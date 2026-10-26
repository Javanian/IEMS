import net from 'node:net';
import { randomUUID } from 'node:crypto';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:4313';
const SMTP_PORT = Number(process.env.SMTP_PORT || 1025);
const SMTP_HTTP_PORT = Number(process.env.SMTP_HTTP_PORT || 1080);

export async function sendSmtpEmail({ from, to, subject, body, host = '127.0.0.1', port = SMTP_PORT }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    socket.on('data', chunk => {
      const s = chunk.toString('utf-8');
      if (s.startsWith('220')) {
        socket.write('HELO iems-automation\r\n');
      } else if (s.startsWith('250-') || s.startsWith('250 OK')) {
        socket.write(`MAIL FROM:<${from}>\r\n`);
      } else if (s.startsWith('250 2.1.0')) {
        socket.write(`RCPT TO:<${to}>\r\n`);
      } else if (s.startsWith('250 2.1.5')) {
        socket.write('DATA\r\n');
      } else if (s.startsWith('354')) {
        socket.write(`Subject: ${subject}\r\nFrom: ${from}\r\nTo: ${to}\r\n\r\n${body}\r\n.\r\n`);
      } else if (s.startsWith('250 2.0.0 OK: queued')) {
        socket.write('QUIT\r\n');
      } else if (s.startsWith('221')) {
        settled = true;
        socket.end();
        resolve({ sent: true, host, port });
      }
    });

    socket.on('error', err => {
      if (!settled) { settled = true; reject(err); }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error('SMTP socket timeout'));
      }
    }, 5000);
  });
}

export async function executeWorkflow1_SlaEscalation({ apiBase = API_BASE, cookie, ticketId, expectedVersion, smtpPort = SMTP_PORT }) {
  console.log('\n--- [Workflow 1] Ticket SLA Monitor & Re-check Escalation ---');

  // Step 1: Query SLA Breaches
  console.log(`1. Scanning SLA breaches on ${apiBase}...`);
  const breachesRes = await fetch(`${apiBase}/api/cs/automation/sla-breaches?thresholdMinutes=15`, {
    headers: { origin: 'http://localhost:4173', Cookie: cookie, Accept: 'application/json' }
  });
  const breaches = await breachesRes.json();
  console.log(`   Found ${breaches.data?.totalBreached ?? 0} breached tickets`);

  const targetId = ticketId || breaches.data?.items?.[0]?.ticketId;
  const targetVer = expectedVersion ?? breaches.data?.items?.[0]?.expectedVersion;

  if (!targetId) {
    console.log('   No breached ticket found to escalate.');
    return { skipped: true, reason: 'NO_BREACHES' };
  }

  // Step 2: Anti-Stale Re-check
  console.log(`2. Performing anti-stale re-check on ticket ${targetId} (v${targetVer})...`);
  const recheckRes = await fetch(`${apiBase}/api/cs/automation/recheck`, {
    method: 'POST',
    headers: { origin: 'http://localhost:4173', 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ ticketId: targetId, expectedVersion: targetVer, action: 'ESCALATE' })
  });
  const recheck = await recheckRes.json();
  console.log(`   Re-check eligibility: ${recheck.data?.eligible ? 'ELIGIBLE' : 'INELIGIBLE'} (${recheck.data?.reason})`);

  if (!recheck.data?.eligible) {
    return { eligible: false, recheck: recheck.data };
  }

  // Step 3: Dispatch email notification to local SMTP sink
  console.log(`3. Dispatching notification to local SMTP sink on port ${smtpPort}...`);
  try {
    await sendSmtpEmail({
      host: '127.0.0.1',
      port: smtpPort,
      from: 'sla-monitor@iems.local',
      to: 'cs-lead@iems.local',
      subject: `[SLA BREACH ALERT] Ticket ${targetId.slice(0, 8)} Escalation`,
      body: `Ticket ${targetId} has breached the SLA target of 15 minutes. Anti-stale recheck confirmed eligible.`
    });
    console.log('   Email successfully accepted by local mail sink.');
  } catch (err) {
    console.warn('   SMTP sink dispatch notice:', err.message);
  }

  // Step 4: Execute Atomic Escalation with Idempotency Key
  const idemKey = 'n8n-wf1-' + randomUUID();
  console.log(`4. Executing atomic escalation with Idempotency-Key: ${idemKey}...`);
  const escRes = await fetch(`${apiBase}/api/cs/automation/escalate`, {
    method: 'POST',
    headers: {
      origin: 'http://localhost:4173',
      'Content-Type': 'application/json',
      'Idempotency-Key': idemKey,
      Cookie: cookie
    },
    body: JSON.stringify({
      ticketId: targetId,
      expectedVersion: targetVer,
      reason: 'Automated SLA Escalation via Workflow 1'
    })
  });
  const esc = await escRes.json();
  console.log(`   Result: Status ${escRes.status}, New Stage: ${esc.data?.newStage}, Version: ${esc.data?.version}`);

  return { eligible: true, escalation: esc.data };
}

export async function executeWorkflow2_WhatsAppHandoff({ apiBase = API_BASE, cookie, conversationId, ticketId }) {
  console.log('\n--- [Workflow 2] WhatsApp Approval & Hand-off Sync ---');
  const idemKey = 'n8n-wf2-' + randomUUID();

  console.log(`1. Synchronizing WhatsApp handoff for conversation ${conversationId}...`);
  const res = await fetch(`${apiBase}/api/cs/automation/whatsapp-handoff`, {
    method: 'POST',
    headers: {
      origin: 'http://localhost:4173',
      'Content-Type': 'application/json',
      'Idempotency-Key': idemKey,
      Cookie: cookie
    },
    body: JSON.stringify({
      conversationId,
      ticketId,
      operatorNote: 'Tier 2 technical operator takeover via automation workflow'
    })
  });

  const data = await res.json();
  console.log(`   Result: Status ${res.status}, WhatsApp State: ${data.data?.whatsappState}`);
  console.log(`   Disclaimer: ${data.data?.disclaimer}`);
  return data.data;
}

export async function executeWorkflow3_WeeklyDigest({ apiBase = API_BASE, cookie, smtpPort = SMTP_PORT }) {
  console.log('\n--- [Workflow 3] Weekly CS Operations Digest ---');

  // Step 1: Fetch Digest Metrics
  console.log(`1. Generating weekly operations digest summary...`);
  const digRes = await fetch(`${apiBase}/api/cs/automation/digest?days=7`, {
    headers: { origin: 'http://localhost:4173', Cookie: cookie }
  });
  const digest = await digRes.json();
  console.log(`   Compliance: ${digest.data?.summary?.slaComplianceRatePercent}%, Open: ${digest.data?.summary?.currentlyOpenCount}`);

  // Step 2: Send Email via Local SMTP Sink
  console.log(`2. Dispatching digest email to local SMTP sink on port ${smtpPort}...`);
  try {
    await sendSmtpEmail({
      host: '127.0.0.1',
      port: smtpPort,
      from: 'automation-reports@iems.local',
      to: 'reports@iems.local',
      subject: `Weekly CS Operations Digest - ${new Date().toISOString().slice(0, 10)}`,
      body: digest.data?.markdown || 'Digest content'
    });
    console.log('   Digest email accepted by local mail sink.');
  } catch (err) {
    console.warn('   SMTP sink notice:', err.message);
  }

  // Step 3: Record Digest Receipt
  const idemKey = 'n8n-wf3-digest-' + randomUUID();
  console.log(`3. Recording digest receipt with Idempotency-Key: ${idemKey}...`);
  const recRes = await fetch(`${apiBase}/api/cs/automation/digest/record`, {
    method: 'POST',
    headers: {
      origin: 'http://localhost:4173',
      'Content-Type': 'application/json',
      'Idempotency-Key': idemKey,
      Cookie: cookie
    },
    body: JSON.stringify({
      summary: digest.data?.summary,
      recipientEmail: 'reports@iems.local',
      subject: 'Weekly CS Operations Digest'
    })
  });

  const record = await recRes.json();
  console.log(`   Recorded: Digest ID ${record.data?._id}, Status: ${record.data?.receiptStatus}`);
  return record.data;
}
