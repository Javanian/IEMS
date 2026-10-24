import { createHash, randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { renderV2 } from './layout-v2.mjs';
import { vatContent } from './vat.mjs';
import { renderV3 } from './layout-v3.mjs';
const vatTemplate = Object.freeze({ id:'iems-commercial', version:3, engine:'pdfkit-0.17.2', layout:'a4-flow-v3' });

const templates = Object.freeze(Object.fromEntries([1,2].map(version => [version, Object.freeze({ id: 'iems-commercial', version, engine: 'pdfkit-0.17.2', layout: `a4-flow-v${version}` })])));
export const TEMPLATE = templates[2];
const scales = { USD: 2, EUR: 2, GBP: 2, IDR: 2, JPY: 0, KWD: 3 };
const scopeKeys = ['tenantId', 'legalEntityId', 'plantId'];
const fail = code => { throw new Error(code); };
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const contentHash = value => createHash('sha256').update(canonical(value)).digest('hex');
function text(value, max = 200) { if (typeof value !== 'string' || !value.trim() || value.length > max || /[^\x20-\x7e]/.test(value)) fail('INVALID_TEXT_ASCII_REQUIRED'); return value; }
function checkedScope(value) { return Object.fromEntries(scopeKeys.map(k => [k, text(value?.[k], 100)])); }
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
function quantity(value) { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/.test(value) || !/[1-9]/.test(value)) fail('INVALID_QUANTITY'); return value; }
function money(value, currency) { const scale = scales[currency]; if (!Object.hasOwn(scales, currency) || typeof value !== 'string' || !new RegExp(`^(0|[1-9][0-9]{0,33})${scale ? `\\.[0-9]{${scale}}` : ''}$`).test(value)) fail('INVALID_MONEY'); return value; }
const minor = value => BigInt(value.replace('.', ''));
const format = (value, scale) => { const raw = value.toString().padStart(scale + 1, '0'); return scale ? raw.slice(0,-scale)+'.'+raw.slice(-scale) : raw; };

export function createSnapshot(kind, scope, source, { templateVersion } = {}) {
  const vatBody = kind === 'quote' || kind === 'purchaseOrder' ? source.snapshot : source;
  if (vatBody?.schemaVersion !== undefined && vatBody.schemaVersion !== (vatBody.taxPolicy === 'FIXTURE_VAT_11_V1' ? 2 : 1)) fail('INVALID_POLICY_SCHEMA');
  if (vatBody?.taxPolicy === 'FIXTURE_VAT_11_V1') {
    if (templateVersion !== undefined && templateVersion !== 3) fail('INVALID_TEMPLATE');
    const selected = checkedScope(scope);
    if (scopeKeys.some(k => selected[k] !== source[k])) fail('SCOPE_MISMATCH');
    if (!Number.isSafeInteger(source.version) || source.version < 1) fail('INVALID_VERSION');
    const content = vatContent(kind, vatBody, netBody => {
      const net = createSnapshot(kind, scope, { ...source, ...(kind === 'quote' ? { snapshot:netBody } : netBody) }, { templateVersion:2 });
      const { schemaVersion, kind:ignoredKind, scope:ignoredScope, sourceId, sourceVersion, template, contentHash:ignoredHash, ...result } = net;
      return result;
    });
    const snapshot = { schemaVersion:2, kind, scope:selected, sourceId:text(source._id,100), sourceVersion:source.version, template:{...vatTemplate}, ...content };
    return freeze({ ...snapshot, contentHash:contentHash(snapshot) });
  }
  if (vatBody?.taxPolicy !== undefined && vatBody.taxPolicy !== 'NO_TAX') fail('INVALID_POLICY');
  templateVersion ??= 2;
  if (!Object.hasOwn(templates, templateVersion)) fail('INVALID_TEMPLATE');
  if (!['quote', 'purchaseOrder', 'invoice', 'shipment'].includes(kind)) fail('INVALID_KIND');
  const selected = checkedScope(scope);
  if (scopeKeys.some(k => selected[k] !== source[k])) fail('SCOPE_MISMATCH');
  const sourceId = text(source._id, 100), sourceVersion = source.version;
  if (!Number.isSafeInteger(sourceVersion) || sourceVersion < 1) fail('INVALID_VERSION');
  const body = kind === 'quote' || kind === 'purchaseOrder' ? source.snapshot : source;
  let content;
  if (kind === 'shipment') {
    content = { salesOrderId: text(body.salesOrderId,100), reference: text(body.reference), lines: [{ description: `Sales order line ${body.lineIndex}`, quantity: quantity(body.quantity), uom: text(body.uom,16) }] };
    if (!/^[A-Z][A-Z0-9_]{0,15}$/.test(body.uom)) fail('INVALID_UOM');
    if (!Number.isSafeInteger(body.lineIndex) || body.lineIndex < 0) fail('INVALID_LINE');
  } else {
    const cumulative = kind === 'invoice' && body?.roundingPolicy === 'CUMULATIVE_HALF_UP';
    if (body?.taxPolicy !== 'NO_TAX' || (!cumulative && body?.roundingPolicy !== 'LINE_HALF_UP')) fail('INVALID_POLICY');
    if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 100) fail('INVALID_LINES');
    const currency = body.currency; let total = 0n;
    const boundaries = new Map();
    const lines = body.lines.map(line => {
      if (line.currency !== currency) fail('CURRENCY_MISMATCH');
      const q = quantity(line.quantity), price = money(line.unitPrice, currency);
      const extend = value => { const denominator = 10n ** BigInt(value.split('.')[1]?.length || 0); return (minor(value)*minor(price)*2n+denominator)/(2n*denominator); };
      let amount = format(extend(q), scales[currency]), rounding;
      if (cumulative) {
        const r = line.rounding;
        if (!r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).sort().join(',') !== 'afterAmount,afterQuantity,beforeAmount,beforeQuantity,lineIndex,sourceId') fail('INVALID_PROVENANCE');
        const before = typeof r.beforeQuantity === 'string' && /^0(?:\.0{1,6})?$/.test(r.beforeQuantity) ? r.beforeQuantity : quantity(r.beforeQuantity), after = quantity(r.afterQuantity);
        const units = value => minor(value) * 10n ** BigInt(6-(value.split('.')[1]?.length || 0));
        if (units(after)-units(before) !== units(q)) fail('INVALID_PROVENANCE');
        if (!Number.isSafeInteger(r.lineIndex) || r.lineIndex < 0) fail('INVALID_PROVENANCE');
        const beforeAmount = money(r.beforeAmount,currency), afterAmount = money(r.afterAmount,currency);
        if (minor(beforeAmount) !== extend(before) || minor(afterAmount) !== extend(after)) fail('INVALID_PROVENANCE');
        amount = money(line.amount,currency);
        if (minor(amount) !== minor(afterAmount)-minor(beforeAmount)) fail('LINE_AMOUNT_MISMATCH');
        rounding = { sourceId:text(r.sourceId,100), lineIndex:r.lineIndex, beforeQuantity:before, afterQuantity:after, beforeAmount, afterAmount };
        const key = canonical([rounding.sourceId,r.lineIndex]), prior = boundaries.get(key);
        if (prior && (prior.quantity !== units(before) || prior.amount !== beforeAmount || prior.price !== price || prior.uom !== line.uom)) fail('INVALID_PROVENANCE');
        boundaries.set(key,{ quantity:units(after), amount:afterAmount, price, uom:line.uom });
      } else if (line.rounding !== undefined) fail('INVALID_PROVENANCE');
      if (line.amount !== undefined && line.amount !== amount) fail('LINE_AMOUNT_MISMATCH');
      total += minor(amount);
      if (!/^[A-Z][A-Z0-9_]{0,15}$/.test(line.uom)) fail('INVALID_UOM');
      return { description: text(line.description), quantity: q, uom: line.uom, unitPrice: price, currency, amount, ...(rounding ? { rounding } : {}) };
    });
    if (money(body.total,currency) !== format(total,scales[currency])) fail('TOTAL_MISMATCH');
    content = { currency, total: body.total, taxPolicy: body.taxPolicy, roundingPolicy: body.roundingPolicy, lines };
  }
  const snapshot = { schemaVersion: 1, kind, scope: selected, sourceId, sourceVersion, template: { ...templates[templateVersion] }, ...content };
  return freeze({ ...snapshot, contentHash: contentHash(snapshot) });
}
function verify(snapshot) {
  const { contentHash: hash, ...body } = snapshot;
  if (hash !== contentHash(body) || canonical(snapshot.template) !== canonical(snapshot.schemaVersion === 2 ? vatTemplate : templates[snapshot.template?.version])) fail('SNAPSHOT_INTEGRITY');
  const recreated = createSnapshot(snapshot.kind, snapshot.scope, { _id: snapshot.sourceId, ...snapshot.scope, version: snapshot.sourceVersion, ...(snapshot.kind === 'quote' || snapshot.kind === 'purchaseOrder' ? { snapshot } : snapshot.kind === 'shipment' ? { ...snapshot, lineIndex: Number(snapshot.lines[0].description.replace('Sales order line ','')), ...snapshot.lines[0] } : snapshot) }, { templateVersion: snapshot.template.version });
  if (canonical(recreated) !== canonical(snapshot)) fail('SNAPSHOT_INTEGRITY');
}
export async function renderPdf(snapshot) {
  verify(snapshot);
  if (snapshot.template.version === 3) return renderV3(snapshot);
  if (snapshot.template.version === 2) return renderV2(snapshot);
  const doc = new PDFDocument({ size: 'A4', margin: 48, compress: true, info: { Title: `${snapshot.kind} ${snapshot.sourceId}`, Author: 'IEMS', CreationDate: new Date('2000-01-01T00:00:00Z'), ModDate: new Date('2000-01-01T00:00:00Z') } });
  const chunks = [];
  const completed = new Promise((resolve,reject) => { doc.on('data',chunk=>chunks.push(chunk)); doc.on('end',()=>resolve(Buffer.concat(chunks))); doc.on('error',reject); });
  doc.font('Helvetica').fontSize(22).fillColor('#153449').text(snapshot.kind === 'purchaseOrder' ? 'PURCHASE ORDER' : snapshot.kind.toUpperCase());
  doc.moveDown().fontSize(10).fillColor('#111111');
  for (const row of [`Reference: ${snapshot.sourceId} / revision ${snapshot.sourceVersion}`, ...scopeKeys.map(k=>`${k}: ${snapshot.scope[k]}`), `Template: ${snapshot.template.id} v${snapshot.template.version}`]) doc.text(row);
  if (snapshot.reference) doc.text(`Dispatch reference: ${snapshot.reference}`);
  doc.moveDown();
  snapshot.lines.forEach((line,i) => {
    doc.font('Helvetica-Bold').fontSize(10);
    const height = doc.heightOfString(`${i+1}. ${line.description}`, { width: 499 }) + (line.currency ? 42 : 28);
    if (doc.y + height > doc.page.height - 48) doc.addPage();
    doc.font('Helvetica-Bold').text(`${i+1}. ${line.description}`);
    doc.font('Helvetica').text(`Quantity: ${line.quantity} ${line.uom}`);
    if (line.currency) doc.text(`Unit price: ${line.unitPrice} ${line.currency} | Amount: ${line.amount} ${line.currency}`);
    doc.moveDown(0.7);
  });
  if (snapshot.total !== undefined) doc.font('Helvetica-Bold').fontSize(14).text(`TOTAL: ${snapshot.total} ${snapshot.currency}`).font('Helvetica').fontSize(9).text(snapshot.roundingPolicy === 'CUMULATIVE_HALF_UP' ? 'No tax. Cumulative half-up differences; exact source amounts.' : 'No tax. Line amounts rounded half up.');
  doc.moveDown().fontSize(8).fillColor('#444444').text(`Content SHA-256: ${snapshot.contentHash}`, { width: 490 });
  doc.end(); return completed;
}

export async function createIssuer({ client, db }) {
  const records = db.collection('documentIssues'), artifacts = db.collection('documentArtifacts');
  const keys = Object.fromEntries([...scopeKeys,'kind','sourceId','sourceVersion'].map(k=>[k,1]));
  await records.createIndex(keys, { unique: true });
  function filter(scope, snapshot) { return { ...checkedScope(scope), kind: snapshot.kind, sourceId: snapshot.sourceId, sourceVersion: snapshot.sourceVersion }; }
  async function validated(record, scope, session) {
    verify(record.snapshot);
    if (record.contentHash !== record.snapshot.contentHash || canonical(record.template) !== canonical(record.snapshot.template) || canonical(filter(scope, record.snapshot)) !== canonical(Object.fromEntries(Object.keys(keys).map(k=>[k,record[k]])))) fail('SNAPSHOT_INTEGRITY');
    const artifact = await artifacts.findOne({ _id: record._id, ...checkedScope(scope) }, { session });
    if (!artifact) fail('ARTIFACT_MISSING');
    const pdf = Buffer.from(artifact.pdf.buffer);
    if (createHash('sha256').update(pdf).digest('hex') !== record.pdfHash) fail('ARTIFACT_INTEGRITY');
    return { record, pdf };
  }
  return {
    async issue(scope, snapshot) {
      verify(snapshot);
      if (scopeKeys.some(k=>scope[k] !== snapshot.scope[k])) fail('SCOPE_MISMATCH');
      const key = filter(scope,snapshot), pdf = await renderPdf(snapshot), pdfHash = createHash('sha256').update(pdf).digest('hex');
      for (let attempt=0; attempt<8; attempt++) {
        const session = client.startSession();
        try {
          return await session.withTransaction(async () => {
            const existing = await records.findOne(key,{session});
            if (existing) { await validated(existing, scope, session); if (existing.contentHash !== snapshot.contentHash) fail('ISSUE_CONFLICT'); return existing; }
            const record = { _id: randomUUID(), ...key, contentHash: snapshot.contentHash, pdfHash, template: snapshot.template, issuedAt: new Date(), snapshot };
            await artifacts.insertOne({ _id: record._id, ...checkedScope(scope), pdf },{session});
            await records.insertOne(record,{session});
            return record;
          },{ readConcern:{level:'snapshot'}, writeConcern:{w:'majority'}, readPreference:'primary' });
        } catch(error) { if (error.code !== 11000 || attempt === 7) throw error; }
        finally { await session.endSession(); }
      }
    },
    async read(scope, issueId) {
      const key = { _id: text(issueId,100), ...checkedScope(scope) };
      const record = await records.findOne(key); if (!record) return null;
      return validated(record, scope);
    }
  };
}
