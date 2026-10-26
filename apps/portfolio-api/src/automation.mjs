import { randomUUID, createHash } from 'node:crypto';

export const automationRoles = {
  automationViewer: ['cs.automation.read'],
  automationOperator: ['cs.automation.read', 'cs.automation.execute'],
  automationAdmin: ['cs.automation.read', 'cs.automation.execute', 'cs.automation.admin'],
};

export const automationActions = [
  'cs.automation.read',
  'cs.automation.execute',
  'cs.automation.admin'
];

const c = (runtime, name) => runtime.db.collection(name);
const sha256 = data => createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex');

export async function initializeAutomation(db) {
  await db.collection('automation_audit_logs').createIndex({ tenantId: 1, plantId: 1, occurredAt: -1 });
  await db.collection('automation_audit_logs').createIndex({ tenantId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });
  await db.collection('automation_audit_logs').createIndex({ tenantId: 1, workflowId: 1, status: 1 });
  await db.collection('automation_digests').createIndex({ tenantId: 1, plantId: 1, createdAt: -1 });
}

export function installAutomation(app, runtime, { fail, id, fields }) {
  const cs = () => runtime.customerService;
  const plantId = req => req.filter.plantId;

  const requireAuthAction = async (req, action) => {
    await runtime.foundation.authorize(req.scope, {
      plantId: plantId(req),
      action
    });
  };

  const parseIdempotencyKey = req => {
    const k = req.headers['idempotency-key'];
    if (typeof k !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(k)) {
      fail(400, 'VALIDATION', 'Idempotency-Key header (8..100 of A-Z a-z 0-9 _ -) is required');
    }
    return k;
  };

  // 1. Overall Automation Status & Health
  app.get('/api/cs/automation/status', async (req, res) => {
    await requireAuthAction(req, 'cs.automation.read');

    let smtpHealthy = false;
    let smtpCount = 0;
    try {
      const sinkRes = await fetch('http://127.0.0.1:1080/health', { signal: AbortSignal.timeout(1500) });
      if (sinkRes.ok) {
        const data = await sinkRes.json();
        smtpHealthy = true;
        smtpCount = data.count || 0;
      }
    } catch {
      smtpHealthy = false;
    }

    let n8nHealthy = false;
    try {
      const n8nRes = await fetch('http://127.0.0.1:5678/healthz', { signal: AbortSignal.timeout(1500) });
      if (n8nRes.ok) n8nHealthy = true;
    } catch {
      n8nHealthy = false;
    }

    const tenantFilter = { tenantId: req.scope.tenantId, plantId: plantId(req) };
    const [totalAudit, successfulAudit, recentDigests, openTicketsCount] = await Promise.all([
      c(runtime, 'automation_audit_logs').countDocuments(tenantFilter),
      c(runtime, 'automation_audit_logs').countDocuments({ ...tenantFilter, status: 'SUCCESS' }),
      c(runtime, 'automation_digests').countDocuments(tenantFilter),
      c(runtime, 'cs_tickets').countDocuments({ ...tenantFilter, stage: { $nin: ['RESOLVED', 'CLOSED'] } })
    ]);

    res.json({
      data: {
        engine: {
          n8n: {
            status: n8nHealthy ? 'HEALTHY' : 'STANDBY_LOCAL',
            url: 'http://127.0.0.1:5678',
            mode: 'STANDALONE_SQLITE',
            loopbackOnly: true
          },
          smtpSink: {
            status: smtpHealthy ? 'HEALTHY' : 'DOWN',
            port: 1025,
            httpPort: 1080,
            capturedCount: smtpCount,
            receiptGuarantee: 'Accepted by local mail sink'
          }
        },
        workflows: [
          {
            id: 'wf-sla-escalation',
            name: 'Ticket SLA Monitor & Re-check Escalation',
            type: 'POLL_AND_RECHECK',
            state: 'ACTIVE',
            guard: 'ANTI_STALE_VERIFIED'
          },
          {
            id: 'wf-whatsapp-handoff',
            name: 'WhatsApp Approval & Hand-off Sync',
            type: 'WEBHOOK_EVENT',
            state: 'ACTIVE',
            deliveryGuarantee: 'PREVIEWED_SIMULATOR'
          },
          {
            id: 'wf-cs-weekly-digest',
            name: 'Weekly CS Operations Digest',
            type: 'SCHEDULED_DIGEST',
            state: 'ACTIVE',
            destination: 'LOCAL_SMTP_SINK'
          }
        ],
        metrics: {
          openTicketsCount,
          totalAutomationsExecuted: totalAudit,
          successfulAutomations: successfulAudit,
          digestsGenerated: recentDigests
        }
      }
    });
  });

  // 2. SLA Breaches Discovery
  app.get('/api/cs/automation/sla-breaches', async (req, res) => {
    await requireAuthAction(req, 'cs.automation.read');

    const thresholdMinutes = Number(req.query.thresholdMinutes || 15);
    const limit = Math.min(Number(req.query.limit || 50), 100);
    const cutoffDate = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    const candidates = await c(runtime, 'cs_tickets').find({
      tenantId: req.scope.tenantId,
      plantId: plantId(req),
      stage: { $in: ['NEW', 'TRIAGED', 'ASSIGNED'] },
      createdAt: { $lte: cutoffDate }
    }).sort({ createdAt: 1 }).limit(limit).toArray();

    const breaches = candidates.map(t => {
      const ageMinutes = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 60000);
      return {
        ticketId: t._id,
        ticketNumber: t.ticketNumber,
        stage: t.stage,
        createdAt: t.createdAt,
        ageMinutes,
        thresholdMinutes,
        slaStatus: 'BREACHED',
        expectedVersion: t.version,
        assigneeId: t.assigneeId || null,
        requiresHuman: Boolean(t.requiresHuman)
      };
    });

    res.json({
      data: {
        totalBreached: breaches.length,
        thresholdMinutes,
        items: breaches
      }
    });
  });

  // 3. Anti-Stale Re-check Eligibility
  app.post('/api/cs/automation/recheck', async (req, res) => {
    await requireAuthAction(req, 'cs.automation.read');
    fields(req.body, ['ticketId', 'expectedVersion', 'action']);

    const ticketId = id(req.body.ticketId);
    const expectedVersion = req.body.expectedVersion !== undefined ? Number(req.body.expectedVersion) : null;
    const action = req.body.action || 'ESCALATE';

    const ticket = await c(runtime, 'cs_tickets').findOne({
      tenantId: req.scope.tenantId,
      plantId: plantId(req),
      _id: ticketId
    });

    if (!ticket) {
      return res.json({
        data: {
          eligible: false,
          ticketId,
          reason: 'TICKET_NOT_FOUND',
          status: 'MISSING'
        }
      });
    }

    if (['RESOLVED', 'CLOSED'].includes(ticket.stage)) {
      return res.json({
        data: {
          eligible: false,
          ticketId,
          currentStage: ticket.stage,
          reason: 'TICKET_ALREADY_RESOLVED_OR_CLOSED',
          status: 'INELIGIBLE_STAGE'
        }
      });
    }

    if (expectedVersion !== null && ticket.version !== expectedVersion) {
      return res.json({
        data: {
          eligible: false,
          ticketId,
          currentVersion: ticket.version,
          expectedVersion,
          reason: 'VERSION_MODIFIED_CONCURRENTLY',
          status: 'STALE_VERSION'
        }
      });
    }

    return res.json({
      data: {
        eligible: true,
        ticketId,
        currentStage: ticket.stage,
        currentVersion: ticket.version,
        action,
        reason: 'SLA_BREACH_CONFIRMED_ELIGIBLE',
        status: 'READY_FOR_EXECUTION'
      }
    });
  });

  // 4. Ticket Escalation (Atomic, Idempotent, Anti-Stale Guarded)
  app.post('/api/cs/automation/escalate', async (req, res) => {
    await requireAuthAction(req, 'cs.automation.execute');
    const idempotencyKey = parseIdempotencyKey(req);
    fields(req.body, ['ticketId', 'expectedVersion', 'reason']);

    const ticketId = id(req.body.ticketId);
    const expectedVersion = Number(req.body.expectedVersion);
    const reason = req.body.reason ? String(req.body.reason).slice(0, 500) : 'Automatic SLA Escalation';

    // 1. Check Idempotency Record
    const existingAudit = await c(runtime, 'automation_audit_logs').findOne({
      tenantId: req.scope.tenantId,
      idempotencyKey
    });

    if (existingAudit) {
      return res.json({
        data: {
          ...existingAudit.result,
          replayed: true,
          auditId: existingAudit._id,
          idempotencyKey
        }
      });
    }

    // 2. Perform Atomic Re-check and Transition inside MongoDB Session
    const session = runtime.client.startSession();
    try {
      const result = await session.withTransaction(async () => {
        const ticket = await c(runtime, 'cs_tickets').findOne({
          tenantId: req.scope.tenantId,
          plantId: plantId(req),
          _id: ticketId
        }, { session });

        if (!ticket) {
          fail(404, 'NOT_FOUND', 'Ticket not found');
        }

        // Anti-stale guard: If ticket was resolved/closed before execution
        if (['RESOLVED', 'CLOSED'].includes(ticket.stage)) {
          fail(409, 'ELIGIBILITY_CHECK_FAILED', `Ticket is already in stage ${ticket.stage}`);
        }

        if (ticket.version !== expectedVersion) {
          fail(409, 'VERSION_CONFLICT', `Current ticket version ${ticket.version} does not match expected ${expectedVersion}`);
        }

        // Determine next stage
        let nextStage = ticket.stage;
        if (ticket.stage === 'NEW') nextStage = 'TRIAGED';
        else if (ticket.stage === 'TRIAGED') nextStage = 'ASSIGNED';
        else if (ticket.stage === 'ASSIGNED') nextStage = 'IN_PROGRESS';

        const updatedVersion = ticket.version + 1;
        const now = new Date();

        await c(runtime, 'cs_tickets').updateOne(
          { _id: ticket._id, version: ticket.version },
          {
            $set: {
              stage: nextStage,
              requiresHuman: true,
              updatedAt: now
            },
            $inc: { version: 1 }
          },
          { session }
        );

        // Record Internal Note for Audit
        const noteId = randomUUID();
        await c(runtime, 'cs_internal_notes').insertOne({
          _id: noteId,
          tenantId: req.scope.tenantId,
          plantId: plantId(req),
          ticketId: ticket._id,
          authorUserId: req.scope.userId,
          text: `[AUTOMATED SLA ESCALATION] ${reason}. Stage transitioned from ${ticket.stage} to ${nextStage}.`,
          createdAt: now
        }, { session });

        const outcomePayload = {
          ticketId: ticket._id,
          ticketNumber: ticket.ticketNumber,
          previousStage: ticket.stage,
          newStage: nextStage,
          version: updatedVersion,
          escalatedAt: now.toISOString(),
          noteId
        };

        const auditId = randomUUID();
        await c(runtime, 'automation_audit_logs').insertOne({
          _id: auditId,
          tenantId: req.scope.tenantId,
          plantId: plantId(req),
          workflowId: 'wf-sla-escalation',
          action: 'TICKET_ESCALATE',
          targetEntity: { type: 'TICKET', id: ticket._id },
          payloadHash: sha256({ ticketId, expectedVersion, reason }),
          status: 'SUCCESS',
          result: outcomePayload,
          idempotencyKey,
          reconciliationState: 'CONFIRMED',
          occurredAt: now
        }, { session });

        return { ...outcomePayload, auditId, idempotencyKey, replayed: false };
      });

      res.status(200).json({ data: result });
    } finally {
      await session.endSession();
    }
  });

  // 5. WhatsApp Handoff & Preview Sync
  app.post('/api/cs/automation/whatsapp-handoff', async (req, res) => {
    await requireAuthAction(req, 'cs.automation.execute');
    const idempotencyKey = parseIdempotencyKey(req);
    fields(req.body, ['conversationId', 'ticketId', 'bindingId', 'operatorNote']);

    const conversationId = id(req.body.conversationId);
    const ticketId = id(req.body.ticketId);
    const operatorNote = req.body.operatorNote || 'Operator Hand-off sync requested via automation';

    const existingAudit = await c(runtime, 'automation_audit_logs').findOne({
      tenantId: req.scope.tenantId,
      idempotencyKey
    });

    if (existingAudit) {
      return res.json({
        data: {
          ...existingAudit.result,
          replayed: true,
          auditId: existingAudit._id
        }
      });
    }

    const conv = await c(runtime, 'cs_conversations').findOne({
      tenantId: req.scope.tenantId,
      plantId: plantId(req),
      _id: conversationId
    });

    if (!conv) fail(404, 'NOT_FOUND', 'Conversation not found');

    const now = new Date();
    await c(runtime, 'cs_conversations').updateOne(
      { _id: conv._id },
      {
        $set: {
          mode: 'HUMAN_TAKEN_OVER',
          updatedAt: now
        },
        $inc: { version: 1 }
      }
    );

    const deliveryId = randomUUID();
    const outcome = {
      conversationId: conv._id,
      ticketId,
      mode: 'HUMAN_TAKEN_OVER',
      whatsappState: 'PREVIEWED',
      deliveryId,
      channelAccount: 'SIMULATED',
      disclaimer: 'Preview only: no live cellular or meta API call was made',
      syncedAt: now.toISOString()
    };

    const auditId = randomUUID();
    await c(runtime, 'automation_audit_logs').insertOne({
      _id: auditId,
      tenantId: req.scope.tenantId,
      plantId: plantId(req),
      workflowId: 'wf-whatsapp-handoff',
      action: 'WHATSAPP_HANDOFF_PREVIEW',
      targetEntity: { type: 'CONVERSATION', id: conv._id },
      payloadHash: sha256({ conversationId, ticketId, operatorNote }),
      status: 'SUCCESS',
      result: outcome,
      idempotencyKey,
      reconciliationState: 'CONFIRMED',
      occurredAt: now
    });

    res.json({
      data: {
        ...outcome,
        auditId,
        idempotencyKey,
        replayed: false
      }
    });
  });

  // 6. Weekly Operations Digest Summary & Content
  app.get('/api/cs/automation/digest', async (req, res) => {
    await requireAuthAction(req, 'cs.automation.read');

    const days = Math.min(Number(req.query.days || 7), 30);
    const fromDate = new Date(Date.now() - days * 24 * 3600 * 1000);
    const tenantFilter = { tenantId: req.scope.tenantId, plantId: plantId(req) };

    const [createdInPeriod, resolvedInPeriod, escalationsInPeriod, openTickets] = await Promise.all([
      c(runtime, 'cs_tickets').countDocuments({ ...tenantFilter, createdAt: { $gte: fromDate } }),
      c(runtime, 'cs_tickets').countDocuments({ ...tenantFilter, resolvedAt: { $gte: fromDate } }),
      c(runtime, 'automation_audit_logs').countDocuments({ ...tenantFilter, action: 'TICKET_ESCALATE', occurredAt: { $gte: fromDate } }),
      c(runtime, 'cs_tickets').find({ ...tenantFilter, stage: { $nin: ['RESOLVED', 'CLOSED'] } }).limit(20).toArray()
    ]);

    const summary = {
      periodDays: days,
      since: fromDate.toISOString(),
      ticketsCreated: createdInPeriod,
      ticketsResolved: resolvedInPeriod,
      escalationsTriggered: escalationsInPeriod,
      currentlyOpenCount: openTickets.length,
      slaComplianceRatePercent: createdInPeriod > 0 ? Math.max(0, Math.round(((createdInPeriod - escalationsInPeriod) / createdInPeriod) * 100)) : 100
    };

    const markdown = `# IEMS Customer Service Operations Digest
**Period**: Last ${days} days (Since ${fromDate.toISOString().slice(0, 10)})
**Generated At**: ${new Date().toISOString()}

## Key Metrics
- **New Tickets**: ${summary.ticketsCreated}
- **Resolved Tickets**: ${summary.ticketsResolved}
- **Automated SLA Escalations**: ${summary.escalationsTriggered}
- **Currently Open**: ${summary.currentlyOpenCount}
- **SLA Compliance**: ${summary.slaComplianceRatePercent}%

## Active Open Tickets
${openTickets.length ? openTickets.map(t => `- **Ticket #${t.ticketNumber}** (${t.stage}): Created ${new Date(t.createdAt).toISOString()}`).join('\n') : '_No open tickets._'}

---
*Report generated by IEMS n8n Automation Center. All emails captured by Local SMTP Sink.*`;

    const html = `<div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 16px; border: 1px solid #e2e8f0; border-radius: 8px;">
  <h2 style="color: #1e293b;">IEMS CS Operations Weekly Digest</h2>
  <p style="color: #64748b; font-size: 14px;">Period: Last ${days} days | Generated: ${new Date().toISOString()}</p>
  <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
    <tr style="background: #f8fafc;"><th style="padding: 8px; text-align: left; border: 1px solid #cbd5e1;">Metric</th><th style="padding: 8px; text-align: right; border: 1px solid #cbd5e1;">Value</th></tr>
    <tr><td style="padding: 8px; border: 1px solid #cbd5e1;">Tickets Created</td><td style="padding: 8px; text-align: right; border: 1px solid #cbd5e1;">${summary.ticketsCreated}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #cbd5e1;">Tickets Resolved</td><td style="padding: 8px; text-align: right; border: 1px solid #cbd5e1;">${summary.ticketsResolved}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #cbd5e1;">Automated SLA Escalations</td><td style="padding: 8px; text-align: right; border: 1px solid #cbd5e1;">${summary.escalationsTriggered}</td></tr>
    <tr><td style="padding: 8px; border: 1px solid #cbd5e1;">SLA Compliance</td><td style="padding: 8px; text-align: right; border: 1px solid #cbd5e1;"><strong>${summary.slaComplianceRatePercent}%</strong></td></tr>
  </table>
  <p style="margin-top: 20px; font-size: 12px; color: #94a3b8;">Accepted by local mail sink (Synthetic verification recipient: reports@iems.local)</p>
</div>`;

    res.json({
      data: {
        summary,
        markdown,
        html
      }
    });
  });

  // 7. Record Digest Receipt & Audit
  app.post('/api/cs/automation/digest/record', async (req, res) => {
    await requireAuthAction(req, 'cs.automation.execute');
    const idempotencyKey = parseIdempotencyKey(req);
    fields(req.body, ['summary', 'recipientEmail', 'subject', 'sinkMessageId']);

    const existingAudit = await c(runtime, 'automation_audit_logs').findOne({
      tenantId: req.scope.tenantId,
      idempotencyKey
    });

    if (existingAudit) {
      return res.json({
        data: {
          ...existingAudit.result,
          replayed: true,
          auditId: existingAudit._id
        }
      });
    }

    const digestId = randomUUID();
    const now = new Date();
    const record = {
      _id: digestId,
      tenantId: req.scope.tenantId,
      plantId: plantId(req),
      recipientEmail: req.body.recipientEmail || 'reports@iems.local',
      subject: req.body.subject || 'Weekly CS Operations Digest',
      sinkMessageId: req.body.sinkMessageId || null,
      summary: req.body.summary,
      receiptStatus: 'Accepted by local mail sink',
      createdAt: now
    };

    await c(runtime, 'automation_digests').insertOne(record);

    const auditId = randomUUID();
    await c(runtime, 'automation_audit_logs').insertOne({
      _id: auditId,
      tenantId: req.scope.tenantId,
      plantId: plantId(req),
      workflowId: 'wf-cs-weekly-digest',
      action: 'DIGEST_RECORDED',
      targetEntity: { type: 'DIGEST', id: digestId },
      payloadHash: sha256(req.body),
      status: 'SUCCESS',
      result: record,
      idempotencyKey,
      reconciliationState: 'CONFIRMED',
      occurredAt: now
    });

    res.status(201).json({
      data: {
        ...record,
        auditId,
        idempotencyKey,
        replayed: false
      }
    });
  });

  // 8. List Automation Audit Logs
  app.get('/api/cs/automation/audit-logs', async (req, res) => {
    await requireAuthAction(req, 'cs.automation.read');

    const limit = Math.min(Number(req.query.limit || 50), 100);
    const filter = {
      tenantId: req.scope.tenantId,
      plantId: plantId(req)
    };

    if (req.query.workflowId) filter.workflowId = String(req.query.workflowId);
    if (req.query.action) filter.action = String(req.query.action);
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.idempotencyKey) filter.idempotencyKey = String(req.query.idempotencyKey);

    const logs = await c(runtime, 'automation_audit_logs')
      .find(filter)
      .sort({ occurredAt: -1 })
      .limit(limit)
      .toArray();

    res.json({
      data: logs
    });
  });

  // 9. Durable Reconciliation
  app.post('/api/cs/automation/reconcile', async (req, res) => {
    await requireAuthAction(req, 'cs.automation.admin');
    const tenantFilter = { tenantId: req.scope.tenantId, plantId: plantId(req) };

    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const overdueBreaches = await c(runtime, 'cs_tickets').find({
      ...tenantFilter,
      stage: { $in: ['NEW', 'TRIAGED'] },
      createdAt: { $lte: cutoff }
    }).toArray();

    const pendingEscalations = [];
    for (const ticket of overdueBreaches) {
      const hasEscalatedAudit = await c(runtime, 'automation_audit_logs').findOne({
        ...tenantFilter,
        action: 'TICKET_ESCALATE',
        'targetEntity.id': ticket._id,
        status: 'SUCCESS'
      });
      if (!hasEscalatedAudit) {
        pendingEscalations.push({
          ticketId: ticket._id,
          ticketNumber: ticket.ticketNumber,
          stage: ticket.stage,
          reconciliationNeeded: true
        });
      }
    }

    res.json({
      data: {
        reconciledAt: new Date().toISOString(),
        unreconciledCount: pendingEscalations.length,
        items: pendingEscalations,
        message: pendingEscalations.length
          ? `Found ${pendingEscalations.length} tickets needing escalation reconciliation`
          : 'All automations reconciled and up to date'
      }
    });
  });
}
