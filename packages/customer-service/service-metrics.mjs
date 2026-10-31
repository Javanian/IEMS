export function summarizeServiceMetrics({ open, inWindow, updates, replies, resolved, from, to, at, cap, slaMinutes }) {
  const truncated = [open, inWindow, updates, replies, resolved].some(rows => rows.length > cap);
  const observedUntil = new Date(Math.min(to.getTime(), at.getTime()));
  const observed = (date, ticket) => date instanceof Date && Number.isFinite(date.getTime()) && date >= ticket.createdAt && date < at;
  const tickets = new Map([...open.slice(0, cap), ...inWindow.slice(0, cap)].map(t => [t._id, t]));
  const responses = new Map(), resolutions = new Map();
  const record = (map, ticketId, date) => {
    const ticket = tickets.get(ticketId);
    if (ticket && observed(date, ticket) && (!map.has(ticketId) || date < map.get(ticketId))) map.set(ticketId, date);
  };
  for (const event of updates.slice(0, cap)) record(responses, event.ticketId, event.at);
  for (const reply of replies.slice(0, cap)) {
    if (['PREVIEWED', 'SENT', 'DELIVERED', 'READ'].includes(reply.state)) record(responses, reply.ticketId, reply.sentAt ?? reply.previewedAt);
  }
  for (const event of resolved.slice(0, cap)) record(resolutions, event.ticketId, event.at);
  const firstHuman = ticket => responses.get(ticket._id) ?? null;
  const firstResolved = ticket => resolutions.get(ticket._id) ?? null;
  const summary = minutes => {
    if (!minutes.length || truncated) return null;
    const sorted = [...minutes].sort((a, b) => a - b);
    const rank = p => Math.round(sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] * 10) / 10;
    return { n: sorted.length, p50Minutes: rank(0.5), p90Minutes: rank(0.9) };
  };
  const windowed = inWindow.slice(0, cap), openRows = open.slice(0, cap);
  const duration = fn => windowed.map(t => [t, fn(t)]).filter(([, date]) => date && date < observedUntil).map(([t, date]) => (date - t.createdAt) / 60000);
  const provenance = { syntheticRuntime: 0, seeded: 0, unknown: 0 };
  for (const ticket of windowed) {
    if (ticket.dataOrigin === 'SEEDED' || ticket.seeded === true) provenance.seeded++;
    else if (ticket.dataOrigin === 'SYNTHETIC_RUNTIME') provenance.syntheticRuntime++;
    else provenance.unknown++;
  }
  return {
    window: { from, to }, open: openRows.length, unassigned: openRows.filter(t => t.assigneeId == null).length,
    overdue: { count: openRows.filter(t => at - t.createdAt > slaMinutes * 60000 && !firstHuman(t)).length, slaMinutes },
    firstHumanResponse: summary(duration(firstHuman)), resolution: summary(duration(firstResolved)), asOf: at,
    truncated, coverage: truncated ? 'INCOMPLETE' : 'COMPLETE', provenance,
    definitions: {
      open: 'Current tickets in this plant not RESOLVED or CLOSED. Counts are bounded samples when coverage is incomplete.',
      unassigned: 'Open tickets with no assignee.',
      overdue: 'Open tickets older than SLA with no observed human response.',
      firstHumanResponse: 'Tickets created in the window: first public operator update, or confirmed preview/sent reply explicitly linked to that ticket. Uses preview/sent time; queued, failed, cancelled, bot, system, unlinked and future replies are excluded. Preview is not external delivery. Nearest-rank percentiles; suppressed on incomplete coverage.',
      resolution: 'Minutes from ticket creation to the first observed RESOLVED transition, before window end/asOf. Nearest-rank percentiles; suppressed on incomplete coverage.',
      provenance: 'Window ticket origin uses explicit persisted markers. Unmarked historical tickets remain unknown; synthetic runtime and seeded records are separate.',
    },
  };
}
