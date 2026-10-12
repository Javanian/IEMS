const service = require('../services/msProjectService');

function success(res, data = {}, status = 200, summary = {}, warnings = []) {
  res.status(status).json({
    success: true,
    data,
    summary,
    warnings,
  });
}

function error(res, err) {
  const isDbConflict = ['23503', '23505'].includes(err.code);
  const isPostgresError = Boolean(err.code && err.severity);
  const status = err.status || (isDbConflict ? 409 : 500);
  const code = err.code || 'INTERNAL_SERVER_ERROR';
  const response = {
    success: false,
    code,
    message: status === 500 && !isPostgresError ? 'Internal Server Error' : err.message,
    details: Array.isArray(err.details) ? err.details : err.details ? [err.details] : [],
  };

  if (isDbConflict) {
    response.message = err.detail || err.message || 'Database constraint conflict';
    response.details = [
      {
        constraint: err.constraint || null,
        table: err.table || null,
        detail: err.detail || null,
      },
    ];
  }

  if (isPostgresError && !isDbConflict) {
    response.details = [
      {
        table: err.table || null,
        column: err.column || null,
        constraint: err.constraint || null,
        detail: err.detail || null,
        hint: err.hint || null,
        position: err.position || null,
        where: err.where || null,
        routine: err.routine || null,
      },
    ];
  }

  if (
    code === 'PROJECT_REVISION_CONFLICT' &&
    err.details &&
    err.details.current_revision_no !== undefined
  ) {
    response.current_revision_no = err.details.current_revision_no;
  }

  if (status >= 500) {
    console.error('[ms-project]', code, err.message, {
      detail: err.detail,
      hint: err.hint,
      position: err.position,
      where: err.where,
      routine: err.routine,
    });
  }

  res.status(status).json(response);
}

function actorOf(req) {
  const name = req.headers['x-user-name'];
  const id = req.headers['x-user-id'];
  const v = (name && String(name).trim()) || (id && String(id).trim()) || '';
  return v || null;
}

function actorIdOf(req) {
  const parsed = Number.parseInt(req.headers['x-user-id'], 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function bodyWithSessionActor(req) {
  const body = req.body || {};
  return { ...body, actor: actorOf(req) ?? body.actor, actor_user_id: actorIdOf(req) };
}

function paginationSummary(result = {}) {
  const summary = { limit: result.limit, offset: result.offset };
  if (result.total !== undefined && result.total !== null) {
    summary.total = Number(result.total);
  }
  return summary;
}

function normalizeOverlaps(overlaps) {
  if (Array.isArray(overlaps)) {
    return { rows: overlaps, truncated: false, total: overlaps.length };
  }
  const rows = Array.isArray(overlaps?.rows) ? overlaps.rows : [];
  return {
    rows,
    truncated: Boolean(overlaps?.truncated),
    total:
      Number.isFinite(Number(overlaps?.total)) &&
      overlaps?.total !== null &&
      overlaps?.total !== undefined
        ? Number(overlaps.total)
        : rows.length,
  };
}

function bayOverlapWarnings(overlaps) {
  const { rows, truncated, total } = normalizeOverlaps(overlaps);
  if (!rows.length) return [];
  return [{ type: 'BAY_OVERLAP', occupants: rows, truncated, total }];
}

function route(handler) {
  return async (req, res) => {
    const startedAt = Date.now();
    try {
      const result = await handler(req);
      const durationMs = Date.now() - startedAt;
      console.log('[ms-project]', req.method, req.originalUrl, 200, `${durationMs}ms`);
      return result(res);
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      console.log(
        '[ms-project]',
        req.method,
        req.originalUrl,
        err.status || 500,
        err.code || 'ERROR',
        `${durationMs}ms`
      );
      return error(res, err);
    }
  };
}

exports.health = route(async () => {
  const data = await service.health();
  return (res) => success(res, data);
});

exports.listProjects = route(async (req) => {
  const result = await service.listProjects(req.query);
  return (res) => success(res, result.rows, 200, { limit: result.limit, offset: result.offset });
});

exports.listProjectTasks = route(async (req) => {
  const result = await service.listProjectTasks(req.params.project_id, req.query);
  return (res) => success(res, result.rows);
});

exports.listSowOrders = route(async (req) => {
  const result = await service.listSowOrders(req.query);
  return (res) => success(res, result.rows, 200, paginationSummary(result));
});

exports.getSowOrderOperations = route(async (req) => {
  const result = await service.getSowOrderOperations(req.params.order_no);
  return (res) => success(res, result.rows);
});

exports.listOrderTasks = route(async (req) => {
  const result = await service.listOrderTasks(req.params.order_no);
  return (res) => success(res, result.rows);
});

exports.updateOperationPeople = route(async (req) => {
  const data = await service.updateOperationPeople(req.params.order_no, (req.body || {}).updates);
  return (res) => success(res, data, 200, { updated: data.updated, requested: data.requested });
});

exports.mapSowOperationToTask = route(async (req) => {
  const data = await service.mapSowOperationToTask(
    req.params.project_id,
    bodyWithSessionActor(req)
  );
  return (res) => success(res, data);
});

exports.listBaySchedules = route(async (req) => {
  const result = await service.listBaySchedules(req.query);
  if (!req.query.ignore_sync) {
    await service.syncBayScheduleDates();
  }
  return (res) => success(res, result.rows, 200, paginationSummary(result));
});

exports.listBayScheduleTasks = route(async (req) => {
  const result = await service.listBayScheduleTasks(req.query);
  return (res) => success(res, result.rows, 200, result.summary || {});
});

exports.listBayOccupants = route(async (req) => {
  const data = normalizeOverlaps(await service.listBayOccupants(req.query));
  return (res) => success(res, data, 200, { count: data.rows.length });
});

exports.createBaySchedule = route(async (req) => {
  const data = await service.createBaySchedule(bodyWithSessionActor(req));
  const warnings = bayOverlapWarnings(data.overlaps);

  const dropped = Array.isArray(data.dropped_duplicate_operations)
    ? data.dropped_duplicate_operations
    : [];
  if (dropped.length) {
    warnings.push({ type: 'DUPLICATE_OPERATION_DROPPED', operations: dropped });
  }
  return (res) => success(res, data, 201, {}, warnings);
});

exports.cancelBaySchedule = route(async (req) => {
  const data = await service.cancelBaySchedule(req.params.schedule_id, bodyWithSessionActor(req));
  return (res) => success(res, data);
});

exports.updateBayScheduleGroup = route(async (req) => {
  const data = await service.updateBayScheduleGroup(
    req.params.schedule_group_id,
    bodyWithSessionActor(req)
  );
  return (res) => success(res, data, 200, { count: data.count }, bayOverlapWarnings(data.overlaps));
});

exports.cancelBayScheduleGroup = route(async (req) => {
  const data = await service.cancelBayScheduleGroup(
    req.params.schedule_group_id,
    bodyWithSessionActor(req)
  );
  const cancelled = data.cancelled;
  return (res) =>
    success(res, data, 200, {
      cancelled: Array.isArray(cancelled) ? cancelled.length : (cancelled ?? 0),
    });
});

exports.getProjectPackage = route(async (req) => {
  const data = await service.getProjectPackage(req.params.project_id);
  return (res) => success(res, data);
});

exports.bulkLoadProjects = route(async (req) => {
  const data = await service.bulkLoadProjectPackages(req.body.project_ids);
  return (res) => success(res, data, 200, { count: data.length });
});

exports.listCalendars = route(async (req) => {
  const result = await service.listCalendars(req.query);
  return (res) => success(res, result.rows, 200, { limit: result.limit, offset: result.offset });
});

exports.getCalendar = route(async (req) => {
  const data = await service.getCalendar(req.params.calendar_id);
  return (res) => success(res, data);
});

exports.refreshCalendarsFromShifts = route(async (req) => {
  const summary = await service.refreshCalendarsFromShifts(req.body || {});
  return (res) => success(res, {}, 200, summary, summary.warnings || []);
});

exports.publishProject = route(async (req) => {
  const data = await service.publishProject(req.body);
  return (res) => success(res, data, 201, data.summary || {});
});

exports.uploadProjectFile = route(async (req) => {
  const data = await service.uploadProjectFile(req.params.project_id, req.file);
  return (res) => success(res, data);
});

exports.downloadProjectFile = route(async (req) => {
  const file = await service.getProjectFileForDownload(req.params.project_id);
  return (res) => res.download(file.absolutePath, file.downloadName);
});

exports.listProjectRevisions = route(async (req) => {
  const result = await service.listProjectRevisions(req.params.project_id, req.query);
  return (res) => success(res, result.rows, 200, { limit: result.limit });
});

exports.updateProjectStatus = route(async (req) => {
  const data = await service.updateProjectStatus(req.params.project_id, req.body || {});
  return (res) => success(res, data);
});

exports.updateProjectInfo = route(async (req) => {
  const data = await service.updateProjectInfo(req.params.project_id, {
    ...(req.body || {}),
    actor: actorOf(req) || undefined,
  });
  return (res) => success(res, data);
});

exports.updateProjectTask = route(async (req) => {
  const data = await service.updateProjectTask(req.params.project_id, req.params.task_id, {
    ...(req.body || {}),
    actor: actorOf(req) || undefined,
  });
  return (res) => success(res, data);
});

exports.deleteProject = route(async (req) => {
  const data = await service.deleteProject(req.params.project_id, {
    ...(req.body || {}),
    actor: actorOf(req) || undefined,
  });
  return (res) => success(res, data);
});

exports.checkoutProject = route(async (req) => {
  const data = await service.checkoutProject(req.params.project_id, req.body || {});
  return (res) => success(res, data);
});

exports.heartbeatProject = route(async (req) => {
  const data = await service.heartbeatProject(req.params.project_id, req.body || {});
  return (res) => success(res, data);
});

exports.syncProject = route(async (req) => {
  const data = await service.syncProject(req.params.project_id, req.body);
  return (res) => success(res, data, 200, data.summary || {});
});

exports.publishCurrentRevision = route(async (req) => {
  const data = await service.publishCurrentRevision(req.params.project_id, req.body || {});
  return (res) => success(res, data);
});

exports.checkinProject = route(async (req) => {
  const data = await service.checkinProject(req.params.project_id, req.body || {});
  return (res) => success(res, data);
});

exports.forceCheckinProject = route(async (req) => {
  const data = await service.forceCheckinProject(req.params.project_id, req.body || {});
  return (res) => success(res, data);
});

exports.searchResources = route(async (req) => {
  const result = await service.searchResources(req.query);
  return (res) => success(res, result.rows, 200, { limit: result.limit, offset: result.offset });
});

exports.refreshResources = route(async (req) => {
  const summary = await service.refreshResources(req.body || {});
  return (res) => success(res, {}, 200, summary, summary.warnings || []);
});

exports.getProjectResources = route(async (req) => {
  const data = await service.getProjectResources(req.params.project_id);
  return (res) => success(res, data);
});

exports.addProjectResources = route(async (req) => {
  const data = await service.addProjectResources(
    req.params.project_id,
    req.body.resource_ids || []
  );
  return (res) =>
    success(res, data.rows, 200, {
      project_resources_created: data.created,
      project_resources_updated: data.updated,
    });
});

exports.deactivateProjectResource = route(async (req) => {
  const data = await service.deactivateProjectResource(
    req.params.project_id,
    req.params.resource_id
  );
  return (res) => success(res, data);
});

exports.getConflicts = route(async (req) => {
  const warnings = await service.getConflicts(req.query);
  return (res) => success(res, {}, 200, { warnings: warnings.length }, warnings);
});
