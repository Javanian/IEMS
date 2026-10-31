export function opportunityView(row, now) {
  const transitions = row.history || [];
  const instant = new Date(now).getTime();
  const intervals = transitions.map((entry, index) => {
    const start = new Date(entry.at).getTime();
    const end = index + 1 < transitions.length ? new Date(transitions[index + 1].at).getTime() : ['WON', 'LOST'].includes(entry.stage) ? start : instant;
    return { stage: entry.stage, enteredAt: entry.at, exitedAt: transitions[index + 1]?.at || null, durationMs: Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null };
  });
  return { ...row, aging: { observedAt: new Date(now).toISOString(), currentStageEnteredAt: transitions.at(-1)?.at || null, currentStageDurationMs: intervals.at(-1)?.durationMs ?? null, intervals } };
}
