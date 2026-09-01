const ANNOUNCE_SEVERITIES = new Set(['Critical']);

const USE_FULL_ISSUE_TEXT = false;

const KPI_LABEL_ID = {
  uptime_tablet: 'Uptime Tablet',
  uptime_hmi: 'Uptime HMI',
  accuracy_labour: 'Akurasi Labour',
  accuracy_machine: 'Akurasi Mesin',
  adoption_labour: 'Adopsi Labour',
  adoption_machine: 'Adopsi Mesin',
  oee: 'O E E',
  ole: 'O L E',
};

function buildIssueSpeech(issue) {
  const kpiName = KPI_LABEL_ID[issue.kpi_type] || issue.kpi_type || 'Indikator';
  const severityWord =
    String(issue.severity || '').toLowerCase() === 'critical' ? 'kritis' : 'perlu diperhatikan';
  const title = `${issue.severity || 'Issue'} — ${kpiName}`;

  if (USE_FULL_ISSUE_TEXT && issue.issue_description) {
    return { title, message: String(issue.issue_description) };
  }
  return { title, message: makeTemplateSpeech(issue, kpiName, severityWord) };
}

function makeTemplateSpeech(issue, kpiName, severityWord) {
  const parts = [];
  parts.push('Perhatian.');
  parts.push(`Indikator ${kpiName} berstatus ${severityWord}.`);
  if (issue.issue_description) parts.push(`${issue.issue_description}.`);
  if (issue.pic) parts.push(`Mohon ditindaklanjuti oleh ${issue.pic}.`);

  return parts.join(' ').replace(/\.\.+/g, '.').replace(/\s+/g, ' ').trim();
}

async function enqueueIssueTts(client, issueRow) {
  if (!issueRow) return false;
  if (!ANNOUNCE_SEVERITIES.has(String(issueRow.severity || ''))) return false;
  if (!issueRow.issue_key) return false;

  const { title, message } = buildIssueSpeech(issueRow);
  if (!message) return false;

  await client.query(
    `
    INSERT INTO ews.tts_notification (issue_key, kpi_type, severity, title, message, generation_status)
    VALUES ($1, $2, $3, $4, $5, 'queued')
    ON CONFLICT (issue_key) DO NOTHING
    `,
    [issueRow.issue_key, issueRow.kpi_type, issueRow.severity, title, message]
  );
  return true;
}

module.exports = {
  buildIssueSpeech,
  enqueueIssueTts,
  ANNOUNCE_SEVERITIES,
  USE_FULL_ISSUE_TEXT,
};
