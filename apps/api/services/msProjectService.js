const dbModule = require('../db');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const MAX_LIMIT = 100;

const BAY_SCHEDULE_MAX_LIMIT = 5000;

const BAY_OVERLAP_LIMIT = 50;
const NON_EXPIRING_LOCK_INTERVAL = '100 years';
const RESOURCE_CATEGORIES = new Set(['PERSON', 'MACHINE', 'WORKCENTER', 'TEAM']);
const RESOURCE_REFRESH_SOURCES = new Set(['WORKCENTER', 'MACHINE', 'EMPLOYEE']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ApiError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function pool() {
  return global.pool || dbModule.pool || dbModule;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function nullableText(value) {
  const text = normalizeText(value);
  return text || null;
}

function stripMppExtension(value) {
  const text = normalizeText(value);
  if (text.toLowerCase().endsWith('.mpp')) return text.slice(0, -4).trim();
  return text;
}

function mppFileName(value, fallback) {
  const baseName = stripMppExtension(value) || normalizeText(fallback) || 'project';
  return `${baseName}.mpp`;
}

function assertUuid(value, fieldName = 'id') {
  const text = normalizeText(value);
  if (!UUID_RE.test(text)) {
    throw new ApiError(400, 'INVALID_UUID', `${fieldName} must be a valid UUID`, [
      { field: fieldName },
    ]);
  }
  return text;
}

function isUuid(value) {
  return UUID_RE.test(normalizeText(value));
}

function optionalUuid(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  return assertUuid(value, fieldName);
}

function normalizeUuidArray(values, fieldName) {
  if (!Array.isArray(values)) {
    throw new ApiError(400, 'INVALID_PAYLOAD', `${fieldName} must be an array`, [
      { field: fieldName },
    ]);
  }
  return values.map((value, index) => assertUuid(value, `${fieldName}[${index}]`));
}

function clampLimit(value, fallback = 50, max = MAX_LIMIT) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

function clampOffset(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

function toBool(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = normalizeText(value).toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(text)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function toNullableInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveNumber(value, fieldName, fallback = 1) {
  const parsed = value === undefined || value === null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ApiError(400, 'INVALID_UNITS', `${fieldName} must be greater than 0`, [
      { field: fieldName },
    ]);
  }
  return parsed;
}

function normalizeCategory(value) {
  const text = normalizeText(value).toUpperCase();
  if (!text) return null;
  if (!RESOURCE_CATEGORIES.has(text)) {
    throw new ApiError(400, 'INVALID_RESOURCE_CATEGORY', 'Unsupported resource category', [
      { category: value },
    ]);
  }
  return text;
}

function ensureObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_PAYLOAD', `${fieldName} must be an object`, [
      { field: fieldName },
    ]);
  }
  return value;
}

function ensureArray(value, fieldName) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_PAYLOAD', `${fieldName} must be an array`, [
      { field: fieldName },
    ]);
  }
  return value;
}

function makeDependencyKey(dep) {
  const pred = normalizeText(dep.predecessor_local_task_uid || dep.predecessor_task_id);
  const succ = normalizeText(dep.successor_local_task_uid || dep.successor_task_id);
  const type = normalizeText(dep.dependency_type || 'FS').toUpperCase();
  const lag = toNullableInt(dep.lag_minutes) ?? 0;
  return `${pred}|${succ}|${type}|${lag}`;
}

function mapProject(row) {
  if (!row) return null;
  return {
    project_id: row.project_id,
    project_name: row.project_name,
    description: row.description,
    status: row.status,
    source_type: row.source_type,
    revision_no: row.revision_no,
    published_revision_no: row.published_revision_no,
    last_published_at: row.last_published_at,
    file_path: row.file_path,
    file_name: row.file_name,
    file_size: row.file_size === null || row.file_size === undefined ? null : Number(row.file_size),
    file_uploaded_at: row.file_uploaded_at,
    checked_out_by: row.checked_out_by,
    checked_out_at: row.checked_out_at,
    calendar_id: row.calendar_id,
    calendar_name: row.calendar_name,
    created_by: row.created_by,
    updated_by: row.updated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildPackage(rows) {
  return {
    project: mapProject(rows.project),
    project_resources: rows.project_resources || [],
    tasks: rows.tasks || [],
    assignments: rows.assignments || [],
    dependencies: rows.dependencies || [],
  };
}

function actorFromBody(body, fallback = 'ms-project-vba') {
  return (
    nullableText(body?.actor || body?.user || body?.updated_by || body?.created_by) || fallback
  );
}

async function writeAuditLog(
  client,
  { projectId = null, action, actor = null, lockToken = null, revisionNo = null, details = {} }
) {
  await client.query(
    `insert into ms_project_audit_log (project_id, action, actor, lock_token, revision_no, details)
     values ($1, $2, $3, $4, $5, $6::jsonb)`,
    [projectId, action, actor, lockToken, revisionNo, JSON.stringify(details || {})]
  );
}

async function snapshotProject(client, projectId) {
  return queryProjectPackage(client, projectId);
}

async function writeRevisionSnapshot(
  client,
  { projectId, revisionNo, revisionType, actor, snapshot }
) {
  await client.query(
    `insert into ms_project_revision (project_id, revision_no, revision_type, snapshot, created_by)
     values ($1, $2, $3, $4::jsonb, $5)
     on conflict (project_id, revision_no, revision_type)
     do update set snapshot = excluded.snapshot, created_by = excluded.created_by, created_at = now()`,
    [projectId, revisionNo, revisionType, JSON.stringify(snapshot), actor]
  );
}

async function writePublishSnapshot(client, { projectId, revisionNo, actor, snapshot }) {
  await client.query(
    `insert into ms_project_publish (project_id, revision_no, snapshot, published_by)
     values ($1, $2, $3::jsonb, $4)
     on conflict (project_id, revision_no)
     do update set snapshot = excluded.snapshot, published_by = excluded.published_by, published_at = now()`,
    [projectId, revisionNo, JSON.stringify(snapshot), actor]
  );
  await client.query(
    `update ms_project
     set published_revision_no = $2,
         last_published_at = now(),
         updated_by = coalesce($3::text, updated_by)
     where project_id = $1`,
    [projectId, revisionNo, actor]
  );
}

async function getActiveLock(client, projectId) {
  const result = await client.query(
    `select *
     from ms_project_lock
     where project_id = $1
     for update`,
    [projectId]
  );
  return result.rows[0] || null;
}

async function requireValidLock(client, projectId, lockToken, actionName) {
  const token = nullableText(lockToken);
  if (!token) {
    throw new ApiError(
      423,
      'PROJECT_LOCK_REQUIRED',
      `${actionName} requires a valid checkout lock_token`
    );
  }
  const result = await client.query(
    `select *
     from ms_project_lock
     where project_id = $1
       and lock_token = $2
     for update`,
    [projectId, token]
  );
  const lock = result.rows[0];
  if (!lock) {
    throw new ApiError(
      423,
      'PROJECT_LOCK_INVALID',
      'Project lock is missing or owned by another session'
    );
  }
  return lock;
}

async function queryProjectPackage(client, projectId) {
  const [project, projectResources, tasks, assignments, dependencies] = await Promise.all([
    client.query('select * from ms_project where project_id = $1', [projectId]),
    client.query(
      `select
         pr.project_resource_id,
         pr.project_id,
         pr.resource_id,
         pr.is_active as project_resource_is_active,
         r.resource_code,
         r.resource_name,
         r.resource_type,
         r.resource_category,
         r.source_type,
         r.source_ref_id,
         r.employee_id,
         r.machine_id,
         r.workcenter_code,
         r.parent_resource_id,
         r.max_units,
         r.calendar_id,
         r.calendar_name,
         rc.calendar_code as resource_calendar_code,
         rc.calendar_name as resource_calendar_name,
         r.is_assignable,
         r.is_generic,
         r.is_active as resource_is_active,
         pr.created_at,
         pr.updated_at
       from ms_project_resource pr
       join ms_resource r on r.resource_id = pr.resource_id
       left join ms_project_calendar rc on rc.calendar_id = r.calendar_id
       where pr.project_id = $1
       order by r.resource_category, r.resource_code`,
      [projectId]
    ),
    client.query(
      `select
         t.*,
         sched.area_code,
         sched.area_name,
         array_to_string(sched.bay_codes, ', ') as bay_codes
       from ms_project_task t
       left join lateral (
         select area_code, area_name, bay_codes
         from ms_project_bay_schedule s
         where s.task_id = t.task_id
           and s.project_id = t.project_id
           and s.status in ('RESERVED', 'CONFIRMED')
         order by s.start_date desc, s.created_at desc
         limit 1
       ) sched on true
       where t.project_id = $1
         and t.is_active = true
       order by t.outline_number nulls last, t.created_at, t.task_name`,
      [projectId]
    ),
    client.query(
      `select *
       from ms_project_assignment
       where project_id = $1
         and is_active = true
       order by created_at, assignment_id`,
      [projectId]
    ),
    client.query(
      `select *
       from ms_project_dependency
       where project_id = $1
         and is_active = true
       order by created_at, dependency_id`,
      [projectId]
    ),
  ]);

  if (!project.rows[0]) {
    throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }

  return buildPackage({
    project: project.rows[0],
    project_resources: projectResources.rows,
    tasks: tasks.rows,
    assignments: assignments.rows,
    dependencies: dependencies.rows,
  });
}

function normalizeProjectPayload(payload, isSync = false) {
  const body = ensureObject(payload, 'payload');
  const project = ensureObject(body.project || {}, 'project');
  const projectName = nullableText(stripMppExtension(project.project_name || project.name));

  if (!isSync && !projectName) {
    throw new ApiError(400, 'INVALID_PROJECT', 'project.project_name is required');
  }

  return {
    project: {
      project_id: project.project_id ? assertUuid(project.project_id, 'project.project_id') : null,
      project_name: projectName,
      description: nullableText(project.description),
      status: nullableText(project.status) || (isSync ? null : 'ACTIVE'),
      calendar_id: optionalUuid(project.calendar_id, 'project.calendar_id'),
      calendar_name: nullableText(project.calendar_name || project.calendar),
      last_known_revision_no: toNullableInt(project.last_known_revision_no),
      lock_token: nullableText(project.lock_token || body.lock_token),
      created_by: nullableText(project.created_by),
      updated_by: nullableText(project.updated_by),
    },
    project_resources: ensureArray(body.project_resources, 'project_resources'),
    tasks: ensureArray(body.tasks, 'tasks'),
    assignments: ensureArray(body.assignments, 'assignments'),
    dependencies: ensureArray(body.dependencies, 'dependencies'),
    deactivate: body.deactivate && typeof body.deactivate === 'object' ? body.deactivate : {},
  };
}

function normalizeTaskPayload(task, index, isPublish) {
  const taskId = task.task_id ? assertUuid(task.task_id, `tasks[${index}].task_id`) : null;
  const localTaskUid = nullableText(task.local_task_uid);
  const hasParentReference =
    Object.prototype.hasOwnProperty.call(task, 'parent_task_id') ||
    Object.prototype.hasOwnProperty.call(task, 'parent_local_task_uid');
  if (!taskId && !localTaskUid) {
    throw new ApiError(400, 'LOCAL_TASK_UID_REQUIRED', 'New task must include local_task_uid', [
      { index },
    ]);
  }
  return {
    task_id: isPublish ? null : taskId,
    local_task_uid: localTaskUid,
    has_parent_reference: hasParentReference,
    parent_task_id: task.parent_task_id
      ? assertUuid(task.parent_task_id, `tasks[${index}].parent_task_id`)
      : null,
    parent_local_task_uid: nullableText(task.parent_local_task_uid),
    task_name: nullableText(task.task_name || task.name) || 'Untitled Task',
    outline_level: toNullableInt(task.outline_level),
    outline_number: nullableText(task.outline_number),
    order_no: nullableText(task.order_no),
    operation_no: nullableText(task.operation_no),
    ssbr_id: nullableText(task.ssbr_id),
    sow_id: toNullableInt(task.sow_id),
    workcenter: nullableText(task.workcenter),
    plan_start: nullableText(task.plan_start),
    plan_finish: nullableText(task.plan_finish),
    duration_minutes: toNullableInt(task.duration_minutes),
    planned_work_minutes: toNullableInt(task.planned_work_minutes),
    calendar_id: optionalUuid(task.calendar_id, `tasks[${index}].calendar_id`),
    calendar_name: nullableText(task.calendar_name || task.calendar),
    ignore_resource_calendar: toBool(task.ignore_resource_calendar, false) === true,
    is_summary: Boolean(task.is_summary),
    is_active: task.is_active === undefined ? true : Boolean(task.is_active),
  };
}

async function validateCalendarIds(client, values) {
  const ids = Array.from(new Set(values.filter(Boolean)));
  if (!ids.length) return;

  const result = await client.query(
    `select calendar_id
     from ms_project_calendar
     where calendar_id = any($1::uuid[])
       and is_active = true`,
    [ids]
  );
  const found = new Set(result.rows.map((row) => row.calendar_id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new ApiError(
      400,
      'INVALID_CALENDAR',
      'One or more calendar_id values are invalid or inactive',
      missing
    );
  }
}

function normalizeAssignmentPayload(assignment, index, isPublish) {
  const assignmentId = assignment.assignment_id
    ? assertUuid(assignment.assignment_id, `assignments[${index}].assignment_id`)
    : null;
  const localAssignmentUid = nullableText(assignment.local_assignment_uid);
  if (!assignmentId && !localAssignmentUid) {
    throw new ApiError(
      400,
      'LOCAL_ASSIGNMENT_UID_REQUIRED',
      'New assignment must include local_assignment_uid',
      [{ index }]
    );
  }
  return {
    assignment_id: isPublish ? null : assignmentId,
    local_assignment_uid: localAssignmentUid,
    task_id: assignment.task_id
      ? assertUuid(assignment.task_id, `assignments[${index}].task_id`)
      : null,
    local_task_uid: nullableText(assignment.local_task_uid),
    resource_id: assertUuid(assignment.resource_id, `assignments[${index}].resource_id`),
    assignment_units: toPositiveNumber(
      assignment.assignment_units,
      `assignments[${index}].assignment_units`,
      1
    ),
    planned_work_minutes: toNullableInt(assignment.planned_work_minutes),
    assignment_start: nullableText(assignment.assignment_start),
    assignment_finish: nullableText(assignment.assignment_finish),
    is_active: assignment.is_active === undefined ? true : Boolean(assignment.is_active),
  };
}

function normalizeDependencyPayload(dep, index, isPublish) {
  const dependencyId = dep.dependency_id
    ? assertUuid(dep.dependency_id, `dependencies[${index}].dependency_id`)
    : null;
  const localDependencyKey = nullableText(dep.local_dependency_key) || makeDependencyKey(dep);
  if (!dependencyId && !localDependencyKey) {
    throw new ApiError(
      400,
      'LOCAL_DEPENDENCY_KEY_REQUIRED',
      'New dependency must include local_dependency_key',
      [{ index }]
    );
  }
  return {
    dependency_id: isPublish ? null : dependencyId,
    local_dependency_key: localDependencyKey,
    predecessor_task_id: dep.predecessor_task_id
      ? assertUuid(dep.predecessor_task_id, `dependencies[${index}].predecessor_task_id`)
      : null,
    predecessor_local_task_uid: nullableText(dep.predecessor_local_task_uid),
    successor_task_id: dep.successor_task_id
      ? assertUuid(dep.successor_task_id, `dependencies[${index}].successor_task_id`)
      : null,
    successor_local_task_uid: nullableText(dep.successor_local_task_uid),
    dependency_type: nullableText(dep.dependency_type) || 'FS',
    lag_minutes: toNullableInt(dep.lag_minutes) ?? 0,
    is_active: dep.is_active === undefined ? true : Boolean(dep.is_active),
  };
}

async function validateProjectResources(client, resourceIds) {
  const ids = Array.from(new Set(resourceIds));
  if (ids.length === 0) return [];

  const result = await client.query(
    `select resource_id, resource_code, resource_name, is_active, is_assignable
     from ms_resource
     where resource_id = any($1::uuid[])`,
    [ids]
  );
  const found = new Map(result.rows.map((row) => [row.resource_id, row]));
  const errors = [];

  for (const id of ids) {
    const row = found.get(id);
    if (!row) {
      errors.push({ resource_id: id, reason: 'NOT_FOUND' });
    } else if (!row.is_active) {
      errors.push({ resource_id: id, reason: 'INACTIVE' });
    } else if (!row.is_assignable) {
      errors.push({ resource_id: id, reason: 'NOT_ASSIGNABLE' });
    }
  }

  if (errors.length) {
    throw new ApiError(
      400,
      'INVALID_PROJECT_RESOURCE',
      'One or more resources are not valid for assignment',
      errors
    );
  }

  return result.rows;
}

function extractProjectResourceIds(projectResources) {
  return projectResources.map((item, index) => {
    if (typeof item === 'string') return assertUuid(item, `project_resources[${index}]`);
    if (!item || typeof item !== 'object') {
      throw new ApiError(
        400,
        'INVALID_PROJECT_RESOURCE',
        'project_resources item must be object or UUID',
        [{ index }]
      );
    }
    return assertUuid(item.resource_id, `project_resources[${index}].resource_id`);
  });
}

async function upsertProjectResources(client, projectId, projectResources) {
  const resourceIds = Array.from(new Set(extractProjectResourceIds(projectResources)));
  await validateProjectResources(client, resourceIds);

  let created = 0;
  let updated = 0;
  const rows = [];

  for (const resourceId of resourceIds) {
    const result = await client.query(
      `insert into ms_project_resource (project_id, resource_id, is_active)
       values ($1, $2, true)
       on conflict (project_id, resource_id)
       do update set is_active = true, updated_at = now()
       returning *, (xmax = 0) as inserted`,
      [projectId, resourceId]
    );
    rows.push(result.rows[0]);
    if (result.rows[0].inserted) created += 1;
    else updated += 1;
  }

  return { rows, created, updated, resourceIds };
}

async function ensureResourceInProjectTeam(client, projectId, resourceIds) {
  const ids = Array.from(new Set(resourceIds));
  if (!ids.length) return;
  const result = await client.query(
    `select pr.resource_id
     from ms_project_resource pr
     join ms_resource r on r.resource_id = pr.resource_id
     where pr.project_id = $1
       and pr.resource_id = any($2::uuid[])
       and pr.is_active = true
       and r.is_active = true
       and r.is_assignable = true`,
    [projectId, ids]
  );
  const found = new Set(result.rows.map((row) => row.resource_id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new ApiError(
      400,
      'RESOURCE_NOT_IN_PROJECT_TEAM',
      'Assignments may only use active project team resources',
      missing
    );
  }
}

function resolveTaskId(item, taskMap, fieldName) {
  if (item.task_id) return item.task_id;
  const local = nullableText(item.local_task_uid);
  if (local && taskMap.has(local)) return taskMap.get(local);
  throw new ApiError(400, 'TASK_REFERENCE_NOT_FOUND', `${fieldName} could not be resolved`, {
    task_id: item.task_id || null,
    local_task_uid: local,
  });
}

function resolveDependencyTaskId(taskId, localTaskUid, taskMap, fieldName) {
  if (taskId) return taskId;
  if (localTaskUid && taskMap.has(localTaskUid)) return taskMap.get(localTaskUid);
  throw new ApiError(400, 'TASK_REFERENCE_NOT_FOUND', `${fieldName} could not be resolved`, {
    task_id: taskId || null,
    local_task_uid: localTaskUid || null,
  });
}

async function upsertTasks(client, projectId, tasks, isPublish) {
  const normalized = tasks.map((task, index) => normalizeTaskPayload(task, index, isPublish));
  const localTaskMap = new Map();
  const mappings = [];
  let created = 0;
  let updated = 0;

  for (const task of normalized) {
    let result;
    if (!isPublish && task.task_id) {
      result = await client.query(
        `update ms_project_task
         set task_name = $3,
             outline_level = $4,
             outline_number = $5,
             order_no = $6,
             operation_no = $7,
             ssbr_id = $8,
             sow_id = $9,
             workcenter = $10,
             plan_start = $11,
             plan_finish = $12,
             duration_minutes = $13,
             planned_work_minutes = $14,
             is_summary = $15,
             is_active = $16,
             local_task_uid = case
               when local_task_uid is null
                and $17::text is not null
                and not exists (
                  select 1 from ms_project_task x
                  where x.project_id = $1
                    and x.local_task_uid = $17::text
                    and x.task_id <> $2
                )
               then $17::text
               else local_task_uid
             end,
             calendar_id = $18,
             calendar_name = $19,
             ignore_resource_calendar = $20
         where project_id = $1 and task_id = $2
         returning task_id, local_task_uid`,
        [
          projectId,
          task.task_id,
          task.task_name,
          task.outline_level,
          task.outline_number,
          task.order_no,
          task.operation_no,
          task.ssbr_id,
          task.sow_id,
          task.workcenter,
          task.plan_start,
          task.plan_finish,
          task.duration_minutes,
          task.planned_work_minutes,
          task.is_summary,
          task.is_active,
          task.local_task_uid,
          task.calendar_id,
          task.calendar_name,
          task.ignore_resource_calendar,
        ]
      );
      if (!result.rows[0]) {
        throw new ApiError(404, 'TASK_NOT_FOUND', 'Task not found in project', [
          { task_id: task.task_id },
        ]);
      }
      updated += 1;
    } else {
      result = await client.query(
        `insert into ms_project_task (
           project_id, parent_task_id, task_name, outline_level, outline_number,
           order_no, operation_no, ssbr_id, sow_id, workcenter,
           plan_start, plan_finish, duration_minutes, planned_work_minutes,
           is_summary, is_active, local_task_uid, calendar_id, calendar_name,
           ignore_resource_calendar
         )
         values ($1, null, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         on conflict (project_id, local_task_uid)
         where local_task_uid is not null
         do update set
           task_name = excluded.task_name,
           outline_level = excluded.outline_level,
           outline_number = excluded.outline_number,
           order_no = excluded.order_no,
           operation_no = excluded.operation_no,
           ssbr_id = excluded.ssbr_id,
           sow_id = excluded.sow_id,
           workcenter = excluded.workcenter,
           plan_start = excluded.plan_start,
           plan_finish = excluded.plan_finish,
           duration_minutes = excluded.duration_minutes,
           planned_work_minutes = excluded.planned_work_minutes,
           is_summary = excluded.is_summary,
           is_active = excluded.is_active,
           calendar_id = excluded.calendar_id,
           calendar_name = excluded.calendar_name,
           ignore_resource_calendar = excluded.ignore_resource_calendar,
           parent_task_id = null,
           updated_at = now()
         returning task_id, local_task_uid, (xmax = 0) as inserted`,
        [
          projectId,
          task.task_name,
          task.outline_level,
          task.outline_number,
          task.order_no,
          task.operation_no,
          task.ssbr_id,
          task.sow_id,
          task.workcenter,
          task.plan_start,
          task.plan_finish,
          task.duration_minutes,
          task.planned_work_minutes,
          task.is_summary,
          task.is_active,
          task.local_task_uid,
          task.calendar_id,
          task.calendar_name,
          task.ignore_resource_calendar,
        ]
      );
      if (result.rows[0].inserted) created += 1;
      else updated += 1;
    }

    const row = result.rows[0];
    if (task.local_task_uid) localTaskMap.set(task.local_task_uid, row.task_id);
    mappings.push({ local_task_uid: task.local_task_uid, task_id: row.task_id });
  }

  for (const task of normalized) {
    const taskId =
      task.task_id || (task.local_task_uid ? localTaskMap.get(task.local_task_uid) : null);
    if (!taskId) continue;
    if (!isPublish && !task.has_parent_reference) continue;

    let parentTaskId = null;
    if (task.parent_task_id) parentTaskId = task.parent_task_id;
    if (!parentTaskId && task.parent_local_task_uid) {
      parentTaskId = localTaskMap.get(task.parent_local_task_uid);
      if (!parentTaskId) {
        throw new ApiError(
          400,
          'PARENT_TASK_NOT_FOUND',
          'parent_local_task_uid could not be resolved',
          {
            parent_local_task_uid: task.parent_local_task_uid,
          }
        );
      }
    }

    if (parentTaskId === taskId) {
      throw new ApiError(400, 'INVALID_PARENT_TASK', 'Task cannot be its own parent', [
        { task_id: taskId },
      ]);
    }

    await client.query(
      `update ms_project_task
       set parent_task_id = $3
       where project_id = $1 and task_id = $2`,
      [projectId, taskId, parentTaskId]
    );
  }

  return { localTaskMap, mappings, created, updated };
}

async function upsertAssignments(client, projectId, assignments, taskMap, isPublish) {
  const normalized = assignments.map((assignment, index) =>
    normalizeAssignmentPayload(assignment, index, isPublish)
  );
  await ensureResourceInProjectTeam(
    client,
    projectId,
    normalized.map((assignment) => assignment.resource_id)
  );

  const mappings = [];
  let created = 0;
  let updated = 0;

  for (const assignment of normalized) {
    const taskId = resolveTaskId(assignment, taskMap, 'assignment task');
    let result;

    if (!isPublish && assignment.assignment_id) {
      result = await client.query(
        `update ms_project_assignment
         set task_id = $3,
             resource_id = $4,
             assignment_units = $5,
             planned_work_minutes = $6,
             assignment_start = $7,
             assignment_finish = $8,
             is_active = $9,
             local_assignment_uid = case
               when local_assignment_uid is null
                and $10::text is not null
                and not exists (
                  select 1 from ms_project_assignment x
                  where x.project_id = $1
                    and x.local_assignment_uid = $10::text
                    and x.assignment_id <> $2
                )
               then $10::text
               else local_assignment_uid
             end
         where project_id = $1 and assignment_id = $2
         returning assignment_id, local_assignment_uid`,
        [
          projectId,
          assignment.assignment_id,
          taskId,
          assignment.resource_id,
          assignment.assignment_units,
          assignment.planned_work_minutes,
          assignment.assignment_start,
          assignment.assignment_finish,
          assignment.is_active,
          assignment.local_assignment_uid,
        ]
      );
      if (!result.rows[0]) {
        throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'Assignment not found in project', [
          { assignment_id: assignment.assignment_id },
        ]);
      }
      updated += 1;
    } else {
      result = await client.query(
        `insert into ms_project_assignment (
           project_id, task_id, resource_id, assignment_units, planned_work_minutes,
           assignment_start, assignment_finish, is_active, local_assignment_uid
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (project_id, local_assignment_uid)
         where local_assignment_uid is not null
         do update set
           task_id = excluded.task_id,
           resource_id = excluded.resource_id,
           assignment_units = excluded.assignment_units,
           planned_work_minutes = excluded.planned_work_minutes,
           assignment_start = excluded.assignment_start,
           assignment_finish = excluded.assignment_finish,
           is_active = excluded.is_active,
           updated_at = now()
         returning assignment_id, local_assignment_uid, (xmax = 0) as inserted`,
        [
          projectId,
          taskId,
          assignment.resource_id,
          assignment.assignment_units,
          assignment.planned_work_minutes,
          assignment.assignment_start,
          assignment.assignment_finish,
          assignment.is_active,
          assignment.local_assignment_uid,
        ]
      );
      if (result.rows[0].inserted) created += 1;
      else updated += 1;
    }

    mappings.push({
      local_assignment_uid: assignment.local_assignment_uid,
      assignment_id: result.rows[0].assignment_id,
    });
  }

  return { mappings, created, updated };
}

async function upsertDependencies(client, projectId, dependencies, taskMap, isPublish) {
  const normalized = dependencies.map((dep, index) =>
    normalizeDependencyPayload(dep, index, isPublish)
  );
  const mappings = [];
  let created = 0;
  let updated = 0;

  for (const dep of normalized) {
    const predecessorTaskId = resolveDependencyTaskId(
      dep.predecessor_task_id,
      dep.predecessor_local_task_uid,
      taskMap,
      'predecessor task'
    );
    const successorTaskId = resolveDependencyTaskId(
      dep.successor_task_id,
      dep.successor_local_task_uid,
      taskMap,
      'successor task'
    );
    let result;

    if (!isPublish && dep.dependency_id) {
      result = await client.query(
        `update ms_project_dependency
         set predecessor_task_id = $3,
             successor_task_id = $4,
             dependency_type = $5,
             lag_minutes = $6,
             local_dependency_key = case
               when local_dependency_key is null
                and $7::text is not null
                and not exists (
                  select 1 from ms_project_dependency x
                  where x.project_id = $1
                    and x.local_dependency_key = $7::text
                    and x.dependency_id <> $2
                )
               then $7::text
               else local_dependency_key
             end,
             is_active = $8
         where project_id = $1 and dependency_id = $2
         returning dependency_id, local_dependency_key`,
        [
          projectId,
          dep.dependency_id,
          predecessorTaskId,
          successorTaskId,
          dep.dependency_type,
          dep.lag_minutes,
          dep.local_dependency_key,
          dep.is_active,
        ]
      );
      if (!result.rows[0]) {
        throw new ApiError(404, 'DEPENDENCY_NOT_FOUND', 'Dependency not found in project', [
          { dependency_id: dep.dependency_id },
        ]);
      }
      updated += 1;
    } else {
      const existingByPair = await client.query(
        `select dependency_id
         from ms_project_dependency
         where project_id = $1
           and predecessor_task_id = $2
           and successor_task_id = $3
           and coalesce(dependency_type, 'FS') = coalesce($4::text, 'FS')
           and coalesce(lag_minutes, 0) = coalesce($5::integer, 0)
           and is_active = true
         order by created_at, dependency_id
         limit 1`,
        [projectId, predecessorTaskId, successorTaskId, dep.dependency_type, dep.lag_minutes]
      );

      if (existingByPair.rows[0]) {
        result = await client.query(
          `update ms_project_dependency
           set local_dependency_key = case
                 when local_dependency_key is null
                  and $3::text is not null
                  and not exists (
                    select 1 from ms_project_dependency x
                    where x.project_id = $1
                      and x.local_dependency_key = $3::text
                      and x.dependency_id <> $2
                  )
                 then $3::text
                 else local_dependency_key
               end,
               is_active = $4,
               updated_at = now()
           where project_id = $1 and dependency_id = $2
           returning dependency_id, local_dependency_key, false as inserted`,
          [projectId, existingByPair.rows[0].dependency_id, dep.local_dependency_key, dep.is_active]
        );
        updated += 1;
      } else {
        result = await client.query(
          `insert into ms_project_dependency (
           project_id, predecessor_task_id, successor_task_id, dependency_type,
           lag_minutes, local_dependency_key, is_active
         )
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (project_id, local_dependency_key)
         where local_dependency_key is not null
         do update set
           predecessor_task_id = excluded.predecessor_task_id,
           successor_task_id = excluded.successor_task_id,
           dependency_type = excluded.dependency_type,
           lag_minutes = excluded.lag_minutes,
           is_active = excluded.is_active,
           updated_at = now()
         returning dependency_id, local_dependency_key, (xmax = 0) as inserted`,
          [
            projectId,
            predecessorTaskId,
            successorTaskId,
            dep.dependency_type,
            dep.lag_minutes,
            dep.local_dependency_key,
            dep.is_active,
          ]
        );
        if (result.rows[0].inserted) created += 1;
        else updated += 1;
      }
    }

    mappings.push({
      local_dependency_key: result.rows[0].local_dependency_key,
      predecessor_local_task_uid: dep.predecessor_local_task_uid,
      successor_local_task_uid: dep.successor_local_task_uid,
      dependency_id: result.rows[0].dependency_id,
    });
  }

  return { mappings, created, updated };
}

async function applyExplicitDeactivate(client, projectId, deactivate = {}) {
  const assignmentIds = normalizeUuidArray(
    deactivate.assignment_ids || [],
    'deactivate.assignment_ids'
  );
  const dependencyIds = normalizeUuidArray(
    deactivate.dependency_ids || [],
    'deactivate.dependency_ids'
  );
  const taskIds = normalizeUuidArray(deactivate.task_ids || [], 'deactivate.task_ids');
  const resourceIds = normalizeUuidArray(deactivate.resource_ids || [], 'deactivate.resource_ids');

  if (assignmentIds.length) {
    await client.query(
      `update ms_project_assignment
       set is_active = false
       where project_id = $1 and assignment_id = any($2::uuid[])`,
      [projectId, assignmentIds]
    );
  }

  if (dependencyIds.length) {
    await client.query(
      `update ms_project_dependency
       set is_active = false
       where project_id = $1 and dependency_id = any($2::uuid[])`,
      [projectId, dependencyIds]
    );
  }

  if (taskIds.length) {
    const blockers = await client.query(
      `select 'assignment' as type, assignment_id::text as id
       from ms_project_assignment
       where project_id = $1
         and task_id = any($2::uuid[])
         and is_active = true
       union all
       select 'dependency' as type, dependency_id::text as id
       from ms_project_dependency
       where project_id = $1
         and is_active = true
         and (predecessor_task_id = any($2::uuid[]) or successor_task_id = any($2::uuid[]))`,
      [projectId, taskIds]
    );
    if (blockers.rows.length) {
      throw new ApiError(
        409,
        'TASK_DEACTIVATE_BLOCKED',
        'Task is still used by active assignment or dependency',
        blockers.rows
      );
    }
    await client.query(
      `update ms_project_task
       set is_active = false
       where project_id = $1 and task_id = any($2::uuid[])`,
      [projectId, taskIds]
    );
  }

  if (resourceIds.length) {
    const blockers = await client.query(
      `select assignment_id, task_id, resource_id
       from ms_project_assignment
       where project_id = $1
         and resource_id = any($2::uuid[])
         and is_active = true`,
      [projectId, resourceIds]
    );
    if (blockers.rows.length) {
      throw new ApiError(
        409,
        'RESOURCE_DEACTIVATE_BLOCKED',
        'Resource is still used by active assignments',
        blockers.rows
      );
    }
    await client.query(
      `update ms_project_resource
       set is_active = false
       where project_id = $1 and resource_id = any($2::uuid[])`,
      [projectId, resourceIds]
    );
  }

  return {
    tasks_deactivated: taskIds.length,
    assignments_deactivated: assignmentIds.length,
    dependencies_deactivated: dependencyIds.length,
    resources_deactivated: resourceIds.length,
  };
}

async function health() {
  await pool().query('select 1');
  return { service: 'ms-project', database: 'connected' };
}

async function listProjects(query) {
  const values = [];
  const where = [];
  const status = nullableText(query.status);
  const q = nullableText(query.q);

  if (status) {
    values.push(status);
    where.push(`status = $${values.length}`);
  }
  if (q) {
    values.push(`%${q}%`);
    where.push(`project_name ilike $${values.length}`);
  }

  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  values.push(limit, offset);

  const sql = `
    select
      project_id,
      project_name,
      description,
      status,
      source_type,
      revision_no,
      published_revision_no,
      last_published_at,
      checked_out_by,
      checked_out_at,
      calendar_id,
      calendar_name,
      file_name,
      file_size,
      file_uploaded_at,
      created_by,
      updated_by,
      created_at,
      updated_at,
      (select count(*) from ms_project_bay_schedule b
        where b.project_id = p.project_id and b.status <> 'CANCELLED') as active_reservation_count
    from ms_project p
    ${where.length ? `where ${where.join(' and ')}` : ''}
    order by updated_at desc
    limit $${values.length - 1} offset $${values.length}
  `;
  const result = await pool().query(sql, values);
  return { rows: result.rows, limit, offset };
}

async function listProjectTasks(projectIdParam, query = {}) {
  const projectId = assertUuid(projectIdParam, 'project_id');
  const values = [projectId];
  const where = ['t.project_id = $1', 't.is_active = true'];
  const q = nullableText(query.q);
  const outlineLevel = toNullableInt(query.outline_level);

  if (q) {
    values.push(`%${q}%`);
    where.push(`(
      t.task_name ilike $${values.length}
      or t.outline_number ilike $${values.length}
      or t.order_no ilike $${values.length}
      or t.operation_no ilike $${values.length}
      or t.workcenter ilike $${values.length}
    )`);
  }
  if (outlineLevel !== null) {
    values.push(outlineLevel);
    where.push(`t.outline_level = $${values.length}`);
  }

  const result = await pool().query(
    `select
       t.task_id,
       t.project_id,
       t.parent_task_id,
       t.task_name,
       t.outline_level,
       t.outline_number,
       t.order_no,
       t.operation_no,
       t.ssbr_id,
       t.sow_id,
       t.workcenter,
       t.plan_start,
       t.plan_finish,
       t.duration_minutes,
       t.planned_work_minutes,
       t.actual_progress,
       t.is_summary,
       t.local_task_uid,
       t.created_at,
       t.updated_at
     from ms_project_task t
     where ${where.join(' and ')}
     order by ${TASK_OPERATION_ORDER_SQL}`,
    values
  );

  return { rows: result.rows };
}

const SOW_COMPLETION_VALUES = new Set(['all', 'unfinished', 'finished']);

function subcontMarkExistsSql(alias = 's') {
  return `exists (
         select 1 from public.sow_subcont_mark scm
         where ltrim(scm.order_no, '0') = ltrim(${alias}.order_no, '0')
           and scm.operation_no = ${alias}.operation_no
           and scm.unmarked_at is null
       )`;
}

const SOW_ORDER_META_CTE_SQL = `
  -- Status SAP per order. max() dipakai sebagai peredam yang deterministik kalau suatu saat satu
  -- order punya order_description berbeda antar baris. Diverifikasi 3 Agu 2026: 0 order punya
  -- lebih dari satu order_description berbeda (REL 67 order, TECO 33, LKD 15), jadi hari ini
  -- max() tidak pernah benar-benar memilih.
  sap as materialized (
    select ltrim(po.order_no, '0') as order_key,
           max(po.order_description) as sap_status
      from public.ph3_order po
     where po.order_no is not null
     group by 1
  )`;

async function listSowOrders(query = {}) {
  const values = [];
  const where = ['s.order_no is not null', "trim(s.order_no) <> ''", 's.operation_no is not null'];

  const having = [];
  const q = nullableText(query.q);

  const windowStart = query.window_start
    ? normalizeDateOnly(query.window_start, 'window_start')
    : null;
  const windowEnd = query.window_end ? normalizeDateOnly(query.window_end, 'window_end') : null;
  if (Boolean(windowStart) !== Boolean(windowEnd)) {
    throw new ApiError(
      400,
      'INVALID_DATE_RANGE',
      'window_start and window_end must be supplied together',
      [
        { field: 'window_start', value: query.window_start ?? null },
        { field: 'window_end', value: query.window_end ?? null },
      ]
    );
  }
  if (windowStart && windowEnd < windowStart) {
    throw new ApiError(400, 'INVALID_DATE_RANGE', 'window_end must be on or after window_start', [
      { field: 'window_start', value: windowStart },
      { field: 'window_end', value: windowEnd },
    ]);
  }

  const completion = normalizeText(query.completion).toLowerCase() || 'all';
  if (!SOW_COMPLETION_VALUES.has(completion)) {
    throw new ApiError(
      400,
      'INVALID_COMPLETION',
      'completion must be one of unfinished, finished, all',
      [{ field: 'completion', value: query.completion }]
    );
  }
  const excludeUnknown = toBool(query.exclude_unknown, false) === true;

  const dueBy = query.due_by ? normalizeDateOnly(query.due_by, 'due_by') : null;

  const countsDueBy = query.counts_due_by
    ? normalizeDateOnly(query.counts_due_by, 'counts_due_by')
    : null;

  let inWindowTasksSql = '0::integer as in_window_tasks';
  if (windowStart) {
    values.push(windowStart, windowEnd);
    const startParam = values.length - 1;
    const endParam = values.length;
    inWindowTasksSql = `count(*) filter (
            where coalesce(t.plan_finish, t.plan_start)::date >= $${startParam}::date
              and coalesce(t.plan_start, t.plan_finish)::date <= $${endParam}::date
          )::integer as in_window_tasks`;
  }

  let dueByTasksSql = 'false::boolean as due_by_tasks';
  if (dueBy) {
    values.push(dueBy);
    const dueByParam = values.length;
    dueByTasksSql = `bool_or(coalesce(t.plan_finish, t.plan_start)::date <= $${dueByParam}::date) as due_by_tasks`;
  }

  if (q) {
    values.push(`%${q.toLowerCase()}%`);
    where.push(`(
      lower(coalesce(s.order_no, '')) like $${values.length}
      or lower(coalesce(s.ssbr_id, '')) like $${values.length}
      or lower(coalesce(s.part_name, '')) like $${values.length}
      or lower(coalesce(s.operation_text, '')) like $${values.length}
      or lower(coalesce(s.workcenter, '')) like $${values.length}
      or lower(coalesce(s.operation_no::text, '')) like $${values.length}
    )`);
  }

  if (excludeUnknown) {
    having.push("exists (select 1 from sap where sap.order_key = ltrim(s.order_no, '0'))");
  }

  if (completion === 'unfinished') {
    having.push(`exists (
      select 1 from sap
      where sap.order_key = ltrim(s.order_no, '0')
        and sap.sap_status in ('REL','LKD')
    )`);
  } else if (completion === 'finished') {
    having.push(`exists (
      select 1 from sap
      where sap.order_key = ltrim(s.order_no, '0')
        and sap.sap_status not in ('REL','LKD')
    )`);
  }

  if (dueBy) {
    having.push(`exists (
      select 1 from msp
      where msp.order_key = ltrim(s.order_no, '0')
        and msp.due_by_tasks
    )`);
  }

  const limit = clampLimit(query.limit, 50);
  const offset = clampOffset(query.offset);
  values.push(limit, offset);

  const subcontMarked = subcontMarkExistsSql('s');
  const havingSql = having.length ? `having ${having.join('\n       and ')}` : '';

  const result = await pool().query(
    `with ${SOW_ORDER_META_CTE_SQL},
     -- Hanya task aktif non-summary: itu definisi "punya jadwal MS Project" yang dipakai
     -- listOrderTasks dan form reservasi (D2 mewajibkan reservasi task-level).
     msp as materialized (
       select ltrim(t.order_no, '0') as order_key,
              min(t.plan_start)::date as earliest_plan_start,
              max(t.plan_finish)::date as latest_plan_finish,
              ${inWindowTasksSql},
              ${dueByTasksSql}
         from public.ms_project_task t
        where t.is_active = true
          and coalesce(t.is_summary, false) = false
          and t.order_no is not null
        group by 1
     ),
     -- Jumlah RESERVASI, bukan jumlah baris: satu reservasi task-level menghasilkan satu
     -- baris per task, jadi count(*) membuat badge "N reservasi" di kartu order tidak cocok
     -- dengan jumlah badge yang benar-benar terlihat di peta (peta men-dedupe per grup).
     -- Baris warisan tanpa schedule_group_id jatuh ke schedule_id.
     resv as materialized (
       select ltrim(bs.order_no, '0') as order_key,
              count(distinct coalesce(bs.schedule_group_id, bs.schedule_id))::integer as active_reservations
         from public.ms_project_bay_schedule bs
        where bs.status <> 'CANCELLED'
          and bs.order_no is not null
        group by 1
     )
     select
       s.order_no,
       min(s.ssbr_id) as ssbr_id,
       min(s.part_name) as part_name,
       min(s.part_number) as part_number,
       min(s.model) as model,
       min(s.customer) as customer,
       min(s.workcenter) as workcenter,
       count(*)::integer as operation_count,
       coalesce(sum(s.planhours) filter (where not ${subcontMarked}), 0)::numeric(12,2) as total_planhours,
       coalesce(sum(s.planhours) filter (where ${subcontMarked}), 0)::numeric(12,2) as total_planhours_subcont,
       (count(*) filter (where ${subcontMarked}))::integer as subcont_ops,
       max(s.created_by) as created_by,
       (select sap.sap_status from sap where sap.order_key = ltrim(s.order_no, '0')) as sap_status,
       coalesce(
         (select sap.sap_status from sap where sap.order_key = ltrim(s.order_no, '0')) in ('REL','LKD'),
         false
       ) as is_unfinished,
       exists (select 1 from msp where msp.order_key = ltrim(s.order_no, '0')) as has_msp_task,
       (select msp.earliest_plan_start from msp where msp.order_key = ltrim(s.order_no, '0')) as earliest_plan_start,
       (select msp.latest_plan_finish from msp where msp.order_key = ltrim(s.order_no, '0')) as latest_plan_finish,
       coalesce((select msp.in_window_tasks from msp where msp.order_key = ltrim(s.order_no, '0')), 0) > 0 as in_window,
      coalesce((select msp.due_by_tasks from msp where msp.order_key = ltrim(s.order_no, '0')), false) as due_by,
       coalesce((select resv.active_reservations from resv where resv.order_key = ltrim(s.order_no, '0')), 0)::integer as active_reservations,
       (count(*) over ())::integer as total
     from sow s
     where ${where.join(' and ')}
     group by s.order_no
     ${havingSql}
     order by max(s.idsow) desc, s.order_no desc
     limit $${values.length - 1} offset $${values.length}`,
    values
  );

  let total = 0;
  const rows = result.rows.map((row) => {
    const { total: rowTotal, ...rest } = row;
    total = rowTotal ?? total;
    rest.earliest_plan_start = toDateOnlyString(rest.earliest_plan_start);
    rest.latest_plan_finish = toDateOnlyString(rest.latest_plan_finish);
    return rest;
  });

  let counts = null;
  if (toBool(query.counts, false) === true) {
    const countsValues = [];
    const countsDueByValue = countsDueBy || dueBy;
    let countsDueByTasksSql = 'false::boolean as due_by_tasks';
    if (countsDueByValue) {
      countsValues.push(countsDueByValue);
      const dueByParam = countsValues.length;
      countsDueByTasksSql = `bool_or(coalesce(t.plan_finish, t.plan_start)::date <= $${dueByParam}::date) as due_by_tasks`;
    }

    const countsWhere = [
      's.order_no is not null',
      "trim(s.order_no) <> ''",
      's.operation_no is not null',
    ];
    if (q) {
      countsValues.push(`%${q.toLowerCase()}%`);
      const qParam = countsValues.length;
      countsWhere.push(`(
        lower(coalesce(s.order_no, '')) like $${qParam}
        or lower(coalesce(s.ssbr_id, '')) like $${qParam}
        or lower(coalesce(s.part_name, '')) like $${qParam}
        or lower(coalesce(s.operation_text, '')) like $${qParam}
        or lower(coalesce(s.workcenter, '')) like $${qParam}
        or lower(coalesce(s.operation_no::text, '')) like $${qParam}
      )`);
    }

    const sapRelLkd =
      "exists (select 1 from sap where sap.order_key = ltrim(s.order_no, '0') and sap.sap_status in ('REL','LKD'))";
    const sapNotRelLkd =
      "exists (select 1 from sap where sap.order_key = ltrim(s.order_no, '0') and sap.sap_status not in ('REL','LKD'))";
    const hasMsp = "exists (select 1 from msp where msp.order_key = ltrim(s.order_no, '0'))";
    const hasDueByTask =
      "exists (select 1 from msp where msp.order_key = ltrim(s.order_no, '0') and msp.due_by_tasks)";
    const hasResv = "exists (select 1 from resv where resv.order_key = ltrim(s.order_no, '0'))";

    const countsResult = await pool().query(
      `with ${SOW_ORDER_META_CTE_SQL},
       msp as materialized (
         select ltrim(t.order_no, '0') as order_key,
                ${countsDueByTasksSql}
           from public.ms_project_task t
          where t.is_active = true
            and coalesce(t.is_summary, false) = false
            and t.order_no is not null
          group by 1
       ),
       resv as materialized (
         select ltrim(bs.order_no, '0') as order_key,
                count(distinct coalesce(bs.schedule_group_id, bs.schedule_id))::integer as active_reservations
           from public.ms_project_bay_schedule bs
          where bs.status <> 'CANCELLED'
            and bs.order_no is not null
          group by 1
       )
       select
         count(*) filter (where flag_perlu)::integer as perlu,
         count(*) filter (where flag_belum_jadwal)::integer as belum_jadwal,
         count(*) filter (where flag_terjadwal)::integer as terjadwal,
         count(*) filter (where flag_selesai)::integer as selesai
       from (
         select
           s.order_no,
           (${sapRelLkd} and ${hasDueByTask}) as flag_perlu,
           (${sapRelLkd} and not ${hasMsp}) as flag_belum_jadwal,
           (${hasResv}) as flag_terjadwal,
           (${sapNotRelLkd}) as flag_selesai
         from sow s
         where ${countsWhere.join(' and ')}
         group by s.order_no
         ${excludeUnknown ? "having exists (select 1 from sap where sap.order_key = ltrim(s.order_no, '0'))" : ''}
       ) g`,
      countsValues
    );
    counts = countsResult.rows[0] || null;
  }

  return { rows, limit, offset, total, ...(counts ? { counts } : {}) };
}

async function getSowOrderOperations(orderNoParam) {
  const orderNo = nullableText(orderNoParam);
  if (!orderNo) {
    throw new ApiError(400, 'INVALID_ORDER_NO', 'order_no is required', [{ field: 'order_no' }]);
  }

  const result = await pool().query(
    `select
       idsow,
       order_no,
       operation_no,
       operation_text,
       ssbr_id,
       part_number,
       part_name,
       model,
       workcenter,
       workcenterdescription,
       wct_group,
       planhours,
       systemstatus,
       status,
       plan_start,
       plan_finish
     from sow
     where ltrim(order_no, '0') = ltrim($1, '0')
       and operation_no is not null
     order by operation_no asc, idsow asc`,
    [orderNo]
  );

  return { rows: result.rows };
}

async function listOrderTasks(orderNoParam) {
  const orderNo = nullableText(orderNoParam);
  if (!orderNo) {
    throw new ApiError(400, 'INVALID_ORDER_NO', 'order_no is required', [{ field: 'order_no' }]);
  }

  const result = await pool().query(
    `select
       t.task_id,
       t.project_id,
       t.task_name,
       t.order_no,
       t.operation_no,
       t.ssbr_id,
       t.workcenter,
       t.outline_number,
       t.plan_start,
       t.plan_finish,
       t.planned_work_minutes,
       t.duration_minutes,
       s.people_required,
       s.planhours,
       -- Satu order boleh dipetakan ke lebih dari satu project (index unik hanya per-project),
       -- dan fungsi ini TIDAK menyaring per project. Tanpa nama project + penanda ini, scheduler
       -- melihat operasi yang sama berkali-kali di picker reservasi tanpa cara membedakannya —
       -- persis gejala yang dilaporkan untuk order 1000127752 (3 project x 294 operasi).
       p.project_name,
       (count(*) over (partition by t.operation_no) > 1) as duplicate_across_projects
     from ms_project_task t
     left join ms_project p on p.project_id = t.project_id
     left join sow s on s.idsow = t.sow_id
     where ltrim(t.order_no, '0') = ltrim($1, '0')
       and t.is_active = true
       and coalesce(t.is_summary, false) = false
     order by
       case when nullif(t.operation_no, '') is null then 1 else 0 end,
       case when t.operation_no ~ '^\\d+$' then t.operation_no::integer end nulls last,
       t.operation_no nulls last,
       t.outline_number nulls last,
       t.created_at,
       t.task_name`,
    [orderNo]
  );

  return { rows: result.rows };
}

async function updateOperationPeople(orderNoParam, updatesInput) {
  const orderNo = nullableText(orderNoParam);
  if (!orderNo) {
    throw new ApiError(400, 'INVALID_ORDER_NO', 'order_no is required', [{ field: 'order_no' }]);
  }

  const updates = ensureArray(updatesInput, 'updates');
  if (updates.length === 0) {
    throw new ApiError(400, 'INVALID_PAYLOAD', 'updates must be a non-empty array', [
      { field: 'updates' },
    ]);
  }

  const normalized = updates.map((entry, index) => {
    const row = ensureObject(entry, `updates[${index}]`);

    const operationText = nullableText(row.operation_no);
    if (!operationText) {
      throw new ApiError(400, 'INVALID_PAYLOAD', 'operation_no is required', [
        { field: `updates[${index}].operation_no` },
      ]);
    }
    const operationNo = Number(operationText);
    if (!Number.isInteger(operationNo)) {
      throw new ApiError(400, 'INVALID_PAYLOAD', 'operation_no must be an integer', [
        { field: `updates[${index}].operation_no`, value: operationText },
      ]);
    }

    const raw = row.people_required;
    let peopleRequired = null;
    if (raw !== undefined && raw !== null && raw !== '') {
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 32767) {
        throw new ApiError(
          400,
          'INVALID_PAYLOAD',
          'people_required must be a positive integer or null',
          [{ field: `updates[${index}].people_required`, value: raw }]
        );
      }
      peopleRequired = parsed;
    }

    return { operation_no: operationNo, people_required: peopleRequired };
  });

  const client = await pool().connect();
  let updated = 0;
  try {
    await client.query('begin');
    for (const item of normalized) {
      const result = await client.query(
        `update public.sow
            set people_required = $1,
                updated_at = now()
          where ltrim(order_no, '0') = ltrim($2, '0')
            and operation_no = $3`,
        [item.people_required, orderNo, item.operation_no]
      );
      updated += result.rowCount;
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return { updated, requested: normalized.length };
}

function sortableOperation(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function operationKey(value) {
  const text = normalizeText(value);
  if (!text) return '';
  const number = Number.parseInt(text, 10);
  return Number.isFinite(number) ? String(number) : text;
}

function minutesFromHours(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed * 60));
}

function normalizeDateOnly(value, fieldName) {
  const text = nullableText(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ApiError(400, 'INVALID_DATE', `${fieldName} must use YYYY-MM-DD format`, [
      { field: fieldName },
    ]);
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, 'INVALID_DATE', `${fieldName} must be a valid date`, [
      { field: fieldName },
    ]);
  }
  return text;
}

const MANUFACTURING_BAY_CODES = new Set([
  'A38E',
  'A38C',
  'A37E',
  'A37C',
  'A36E',
  'A36C',
  'A35E',
  'A35C',

  'A34E',
  'A34C',
  'A33E',
  'A33C',
  'A32E',
  'A32C',

  'A30E',
  'A30C',
  'A29E',
  'A29C',
  'A28E',
  'A28C',
  'A27E',
  'A27C',

  'A26E',
  'A26C',
  'A25E',
  'A25C',
  'A24E',
  'A24C',
  'A23E',
  'A23C',

  'A22E',
  'A22C',
  'A21E',
  'A21C',
  'A20E',
  'A20C',
  'A19E',
  'A19C',

  'A18E',
  'A18C',
  'A17E',
  'A17C',
  'A16E',
  'A16C',
  'A15E',
  'A15C',

  'A14E',
  'A14C',
  'A13E',
  'A13C',
  'A12E',
  'A12C',
  'A11E',
  'A11C',

  'A9E',
  'A9C',
  'A8E',
  'A8C',
  'A7E',
  'A7C',
  'A6E',
  'A6C',

  'A5E',
  'A5C',
  'A4E',
  'A4C',
  'A3E',
  'A3C',
  'A2E',
  'A2C',

  'A1E',
  'A1C',

  'B38E',
  'B38C',
  'B37E',
  'B37C',
  'B36E',
  'B36C',
  'B35E',
  'B35C',

  'B34E',
  'B34C',
  'B33E',
  'B33C',
  'B32E',
  'B32C',

  'B30E',
  'B30C',
  'B29E',
  'B29C',
  'B28E',
  'B28C',
  'B27E',
  'B27C',

  'B26E',
  'B26C',
  'B25E',
  'B25C',
  'B24E',
  'B24C',
  'B23E',
  'B23C',

  'B22E',
  'B22C',
  'B21E',
  'B21C',
  'B20E',
  'B20C',
  'B19E',
  'B19C',

  'B17E',
  'B17C',
  'B16E',
  'B16C',
  'B15E',
  'B15C',
  'B14E',
  'B14C',

  'B13E',
  'B13C',
  'B12E',
  'B12C',
  'B11E',
  'B11C',
  'B10E',
  'B10C',

  'PT1',
  'PT2',
  'PT3',
  'BL1',
  'BL2',
]);

const BAY_BOOKING_TYPES = ['ORDER', 'PARKING', 'STORAGE', 'MAINTENANCE', 'OTHER'];
const BAY_BOOKING_TYPE_SET = new Set(BAY_BOOKING_TYPES);

function normalizeBookingType(value) {
  const text = normalizeText(value).toUpperCase() || 'ORDER';
  if (!BAY_BOOKING_TYPE_SET.has(text)) {
    throw new ApiError(
      400,
      'INVALID_BOOKING_TYPE',
      `booking_type must be one of ${BAY_BOOKING_TYPES.join(', ')}`,
      [{ field: 'booking_type', value }]
    );
  }
  return text;
}

function toDateOnlyString(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return normalizeText(value).slice(0, 10) || null;
}

function normalizeBayCodes(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new ApiError(400, 'INVALID_PAYLOAD', 'bay_codes must be a non-empty array', [
      { field: 'bay_codes' },
    ]);
  }
  const codes = values.map((value) => normalizeText(value).toUpperCase()).filter(Boolean);
  const uniqueCodes = Array.from(new Set(codes));
  if (!uniqueCodes.length) {
    throw new ApiError(400, 'INVALID_PAYLOAD', 'bay_codes must include at least one bay', [
      { field: 'bay_codes' },
    ]);
  }

  const malformed = uniqueCodes.filter((code) => !/^[A-Z]{1,3}[0-9]{1,3}[CE]?$/.test(code));
  if (malformed.length) {
    throw new ApiError(
      400,
      'INVALID_BAY_CODE',
      'One or more bay codes are invalid',
      malformed.map((code) => ({ bay_code: code }))
    );
  }
  const unknown = uniqueCodes.filter((code) => !MANUFACTURING_BAY_CODES.has(code));
  if (unknown.length) {
    throw new ApiError(
      400,
      'INVALID_BAY_CODE',
      'One or more bay codes do not exist in the manufacturing area topology',
      unknown.map((code) => ({ bay_code: code }))
    );
  }
  return uniqueCodes;
}

function parseBayCodeList(value) {
  const raw = Array.isArray(value) ? value : normalizeText(value).split(',');
  const codes = raw.map((entry) => normalizeText(entry).toUpperCase()).filter(Boolean);
  return Array.from(new Set(codes));
}

const TASK_OPERATION_ORDER_SQL = `
  case when nullif(operation_no, '') is null then 1 else 0 end,
  case when operation_no ~ '^\\d+$' then operation_no::integer end nulls last,
  operation_no nulls last,
  outline_number nulls last,
  created_at,
  task_name
`;

function buildNextOutlineNumberFactory(tasks, parentTask = null) {
  const numberedTasks = tasks.map((task) => normalizeText(task.outline_number)).filter(Boolean);
  const lastOutline = numberedTasks[numberedTasks.length - 1] || '';
  const parts = lastOutline.split('.');
  const lastPart = Number.parseInt(parts[parts.length - 1], 10);

  if (!lastOutline && parentTask?.outline_number) {
    let nextChild = 1;
    return () => `${parentTask.outline_number}.${nextChild++}`;
  }

  if (!lastOutline || !Number.isFinite(lastPart)) {
    return () => null;
  }

  const prefix = parts.slice(0, -1).join('.');
  let nextNumber = lastPart + 1;
  return () => {
    const outlineNumber = prefix ? `${prefix}.${nextNumber}` : String(nextNumber);
    nextNumber += 1;
    return outlineNumber;
  };
}

async function mapSowOperationToTask(projectIdParam, body = {}) {
  const projectId = assertUuid(projectIdParam, 'project_id');
  const orderNo = nullableText(body.order_no);
  const operationNo = nullableText(body.operation_no);
  const targetTaskId = optionalUuid(body.target_task_id, 'target_task_id');
  const targetParentTaskId = optionalUuid(body.target_parent_task_id, 'target_parent_task_id');
  const takeover = body.takeover === true || body.takeover === 'true';
  const actor = actorFromBody(body, 'web-manufacturing');

  if (!orderNo)
    throw new ApiError(400, 'INVALID_PAYLOAD', 'order_no is required', [{ field: 'order_no' }]);
  if (!operationNo)
    throw new ApiError(400, 'INVALID_PAYLOAD', 'operation_no is required', [
      { field: 'operation_no' },
    ]);
  if (!targetTaskId && !targetParentTaskId) {
    throw new ApiError(
      400,
      'INVALID_PAYLOAD',
      'target_task_id or target_parent_task_id is required',
      [{ field: 'target_task_id' }, { field: 'target_parent_task_id' }]
    );
  }
  if (targetTaskId && targetParentTaskId) {
    throw new ApiError(
      400,
      'INVALID_PAYLOAD',
      'Send either target_task_id or target_parent_task_id, not both',
      []
    );
  }

  const client = await pool().connect();
  try {
    await client.query('begin');

    const projectResult = await client.query(
      'select * from ms_project where project_id = $1 for update',
      [projectId]
    );
    if (!projectResult.rows[0]) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');

    const opResult = await client.query(
      `select idsow, order_no, operation_no, operation_text, ssbr_id, workcenter, planhours
         from sow
        where ltrim(order_no, '0') = ltrim($1, '0') and operation_no::text = $2
        limit 1`,
      [orderNo, operationNo]
    );
    const operation = opResult.rows[0];
    if (!operation) {
      throw new ApiError(404, 'SOW_OPERATION_NOT_FOUND', 'Operation not found for this order', [
        { order_no: orderNo, operation_no: operationNo },
      ]);
    }

    const existingResult = await client.query(
      `select t.task_id, t.project_id, p.project_name
         from ms_project_task t
         left join ms_project p on p.project_id = t.project_id
        where t.is_active = true and coalesce(t.is_summary, false) = false
          and ltrim(t.order_no, '0') = ltrim($1, '0') and t.operation_no = $2`,
      [orderNo, String(operation.operation_no)]
    );
    const existing = existingResult.rows[0] || null;
    if (existing && existing.project_id !== projectId && !takeover) {
      throw new ApiError(
        409,
        'ORDER_MAPPED_ELSEWHERE',
        `This operation is already mapped in ${existing.project_name || existing.project_id}.`,
        existingResult.rows
      );
    }

    const taskName =
      nullableText(operation.operation_text) || `Operation ${operation.operation_no}`;
    const workMinutes = minutesFromHours(operation.planhours);
    let resultTask = null;
    let replaced = null;

    if (targetTaskId) {
      const targetResult = await client.query(
        `select task_id, task_name, outline_number, order_no, operation_no, coalesce(is_summary,false) as is_summary
           from ms_project_task
          where project_id = $1 and task_id = $2 and is_active = true`,
        [projectId, targetTaskId]
      );
      const target = targetResult.rows[0];
      if (!target)
        throw new ApiError(404, 'TASK_NOT_FOUND', 'Target task not found in this project', [
          { task_id: targetTaskId },
        ]);
      if (target.is_summary) {
        throw new ApiError(
          400,
          'TARGET_IS_SUMMARY',
          'That is a summary task. Drop onto it to create a child instead of assigning to it.',
          [{ task_id: targetTaskId }]
        );
      }

      const holdsOther =
        target.order_no &&
        target.operation_no &&
        !(
          String(target.operation_no) === String(operation.operation_no) &&
          String(target.order_no).replace(/^0+/, '') ===
            String(operation.order_no).replace(/^0+/, '')
        );
      if (holdsOther && !takeover) {
        throw new ApiError(
          409,
          'TARGET_TASK_OCCUPIED',
          `That task already holds order ${target.order_no} operation ${target.operation_no}.`,
          [
            {
              task_id: target.task_id,
              order_no: target.order_no,
              operation_no: target.operation_no,
            },
          ]
        );
      }
      if (holdsOther) replaced = { order_no: target.order_no, operation_no: target.operation_no };

      if (existing && existing.task_id !== targetTaskId) {
        await client.query(
          'update ms_project_task set is_active = false, updated_at = now() where task_id = $1',
          [existing.task_id]
        );
      }

      const updated = await client.query(
        `update ms_project_task
            set task_name = $3, order_no = $4, operation_no = $5, ssbr_id = $6, sow_id = $7,
                workcenter = $8,
                planned_work_minutes = coalesce($9, planned_work_minutes),
                duration_minutes = coalesce($9, duration_minutes),
                updated_at = now()
          where project_id = $1 and task_id = $2
        returning task_id, task_name, outline_number, order_no, operation_no`,
        [
          projectId,
          targetTaskId,
          taskName,
          operation.order_no,
          String(operation.operation_no),
          operation.ssbr_id || null,
          operation.idsow || null,
          operation.workcenter || null,
          workMinutes,
        ]
      );
      resultTask = updated.rows[0];
    } else {
      const parentResult = await client.query(
        `select task_id, outline_level, outline_number
           from ms_project_task
          where project_id = $1 and task_id = $2 and is_active = true`,
        [projectId, targetParentTaskId]
      );
      const parent = parentResult.rows[0];
      if (!parent)
        throw new ApiError(404, 'TASK_NOT_FOUND', 'Target parent task not found in this project', [
          { task_id: targetParentTaskId },
        ]);

      const siblingsResult = await client.query(
        `select outline_number from ms_project_task
          where project_id = $1 and parent_task_id = $2 and is_active = true
          order by ${TASK_OPERATION_ORDER_SQL}`,
        [projectId, parent.task_id]
      );
      const nextOutline = buildNextOutlineNumberFactory(siblingsResult.rows, parent);

      if (existing) {
        await client.query(
          'update ms_project_task set is_active = false, updated_at = now() where task_id = $1',
          [existing.task_id]
        );
      }

      const inserted = await client.query(
        `insert into ms_project_task (
           project_id, parent_task_id, task_name, outline_level, outline_number,
           order_no, operation_no, ssbr_id, sow_id, workcenter,
           duration_minutes, planned_work_minutes, is_summary, is_active
         )
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, false, true)
         returning task_id, task_name, outline_number, order_no, operation_no`,
        [
          projectId,
          parent.task_id,
          taskName,
          Number.isFinite(Number(parent.outline_level)) ? Number(parent.outline_level) + 1 : null,
          nextOutline(),
          operation.order_no,
          String(operation.operation_no),
          operation.ssbr_id || null,
          operation.idsow || null,
          operation.workcenter || null,
          workMinutes,
        ]
      );
      resultTask = inserted.rows[0];
    }

    await writeAuditLog(client, {
      projectId,
      action: 'MAP_SOW_OPERATION',
      actor,
      details: {
        order_no: operation.order_no,
        operation_no: String(operation.operation_no),
        task_id: resultTask?.task_id,
        moved_from_task_id:
          existing && existing.task_id !== resultTask?.task_id ? existing.task_id : null,
        replaced,
      },
    });

    await client.query('commit');
    return {
      project_id: projectId,
      task: resultTask,
      moved_from:
        existing && existing.task_id !== resultTask?.task_id
          ? {
              task_id: existing.task_id,
              project_id: existing.project_id,
              project_name: existing.project_name,
            }
          : null,
      replaced,
    };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function listBaySchedules(query = {}) {
  const values = [];
  const where = ['1 = 1'];
  const startDate = query.start_date ? normalizeDateOnly(query.start_date, 'start_date') : null;
  const endDate = query.end_date ? normalizeDateOnly(query.end_date, 'end_date') : null;
  const status = nullableText(query.status)?.toUpperCase();
  const orderNo = nullableText(query.order_no);
  const bookingType = query.booking_type ? normalizeBookingType(query.booking_type) : null;
  const scheduleGroupId = optionalUuid(query.schedule_group_id, 'schedule_group_id');

  if (startDate) {
    values.push(startDate);
    where.push(`s.end_date >= $${values.length}::date`);
  }
  if (endDate) {
    values.push(endDate);
    where.push(`s.start_date <= $${values.length}::date`);
  }
  if (status) {
    values.push(status);
    where.push(`s.status = $${values.length}`);
  } else {
    where.push("s.status <> 'CANCELLED'");
  }
  if (orderNo) {
    values.push(orderNo);
    where.push(`ltrim(s.order_no, '0') = ltrim($${values.length}, '0')`);
  }
  if (bookingType) {
    values.push(bookingType);
    where.push(`coalesce(s.booking_type, 'ORDER') = $${values.length}`);
  }
  if (scheduleGroupId) {
    values.push(scheduleGroupId);
    where.push(`s.schedule_group_id = $${values.length}::uuid`);
  }

  const limit = clampLimit(query.limit, 2000, BAY_SCHEDULE_MAX_LIMIT);
  const offset = clampOffset(query.offset);
  values.push(limit, offset);

  const result = await pool().query(
    `select
       s.schedule_id,
       s.schedule_group_id,
       s.booking_type,
       s.purpose,
       s.order_no,
       s.project_id,
       p.project_name,
       s.task_id,
       t.task_name,
       t.operation_no,
       t.workcenter,
       so.people_required,
       so.planhours,
       coalesce(so.part_name, ph.material_description) as part_name,
       so.customer,
       -- D7: apakah order_no reservasi ini dikenal di sow/ph3_order. FE sebelumnya menebak
       -- lewat "part_name & customer NULL", dan itu SALAH: part_name/customer datang dari
       -- join lewat t.sow_id, jadi order SAH yang task-nya tidak ber-sow_id ikut tertuduh.
       -- Booking non-job tidak punya order sama sekali -> dianggap dikenal supaya tidak
       -- memicu badge "order tidak dikenal".
       (s.order_no is null
        or coalesce(s.booking_type, 'ORDER') <> 'ORDER'
        or exists (select 1 from sow k where ltrim(k.order_no, '0') = ltrim(s.order_no, '0'))
        or exists (select 1 from ph3_order k where ltrim(k.order_no, '0') = ltrim(s.order_no, '0'))
       ) as order_known,
       -- Fase 6: operasi task ini ditandai subcont? Dipakai peta untuk membedakannya secara
       -- visual dari beban internal. NULL-safe: reservasi order-level (task_id NULL) -> false.
       (t.operation_no is not null and exists (
          select 1 from public.sow_subcont_mark scm
           where ltrim(scm.order_no, '0') = ltrim(s.order_no, '0')
             and scm.operation_no::text = t.operation_no
             and scm.unmarked_at is null)
       ) as is_subcont,
       s.area_code,
       s.area_name,
       s.bay_codes,
       s.start_date,
       s.end_date,
       s.status,
       s.notes,
       s.created_by,
       s.updated_by,
       -- Nama di-resolve dari FK, teks lama hanya cadangan untuk aktor non-user (job/skrip).
       -- Sebelumnya UI menampilkan isi created_by apa adanya, dan itu sempat berupa ID user
       -- ('37') karena helper lama mengirim String(user.id) sebagai aktor.
       coalesce(cu.name, s.created_by) as created_by_name,
       coalesce(uu.name, s.updated_by) as updated_by_name,
       s.created_by_user_id,
       s.created_at,
       s.updated_at
     from ms_project_bay_schedule s
     left join users cu on cu.id = s.created_by_user_id
     left join users uu on uu.id = s.updated_by_user_id
     left join ms_project p on p.project_id = s.project_id
     left join ms_project_task t
       on t.project_id = s.project_id
      and t.task_id = s.task_id
     left join sow so on so.idsow = t.sow_id
    left join lateral (
      select min(k.material_description) as material_description
      from ph3_order k
      where ltrim(k.order_no, '0') = ltrim(s.order_no, '0')
        and nullif(btrim(k.material_description), '') is not null
    ) ph on true
     where ${where.join(' and ')}
     order by s.start_date, s.area_code, s.bay_codes[1], s.order_no
     limit $${values.length - 1} offset $${values.length}`,
    values
  );

  return { rows: result.rows, limit, offset };
}

let lastSyncAt = 0;
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
async function syncBayScheduleDates() {
  const now = Date.now();
  if (now - lastSyncAt < SYNC_INTERVAL_MS) return 0;
  lastSyncAt = now;
  const result = await pool().query(
    `update ms_project_bay_schedule s
     set start_date = (t.plan_start at time zone 'Asia/Jakarta')::date,
         end_date = (t.plan_finish at time zone 'Asia/Jakarta')::date,
         updated_at = now(), updated_by = 'bay-schedule-sync'
     from ms_project_task t
     where s.task_id = t.task_id
       and s.status <> 'CANCELLED'
       and s.start_date::date >= current_date
       and t.plan_start is not null and t.plan_finish is not null
       and ((t.plan_start at time zone 'Asia/Jakarta')::date <> s.start_date::date
         or (t.plan_finish at time zone 'Asia/Jakarta')::date <> s.end_date::date)`
  );
  return result.rowCount;
}

async function listBayScheduleTasks(query = {}) {
  const values = [];

  const where = ["s.status <> 'CANCELLED'", "coalesce(s.booking_type, 'ORDER') = 'ORDER'"];
  const areaCode = nullableText(query.area_code)?.toUpperCase();
  const bayCode = nullableText(query.bay_code)?.toUpperCase();
  const workcenter = nullableText(query.workcenter)?.toUpperCase();
  const q = nullableText(query.q);
  const startDate = query.start_date ? normalizeDateOnly(query.start_date, 'start_date') : null;
  const endDate = query.end_date ? normalizeDateOnly(query.end_date, 'end_date') : null;

  if (areaCode) {
    values.push(areaCode);
    where.push(`upper(s.area_code) = $${values.length}`);
  }
  if (bayCode) {
    values.push([bayCode]);
    where.push(`s.bay_codes && $${values.length}::text[]`);
  }
  if (workcenter) {
    values.push(workcenter);

    where.push(`(s.task_id is null or upper(coalesce(t.workcenter, '')) = $${values.length})`);
  }
  if (startDate) {
    values.push(startDate);
    where.push(`s.end_date >= $${values.length}::date`);
  }
  if (endDate) {
    values.push(endDate);
    where.push(`s.start_date <= $${values.length}::date`);
  }
  if (!startDate && !endDate) {
    where.push("current_date between s.start_date and s.end_date");
  }
  where.push(`(
    s.task_id is null
    or (coalesce(t.actual_progress, 0) < 100 and not coalesce(ph.is_teco, false))
  )`);
  if (q) {
    values.push(`%${q.toLowerCase()}%`);
    where.push(`(
      lower(coalesce(s.order_no, '')) like $${values.length}
      or lower(coalesce(t.task_name, '')) like $${values.length}
      or lower(coalesce(t.operation_no, '')) like $${values.length}
      or lower(coalesce(t.ssbr_id, '')) like $${values.length}
      or lower(coalesce(t.workcenter, '')) like $${values.length}
    )`);
  }

  const result = await pool().query(
    `select
       s.schedule_id,
       s.schedule_group_id,
       s.booking_type,
       s.order_no,
       s.project_id as schedule_project_id,
       s.task_id as schedule_task_id,
       s.area_code,
       s.area_name,
       s.bay_codes,
       s.start_date,
       s.end_date,
       s.status as schedule_status,
       s.notes as schedule_notes,
       (s.task_id is null) as is_order_level,
       t.task_id,
       t.project_id,
       t.task_name,
       t.outline_number,
       t.order_no as task_order_no,
       t.operation_no,
       t.ssbr_id,
       t.workcenter,
       t.plan_start,
       t.plan_finish,
       t.duration_minutes,
       t.planned_work_minutes,
       t.actual_progress,
       t.is_summary,
       act.actual_hours,
       mp.project_name,
       u.unit_name
       from ms_project_bay_schedule s
       left join ms_project_task t
       on t.is_active = true
       and s.project_id is not null
       and s.task_id is not null
       and t.project_id = s.project_id
       and t.task_id = s.task_id
       -- Nama project untuk group header (order-level: task NULL → pakai project_id dari schedule).
       left join ms_project mp
       on mp.project_id = coalesce(t.project_id, s.project_id)
       -- Status TECO order SAP (bool_or: kalau salah satu baris ph3_order TECO → hidden).
       left join lateral (
         select bool_or(upper(coalesce(k.order_description, '')) = 'TECO') as is_teco
         from ph3_order k
         where ltrim(k.order_no, '0') = ltrim(s.order_no, '0')
       ) ph on true
       left join lateral (
         select coalesce(sum(coalesce(tt.duration, 0)), 0) as actual_hours
         from timesheet_transaction tt
         where ltrim(tt.order_no, '0') = ltrim(s.order_no, '0')
           and tt.duration is not null and tt.duration > 0
       ) act on true
       -- Grouping job per "Unit": naikkan rantai parent sampai summary yang namanya mengandung
       -- 'unit' (mis. "UNIT 1", "UNIT 01"). Kalau tidak ada (project berbasis proses seperti
       -- FABRICATION/BLASTING), unit_name NULL → FE menampilkan bucket "No Unit".
       left join lateral (
       with recursive chain as (
         select m.task_id, m.task_name, m.parent_task_id, 1 as depth
         from ms_project_task m
         where m.task_id = t.parent_task_id
         union all
         select m.task_id, m.task_name, m.parent_task_id, c.depth + 1
         from ms_project_task m
         join chain c on m.task_id = c.parent_task_id
         where c.depth < 8
       )
       select c.task_name as unit_name
       from chain c
       where c.task_name ilike '%unit%'
       order by c.depth
       limit 1
       ) u on true
     where ${where.join(' and ')}
       and (
         -- reservasi task-level: tetap seperti dulu, satu baris per task nyata
         (s.task_id is not null and t.task_id is not null and coalesce(t.is_summary, false) = false)
         -- reservasi order-level: satu entri saja, tanpa task hasil tebakan
         or s.task_id is null
       )
     order by
       s.start_date,
       s.area_code,
       s.bay_codes[1],
       s.order_no,
       case when nullif(t.operation_no, '') is null then 1 else 0 end,
       case when t.operation_no ~ '^\\d+$' then t.operation_no::integer end nulls last,
       t.operation_no nulls last,
       t.outline_number nulls last,
       t.created_at,
       t.task_name`,
    values
  );

  const orderLevelCount = result.rows.filter((row) => row.is_order_level).length;

  return {
    rows: result.rows,
    summary: {
      area_code: areaCode || null,
      bay_code: bayCode || null,
      workcenter: workcenter || null,
      task_count: result.rows.length - orderLevelCount,
      order_level_count: orderLevelCount,
      row_count: result.rows.length,
    },
  };
}

function normalizeTaskRows(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    throw new ApiError(400, 'INVALID_PAYLOAD', 'tasks must be an array', [{ field: 'tasks' }]);
  }
  const rows = [];
  const seen = new Set();
  input.forEach((entry, index) => {
    let taskId;
    let projectId = null;
    if (typeof entry === 'string') {
      taskId = assertUuid(entry, `task_ids[${index}]`);
    } else if (entry && typeof entry === 'object') {
      taskId = assertUuid(entry.task_id, `tasks[${index}].task_id`);
      projectId = optionalUuid(entry.project_id, `tasks[${index}].project_id`);
    } else {
      throw new ApiError(
        400,
        'INVALID_PAYLOAD',
        'Each task entry must be a UUID or an object with task_id',
        [{ field: `tasks[${index}]` }]
      );
    }
    if (seen.has(taskId)) return;
    seen.add(taskId);
    rows.push({ task_id: taskId, project_id: projectId });
  });
  return rows;
}

async function resolveTaskProject(client, taskId, providedProjectId) {
  if (providedProjectId) {
    const res = await client.query(
      `select project_id
       from ms_project_task
       where task_id = $1
         and project_id = $2
         and is_active = true`,
      [taskId, providedProjectId]
    );
    if (!res.rows[0]) {
      throw new ApiError(
        404,
        'TASK_NOT_FOUND',
        'Project task not found for the provided project_id',
        [{ task_id: taskId, project_id: providedProjectId }]
      );
    }
    return providedProjectId;
  }
  const res = await client.query(
    `select project_id
     from ms_project_task
     where task_id = $1
       and is_active = true`,
    [taskId]
  );
  if (!res.rows.length) {
    throw new ApiError(404, 'TASK_NOT_FOUND', 'Project task not found', [{ task_id: taskId }]);
  }
  if (res.rows.length > 1) {
    throw new ApiError(
      400,
      'AMBIGUOUS_TASK',
      'task_id exists under multiple projects; provide project_id',
      [{ task_id: taskId }]
    );
  }
  return res.rows[0].project_id;
}

async function findBayOverlaps(
  client,
  { bayCodes, startDate, endDate, excludeGroupId = null } = {}
) {
  const codes = Array.isArray(bayCodes) ? bayCodes.filter(Boolean) : [];
  if (!codes.length || !startDate || !endDate) return { rows: [], truncated: false, total: 0 };

  const runner = client || pool();
  const values = [codes, startDate, endDate];
  let excludeSql = '';
  if (excludeGroupId) {
    values.push(excludeGroupId);
    excludeSql = `and (s.schedule_group_id is null or s.schedule_group_id <> $${values.length}::uuid)`;
  }

  const whereSql = `s.status <> 'CANCELLED'
       and s.bay_codes && $1::text[]
       and daterange(s.start_date, s.end_date, '[]') && daterange($2::date, $3::date, '[]')
       ${excludeSql}`;

  const groupExpr = 'coalesce(s.schedule_group_id, s.schedule_id)';

  const countResult = await runner.query(
    `select count(distinct ${groupExpr})::integer as total
     from ms_project_bay_schedule s
     where ${whereSql}`,
    values
  );
  const total = countResult.rows[0]?.total ?? 0;

  const result = await runner.query(
    `select * from (
       select distinct on (${groupExpr})
         s.schedule_id,
         s.schedule_group_id,
         s.order_no,
         s.booking_type,
         s.purpose,
         s.bay_codes,
         s.start_date,
         s.end_date,
         s.status,
         s.created_by
       from ms_project_bay_schedule s
       where ${whereSql}
       order by ${groupExpr}, s.start_date
     ) o
     order by o.start_date, o.bay_codes[1], o.order_no
     limit ${BAY_OVERLAP_LIMIT}`,
    values
  );
  return { rows: result.rows, truncated: total > result.rows.length, total };
}

async function createBaySchedule(body = {}) {
  const payload = ensureObject(body, 'payload');

  const bookingType = normalizeBookingType(payload.booking_type);
  const isOrderBooking = bookingType === 'ORDER';
  const orderNo = isOrderBooking ? nullableText(payload.order_no) : null;
  const purpose = nullableText(payload.purpose);
  const areaCode = nullableText(payload.area_code)?.toUpperCase();
  const areaName = nullableText(payload.area_name) || areaCode;
  const bayCodes = normalizeBayCodes(payload.bay_codes);
  const startDate = normalizeDateOnly(payload.start_date, 'start_date');
  const endDate = normalizeDateOnly(payload.end_date, 'end_date');
  let projectId = isOrderBooking ? optionalUuid(payload.project_id, 'project_id') : null;
  const taskId = isOrderBooking ? optionalUuid(payload.task_id, 'task_id') : null;
  const actor = actorFromBody(payload, 'web-manufacturing');

  const actorUserId = Number.isInteger(payload.actor_user_id) ? payload.actor_user_id : null;
  const notes = nullableText(payload.notes);

  let taskRows = isOrderBooking ? normalizeTaskRows(payload.tasks || payload.task_ids) : [];

  const scheduleGroupId = crypto.randomUUID();

  if (isOrderBooking && !orderNo) {
    throw new ApiError(400, 'INVALID_PAYLOAD', 'order_no is required', [{ field: 'order_no' }]);
  }
  if (!isOrderBooking && !purpose) {
    throw new ApiError(
      400,
      'INVALID_PAYLOAD',
      'purpose is required when booking_type is not ORDER',
      [{ field: 'purpose', booking_type: bookingType }]
    );
  }
  if (!areaCode) {
    throw new ApiError(400, 'INVALID_PAYLOAD', 'area_code is required', [{ field: 'area_code' }]);
  }
  if (endDate < startDate) {
    throw new ApiError(400, 'INVALID_DATE_RANGE', 'end_date must be on or after start_date', [
      { field: 'start_date', value: startDate },
      { field: 'end_date', value: endDate },
    ]);
  }
  if (taskRows.length === 0 && taskId && !projectId) {
    throw new ApiError(400, 'INVALID_PAYLOAD', 'project_id is required when task_id is provided', [
      { field: 'project_id' },
    ]);
  }

  const client = await pool().connect();
  try {
    await client.query('begin');

    let resolvedOrderNo = null;
    if (isOrderBooking) {
      const sowResult = await client.query(
        `select min(order_no) as order_no
         from sow
         where ltrim(order_no, '0') = ltrim($1, '0')`,
        [orderNo]
      );
      resolvedOrderNo = sowResult.rows[0]?.order_no || orderNo;
    }

    if (taskRows.length > 0) {
      const overlaps = await findBayOverlaps(client, { bayCodes, startDate, endDate });

      const opResult = await client.query(
        `select task_id, operation_no from ms_project_task where task_id = any($1::uuid[])`,
        [taskRows.map((row) => row.task_id)]
      );
      const opByTask = new Map(opResult.rows.map((row) => [row.task_id, row.operation_no]));
      const seenOperation = new Map();
      const droppedDuplicateOperations = [];
      const uniqueTaskRows = [];
      for (const taskRow of taskRows) {
        const op = opByTask.get(taskRow.task_id);
        const key = op == null || op === '' ? null : String(op).trim();
        if (key !== null && seenOperation.has(key)) {
          droppedDuplicateOperations.push({
            operation_no: key,
            kept_task_id: seenOperation.get(key),
            dropped_task_id: taskRow.task_id,
          });
          continue;
        }
        if (key !== null) seenOperation.set(key, taskRow.task_id);
        uniqueTaskRows.push(taskRow);
      }
      taskRows = uniqueTaskRows;

      const inserted = [];
      for (const taskRow of taskRows) {
        const resolvedProjectId = await resolveTaskProject(
          client,
          taskRow.task_id,
          taskRow.project_id
        );
        const insertResult = await client.query(
          `insert into ms_project_bay_schedule (
             order_no,
             project_id,
             task_id,
             area_code,
             area_name,
             bay_codes,
             start_date,
             end_date,
             status,
             notes,
             booking_type,
             purpose,
             schedule_group_id,
             created_by,
             updated_by,
             created_by_user_id,
             updated_by_user_id
           )
           values ($1, $2, $3, $4, $5, $6::text[], $7::date, $8::date, 'RESERVED', $9, $10, $11, $12::uuid, $13, $13, $14, $14)
           returning *`,
          [
            resolvedOrderNo,
            resolvedProjectId,
            taskRow.task_id,
            areaCode,
            areaName,
            bayCodes,
            startDate,
            endDate,
            notes,
            bookingType,
            purpose,
            scheduleGroupId,
            actor,
            actorUserId,
          ]
        );
        inserted.push(insertResult.rows[0]);
      }

      await writeAuditLog(client, {
        projectId: inserted[0]?.project_id || null,
        action: 'BAY_SCHEDULE_RESERVE',
        actor,
        details: {
          schedule_group_id: scheduleGroupId,
          schedule_ids: inserted.map((row) => row.schedule_id),
          task_ids: inserted.map((row) => row.task_id),
          order_no: resolvedOrderNo,
          booking_type: bookingType,
          area_code: areaCode,
          bay_codes: bayCodes,
          start_date: startDate,
          end_date: endDate,

          overlap_count: overlaps.total,
          overlap_truncated: overlaps.truncated,
        },
      });

      await client.query('commit');
      return {
        schedules: inserted,
        count: inserted.length,
        schedule_group_id: scheduleGroupId,
        overlaps,
        dropped_duplicate_operations: droppedDuplicateOperations,
      };
    }

    if (isOrderBooking && !projectId) {
      const projectMatch = await client.query(
        `select distinct project_id
           from ms_project_task
          where is_active = true
            and project_id is not null
            and ltrim(order_no, '0') = ltrim($1, '0')`,
        [resolvedOrderNo]
      );
      if (projectMatch.rows.length === 1) {
        projectId = projectMatch.rows[0].project_id;
      }
    }

    if (projectId) {
      const projectResult = await client.query(
        'select project_id from ms_project where project_id = $1',
        [projectId]
      );
      if (!projectResult.rows[0]) {
        throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found', [
          { project_id: projectId },
        ]);
      }
    }
    if (taskId) {
      const taskResult = await client.query(
        `select task_id
         from ms_project_task
         where project_id = $1
           and task_id = $2
           and is_active = true`,
        [projectId, taskId]
      );
      if (!taskResult.rows[0]) {
        throw new ApiError(404, 'TASK_NOT_FOUND', 'Project task not found', [{ task_id: taskId }]);
      }
    }

    const overlaps = await findBayOverlaps(client, { bayCodes, startDate, endDate });

    const insertResult = await client.query(
      `insert into ms_project_bay_schedule (
         order_no,
         project_id,
         task_id,
         area_code,
         area_name,
         bay_codes,
         start_date,
         end_date,
         status,
         notes,
         booking_type,
         purpose,
         schedule_group_id,
         created_by,
         updated_by,
         created_by_user_id,
         updated_by_user_id
       )
       values ($1, $2, $3, $4, $5, $6::text[], $7::date, $8::date, 'RESERVED', $9, $10, $11, $12::uuid, $13, $13, $14, $14)
       returning *`,
      [
        resolvedOrderNo,
        projectId,
        taskId,
        areaCode,
        areaName,
        bayCodes,
        startDate,
        endDate,
        notes,
        bookingType,
        purpose,
        scheduleGroupId,
        actor,
        actorUserId,
      ]
    );

    await writeAuditLog(client, {
      projectId,
      action: 'BAY_SCHEDULE_RESERVE',
      actor,
      details: {
        schedule_group_id: scheduleGroupId,
        schedule_id: insertResult.rows[0].schedule_id,
        order_no: resolvedOrderNo,
        booking_type: bookingType,
        purpose,
        area_code: areaCode,
        bay_codes: bayCodes,
        start_date: startDate,
        end_date: endDate,
        overlap_count: overlaps.total,
        overlap_truncated: overlaps.truncated,
      },
    });

    await client.query('commit');
    return { ...insertResult.rows[0], schedule_group_id: scheduleGroupId, overlaps };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function listBayOccupants(query = {}) {
  const bayCodes = parseBayCodeList(query.bay_codes);
  if (!bayCodes.length) {
    throw new ApiError(400, 'INVALID_PAYLOAD', 'bay_codes is required', [{ field: 'bay_codes' }]);
  }
  const startDate = normalizeDateOnly(query.start_date, 'start_date');
  const endDate = normalizeDateOnly(query.end_date, 'end_date');
  if (endDate < startDate) {
    throw new ApiError(400, 'INVALID_DATE_RANGE', 'end_date must be on or after start_date', [
      { field: 'start_date', value: startDate },
      { field: 'end_date', value: endDate },
    ]);
  }
  const excludeGroupId = optionalUuid(query.exclude_group_id, 'exclude_group_id');

  return findBayOverlaps(pool(), { bayCodes, startDate, endDate, excludeGroupId });
}

async function loadBayScheduleGroup(client, groupId) {
  const result = await client.query(
    `select *
     from ms_project_bay_schedule
     where schedule_group_id = $1::uuid
     order by created_at, schedule_id
     for update`,
    [groupId]
  );
  if (!result.rows.length) {
    throw new ApiError(404, 'BAY_SCHEDULE_GROUP_NOT_FOUND', 'Bay schedule group not found', [
      { schedule_group_id: groupId },
    ]);
  }
  return result.rows;
}

async function updateBayScheduleGroup(groupIdParam, body = {}) {
  const groupId = assertUuid(groupIdParam, 'schedule_group_id');
  const payload = ensureObject(body, 'payload');
  const actor = actorFromBody(payload, 'web-manufacturing');

  const actorUserId = Number.isInteger(payload.actor_user_id) ? payload.actor_user_id : null;
  const hasNotes = payload.notes !== undefined;
  const hasPurpose = payload.purpose !== undefined;
  const notes = hasNotes ? nullableText(payload.notes) : null;
  const purpose = hasPurpose ? nullableText(payload.purpose) : null;

  const hasBayCodes = payload.bay_codes !== undefined;
  const bayCodes = hasBayCodes ? normalizeBayCodes(payload.bay_codes) : null;

  const hasAreaCode = payload.area_code !== undefined;
  const areaCode = hasAreaCode ? nullableText(payload.area_code)?.toUpperCase() || null : null;
  if (hasAreaCode && !areaCode) {
    throw new ApiError(400, 'INVALID_PAYLOAD', 'area_code cannot be cleared', [
      { field: 'area_code' },
    ]);
  }
  const hasAreaName = payload.area_name !== undefined;
  const areaName = hasAreaName ? nullableText(payload.area_name) : null;

  const hasTasks = payload.tasks !== undefined || payload.task_ids !== undefined;
  const taskRows = hasTasks ? normalizeTaskRows(payload.tasks ?? payload.task_ids) : [];

  if (hasTasks && taskRows.length === 0) {
    throw new ApiError(400, 'INVALID_PAYLOAD', 'tasks cannot be empty; cancel the group instead', [
      { field: 'tasks', schedule_group_id: groupId },
    ]);
  }

  const client = await pool().connect();
  try {
    await client.query('begin');
    const existing = await loadBayScheduleGroup(client, groupId);
    const active = existing.filter((row) => row.status !== 'CANCELLED');
    if (!active.length) {
      throw new ApiError(409, 'BAY_SCHEDULE_CANCELLED', 'Bay schedule group is already cancelled', [
        { schedule_group_id: groupId },
      ]);
    }

    const current = active[0];
    const startDate =
      payload.start_date === undefined
        ? toDateOnlyString(current.start_date)
        : normalizeDateOnly(payload.start_date, 'start_date');
    const endDate =
      payload.end_date === undefined
        ? toDateOnlyString(current.end_date)
        : normalizeDateOnly(payload.end_date, 'end_date');
    if (endDate < startDate) {
      throw new ApiError(400, 'INVALID_DATE_RANGE', 'end_date must be on or after start_date', [
        { field: 'start_date', value: startDate },
        { field: 'end_date', value: endDate },
      ]);
    }

    if (hasPurpose && !purpose && active.some((row) => (row.booking_type || 'ORDER') !== 'ORDER')) {
      throw new ApiError(
        400,
        'INVALID_PAYLOAD',
        'purpose cannot be cleared on a non-ORDER booking',
        [{ field: 'purpose', schedule_group_id: groupId }]
      );
    }

    const effectiveBayCodes = hasBayCodes ? bayCodes : current.bay_codes;
    const effectivePurpose = hasPurpose ? purpose : (current.purpose ?? null);
    const effectiveNotes = hasNotes ? notes : (current.notes ?? null);
    const effectiveAreaCode = hasAreaCode ? areaCode : current.area_code;
    const effectiveAreaName = hasAreaName ? areaName : current.area_name;

    const isTaskLevelGroup = active.some((row) => row.task_id !== null);
    const tasksIgnored = hasTasks && !isTaskLevelGroup;
    const syncTasks = hasTasks && isTaskLevelGroup;
    const desiredTaskIds = new Set(taskRows.map((row) => row.task_id));
    const activeTaskRows = active.filter((row) => row.task_id !== null);
    const activeTaskIds = new Set(activeTaskRows.map((row) => row.task_id));
    let cancelledTaskIds = [];
    const addedTaskIds = [];

    if (syncTasks) {
      const rowsToCancel = activeTaskRows.filter((row) => !desiredTaskIds.has(row.task_id));
      if (rowsToCancel.length) {
        const cancelResult = await client.query(
          `update ms_project_bay_schedule
           set status = 'CANCELLED',
               updated_by = $2,
               updated_by_user_id = $3,
               updated_at = now()
           where schedule_id = any($1::uuid[])
             and status <> 'CANCELLED'
           returning task_id`,
          [rowsToCancel.map((row) => row.schedule_id), actor, actorUserId]
        );
        cancelledTaskIds = cancelResult.rows.map((row) => row.task_id);
      }
    }

    await client.query(
      `update ms_project_bay_schedule
       set start_date = $2::date,
           end_date = $3::date,
           notes = case when $4::boolean then $5 else notes end,
           purpose = case when $6::boolean then $7 else purpose end,
           bay_codes = case when $8::boolean then $9::text[] else bay_codes end,
           area_code = case when $10::boolean then $11 else area_code end,
           area_name = case when $12::boolean then $13 else area_name end,
           updated_by = $14,
           updated_by_user_id = $15,
           updated_at = now()
       where schedule_group_id = $1::uuid
         and status <> 'CANCELLED'`,
      [
        groupId,
        startDate,
        endDate,
        hasNotes,
        notes,
        hasPurpose,
        purpose,
        hasBayCodes,
        bayCodes,
        hasAreaCode,
        areaCode,
        hasAreaName,
        areaName,
        actor,
        actorUserId,
      ]
    );

    if (syncTasks) {
      for (const taskRow of taskRows) {
        if (activeTaskIds.has(taskRow.task_id)) continue;
        const resolvedProjectId = await resolveTaskProject(
          client,
          taskRow.task_id,
          taskRow.project_id
        );

        if (current.order_no) {
          const owner = await client.query(
            `select order_no
             from ms_project_task
             where task_id = $1 and project_id = $2`,
            [taskRow.task_id, resolvedProjectId]
          );
          const taskOrderNo = owner.rows[0]?.order_no ?? null;
          if (
            taskOrderNo &&
            taskOrderNo.replace(/^0+/, '') !== String(current.order_no).replace(/^0+/, '')
          ) {
            throw new ApiError(400, 'TASK_ORDER_MISMATCH', 'Task belongs to a different order', [
              {
                task_id: taskRow.task_id,
                task_order_no: taskOrderNo,
                group_order_no: current.order_no,
              },
            ]);
          }
        }

        await client.query(
          `insert into ms_project_bay_schedule (
             order_no,
             project_id,
             task_id,
             area_code,
             area_name,
             bay_codes,
             start_date,
             end_date,
             status,
             notes,
             booking_type,
             purpose,
             schedule_group_id,
             created_by,
             updated_by,
             created_by_user_id,
             updated_by_user_id
           )
           values ($1, $2, $3, $4, $5, $6::text[], $7::date, $8::date, 'RESERVED', $9, $10, $11, $12::uuid, $13, $13, $14, $14)`,
          [
            current.order_no,
            resolvedProjectId,
            taskRow.task_id,
            effectiveAreaCode,
            effectiveAreaName,
            effectiveBayCodes,
            startDate,
            endDate,
            effectiveNotes,
            current.booking_type || 'ORDER',
            effectivePurpose,
            groupId,
            actor,
            actorUserId,
          ]
        );
        addedTaskIds.push(taskRow.task_id);
      }
    }

    const overlaps = await findBayOverlaps(client, {
      bayCodes: effectiveBayCodes,
      startDate,
      endDate,
      excludeGroupId: groupId,
    });

    const finalRows = await client.query(
      `select *
       from ms_project_bay_schedule
       where schedule_group_id = $1::uuid
         and status <> 'CANCELLED'
       order by created_at, schedule_id`,
      [groupId]
    );

    await writeAuditLog(client, {
      projectId: current.project_id || null,
      action: 'BAY_SCHEDULE_UPDATE',
      actor,
      details: {
        schedule_group_id: groupId,
        schedule_ids: finalRows.rows.map((row) => row.schedule_id),
        order_no: current.order_no,
        booking_type: current.booking_type || 'ORDER',
        area_code: effectiveAreaCode,
        bay_codes: effectiveBayCodes,
        start_date: startDate,
        end_date: endDate,
        notes_changed: hasNotes,
        purpose_changed: hasPurpose,
        bay_codes_changed: hasBayCodes,
        previous_bay_codes: hasBayCodes ? current.bay_codes : undefined,
        tasks_added: addedTaskIds,
        tasks_cancelled: cancelledTaskIds,
        tasks_ignored: tasksIgnored,
        overlap_count: overlaps.total,
        overlap_truncated: overlaps.truncated,
      },
    });

    await client.query('commit');
    return {
      schedules: finalRows.rows,
      count: finalRows.rows.length,
      schedule_group_id: groupId,
      tasks_added: addedTaskIds.length,
      tasks_cancelled: cancelledTaskIds.length,

      tasks_ignored: tasksIgnored,
      overlaps,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function cancelBayScheduleGroup(groupIdParam, body = {}) {
  const groupId = assertUuid(groupIdParam, 'schedule_group_id');
  const payload = ensureObject(body, 'payload');
  const actor = actorFromBody(payload, 'web-manufacturing');

  const actorUserId = Number.isInteger(payload.actor_user_id) ? payload.actor_user_id : null;

  const client = await pool().connect();
  try {
    await client.query('begin');
    const existing = await loadBayScheduleGroup(client, groupId);

    const result = await client.query(
      `update ms_project_bay_schedule
       set status = 'CANCELLED',
           updated_by = $2,
           updated_by_user_id = $3,
           updated_at = now()
       where schedule_group_id = $1::uuid
         and status <> 'CANCELLED'
       returning *`,
      [groupId, actor, actorUserId]
    );

    await writeAuditLog(client, {
      projectId: existing[0].project_id || null,
      action: 'BAY_SCHEDULE_CANCEL_GROUP',
      actor,
      details: {
        schedule_group_id: groupId,
        schedule_ids: result.rows.map((row) => row.schedule_id),
        order_no: existing[0].order_no,
        booking_type: existing[0].booking_type || 'ORDER',
        area_code: existing[0].area_code,
        bay_codes: existing[0].bay_codes,
        cancelled_count: result.rows.length,
      },
    });

    await client.query('commit');
    return { cancelled: result.rows, count: result.rows.length, schedule_group_id: groupId };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function cancelBaySchedule(scheduleIdParam, body = {}) {
  const scheduleId = assertUuid(scheduleIdParam, 'schedule_id');
  const actor = actorFromBody(body, 'web-manufacturing');
  const client = await pool().connect();

  try {
    await client.query('begin');
    const result = await client.query(
      `update ms_project_bay_schedule
       set status = 'CANCELLED',
           updated_by = $2,
           updated_by_user_id = $3,
           updated_at = now()
       where schedule_id = $1
         and status <> 'CANCELLED'
       returning *`,
      [scheduleId, actor, actorUserId]
    );
    const schedule = result.rows[0];
    if (!schedule) {
      throw new ApiError(404, 'BAY_SCHEDULE_NOT_FOUND', 'Bay schedule not found', [
        { schedule_id: scheduleId },
      ]);
    }

    await writeAuditLog(client, {
      projectId: schedule.project_id,
      action: 'BAY_SCHEDULE_CANCEL',
      actor,
      details: {
        schedule_id: schedule.schedule_id,
        schedule_group_id: schedule.schedule_group_id || null,
        order_no: schedule.order_no,
        booking_type: schedule.booking_type || 'ORDER',
        area_code: schedule.area_code,
        bay_codes: schedule.bay_codes,
      },
    });

    await client.query('commit');
    return schedule;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function getProjectPackage(projectId) {
  return queryProjectPackage(pool(), assertUuid(projectId, 'project_id'));
}

async function bulkLoadProjectPackages(projectIds) {
  const ids = normalizeUuidArray(projectIds, 'project_ids');
  if (!ids.length) {
    throw new ApiError(400, 'INVALID_PAYLOAD', 'project_ids must not be empty');
  }
  const packages = [];
  for (const id of ids) {
    packages.push(await queryProjectPackage(pool(), id));
  }
  return packages;
}

async function listCalendars(query = {}) {
  const values = [];
  const where = [];
  const active = toBool(query.active, true);
  const scope = nullableText(query.scope)?.toUpperCase();
  const q = nullableText(query.q);

  if (active !== null) {
    values.push(active);
    where.push(`c.is_active = $${values.length}`);
  }
  if (scope) {
    values.push(scope);
    where.push(`c.calendar_scope = $${values.length}`);
  }
  if (q) {
    values.push(`%${q}%`);
    where.push(
      `(c.calendar_code ilike $${values.length} or c.calendar_name ilike $${values.length})`
    );
  }

  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  values.push(limit, offset);

  const result = await pool().query(
    `select
       c.*,
       coalesce(wd.weekday_count, 0)::integer as weekday_count,
       coalesce(wt.working_time_count, 0)::integer as working_time_count,
       coalesce(ex.exception_count, 0)::integer as exception_count
     from ms_project_calendar c
     left join (
       select calendar_id, count(*) as weekday_count
       from ms_project_calendar_weekday
       group by calendar_id
     ) wd on wd.calendar_id = c.calendar_id
     left join (
       select calendar_id, count(*) as working_time_count
       from ms_project_calendar_working_time
       group by calendar_id
     ) wt on wt.calendar_id = c.calendar_id
     left join (
       select calendar_id, count(*) as exception_count
       from ms_project_calendar_exception
       where is_active = true
       group by calendar_id
     ) ex on ex.calendar_id = c.calendar_id
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by c.is_default desc, c.calendar_scope, c.calendar_code
     limit $${values.length - 1} offset $${values.length}`,
    values
  );

  return { rows: result.rows, limit, offset };
}

async function getCalendar(calendarIdParam) {
  const calendarId = assertUuid(calendarIdParam, 'calendar_id');
  const client = pool();
  const [calendar, weekdays, workingTimes, exceptions, exceptionTimes] = await Promise.all([
    client.query('select * from ms_project_calendar where calendar_id = $1', [calendarId]),
    client.query(
      `select *
       from ms_project_calendar_weekday
       where calendar_id = $1
       order by day_of_week`,
      [calendarId]
    ),
    client.query(
      `select *
       from ms_project_calendar_working_time
       where calendar_id = $1
       order by day_of_week, segment_no`,
      [calendarId]
    ),
    client.query(
      `select *
       from ms_project_calendar_exception
       where calendar_id = $1
       order by start_date, priority, exception_name`,
      [calendarId]
    ),
    client.query(
      `select et.*
       from ms_project_calendar_exception_time et
       join ms_project_calendar_exception ex on ex.exception_id = et.exception_id
       where ex.calendar_id = $1
       order by et.exception_id, et.segment_no`,
      [calendarId]
    ),
  ]);

  if (!calendar.rows[0]) {
    throw new ApiError(404, 'CALENDAR_NOT_FOUND', 'Calendar not found');
  }

  const timesByException = new Map();
  for (const row of exceptionTimes.rows) {
    if (!timesByException.has(row.exception_id)) timesByException.set(row.exception_id, []);
    timesByException.get(row.exception_id).push(row);
  }

  return {
    ...calendar.rows[0],
    weekdays: weekdays.rows,
    working_times: workingTimes.rows,
    exceptions: exceptions.rows.map((row) => ({
      ...row,
      working_times: timesByException.get(row.exception_id) || [],
    })),
  };
}

async function refreshCalendarsFromShifts(body = {}) {
  const actor = actorFromBody(body, 'ms-project-api');
  const client = await pool().connect();
  const summary = { created: 0, updated: 0, skipped: 0, warnings: [] };

  try {
    await client.query('begin');

    const rows = await client.query(
      `select shift_code,
              shift_name,
              start_time,
              end_time,
              crosses_midnight,
              default_capacity_hours
       from shift_definition
       where is_default = true
         and shift_code is not null
         and trim(shift_code) <> ''
       order by shift_code`
    );

    for (const row of rows.rows) {
      const calendarCode = normalizeText(row.shift_code).toUpperCase();
      const calendarName = nullableText(row.shift_name) || calendarCode;
      const hoursPerDay =
        Number(row.default_capacity_hours) > 0 ? Number(row.default_capacity_hours) : 8;
      const hoursPerWeek = hoursPerDay * 5;

      const upserted = await client.query(
        `insert into ms_project_calendar (
           calendar_code,
           calendar_name,
           calendar_scope,
           is_enterprise,
           is_default,
           hours_per_day,
           hours_per_week,
           days_per_month,
           default_start_time,
           default_finish_time,
           timezone,
           description,
           source_type,
           source_ref_id,
           created_by,
           updated_by
         )
         values ($1, $2, 'BASE', true, false, $3, $4, 20, $5, $6, 'Asia/Jakarta',
                 $7, 'SHIFT_DEFINITION', $8, $9, $9)
         on conflict (calendar_code)
         do update set
           calendar_name = excluded.calendar_name,
           calendar_scope = excluded.calendar_scope,
           is_enterprise = excluded.is_enterprise,
           hours_per_day = excluded.hours_per_day,
           hours_per_week = excluded.hours_per_week,
           days_per_month = excluded.days_per_month,
           default_start_time = excluded.default_start_time,
           default_finish_time = excluded.default_finish_time,
           timezone = excluded.timezone,
           description = excluded.description,
           source_type = excluded.source_type,
           source_ref_id = excluded.source_ref_id,
           updated_by = excluded.updated_by
         returning calendar_id, (xmax = 0) as inserted`,
        [
          calendarCode,
          calendarName,
          hoursPerDay,
          hoursPerWeek,
          row.start_time,
          row.end_time,
          `Mirrored from shift_definition.${calendarCode}`,
          calendarCode,
          actor,
        ]
      );

      const calendarId = upserted.rows[0].calendar_id;
      if (upserted.rows[0].inserted) summary.created += 1;
      else summary.updated += 1;

      await client.query(
        `insert into ms_project_calendar_weekday (calendar_id, day_of_week, day_type)
         select $1, day_of_week,
                case when day_of_week between 1 and 5 then 'WORKING' else 'NON_WORKING' end
         from generate_series(1, 7) as day_of_week
         on conflict (calendar_id, day_of_week)
         do update set day_type = excluded.day_type`,
        [calendarId]
      );

      await client.query('delete from ms_project_calendar_working_time where calendar_id = $1', [
        calendarId,
      ]);
      await client.query(
        `insert into ms_project_calendar_working_time (
           calendar_id,
           day_of_week,
           segment_no,
           start_time,
           end_time,
           crosses_midnight
         )
         select $1, day_of_week, 1, $2::time, $3::time, $4::boolean
         from generate_series(1, 5) as day_of_week`,
        [calendarId, row.start_time, row.end_time, row.crosses_midnight === true]
      );
    }

    const skipped = await client.query(
      `select count(*)::integer as count
       from shift_definition
       where is_default = false
         and shift_code is not null
         and trim(shift_code) <> ''`
    );
    summary.skipped = skipped.rows[0]?.count || 0;
    if (summary.skipped > 0) {
      summary.warnings.push({
        code: 'SHIFT_DATE_OVERRIDES_NOT_IMPORTED',
        message:
          'Non-default shift_definition rows were not imported in this stage; they belong to calendar exceptions.',
        skipped: summary.skipped,
      });
    }

    await client.query('commit');
    return summary;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function searchResources(query) {
  const values = [];
  const where = [];
  const active = toBool(query.active, null);
  const category = normalizeCategory(query.category);
  const q = nullableText(query.q);
  const workcenterCode = nullableText(query.workcenter_code);

  if (active !== null) {
    values.push(active);
    where.push(`is_active = $${values.length}`);
  }
  if (category) {
    values.push(category);
    where.push(`resource_category = $${values.length}`);
  }
  if (q) {
    values.push(`%${q}%`);
    where.push(`(resource_code ilike $${values.length} or resource_name ilike $${values.length})`);
  }
  if (workcenterCode) {
    values.push(workcenterCode);
    where.push(`workcenter_code = $${values.length}`);
  }

  const limit = clampLimit(query.limit);
  const offset = clampOffset(query.offset);
  values.push(limit, offset);

  const result = await pool().query(
    `select *
     from ms_resource
     ${where.length ? `where ${where.join(' and ')}` : ''}
     order by resource_category, resource_code
     limit $${values.length - 1} offset $${values.length}`,
    values
  );
  return { rows: result.rows, limit, offset };
}

async function upsertResourceFromRow(client, data) {
  const result = await client.query(
    `insert into ms_resource (
       resource_code, resource_name, resource_type, resource_category,
       source_type, source_ref_id, employee_id, machine_id, workcenter_code,
       max_units, is_assignable, is_generic, is_active, description
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true, $13)
     on conflict (source_type, source_ref_id)
     where source_ref_id is not null
     do update set
       resource_code = excluded.resource_code,
       resource_name = excluded.resource_name,
       resource_type = excluded.resource_type,
       resource_category = excluded.resource_category,
       employee_id = excluded.employee_id,
       machine_id = excluded.machine_id,
       workcenter_code = excluded.workcenter_code,
       max_units = excluded.max_units,
       is_assignable = excluded.is_assignable,
       is_generic = excluded.is_generic,
       is_active = true,
       description = excluded.description,
       updated_at = now()
     returning resource_id, (xmax = 0) as inserted`,
    [
      data.resource_code,
      data.resource_name,
      data.resource_type || 'WORK',
      data.resource_category,
      data.source_type,
      data.source_ref_id,
      data.employee_id || null,
      data.machine_id || null,
      data.workcenter_code || null,
      data.max_units || 1,
      data.is_assignable !== false,
      data.is_generic === true,
      data.description || null,
    ]
  );
  return result.rows[0];
}

async function refreshResources(body) {
  const requestedSources = ensureArray(
    body?.sources || ['WORKCENTER', 'MACHINE', 'EMPLOYEE'],
    'sources'
  ).map((source) => normalizeText(source).toUpperCase());
  const invalid = requestedSources.filter((source) => !RESOURCE_REFRESH_SOURCES.has(source));
  if (invalid.length) {
    throw new ApiError(400, 'INVALID_RESOURCE_SOURCE', 'Unsupported refresh source', invalid);
  }

  const client = await pool().connect();
  const summary = { created: 0, updated: 0, skipped: 0, warnings: [] };

  try {
    await client.query('begin');

    if (requestedSources.includes('EMPLOYEE')) {
      const result = await client.query(
        `select snssb, full_name, machineid, workcenter
         from usernfc
         where snssb is not null and trim(snssb) <> ''`
      );
      for (const row of result.rows) {
        const key = normalizeText(row.snssb);
        if (!key) {
          summary.skipped += 1;
          continue;
        }
        const upserted = await upsertResourceFromRow(client, {
          resource_code: `EMP-${key}`,
          resource_name: nullableText(row.full_name) || key,
          resource_category: 'PERSON',
          source_type: 'EMPLOYEE_MASTER',
          source_ref_id: key,
          employee_id: key,
          machine_id: nullableText(row.machineid),
          workcenter_code: nullableText(row.workcenter),
          max_units: 1,
          is_assignable: true,
          is_generic: false,
          description: 'Synced from usernfc',
        });
        if (upserted.inserted) summary.created += 1;
        else summary.updated += 1;
      }
    }

    if (requestedSources.includes('MACHINE')) {
      const result = await client.query(
        `select machineid, workcenter_description, workcenternew
         from workcenter
         where machineid is not null and trim(machineid) <> ''`
      );
      for (const row of result.rows) {
        const key = normalizeText(row.machineid);
        if (!key) {
          summary.skipped += 1;
          continue;
        }
        const upserted = await upsertResourceFromRow(client, {
          resource_code: `MCH-${key}`,
          resource_name: nullableText(row.workcenter_description) || key,
          resource_category: 'MACHINE',
          source_type: 'MACHINE_MASTER',
          source_ref_id: key,
          machine_id: key,
          workcenter_code: nullableText(row.workcenternew),
          max_units: 1,
          is_assignable: true,
          is_generic: false,
          description: 'Synced from workcenter.machineid',
        });
        if (upserted.inserted) summary.created += 1;
        else summary.updated += 1;
      }
    }

    if (requestedSources.includes('WORKCENTER')) {
      const result = await client.query(
        `select workcenternew, workcenter_description
         from workcenter
         where workcenternew is not null and trim(workcenternew) <> ''`
      );
      for (const row of result.rows) {
        const key = normalizeText(row.workcenternew);
        if (!key) {
          summary.skipped += 1;
          continue;
        }
        const upserted = await upsertResourceFromRow(client, {
          resource_code: `WC-${key}`,
          resource_name: nullableText(row.workcenter_description) || key,
          resource_category: 'WORKCENTER',
          source_type: 'WORKCENTER_MASTER',
          source_ref_id: key,
          workcenter_code: key,
          max_units: 1,
          is_assignable: true,
          is_generic: true,
          description: 'Synced from workcenter.workcenternew',
        });
        if (upserted.inserted) summary.created += 1;
        else summary.updated += 1;
      }
    }

    await client.query('commit');
    return summary;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function getProjectResources(projectId) {
  const result = await pool().query(
    `select
       pr.project_resource_id,
       pr.project_id,
       pr.resource_id,
       pr.is_active as project_resource_is_active,
       r.resource_code,
       r.resource_name,
       r.resource_type,
       r.resource_category,
       r.source_type,
       r.source_ref_id,
       r.employee_id,
       r.machine_id,
       r.workcenter_code,
       r.parent_resource_id,
       r.max_units,
       r.is_assignable,
       r.is_generic,
       r.is_active as resource_is_active,
       pr.created_at,
       pr.updated_at
     from ms_project_resource pr
     join ms_resource r on r.resource_id = pr.resource_id
     where pr.project_id = $1
     order by r.resource_category, r.resource_code`,
    [assertUuid(projectId, 'project_id')]
  );
  return result.rows;
}

async function addProjectResources(projectId, resourceIds) {
  const id = assertUuid(projectId, 'project_id');
  const client = await pool().connect();
  try {
    await client.query('begin');
    const project = await client.query('select project_id from ms_project where project_id = $1', [
      id,
    ]);
    if (!project.rows[0]) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    const result = await upsertProjectResources(
      client,
      id,
      resourceIds.map((resource_id) => ({ resource_id }))
    );
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deactivateProjectResource(projectId, resourceId) {
  const pid = assertUuid(projectId, 'project_id');
  const rid = assertUuid(resourceId, 'resource_id');
  const client = await pool().connect();

  try {
    await client.query('begin');
    const blockers = await client.query(
      `select assignment_id, task_id, resource_id
       from ms_project_assignment
       where project_id = $1 and resource_id = $2 and is_active = true`,
      [pid, rid]
    );
    if (blockers.rows.length) {
      throw new ApiError(
        409,
        'RESOURCE_DEACTIVATE_BLOCKED',
        'Resource is still used by active assignments',
        blockers.rows
      );
    }
    const result = await client.query(
      `update ms_project_resource
       set is_active = false
       where project_id = $1 and resource_id = $2
       returning *`,
      [pid, rid]
    );
    if (!result.rows[0])
      throw new ApiError(404, 'PROJECT_RESOURCE_NOT_FOUND', 'Project resource not found');
    await client.query('commit');
    return result.rows[0];
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function checkoutProject(projectIdParam, body = {}) {
  const projectId = assertUuid(projectIdParam, 'project_id');
  const actor = actorFromBody(body);
  const lockToken = crypto.randomUUID();
  const client = await pool().connect();

  try {
    await client.query('begin');
    const projectResult = await client.query(
      'select * from ms_project where project_id = $1 for update',
      [projectId]
    );
    const project = projectResult.rows[0];
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');

    const activeLock = await getActiveLock(client, projectId);
    if (activeLock) {
      throw new ApiError(409, 'PROJECT_LOCKED', 'Project is already checked out', {
        checked_out_by: activeLock.locked_by,
        checked_out_at: activeLock.locked_at,
        expires_at: activeLock.expires_at,
      });
    }

    const lockResult = await client.query(
      `insert into ms_project_lock (project_id, lock_token, locked_by, expires_at)
       values ($1, $2, $3, now() + $4::interval)
       on conflict (project_id)
       do update set
         lock_token = excluded.lock_token,
         locked_by = excluded.locked_by,
         locked_at = now(),
         heartbeat_at = now(),
         expires_at = excluded.expires_at,
         updated_at = now()
       returning *`,
      [projectId, lockToken, actor, NON_EXPIRING_LOCK_INTERVAL]
    );
    await client.query(
      `update ms_project
       set checked_out_by = $2,
           checked_out_at = now(),
           updated_by = $2
       where project_id = $1`,
      [projectId, actor]
    );
    await writeAuditLog(client, {
      projectId,
      action: 'CHECKOUT',
      actor,
      lockToken,
      revisionNo: project.revision_no,
      details: { non_expiring: true },
    });
    await client.query('commit');

    return {
      project_id: projectId,
      lock_token: lockToken,
      locked_by: actor,
      revision_no: project.revision_no,
      expires_at: lockResult.rows[0].expires_at,
      expires_in_minutes: null,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function heartbeatProject(projectIdParam, body = {}) {
  const projectId = assertUuid(projectIdParam, 'project_id');
  const client = await pool().connect();

  try {
    await client.query('begin');
    const lock = await requireValidLock(client, projectId, body.lock_token, 'heartbeat');
    const result = await client.query(
      `update ms_project_lock
       set heartbeat_at = now(),
           expires_at = now() + $3::interval,
           updated_at = now()
       where project_id = $1
         and lock_token = $2
       returning *`,
      [projectId, body.lock_token, NON_EXPIRING_LOCK_INTERVAL]
    );
    await client.query('commit');
    return {
      project_id: projectId,
      lock_token: body.lock_token,
      locked_by: lock.locked_by,
      heartbeat_at: result.rows[0].heartbeat_at,
      expires_at: result.rows[0].expires_at,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function checkinProject(projectIdParam, body = {}) {
  const projectId = assertUuid(projectIdParam, 'project_id');
  const actor = actorFromBody(body);
  const client = await pool().connect();

  try {
    await client.query('begin');
    const projectResult = await client.query(
      'select * from ms_project where project_id = $1 for update',
      [projectId]
    );
    const project = projectResult.rows[0];
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    await requireValidLock(client, projectId, body.lock_token, 'checkin');
    await client.query('delete from ms_project_lock where project_id = $1 and lock_token = $2', [
      projectId,
      body.lock_token,
    ]);
    await client.query(
      `update ms_project
       set checked_out_by = null,
           checked_out_at = null,
           updated_by = coalesce($2::text, updated_by)
       where project_id = $1`,
      [projectId, actor]
    );
    await writeAuditLog(client, {
      projectId,
      action: 'CHECKIN',
      actor,
      lockToken: body.lock_token,
      revisionNo: project.revision_no,
      details: {},
    });
    await client.query('commit');
    return { project_id: projectId, checked_in: true, revision_no: project.revision_no };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function forceCheckinProject(projectIdParam, body = {}) {
  const projectId = assertUuid(projectIdParam, 'project_id');
  const actor = actorFromBody(body, 'admin');
  const reason = nullableText(body.reason) || 'force check-in';
  const client = await pool().connect();

  try {
    await client.query('begin');
    const projectResult = await client.query(
      'select * from ms_project where project_id = $1 for update',
      [projectId]
    );
    const project = projectResult.rows[0];
    if (!project) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    const lockResult = await client.query(
      'delete from ms_project_lock where project_id = $1 returning *',
      [projectId]
    );
    await client.query(
      `update ms_project
       set checked_out_by = null,
           checked_out_at = null,
           updated_by = coalesce($2::text, updated_by)
       where project_id = $1`,
      [projectId, actor]
    );
    await writeAuditLog(client, {
      projectId,
      action: 'FORCE_CHECKIN',
      actor,
      revisionNo: project.revision_no,
      details: { reason, released_lock: lockResult.rows[0] || null },
    });
    await client.query('commit');
    return {
      project_id: projectId,
      checked_in: true,
      forced: true,
      released_lock: Boolean(lockResult.rows[0]),
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function publishCurrentRevision(projectIdParam, payload = {}) {
  const projectId = assertUuid(projectIdParam, 'project_id');
  const body = ensureObject(payload || {}, 'payload');
  const project = ensureObject(body.project || {}, 'project');
  const actor = actorFromBody({ ...body, ...project });
  const lockToken = nullableText(project.lock_token || body.lock_token);
  const lastKnownRevisionNo = toNullableInt(
    project.last_known_revision_no || body.last_known_revision_no
  );
  if (!Number.isInteger(lastKnownRevisionNo)) {
    throw new ApiError(
      400,
      'REVISION_REQUIRED',
      'project.last_known_revision_no is required for publish'
    );
  }

  const client = await pool().connect();
  try {
    await client.query('begin');
    const locked = await client.query('select * from ms_project where project_id = $1 for update', [
      projectId,
    ]);
    const currentProject = locked.rows[0];
    if (!currentProject) throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    await requireValidLock(client, projectId, lockToken, 'publish');
    if (Number(currentProject.revision_no) !== Number(lastKnownRevisionNo)) {
      throw new ApiError(
        409,
        'PROJECT_REVISION_CONFLICT',
        'Project has been updated by another user.',
        {
          current_revision_no: currentProject.revision_no,
        }
      );
    }

    const revisionResult = await client.query(
      `update ms_project
       set revision_no = revision_no + 1,
           updated_by = coalesce($2::text, updated_by),
           updated_at = now()
       where project_id = $1
       returning project_id, revision_no, updated_at`,
      [projectId, actor]
    );
    const revisionNo = revisionResult.rows[0].revision_no;
    const snapshot = await snapshotProject(client, projectId);
    await writeRevisionSnapshot(client, {
      projectId,
      revisionNo,
      revisionType: 'PUBLISH',
      actor,
      snapshot,
    });
    await writePublishSnapshot(client, { projectId, revisionNo, actor, snapshot });
    await writeAuditLog(client, {
      projectId,
      action: 'PUBLISH',
      actor,
      lockToken,
      revisionNo,
      details: { previous_revision_no: currentProject.revision_no },
    });
    await client.query('commit');

    return {
      project_id: projectId,
      revision_no: revisionNo,
      updated_at: revisionResult.rows[0].updated_at,
      published_revision_no: revisionNo,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function publishProject(payload) {
  const normalized = normalizeProjectPayload(payload, false);
  const client = await pool().connect();

  try {
    await client.query('begin');
    await validateCalendarIds(client, [
      normalized.project.calendar_id,
      ...normalized.tasks.map((task) => task.calendar_id),
    ]);

    const projectResult = await client.query(
      `insert into ms_project (
         project_name,
         description,
         status,
         calendar_id,
         calendar_name,
         created_by,
         updated_by
       )
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [
        normalized.project.project_name,
        normalized.project.description,
        normalized.project.status,
        normalized.project.calendar_id,
        normalized.project.calendar_name,
        normalized.project.created_by,
        normalized.project.updated_by,
      ]
    );
    const project = projectResult.rows[0];
    const projectId = project.project_id;

    const projectResourceResult = await upsertProjectResources(
      client,
      projectId,
      normalized.project_resources
    );
    const taskResult = await upsertTasks(client, projectId, normalized.tasks, true);
    const assignmentResult = await upsertAssignments(
      client,
      projectId,
      normalized.assignments,
      taskResult.localTaskMap,
      true
    );
    const dependencyResult = await upsertDependencies(
      client,
      projectId,
      normalized.dependencies,
      taskResult.localTaskMap,
      true
    );
    const actor =
      normalized.project.created_by || normalized.project.updated_by || 'ms-project-vba';
    const snapshot = await snapshotProject(client, projectId);
    await writeRevisionSnapshot(client, {
      projectId,
      revisionNo: project.revision_no,
      revisionType: 'CREATE',
      actor,
      snapshot,
    });
    await writePublishSnapshot(client, {
      projectId,
      revisionNo: project.revision_no,
      actor,
      snapshot,
    });
    await writeAuditLog(client, {
      projectId,
      action: 'CREATE_PROJECT',
      actor,
      revisionNo: project.revision_no,
      details: {
        project_resources: projectResourceResult.resourceIds.length,
        tasks: taskResult.mappings.length,
        assignments: assignmentResult.mappings.length,
        dependencies: dependencyResult.mappings.length,
      },
    });

    await client.query('commit');

    return {
      project_id: project.project_id,
      revision_no: project.revision_no,
      updated_at: project.updated_at,
      summary: {
        project_resources_created: projectResourceResult.created,
        project_resources_updated: projectResourceResult.updated,
        tasks_created: taskResult.created,
        tasks_updated: taskResult.updated,
        assignments_created: assignmentResult.created,
        assignments_updated: assignmentResult.updated,
        dependencies_created: dependencyResult.created,
        dependencies_updated: dependencyResult.updated,
      },
      task_mappings: taskResult.mappings,
      resource_mappings: projectResourceResult.resourceIds.map((resource_id) => ({ resource_id })),
      assignment_mappings: assignmentResult.mappings,
      dependency_mappings: dependencyResult.mappings,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function uploadProjectFile(projectIdParam, file) {
  const projectId = assertUuid(projectIdParam, 'project_id');

  if (!file) {
    throw new ApiError(400, 'PROJECT_FILE_REQUIRED', 'A .mpp file upload is required');
  }

  const originalName = nullableText(file.originalname) || `${projectId}.mpp`;
  if (path.extname(originalName).toLowerCase() !== '.mpp') {
    await fs.unlink(file.path).catch(() => {});
    throw new ApiError(400, 'INVALID_PROJECT_FILE', 'Only .mpp files are allowed');
  }

  const finalFilename = `${projectId}.mpp`;
  const finalPath = path.join(path.dirname(file.path), finalFilename);
  const publicPath = `/uploads/ms-project-mpp/${finalFilename}`;
  const client = await pool().connect();

  try {
    await client.query('begin');
    const projectResult = await client.query(
      `select project_name
       from ms_project
       where project_id = $1
       for update`,
      [projectId]
    );

    if (!projectResult.rows[0]) {
      await client.query('rollback');
      await fs.unlink(file.path).catch(() => {});
      throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    const storedFileName = mppFileName(projectResult.rows[0].project_name, projectId);

    const result = await client.query(
      `update ms_project
       set file_path = $2,
           file_name = $3,
           file_size = $4,
           file_uploaded_at = now(),
           updated_at = now()
       where project_id = $1
       returning project_id, project_name, revision_no, file_path, file_name, file_size, file_uploaded_at`,
      [projectId, publicPath, storedFileName, file.size]
    );

    await writeAuditLog(client, {
      projectId,
      action: 'UPLOAD_PROJECT_FILE',
      revisionNo: result.rows[0].revision_no,
      details: {
        file_path: publicPath,
        original_name: originalName,
        file_name: storedFileName,
        file_size: file.size,
      },
    });

    await fs.rename(file.path, finalPath);
    await client.query('commit');
    return result.rows[0];
  } catch (error) {
    await client.query('rollback').catch(() => {});
    await fs.unlink(file.path).catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function getProjectFileForDownload(projectIdParam) {
  const projectId = assertUuid(projectIdParam, 'project_id');
  const result = await pool().query(
    `select project_id, project_name, revision_no, file_path, file_name, file_uploaded_at
     from ms_project
     where project_id = $1`,
    [projectId]
  );
  const project = result.rows[0];
  if (!project) {
    throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
  }
  if (!project.file_path) {
    throw new ApiError(404, 'PROJECT_FILE_NOT_FOUND', 'Project has no uploaded .mpp file yet');
  }

  const uploadsRoot = path.resolve(__dirname, '../uploads/ms-project-mpp');
  const absolutePath = path.resolve(__dirname, '..', `.${project.file_path}`);
  if (!absolutePath.startsWith(uploadsRoot + path.sep)) {
    throw new ApiError(
      400,
      'INVALID_PROJECT_FILE_PATH',
      'Stored file path is outside the upload directory'
    );
  }
  try {
    await fs.access(absolutePath);
  } catch {
    throw new ApiError(404, 'PROJECT_FILE_MISSING', 'Stored .mpp file is missing on disk');
  }

  await writeAuditLog(pool(), {
    projectId,
    action: 'FILE_DOWNLOAD',
    revisionNo: project.revision_no,
    details: { file_path: project.file_path },
  });

  const downloadName = mppFileName(
    `${stripMppExtension(project.file_name || project.project_name)}-rev${project.revision_no}`,
    projectId
  );
  return { absolutePath, downloadName };
}

async function listProjectRevisions(projectIdParam, query = {}) {
  const projectId = assertUuid(projectIdParam, 'project_id');
  const limit = clampLimit(query.limit, 20);
  const result = await pool().query(
    `select revision_id, project_id, revision_no, revision_type, created_by, created_at
     from ms_project_revision
     where project_id = $1
     order by revision_no desc, created_at desc
     limit $2`,
    [projectId, limit]
  );
  return { rows: result.rows, limit };
}

const PROJECT_STATUSES = new Set(['DRAFT', 'ACTIVE', 'ARCHIVED']);

async function updateProjectStatus(projectIdParam, body = {}) {
  const projectId = assertUuid(projectIdParam, 'project_id');
  const status = normalizeText(body.status).toUpperCase();
  if (!PROJECT_STATUSES.has(status)) {
    throw new ApiError(
      400,
      'INVALID_PROJECT_STATUS',
      'status must be one of DRAFT, ACTIVE, ARCHIVED'
    );
  }
  const actor = nullableText(body.actor) || 'web-hub';
  const client = await pool().connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `update ms_project
       set status = $2, updated_by = $3, updated_at = now()
       where project_id = $1
       returning project_id, project_name, status, revision_no, updated_by, updated_at`,
      [projectId, status, actor]
    );
    if (!result.rows[0]) {
      await client.query('rollback');
      throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    await writeAuditLog(client, {
      projectId,
      action: 'STATUS_CHANGE',
      actor,
      revisionNo: result.rows[0].revision_no,
      details: { status },
    });
    await client.query('commit');
    return result.rows[0];
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function updateProjectInfo(projectIdParam, body = {}) {
  const projectId = assertUuid(projectIdParam, 'project_id');
  const actor = nullableText(body.actor) || 'web-hub';

  const sets = [];
  const values = [projectId];
  if (body.project_name !== undefined) {
    const projectName = normalizeText(body.project_name);
    if (!projectName) {
      throw new ApiError(400, 'PROJECT_NAME_REQUIRED', 'project_name must not be empty');
    }
    values.push(projectName);
    sets.push(`project_name = $${values.length}`);
  }
  if (body.description !== undefined) {
    values.push(nullableText(body.description));
    sets.push(`description = $${values.length}`);
  }
  if (sets.length === 0) {
    throw new ApiError(400, 'NOTHING_TO_UPDATE', 'provide project_name and/or description');
  }
  values.push(actor);
  sets.push(`updated_by = $${values.length}`, 'updated_at = now()');

  const client = await pool().connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `update ms_project
       set ${sets.join(', ')}
       where project_id = $1
       returning project_id, project_name, description, status, revision_no, updated_by, updated_at`,
      values
    );
    if (!result.rows[0]) {
      await client.query('rollback');
      throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    await writeAuditLog(client, {
      projectId,
      action: 'PROJECT_RENAME',
      actor,
      revisionNo: result.rows[0].revision_no,
      details: { project_name: result.rows[0].project_name },
    });
    await client.query('commit');
    return result.rows[0];
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function updateProjectTask(projectIdParam, taskIdParam, body = {}) {
  const projectId = assertUuid(projectIdParam, 'project_id');
  const taskId = assertUuid(taskIdParam, 'task_id');
  const actor = nullableText(body.actor) || 'web-hub';

  if (body.plan_start && body.plan_finish) {
    const start = normalizeDateOnly(body.plan_start, 'plan_start');
    const finish = normalizeDateOnly(body.plan_finish, 'plan_finish');
    if (finish < start) {
      throw new ApiError(400, 'INVALID_DATE_RANGE', 'plan_finish must be on or after plan_start');
    }
  }

  const sets = [];
  const values = [projectId, taskId];
  if (body.task_name !== undefined) {
    const taskName = normalizeText(body.task_name);
    if (!taskName) {
      throw new ApiError(400, 'TASK_NAME_REQUIRED', 'task_name must not be empty');
    }
    values.push(taskName);
    sets.push(`task_name = $${values.length}`);
  }
  if (body.plan_start !== undefined) {
    values.push(body.plan_start ? normalizeDateOnly(body.plan_start, 'plan_start') : null);
    sets.push(`plan_start = $${values.length}::timestamptz`);
  }
  if (body.plan_finish !== undefined) {
    values.push(body.plan_finish ? normalizeDateOnly(body.plan_finish, 'plan_finish') : null);
    sets.push(`plan_finish = $${values.length}::timestamptz`);
  }
  if (sets.length === 0) {
    throw new ApiError(
      400,
      'NOTHING_TO_UPDATE',
      'provide task_name, plan_start and/or plan_finish'
    );
  }
  sets.push('updated_at = now()');

  const client = await pool().connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `update ms_project_task
       set ${sets.join(', ')}
       where project_id = $1 and task_id = $2
       returning task_id, task_name, plan_start, plan_finish, updated_at`,
      values
    );
    if (!result.rows[0]) {
      await client.query('rollback');
      throw new ApiError(404, 'TASK_NOT_FOUND', 'Task not found in this project');
    }
    await writeAuditLog(client, {
      projectId,
      action: 'TASK_UPDATE',
      actor,
      details: {
        task_id: taskId,
        task_name: result.rows[0].task_name,
        plan_start: result.rows[0].plan_start
          ? String(result.rows[0].plan_start).slice(0, 10)
          : null,
        plan_finish: result.rows[0].plan_finish
          ? String(result.rows[0].plan_finish).slice(0, 10)
          : null,
      },
    });
    await client.query('commit');
    return result.rows[0];
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function deleteProject(projectIdParam, body = {}) {
  const projectId = assertUuid(projectIdParam, 'project_id');
  const actor = nullableText(body.actor) || 'web-hub';
  const force = body.force === true || body.force === 'true' || body.force === '1';

  const client = await pool().connect();
  try {
    await client.query('begin');

    const project = await client.query(
      `select project_id, project_name, revision_no, file_path from ms_project where project_id = $1`,
      [projectId]
    );
    if (!project.rows[0]) {
      await client.query('rollback');
      throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }

    const active = await client.query(
      `select count(*)::int as n
         from ms_project_bay_schedule
        where project_id = $1 and status <> 'CANCELLED'`,
      [projectId]
    );
    if (active.rows[0].n > 0 && !force) {
      await client.query('rollback');
      throw new ApiError(
        409,
        'PROJECT_HAS_ACTIVE_RESERVATIONS',
        `${active.rows[0].n} active bay reservation(s) must be cancelled before deleting this project (or use force delete)`
      );
    }

    await client.query(`delete from ms_project_bay_schedule where project_id = $1`, [projectId]);
    await client.query(`delete from ms_project_assignment where project_id = $1`, [projectId]);
    await client.query(
      `delete from ms_project_dependency
        where project_id = $1
           or predecessor_task_id in (select task_id from ms_project_task where project_id = $1)
           or successor_task_id in (select task_id from ms_project_task where project_id = $1)`,
      [projectId]
    );
    await client.query(`delete from ms_project_resource where project_id = $1`, [projectId]);
    await client.query(`delete from ms_project_lock where project_id = $1`, [projectId]);
    await client.query(`delete from ms_project_publish where project_id = $1`, [projectId]);
    await client.query(`delete from ms_project_revision where project_id = $1`, [projectId]);

    await writeAuditLog(client, {
      projectId,
      action: force ? 'PROJECT_DELETE_FORCE' : 'PROJECT_DELETE',
      actor,
      revisionNo: project.rows[0].revision_no,
      details: {
        project_name: project.rows[0].project_name,
        force,
        cancelled_reservations: active.rows[0].n,
      },
    });

    await client.query(`delete from ms_project_task where project_id = $1`, [projectId]);
    await client.query(`delete from ms_project where project_id = $1`, [projectId]);

    await client.query('commit');

    try {
      const filePath = project.rows[0].file_path;
      if (filePath) {
        const uploadsRoot = path.resolve(__dirname, '../uploads/ms-project-mpp');
        const absolutePath = path.resolve(__dirname, '..', `.${filePath}`);
        if (absolutePath.startsWith(uploadsRoot + path.sep)) {
          await fs.unlink(absolutePath);
        }
      }
    } catch {}

    return {
      project_id: projectId,
      project_name: project.rows[0].project_name,
      deleted: true,
      force,
      cancelled_reservations: active.rows[0].n,
    };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function syncProject(projectIdParam, payload) {
  const projectId = assertUuid(projectIdParam, 'project_id');
  const normalized = normalizeProjectPayload(payload, true);
  if (normalized.project.project_id && normalized.project.project_id !== projectId) {
    throw new ApiError(
      400,
      'PROJECT_ID_MISMATCH',
      'Path project_id and payload project_id do not match'
    );
  }
  if (!Number.isInteger(normalized.project.last_known_revision_no)) {
    throw new ApiError(
      400,
      'REVISION_REQUIRED',
      'project.last_known_revision_no is required for sync'
    );
  }

  const client = await pool().connect();

  try {
    await client.query('begin');
    await validateCalendarIds(client, [
      normalized.project.calendar_id,
      ...normalized.tasks.map((task) => task.calendar_id),
    ]);
    const locked = await client.query('select * from ms_project where project_id = $1 for update', [
      projectId,
    ]);
    const project = locked.rows[0];
    if (!project) {
      throw new ApiError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    }
    await requireValidLock(client, projectId, normalized.project.lock_token, 'sync');
    if (Number(project.revision_no) !== Number(normalized.project.last_known_revision_no)) {
      throw new ApiError(
        409,
        'PROJECT_REVISION_CONFLICT',
        'Project has been updated by another user.',
        {
          current_revision_no: project.revision_no,
        }
      );
    }

    await client.query(
      `update ms_project
       set project_name = coalesce($2::text, project_name),
           description = coalesce($3::text, description),
           status = coalesce($4::text, status),
           updated_by = coalesce($5::text, updated_by),
           calendar_id = coalesce($6::uuid, calendar_id),
           calendar_name = coalesce($7::text, calendar_name)
       where project_id = $1`,
      [
        projectId,
        normalized.project.project_name,
        normalized.project.description,
        normalized.project.status,
        normalized.project.updated_by,
        normalized.project.calendar_id,
        normalized.project.calendar_name,
      ]
    );

    const projectResourceResult = await upsertProjectResources(
      client,
      projectId,
      normalized.project_resources
    );
    const taskResult = await upsertTasks(client, projectId, normalized.tasks, false);
    const assignmentResult = await upsertAssignments(
      client,
      projectId,
      normalized.assignments,
      taskResult.localTaskMap,
      false
    );
    const dependencyResult = await upsertDependencies(
      client,
      projectId,
      normalized.dependencies,
      taskResult.localTaskMap,
      false
    );
    const deactivateSummary = await applyExplicitDeactivate(
      client,
      projectId,
      normalized.deactivate
    );

    const revisionResult = await client.query(
      `update ms_project
       set revision_no = revision_no + 1,
           updated_at = now()
       where project_id = $1
       returning project_id, revision_no, updated_at`,
      [projectId]
    );
    const revisionNo = revisionResult.rows[0].revision_no;
    const actor = normalized.project.updated_by || 'ms-project-vba';
    const snapshot = await snapshotProject(client, projectId);
    await writeRevisionSnapshot(client, {
      projectId,
      revisionNo,
      revisionType: 'SYNC',
      actor,
      snapshot,
    });
    await writeAuditLog(client, {
      projectId,
      action: 'SYNC',
      actor,
      lockToken: normalized.project.lock_token,
      revisionNo,
      details: {
        previous_revision_no: project.revision_no,
        summary: {
          project_resources_created: projectResourceResult.created,
          project_resources_updated: projectResourceResult.updated,
          tasks_created: taskResult.created,
          tasks_updated: taskResult.updated,
          assignments_created: assignmentResult.created,
          assignments_updated: assignmentResult.updated,
          dependencies_created: dependencyResult.created,
          dependencies_updated: dependencyResult.updated,
          ...deactivateSummary,
        },
      },
    });

    await client.query('commit');

    return {
      project_id: revisionResult.rows[0].project_id,
      revision_no: revisionResult.rows[0].revision_no,
      updated_at: revisionResult.rows[0].updated_at,
      summary: {
        project_resources_created: projectResourceResult.created,
        project_resources_updated: projectResourceResult.updated,
        tasks_created: taskResult.created,
        tasks_updated: taskResult.updated,
        assignments_created: assignmentResult.created,
        assignments_updated: assignmentResult.updated,
        dependencies_created: dependencyResult.created,
        dependencies_updated: dependencyResult.updated,
        ...deactivateSummary,
      },
      task_mappings: taskResult.mappings,
      resource_mappings: projectResourceResult.resourceIds.map((resource_id) => ({ resource_id })),
      assignment_mappings: assignmentResult.mappings,
      dependency_mappings: dependencyResult.mappings,
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function toTime(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function buildConflictFilters(query) {
  const values = [];
  const where = [
    'a.is_active = true',
    't.is_active = true',
    'r.is_active = true',
    'coalesce(a.assignment_start, t.plan_start) is not null',
    'coalesce(a.assignment_finish, t.plan_finish) is not null',
  ];

  if (query.project_id) {
    values.push(assertUuid(query.project_id, 'project_id'));
    where.push(`a.project_id = $${values.length}`);
  }
  if (query.resource_id) {
    values.push(assertUuid(query.resource_id, 'resource_id'));
    where.push(`a.resource_id = $${values.length}`);
  }
  if (query.category) {
    values.push(normalizeCategory(query.category));
    where.push(`r.resource_category = $${values.length}`);
  }
  if (query.start) {
    values.push(query.start);
    where.push(`coalesce(a.assignment_finish, t.plan_finish) > $${values.length}::timestamptz`);
  }
  if (query.finish) {
    values.push(query.finish);
    where.push(`coalesce(a.assignment_start, t.plan_start) < $${values.length}::timestamptz`);
  }

  return { values, where };
}

function calculateGenericConflict(resource, assignments) {
  const boundaries = [];
  for (const assignment of assignments) {
    const start = toTime(assignment.start_at);
    const finish = toTime(assignment.finish_at);
    if (start === null || finish === null || finish <= start) continue;
    boundaries.push(start, finish);
  }
  const ordered = Array.from(new Set(boundaries)).sort((a, b) => a - b);
  let best = null;

  for (let i = 0; i < ordered.length - 1; i += 1) {
    const start = ordered[i];
    const finish = ordered[i + 1];
    if (finish <= start) continue;
    const active = assignments.filter((assignment) => {
      const assignmentStart = toTime(assignment.start_at);
      const assignmentFinish = toTime(assignment.finish_at);
      return (
        assignmentStart !== null &&
        assignmentFinish !== null &&
        assignmentStart < finish &&
        assignmentFinish > start
      );
    });
    const peakUnits = active.reduce(
      (sum, assignment) => sum + Number(assignment.assignment_units || 0),
      0
    );
    if (peakUnits > Number(resource.max_units || 0) && (!best || peakUnits > best.peak_units)) {
      best = {
        resource_id: resource.resource_id,
        resource_code: resource.resource_code,
        resource_name: resource.resource_name,
        resource_category: resource.resource_category,
        max_units: Number(resource.max_units),
        peak_units: peakUnits,
        overlap_start: new Date(start).toISOString(),
        overlap_finish: new Date(finish).toISOString(),
        assignments: active.map((assignment) => ({
          assignment_id: assignment.assignment_id,
          project_id: assignment.project_id,
          task_id: assignment.task_id,
          task_name: assignment.task_name,
          assignment_units: Number(assignment.assignment_units),
          start_at: assignment.start_at,
          finish_at: assignment.finish_at,
        })),
      };
    }
  }

  return best;
}

async function getConflicts(query) {
  const { values, where } = buildConflictFilters(query);
  const result = await pool().query(
    `select
       a.assignment_id,
       a.project_id,
       a.task_id,
       t.task_name,
       a.resource_id,
       r.resource_code,
       r.resource_name,
       r.resource_category,
       r.max_units,
       coalesce(a.assignment_start, t.plan_start) as start_at,
       coalesce(a.assignment_finish, t.plan_finish) as finish_at,
       coalesce(a.assignment_units, 1.0) as assignment_units
     from ms_project_assignment a
     join ms_project_task t
       on t.project_id = a.project_id
      and t.task_id = a.task_id
     join ms_resource r on r.resource_id = a.resource_id
     where ${where.join(' and ')}
     order by r.resource_code, start_at`,
    values
  );

  const grouped = new Map();
  for (const row of result.rows) {
    if (!grouped.has(row.resource_id)) {
      grouped.set(row.resource_id, {
        resource_id: row.resource_id,
        resource_code: row.resource_code,
        resource_name: row.resource_name,
        resource_category: row.resource_category,
        max_units: Number(row.max_units),
        assignments: [],
      });
    }
    grouped.get(row.resource_id).assignments.push(row);
  }

  const warnings = [];

  for (const resource of grouped.values()) {
    if (['PERSON', 'MACHINE'].includes(resource.resource_category)) {
      const assignments = resource.assignments;
      for (let i = 0; i < assignments.length; i += 1) {
        for (let j = i + 1; j < assignments.length; j += 1) {
          const a = assignments[i];
          const b = assignments[j];
          const start = Math.max(toTime(a.start_at), toTime(b.start_at));
          const finish = Math.min(toTime(a.finish_at), toTime(b.finish_at));
          if (finish <= start) continue;
          const peakUnits = Number(a.assignment_units || 0) + Number(b.assignment_units || 0);
          if (peakUnits > resource.max_units) {
            warnings.push({
              resource_id: resource.resource_id,
              resource_code: resource.resource_code,
              resource_name: resource.resource_name,
              resource_category: resource.resource_category,
              max_units: resource.max_units,
              peak_units: peakUnits,
              overlap_start: new Date(start).toISOString(),
              overlap_finish: new Date(finish).toISOString(),
              assignments: [a, b].map((assignment) => ({
                assignment_id: assignment.assignment_id,
                project_id: assignment.project_id,
                task_id: assignment.task_id,
                task_name: assignment.task_name,
                assignment_units: Number(assignment.assignment_units),
                start_at: assignment.start_at,
                finish_at: assignment.finish_at,
              })),
            });
          }
        }
      }
    } else if (['WORKCENTER', 'TEAM'].includes(resource.resource_category)) {
      const warning = calculateGenericConflict(resource, resource.assignments);
      if (warning) warnings.push(warning);
    }
  }

  return warnings;
}

module.exports = {
  ApiError,
  addProjectResources,
  bulkLoadProjectPackages,
  cancelBaySchedule,
  cancelBayScheduleGroup,
  checkinProject,
  checkoutProject,
  createBaySchedule,
  deactivateProjectResource,
  findBayOverlaps,
  forceCheckinProject,
  getConflicts,
  getCalendar,
  getProjectFileForDownload,
  getProjectPackage,
  getProjectResources,
  heartbeatProject,
  health,
  getSowOrderOperations,
  listOrderTasks,
  listBayOccupants,
  listBayScheduleTasks,
  listBaySchedules,
  syncBayScheduleDates,
  listCalendars,
  listProjectRevisions,
  listProjectTasks,
  listProjects,
  listSowOrders,
  mapSowOperationToTask,
  publishCurrentRevision,
  publishProject,
  refreshCalendarsFromShifts,
  refreshResources,
  searchResources,
  syncProject,
  updateBayScheduleGroup,
  updateOperationPeople,
  updateProjectInfo,
  updateProjectStatus,
  updateProjectTask,
  deleteProject,
  uploadProjectFile,
};
