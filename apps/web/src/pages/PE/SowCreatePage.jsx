import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Rnd } from 'react-rnd';
import {
  Search,
  Loader2,
  X,
  Plus,
  AlertCircle,
  Package,
  ClipboardList,
  BookmarkPlus,
  Check,
  ChevronRight,
  GripVertical,
  Trash2,
  ChevronDown,
  PenLine,
  ArrowRight,
  ArrowLeft,
  Printer,
  Info,
  Paperclip,
  Eye,
  Image as ImageIcon,
  FileText,
  Save,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { QRCodeCanvas } from 'qrcode.react';
import * as pdfjsLib from 'pdfjs-dist';
import ssbLogo from '../../assets/ssb.png';
import travelCardHtml from '../../templates/travel-card.html?raw';
import operationCardHtml from '../../templates/operation-card.html?raw';
import { useSowDraft } from '../../features/sow/useSowDraft';
import {
  listSavedSows,
  getSavedSow,
  createSavedSow,
  updateSavedSow,
  deleteSavedSow,
} from '../../features/sow/savedSows';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const ENABLE_EXISTING_SOW_HISTORY_LINK =
  import.meta.env.VITE_ENABLE_EXISTING_SOW_HISTORY_LINK === 'false';
export const normalizeProductionOrder = (value) =>
  String(value ?? '')
    .trim()
    .replace(/-/g, '000');
const getSowOrderNo = (row) =>
  row?.sow_order_no ||
  (row?.production_order ? normalizeProductionOrder(row.production_order) : '');
const toOrderNumber = (value) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const isGeneralServiceOperation = (op) => {
  const text = String(op?.operation_text || '')
    .trim()
    .toLowerCase();
  const standardNo = toOrderNumber(op?._standardOperationNo ?? op?.operation_no);
  return text.startsWith('general service') || (standardNo != null && standardNo >= 5000);
};
const renumberNormalSequential = (items) => {
  let normalIndex = 0;
  const used = new Set();
  return items.map((op) => {
    if (isGeneralServiceOperation(op)) {
      const standardNo = toOrderNumber(op._standardOperationNo);
      const currentNo = toOrderNumber(op.operation_no);
      let operationNo = standardNo != null ? standardNo : currentNo != null ? currentNo : 5001;
      while (used.has(operationNo)) operationNo += 1;
      used.add(operationNo);
      return {
        ...op,
        operation_no: operationNo,
      };
    }
    normalIndex += 1;
    let operationNo = normalIndex * 10;
    while (used.has(operationNo)) {
      normalIndex += 1;
      operationNo = normalIndex * 10;
    }
    used.add(operationNo);
    return { ...op, operation_no: operationNo };
  });
};
const getNextOperationNo = (items, op) => {
  const general = isGeneralServiceOperation(op);
  const numbers = items
    .map((item) => toOrderNumber(item.operation_no))
    .filter((number) => number != null && (general ? number >= 5000 : number < 5000));
  const fallback = general ? 5000 : 0;
  return Math.max(fallback, ...numbers) + (general ? 1 : 10);
};
const renumberByStandardOrder = (items) =>
  renumberNormalSequential(
    [...items].sort((a, b) => {
      const aStd = toOrderNumber(a._standardOperationNo);
      const bStd = toOrderNumber(b._standardOperationNo);
      if (aStd != null && bStd != null && aStd !== bStd) return aStd - bStd;
      if (aStd != null && bStd == null) return -1;
      if (aStd == null && bStd != null) return 1;
      return (a._insertSeq || 0) - (b._insertSeq || 0);
    })
  );

const fmtHours = (v) => (v != null && v !== '' ? parseFloat(v).toFixed(2) : '—');
const fmtTravelCardHours = (value) => {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(number);
};
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const escAttr = (s) => esc(s).replace(/'/g, '&#39;');
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function readAuthUser() {
  try {
    return JSON.parse(sessionStorage.getItem('authUser') || 'null');
  } catch {
    return null;
  }
}

export function getAuthUserDisplayName(user = readAuthUser()) {
  return user?.name || user?.full_name || user?.username || '';
}

export function formatTravelCardIssuedAt(date = new Date()) {
  return (
    [
      String(date.getDate()).padStart(2, '0'),
      MONTH_SHORT[date.getMonth()],
      String(date.getFullYear()).slice(-2),
    ].join(' ') +
    ' ' +
    [
      String(date.getHours()).padStart(2, '0'),
      String(date.getMinutes()).padStart(2, '0'),
      String(date.getSeconds()).padStart(2, '0'),
    ].join(':')
  );
}

export function formatRevisionDate(value) {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return String(value);
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

const NOTE_MAX_LENGTH = 180;

const OP_MAIN_BOX_W = 700;
const OP_MAIN_BOX_H = 560;
const AUTO_ATTACH_MARGIN = 40;

function resolveAssetUrl(src) {
  if (!src) return '';
  if (String(src).startsWith('/uploads/')) {
    const base = API_BASE.replace(/\/$/, '');
    if (base === '/api') return src;
    if (base.endsWith('/api')) {
      try {
        return `${new URL(base, window.location.origin).origin}${src}`;
      } catch {
        return src;
      }
    }
    return `${base}${src}`;
  }
  return src;
}

function loadCanvasImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = resolveAssetUrl(src);
  });
}

export async function generateOperationCardBoxImage(images = []) {
  if (!images.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = OP_MAIN_BOX_W;
  canvas.height = OP_MAIN_BOX_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, OP_MAIN_BOX_W, OP_MAIN_BOX_H);

  for (const item of images) {
    try {
      const img = await loadCanvasImage(item.src);
      ctx.drawImage(
        img,
        Number(item.x) || 0,
        Number(item.y) || 0,
        Number(item.width) || 0,
        Number(item.height) || 0
      );
    } catch {
      continue;
    }
  }

  return canvas.toDataURL('image/png');
}

async function renderPdfToDataUrl(url) {
  const pdf = await pdfjsLib.getDocument(url).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
}

function PdfPreview({ url, style }) {
  const canvasRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    pdfjsLib
      .getDocument(url)
      .promise.then(async (pdf) => {
        if (cancelled) return;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (error) {
    return (
      <div
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fef2f2',
          color: '#dc2626',
          fontSize: 12,
        }}
      >
        PDF render error
      </div>
    );
  }

  return <canvas ref={canvasRef} style={{ ...style, display: 'block' }} />;
}
const TRAVEL_CARD_FALLBACK_MAX_HEIGHT_MM = 165;
const TRAVEL_CARD_PAGE_SAFE_GAP_MM = 2;
const CSS_PX_PER_MM = 96 / 25.4;
const TRAVEL_CARD_RENDER_PATCH = `
  body.travel-card-rendered {
    display: block;
    width: 210mm;
    height: auto;
    min-height: 0;
    margin: 0 auto;
    padding: 0;
    background: #ffffff;
  }
  body.travel-card-rendered > .a4-page,
  body.travel-card-rendered > .container {
    width: 210mm;
    height: 297mm;
    margin: 0 auto;
  }
  body.travel-card-rendered > .a4-page:not(:last-child),
  body.travel-card-rendered > .container:not(:last-child) {
    break-after: page;
    page-break-after: always;
  }
  body.travel-card-rendered .card-middle {
    overflow: hidden;
  }
`;

export const makeOperationCardKey = (op) =>
  op?._key || `${op?.operation_no || 'op'}-${op?.machineid || ''}`;
const operationCardStyle = operationCardHtml.match(/<style>([\s\S]*?)<\/style>/i)?.[1] || '';
const operationCardBody =
  operationCardHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || operationCardHtml;

function getOperationQrValue({ selectedPart, cardInfo, op }) {
  const productionOrder = cardInfo.productionOrder || selectedPart?.production_order || '';
  return [`${normalizeProductionOrder(productionOrder)}-`, `${op.operation_no}`].join('');
}

function renderOperationCardImages(images = []) {
  return images
    .map((img) => {
      const left = (img.x / OP_MAIN_BOX_W) * 100;
      const top = (img.y / OP_MAIN_BOX_H) * 100;
      const width = (img.width / OP_MAIN_BOX_W) * 100;
      const height = (img.height / OP_MAIN_BOX_H) * 100;

      return `
      <img
        class="main-box-image"
        src="${escAttr(resolveAssetUrl(img.src))}"
        alt=""
        style="left:${left.toFixed(4)}%; top:${top.toFixed(4)}%; width:${width.toFixed(4)}%; height:${height.toFixed(4)}%;"
      >`;
    })
    .join('');
}

function buildOperationCardsHtml({
  selectedPart,
  editOps,
  selectedKeys,
  imagesByKey,
  qrByKey,
  cardInfo,
}) {
  const selectedKeySet = new Set(selectedKeys);
  const selectedOps = editOps.filter((op) => selectedKeySet.has(makeOperationCardKey(op)));

  const cards = selectedOps
    .map((op) => {
      const key = makeOperationCardKey(op);
      const productionOrder = normalizeProductionOrder(
        cardInfo.productionOrder || selectedPart?.production_order || ''
      );
      const confirmationNo = `${productionOrder || selectedPart?.part_number || 'OP'}-${op.operation_no || key}`;

      return operationCardBody
        .replace('{{opsNo}}', esc(op.operation_no || '-'))
        .replace('{{operationText}}', esc(op.operation_text || '-'))
        .replace('{{workCenter}}', esc(op.machineid || '-'))
        .replace('{{confirmationNo}}', esc(confirmationNo))
        .replace('{{qrCodeDataUrl}}', qrByKey[key] || '')
        .replace('{{mainBoxImages}}', renderOperationCardImages(imagesByKey[key] || []));
    })
    .join('\n<div class="page-break"></div>\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SSB Operation Card</title>
<style>
${operationCardStyle}
.page-break { page-break-after: always; break-after: page; height: 0; }
.page-break:last-child { display: none; }
</style>
</head>
<body>
${cards || '<div style="padding:16px;font-family:Arial,sans-serif;">Pilih minimal satu operation card.</div>'}
</body>
</html>`;
}

function splitTravelCardTemplate(html) {
  const matchBlock = (className) => {
    const startPattern = new RegExp(`<div\\s+class=["']${className}["'][^>]*>`, 'i');
    const startMatch = html.match(startPattern);
    if (!startMatch || startMatch.index == null) return '';

    const start = startMatch.index;
    let cursor = start + startMatch[0].length;
    let depth = 1;
    const tagPattern = /<\/?div\b[^>]*>/gi;
    tagPattern.lastIndex = cursor;

    while (depth > 0) {
      const tagMatch = tagPattern.exec(html);
      if (!tagMatch) return html.slice(start);
      if (tagMatch[0].startsWith('</')) depth -= 1;
      else depth += 1;
      cursor = tagPattern.lastIndex;
    }

    return html.slice(start, cursor);
  };

  const cardTop = matchBlock('card-top');
  const cardMiddle = matchBlock('card-middle');
  const cardBottom = matchBlock('card-bottom');
  if (cardTop || cardMiddle || cardBottom) {
    return {
      card1: cardTop,
      card2: cardMiddle,
      card3: cardBottom,
      wrapperClass: 'a4-page',
    };
  }

  const cardMatches = Array.from(
    html.matchAll(/<div class="card"[\s\S]*?<\/div><!-- \/Card \d+ -->/g)
  );

  return {
    card1: cardMatches[0]?.[0] || '',
    card2: cardMatches[1]?.[0] || '',
    card3: cardMatches[2]?.[0] || '',
    wrapperClass: 'container',
  };
}

function chunkRowsByEstimatedHeight(rows, maxHeightMM = TRAVEL_CARD_FALLBACK_MAX_HEIGHT_MM) {
  const PADDING_MM = 3;
  const LINE_HEIGHT_MM = 3;
  const DESC_CHARS_PER_LINE = 25;
  const REMARK_CHARS_PER_LINE = 36;

  const chunks = [];
  let currentChunk = [];
  let currentHeight = 0;

  for (const row of rows) {
    const descLines = Math.max(1, Math.ceil((row.opText?.length || 0) / DESC_CHARS_PER_LINE));
    const remarkLines = Math.max(1, Math.ceil((row.remark?.length || 0) / REMARK_CHARS_PER_LINE));
    const rowLines = Math.max(descLines, remarkLines);
    const rowHeight = PADDING_MM + rowLines * LINE_HEIGHT_MM;

    if (currentHeight + rowHeight > maxHeightMM && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentHeight = 0;
    }

    currentChunk.push(row);
    currentHeight += rowHeight;
  }

  if (currentChunk.length > 0) chunks.push(currentChunk);

  return chunks.length ? chunks : [[]];
}

function mmToPx(mm) {
  return mm * CSS_PX_PER_MM;
}

function addMeasureIndexToRow(rowHtml, index) {
  return rowHtml.replace(/<tr\b/i, `<tr data-measure-row="${index}"`);
}

function chunkRowsByMeasuredHeights(rows, rowHeights, maxRowsHeightPx) {
  const chunks = [];
  let currentChunk = [];
  let currentHeight = 0;

  rows.forEach((row, index) => {
    const rowHeight = Math.max(0, rowHeights[index] || 0);

    if (currentChunk.length > 0 && currentHeight + rowHeight > maxRowsHeightPx) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentHeight = 0;
    }

    currentChunk.push(row);
    currentHeight += rowHeight;
  });

  if (currentChunk.length > 0) chunks.push(currentChunk);

  return chunks.length ? chunks : [[]];
}

function waitForIframeLoad(iframe) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };

    iframe.onload = finish;
    window.setTimeout(finish, 300);
  });
}

function waitForLayoutFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(resolve);
    });
  });
}

async function chunkRowsByMeasuredHeight({
  html,
  rows,
  card1,
  card2,
  card3,
  wrapperClass,
  operationBlockPattern,
}) {
  if (!rows.length || typeof document === 'undefined' || !document.body) {
    return chunkRowsByEstimatedHeight(rows);
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.position = 'fixed';
  iframe.style.left = '-10000px';
  iframe.style.top = '0';
  iframe.style.width = '210mm';
  iframe.style.height = '297mm';
  iframe.style.visibility = 'hidden';
  iframe.style.pointerEvents = 'none';

  const measuredRowsHtml = rows.map((row, index) => addMeasureIndexToRow(row.html, index)).join('');
  const workCard = card2.replace(operationBlockPattern, measuredRowsHtml);
  const measurementPage = `
    <section class="${wrapperClass}">
      ${card1}
      ${workCard}
      ${card3}
    </section>
  `;
  const measurementHtml = html
    .replace('</style>', `${TRAVEL_CARD_RENDER_PATCH}</style>`)
    .replace(
      /<body[^>]*>[\s\S]*?<\/body>/,
      `<body class="travel-card-rendered">${measurementPage}</body>`
    );

  try {
    const loadPromise = waitForIframeLoad(iframe);
    iframe.srcdoc = measurementHtml;
    document.body.appendChild(iframe);
    await loadPromise;

    const iframeDocument = iframe.contentDocument;
    if (!iframeDocument) throw new Error('Travel card measurement document is not available.');

    if (iframeDocument.fonts?.ready) {
      await iframeDocument.fonts.ready.catch(() => undefined);
    }
    await waitForLayoutFrame();

    const cardMiddle = iframeDocument.querySelector('.card-middle');
    const tbody = iframeDocument.querySelector('.work-table tbody');
    const measuredRowEls = Array.from(iframeDocument.querySelectorAll('tr[data-measure-row]'));

    if (!cardMiddle || !tbody || measuredRowEls.length !== rows.length) {
      throw new Error('Travel card measurement nodes are incomplete.');
    }

    const cardRect = cardMiddle.getBoundingClientRect();
    const tbodyRect = tbody.getBoundingClientRect();
    const maxRowsHeightPx = Math.max(
      0,
      cardRect.bottom - tbodyRect.top - mmToPx(TRAVEL_CARD_PAGE_SAFE_GAP_MM)
    );
    const rowHeights = measuredRowEls.map((rowEl) => rowEl.getBoundingClientRect().height);

    if (
      !Number.isFinite(maxRowsHeightPx) ||
      maxRowsHeightPx <= 0 ||
      rowHeights.some((height) => height <= 0)
    ) {
      throw new Error('Travel card measurement produced invalid heights.');
    }

    return chunkRowsByMeasuredHeights(rows, rowHeights, maxRowsHeightPx);
  } catch {
    return chunkRowsByEstimatedHeight(rows);
  } finally {
    iframe.remove();
  }
}

export function useWorkcenterData() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/workcenter`)
      .then((r) => r.json())
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sortedRows = [...rows]
    .filter((row) => row.machineid)
    .sort((a, b) => {
      const groupCompare = String(a.groupname || a.machineid || '').localeCompare(
        String(b.groupname || b.machineid || '')
      );
      if (groupCompare !== 0) return groupCompare;
      const aPos = Number.isFinite(Number(a.position))
        ? Number(a.position)
        : Number.MAX_SAFE_INTEGER;
      const bPos = Number.isFinite(Number(b.position))
        ? Number(b.position)
        : Number.MAX_SAFE_INTEGER;
      if (aPos !== bPos) return aPos - bPos;
      return String(a.machineid || '').localeCompare(String(b.machineid || ''));
    });
  const machineIds = [...new Set(sortedRows.map((r) => r.machineid).filter(Boolean))];
  const groupOptions = [];
  const machineToGroup = {};
  const groupToMachine = {};

  sortedRows.forEach((row) => {
    const machineid = row.machineid;
    const groupname = row.groupname || machineid;
    if (!machineid || !groupname) return;
    [row.machineid, row.workcenterot, row.workcenternew, row.workcenterold].forEach((code) => {
      if (code) machineToGroup[code] = groupname;
    });
    if (!groupToMachine[groupname]) {
      groupToMachine[groupname] = machineid;
      groupOptions.push({ groupname, machineid });
    }
  });

  return { machineIds, groupOptions, machineToGroup, groupToMachine, loading };
}

function StepBadge({ n, active, done }) {
  return (
    <div
      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                 flex-shrink-0 transition-all"
      style={
        done
          ? { background: '#0096c7', color: '#fff' }
          : active
            ? { background: '#caf0f8', color: '#0077b6', border: '1.5px solid #00b4d8' }
            : { background: '#f1f5f9', color: '#94a3b8' }
      }
    >
      {done ? <Check size={10} /> : n}
    </div>
  );
}

function Checkbox({ checked, indeterminate, className }) {
  return (
    <div
      className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0
                  transition-all
                  ${
                    checked
                      ? 'bg-[#0096c7] border-[#0096c7]'
                      : indeterminate
                        ? 'border-[#0096c7] bg-white'
                        : 'border-slate-300 bg-white'
                  } ${className || ''}`}
    >
      {checked && <Check size={10} className="text-white" />}
      {indeterminate && !checked && <div className="w-2 h-0.5 bg-[#0096c7] rounded-sm" />}
    </div>
  );
}

function StatusIcon({ active, label }) {
  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border ${
        active
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-slate-200 bg-slate-50 text-slate-300'
      }`}
    >
      {active ? <Check size={14} /> : <X size={13} />}
    </span>
  );
}

function OrderStatusIcon({ row }) {
  const hasOrderNo = Boolean(row?.has_order_no || row?.production_order);
  return <StatusIcon active={hasOrderNo} label={hasOrderNo ? 'Order ada' : 'Order belum ada'} />;
}

function SowStatusIcon({ row }) {
  const sowExists = Boolean(row?.sow_exists);
  const count = row?.sow_row_count ? ` (${row.sow_row_count})` : '';
  return <StatusIcon active={sowExists} label={sowExists ? `SOW ada${count}` : 'SOW belum ada'} />;
}

function ReceivingSowStatusBadges({ row }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-500">
      <span className="inline-flex items-center gap-1">
        <OrderStatusIcon row={row} />
        Order
      </span>
      <span className="inline-flex items-center gap-1">
        <SowStatusIcon row={row} />
        SOW
      </span>
    </div>
  );
}

function PartPanel({ selected, onSelect }) {
  const [inputValue, setInputValue] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    fetch(`${API_BASE}/receiving-shipment/sow-components?limit=20&q=${encodeURIComponent(search)}`)
      .then((r) => r.json())
      .then((json) => setResults(json.data || []))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [search]);

  const handleInput = (e) => {
    const val = e.target.value;
    setInputValue(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(val), 350);
  };

  const clearSearch = () => {
    setInputValue('');
    setSearch('');
    setResults([]);
  };

  const handlePick = (part) => {
    if (part?.sow_exists) {
      toast.warning(`SOW untuk order ${part.sow_order_no || part.production_order} sudah ada`);
    }
    onSelect(part);
    clearSearch();
  };

  if (selected) {
    return (
      <div className="flex flex-col gap-2 py-1">
        <div
          className="flex items-start gap-2 px-3 py-2.5 rounded-xl border"
          style={{ background: '#caf0f8', borderColor: '#90e0ef' }}
        >
          <Check size={13} style={{ color: '#0077b6' }} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p
              className="text-xs font-bold leading-snug"
              style={{ color: '#023e8a' }}
              title={selected.part_name}
            >
              {selected.part_name}
            </p>
            <p className="text-[10px] font-mono mt-0.5" style={{ color: '#0077b6' }}>
              {selected.part_number}
              {selected.model ? ` · ${selected.model}` : ''}
            </p>
            <p className="text-[10px] text-slate-500 mt-1">
              {selected.ssbr_ident || 'No SSBR'} /{' '}
              {selected.production_order || 'No production order'}
            </p>
            <div className="mt-2">
              <ReceivingSowStatusBadges row={selected} compact />
            </div>
          </div>
        </div>
        <button
          onClick={() => {
            onSelect(null);
            clearSearch();
          }}
          className="flex items-center justify-center gap-1.5 text-xs font-semibold
                     text-slate-400 hover:text-[#0096c7] py-1.5 rounded-lg
                     hover:bg-slate-50 border border-transparent hover:border-slate-200
                     transition-all"
        >
          <Search size={11} />
          Ganti Part
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {}
      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
        />
        <input
          type="text"
          value={inputValue}
          onChange={handleInput}
          placeholder="Cari SSBR, production order, part, customer..."
          autoFocus
          className="w-full pl-8 pr-8 py-2 bg-white border border-slate-200 text-slate-800
                     placeholder-slate-400 rounded-lg text-sm focus:outline-none
                     focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
        />
        {inputValue && (
          <button
            onClick={clearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400
                       hover:text-slate-600 p-1 rounded"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {}
      {loading ? (
        <div className="flex justify-center py-5">
          <Loader2 size={16} className="animate-spin text-[#0096c7]" />
        </div>
      ) : results.length > 0 ? (
        <div className="flex flex-col gap-1 max-h-[260px] md:max-h-none overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.receiving_component_id}
              onClick={() => handlePick(r)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                         transition-all min-h-[44px] border border-slate-100 bg-white
                         hover:bg-slate-50 hover:border-slate-200 active:scale-[0.98]"
            >
              <Package size={14} className="flex-shrink-0 text-slate-300" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-slate-800 truncate">{r.part_name}</p>
                <p className="text-[10px] text-slate-500">
                  <span className="font-mono">{r.part_number || 'No part number'}</span>
                  {r.model ? ` · ${r.model}` : ''}
                  <span className="ml-1.5 text-slate-400">· {r.operation_count} op</span>
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  <span className="font-mono">{r.ssbr_ident}</span>
                  {r.production_order ? (
                    <span> / PO {r.production_order}</span>
                  ) : (
                    <span> / PO belum ada</span>
                  )}
                  {r.customer_name ? <span> / {r.customer_name}</span> : null}
                </p>
                <div className="mt-1.5">
                  <ReceivingSowStatusBadges row={r} compact />
                </div>
              </div>
              <ChevronRight size={12} className="flex-shrink-0 text-slate-300" />
            </button>
          ))}
        </div>
      ) : search.trim() ? (
        <p className="text-center text-xs text-slate-400 py-5">
          Tidak ada hasil untuk &ldquo;{search}&rdquo;
        </p>
      ) : (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <Package size={28} className="text-slate-200" />
          <p className="text-xs text-slate-400">Ketik untuk mencari component receiving</p>
        </div>
      )}
    </div>
  );
}

function ReceivingComponentTable({ onSelect }) {
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const debounceRef = useRef(null);
  const limit = 12;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search.trim()) params.set('q', search.trim());

    setLoading(true);
    fetch(`${API_BASE}/receiving-shipment/sow-components?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Server ${r.status}`);
        return r.json();
      })
      .then((json) => {
        const data = Array.isArray(json.data) ? json.data : [];
        setRows(data);
        setTotal(json.pagination?.total || data.length);
        setPreview(
          (current) =>
            data.find((item) => item.receiving_component_id === current?.receiving_component_id) ||
            data[0] ||
            null
        );
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setRows([]);
          setTotal(0);
          setPreview(null);
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [page, search]);

  const handleInput = (e) => {
    const val = e.target.value;
    setInputValue(val);
    setPage(1);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(val), 350);
  };

  const clearSearch = () => {
    clearTimeout(debounceRef.current);
    setInputValue('');
    setSearch('');
    setPage(1);
  };

  const handleSelect = (row) => {
    if (ENABLE_EXISTING_SOW_HISTORY_LINK && row?.sow_exists) {
      const orderNo = getSowOrderNo(row);
      navigate(`/sow-management/history?search=${encodeURIComponent(orderNo)}`);
      return;
    }
    onSelect(row);
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <div className="flex items-center gap-1.5">
            <StepBadge n={1} active done={false} />
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              Pilih Receiving Component
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            {total} component tersedia. Pilih row untuk preview, lalu lanjutkan ke proses SOW.
          </p>
        </div>
        <div className="relative w-[360px] max-w-full">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={inputValue}
            onChange={handleInput}
            placeholder="Cari SSBR, PO, part, customer..."
            autoFocus
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-8 text-sm text-slate-800
                       placeholder-slate-400 transition-all focus:border-[#0096c7] focus:outline-none
                       focus:ring-2 focus:ring-[#00b4d8]"
          />
          {inputValue && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_360px] overflow-hidden">
        <div className="min-w-0 overflow-hidden border-r border-slate-100">
          <div className="h-full overflow-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-bold">SSBR</th>
                  <th className="px-3 py-3 font-bold">Production Order</th>
                  <th className="px-3 py-3 font-bold">Part</th>
                  <th className="px-3 py-3 font-bold">Model</th>
                  <th className="px-3 py-3 font-bold">Customer</th>
                  <th className="px-3 py-3 font-bold">Level</th>
                  <th className="px-3 py-3 text-center font-bold">Order</th>
                  <th className="px-3 py-3 text-center font-bold">SOW</th>
                  <th className="px-4 py-3 text-right font-bold">Ops</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                      <Loader2 size={18} className="mx-auto mb-2 animate-spin text-[#0096c7]" />
                      Loading receiving components...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                      Tidak ada receiving component ditemukan.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const isActive = preview?.receiving_component_id === row.receiving_component_id;
                    return (
                      <tr
                        key={row.receiving_component_id}
                        onClick={() => setPreview(row)}
                        onDoubleClick={() => handleSelect(row)}
                        className={`cursor-pointer transition-colors ${isActive ? 'bg-cyan-50/70' : 'hover:bg-slate-50'}`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-mono font-bold text-slate-900">{row.ssbr_ident}</div>
                          <div className="text-[10px] text-slate-400">
                            {row.received_date
                              ? new Date(row.received_date).toLocaleDateString('id-ID')
                              : '-'}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-mono text-slate-700">
                            {row.production_order || '-'}
                          </div>
                          {row.production_order && (
                            <div className="text-[10px] text-slate-400">
                              {normalizeProductionOrder(row.production_order)}
                            </div>
                          )}
                        </td>
                        <td className="max-w-[300px] px-3 py-3">
                          <div className="truncate font-semibold text-slate-800">
                            {row.part_name}
                          </div>
                          <div className="truncate font-mono text-[10px] text-slate-400">
                            {row.part_number || 'No part number'}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-slate-600">{row.model || '-'}</td>
                        <td className="max-w-[220px] px-3 py-3">
                          <div className="truncate text-slate-700">{row.customer_name || '-'}</div>
                          <div className="truncate text-[10px] text-slate-400">
                            {row.customer_site_name || row.customer_site_location || '-'}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
                            L{row.part_level} {row.part_type || ''}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <OrderStatusIcon row={row} />
                        </td>
                        <td className="px-3 py-3 text-center">
                          <SowStatusIcon row={row} />
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-600">
                          {row.operation_count}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex min-h-0 flex-col bg-slate-50/60">
          <div className="flex-1 overflow-auto p-4">
            {preview ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        {preview.ssbr_ident}
                      </p>
                      <h3 className="mt-1 text-base font-bold leading-snug text-slate-900">
                        {preview.part_name}
                      </h3>
                      <p className="mt-1 font-mono text-xs text-[#0077b6]">
                        {preview.part_number || 'No part number'} / {preview.model || 'No model'}
                      </p>
                    </div>
                    <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-[10px] font-bold text-[#0077b6]">
                      {preview.operation_count} ops
                    </span>
                  </div>
                  <div className="mt-3">
                    <ReceivingSowStatusBadges row={preview} />
                  </div>
                  {preview.sow_exists ? (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-700">
                      {ENABLE_EXISTING_SOW_HISTORY_LINK
                        ? 'Order ini sudah punya SOW. Buka SOW History untuk melihat detail order tersebut.'
                        : 'Order ini sudah punya SOW. Saat ini tombol tetap memilih component.'}
                    </div>
                  ) : null}
                  <button
                    onClick={() => handleSelect(preview)}
                    className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#0096c7] px-4 py-2 text-xs font-bold text-white transition-all hover:bg-[#0077b6] active:scale-[0.98]"
                  >
                    {ENABLE_EXISTING_SOW_HISTORY_LINK && preview.sow_exists
                      ? 'Lihat SOW'
                      : 'Pilih Component'}
                    <ChevronRight size={13} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <PreviewField
                    label="Production Order"
                    value={preview.production_order || '-'}
                    mono
                  />
                  <PreviewField
                    label="SOW Order No"
                    value={
                      preview.sow_order_no ||
                      (preview.production_order
                        ? normalizeProductionOrder(preview.production_order)
                        : '-')
                    }
                    mono
                  />
                  <PreviewField label="Customer" value={preview.customer_name || '-'} />
                  <PreviewField
                    label="Location"
                    value={preview.customer_site_name || preview.customer_site_location || '-'}
                  />
                  <PreviewField
                    label="Level / Type"
                    value={`L${preview.part_level}${preview.part_type ? ` / ${preview.part_type}` : ''}`}
                  />
                  <PreviewField label="Parent" value={preview.parent_part_name || '-'} />
                  <PreviewField label="Reference" value={preview.reff_number || '-'} mono />
                  <PreviewField label="Ex Unit" value={preview.ex_unit || '-'} mono />
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
                <Package size={32} className="mb-2 text-slate-300" />
                <p className="text-sm font-semibold">Pilih row untuk melihat detail</p>
              </div>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center justify-between border-t border-slate-200 bg-white px-4 py-3">
            <span className="text-[11px] text-slate-400">
              Page <span className="font-bold text-slate-600">{page}</span> of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewField({ label, value, mono }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p
        className={`mt-1 break-words text-xs font-semibold text-slate-800 ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}

export function ComponentMasterPicker({ selectedPart, onSelect }) {
  const [inputValue, setInputValue] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: '40' });
    if (search.trim()) params.set('q', search.trim());

    setLoading(true);
    fetch(`${API_BASE}/receiving-shipment/components?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Server ${r.status}`);
        return r.json();
      })
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch((err) => {
        if (err.name !== 'AbortError') setRows([]);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [search]);

  const handleInput = (e) => {
    const value = e.target.value;
    setInputValue(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 300);
  };

  const clearSearch = () => {
    clearTimeout(debounceRef.current);
    setInputValue('');
    setSearch('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex-shrink-0 border-b border-amber-100 bg-amber-50 px-4 py-3">
        <div className="flex items-start gap-2">
          <AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-amber-600" />
          <div>
            <p className="text-xs font-bold text-amber-800">
              Part receiving ini tidak punya part_number / component master.
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-amber-700">
              Pilih referensi dari master components
            </p>
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 border-b border-slate-100 p-3">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={inputValue}
            onChange={handleInput}
            placeholder={`Cari master component${selectedPart?.part_name ? `: ${selectedPart.part_name}` : ''}`}
            className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-8 text-xs text-slate-800
                       placeholder-slate-400 focus:border-[#0096c7] focus:outline-none focus:ring-2 focus:ring-[#00b4d8]"
          />
          {inputValue && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 size={18} className="animate-spin text-[#0096c7]" />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-slate-400">
            Tidak ada master component ditemukan.
          </div>
        ) : (
          rows.map((component) => (
            <button
              key={component.component_id}
              onClick={() => onSelect(component)}
              className="flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
            >
              <Package size={14} className="mt-0.5 flex-shrink-0 text-slate-300" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-slate-800">{component.part_name}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  <span className="font-mono">{component.part_number}</span>
                  {component.model ? <span> / {component.model}</span> : null}
                </p>
              </div>
              <ChevronRight size={12} className="mt-1 flex-shrink-0 text-slate-300" />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function ChecklistPanel({
  componentId,
  selectedPart,
  checked,
  checkedTemplates,
  onToggle,
  onToggleAll,
  onToggleTemplate,
  onResolveComponent,
}) {
  const [ops, setOps] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!componentId) {
      setOps([]);
      setTemplates([]);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`${API_BASE}/sow/standard/component/${componentId}`).then((r) => {
        if (!r.ok) throw new Error(`Server ${r.status}`);
        return r.json();
      }),
      fetch(`${API_BASE}/sow/standard/component/${componentId}/templates`).then((r) => {
        if (!r.ok) throw new Error(`Server ${r.status}`);
        return r.json();
      }),
    ])
      .then(([operationsPayload, templatesPayload]) => {
        setOps(
          Array.isArray(operationsPayload)
            ? operationsPayload.sort((a, b) => a.operation_no - b.operation_no)
            : []
        );
        setTemplates(Array.isArray(templatesPayload?.data) ? templatesPayload.data : []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [componentId]);

  if (!selectedPart) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-12 gap-2">
        <ClipboardList size={32} className="text-slate-200" />
        <p className="text-xs text-slate-400">Pilih part terlebih dahulu</p>
      </div>
    );
  }

  if (!componentId) {
    return <ComponentMasterPicker selectedPart={selectedPart} onSelect={onResolveComponent} />;
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 size={18} className="animate-spin text-[#0096c7]" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="m-4 flex items-start gap-2 px-3 py-2.5 bg-red-50 border
                      border-red-200 rounded-lg text-xs text-red-700"
      >
        <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
        {error}
      </div>
    );
  }

  if (ops.length === 0) {
    return (
      <p className="text-center text-xs text-slate-400 py-10">
        Part ini belum memiliki operasi standar.
      </p>
    );
  }

  const allChecked = ops.length > 0 && ops.every((op) => checked.has(op.id));
  const someChecked = ops.some((op) => checked.has(op.id));
  const operationIdsInTemplates = new Set(
    templates.flatMap((template) => (template.operations || []).map((op) => op.id))
  );
  const individualOps = ops.filter((op) => !operationIdsInTemplates.has(op.id));
  const standaloneOps = individualOps.length ? individualOps : ops;
  const toggleExpanded = (templateId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(templateId)) next.delete(templateId);
      else next.add(templateId);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {}
      <div
        className="flex-shrink-0 flex items-center justify-between px-3 py-2
                      bg-slate-50 border-b border-slate-100"
      >
        <button
          onClick={() => onToggleAll(ops, !allChecked)}
          className="flex items-center gap-2 text-xs font-semibold text-[#0096c7]
                     hover:text-[#0077b6] transition-colors min-h-[36px]"
        >
          <Checkbox checked={allChecked} indeterminate={someChecked && !allChecked} />
          {allChecked ? 'Deselect All' : 'Select All Operations'}
        </button>
        <span className="text-[10px] text-slate-400">
          <span className="font-semibold text-slate-600">{checked.size}</span>/{ops.length}
        </span>
      </div>

      {}
      <div className="flex-1 overflow-y-auto">
        {templates.length > 0 && (
          <div className="border-b border-slate-100">
            <div className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-slate-400 bg-white">
              Operation Packages
            </div>
            <div className="divide-y divide-slate-50">
              {templates.map((template) => {
                const templateOps = Array.isArray(template.operations) ? template.operations : [];
                const templateExplicitChecked = checkedTemplates?.has(template.template_id);
                const templatePartial =
                  !templateExplicitChecked && templateOps.some((op) => checked.has(op.id));
                const templateChecked =
                  templateExplicitChecked ||
                  (templateOps.length > 0 && templateOps.every((op) => checked.has(op.id)));
                const isOpen = expanded.has(template.template_id);
                return (
                  <div key={template.template_id}>
                    <div
                      className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${templateChecked ? 'bg-[#caf0f8]/40' : 'hover:bg-slate-50'}`}
                    >
                      <button
                        onClick={() =>
                          onToggleTemplate(
                            templateOps,
                            !templateExplicitChecked,
                            template.template_id
                          )
                        }
                        className="mt-0.5"
                        title={templateExplicitChecked ? 'Deselect package' : 'Select package'}
                      >
                        <Checkbox
                          checked={templateChecked}
                          indeterminate={templatePartial && !templateChecked}
                        />
                      </button>
                      <button
                        onClick={() => toggleExpanded(template.template_id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-1.5">
                          {isOpen ? (
                            <ChevronDown size={12} className="text-slate-400" />
                          ) : (
                            <ChevronRight size={12} className="text-slate-400" />
                          )}
                          <span className="truncate text-xs font-bold text-slate-800">
                            {template.template_name}
                          </span>
                          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">
                            {template.operation_count} ops
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          Key {template.template_key} · {fmtHours(template.total_std_hours)} hrs
                        </p>
                      </button>
                    </div>
                    {isOpen && (
                      <div className="bg-slate-50/70 py-1">
                        {templateOps.map((op) => (
                          <div
                            key={`${template.template_id}-${op.id}`}
                            className="flex gap-2 px-8 py-1.5 text-[11px] text-slate-600"
                          >
                            <span className="font-mono font-bold text-[#0077b6]">
                              {String(op.operation_no).padStart(4, '0')}
                            </span>
                            <span className="min-w-0 flex-1">{op.operation_text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-wide text-slate-400 bg-white">
          {templates.length > 0 ? 'Individual Operations' : 'Operations'}
        </div>
        <div className="divide-y divide-slate-50">
          {standaloneOps.map((op) => {
            const isChecked = checked.has(op.id);
            return (
              <button
                key={op.id}
                onClick={() => onToggle(op)}
                className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left
                         transition-colors min-h-[48px]
                         ${
                           isChecked ? 'bg-[#caf0f8]/40 hover:bg-[#caf0f8]/60' : 'hover:bg-slate-50'
                         }`}
              >
                <Checkbox checked={isChecked} className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-1.5 flex-wrap">
                    <span className="font-mono text-[10px] font-bold text-[#0077b6] whitespace-nowrap">
                      {String(op.operation_no).padStart(4, '0')}
                    </span>
                    <span className="text-xs text-slate-800 leading-snug">{op.operation_text}</span>
                  </div>
                  {(op.workcenter || op.std_hours != null) && (
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {op.workcenter && <span className="font-mono">{op.workcenter}</span>}
                      {op.workcenter && op.std_hours != null && ' · '}
                      {op.std_hours != null && `${fmtHours(op.std_hours)} hrs`}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WorkcenterSelect({
  value,
  onChange,
  groupOptions = [],
  machineToGroup = {},
  loading,
  className,
}) {
  const currentGroup = value ? machineToGroup[value] || value : '';
  const hasCurrentGroup =
    currentGroup && groupOptions.some((option) => option.groupname === currentGroup);
  const options =
    hasCurrentGroup || !currentGroup
      ? groupOptions
      : [{ groupname: currentGroup, machineid: value }, ...groupOptions];

  return (
    <div className="relative">
      <select
        value={currentGroup}
        onChange={(event) => {
          const selected = options.find((option) => option.groupname === event.target.value);
          onChange(selected?.machineid || event.target.value);
        }}
        disabled={loading}
        className={`w-full pl-2 pr-5 py-1.5 bg-white border border-slate-200 text-slate-700
                    rounded text-[11px] focus:outline-none focus:ring-1 focus:ring-[#00b4d8]
                    focus:border-[#0096c7] transition-all appearance-none cursor-pointer
                    ${loading ? 'opacity-50 cursor-not-allowed' : ''}
                    ${className || ''}`}
      >
        <option value="">-- WC --</option>
        {options.map((option) => (
          <option key={option.groupname} value={option.groupname}>
            {option.groupname}
          </option>
        ))}
      </select>
      <ChevronDown
        size={9}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
      />
    </div>
  );
}

export function EditPanel({ editOps, onEdit, onDelete, onReorder, onAdd, wcData }) {
  const { groupOptions, machineToGroup, loading: wcLoading } = wcData;

  const [dragKey, setDragKey] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newOp, setNewOp] = useState({
    operation_text: '',
    machineid: '',
    std_hours: '',
    remark: '',
  });

  const handleDragStart = (e, key) => {
    setDragKey(key);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e, key) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (key !== dragKey) setDragOverKey(key);
  };
  const handleDrop = (e, targetKey) => {
    e.preventDefault();
    if (!dragKey || dragKey === targetKey) {
      resetDrag();
      return;
    }
    onReorder(dragKey, targetKey);
    resetDrag();
  };
  const handleDragEnd = () => resetDrag();
  const resetDrag = () => {
    setDragKey(null);
    setDragOverKey(null);
  };

  const handleWcChange = (key, value) => {
    onEdit(key, 'machineid', value);
  };

  const handleAddSubmit = () => {
    if (!newOp.operation_text.trim()) {
      toast.error('Operation Text wajib diisi');
      return;
    }
    onAdd({
      operation_text: newOp.operation_text.trim(),
      machineid: newOp.machineid,

      std_hours: newOp.std_hours,
      va_hours: newOp.std_hours,
      nnva_hours: 0,
      remark: newOp.remark,
    });
    setNewOp({ operation_text: '', machineid: '', std_hours: '', remark: '' });
    setShowAddForm(false);
  };

  if (editOps.length === 0 && !showAddForm) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 py-12 px-6">
        <PenLine size={32} className="text-slate-200" />
        <div className="text-center">
          <p className="text-sm text-slate-400 font-medium">Belum ada proses dipilih</p>
          <p className="text-xs text-slate-300 mt-1">
            Centang proses dari panel kiri, atau tambahkan operasi manual di bawah
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-[#0096c7]
                     hover:text-[#0077b6] transition-colors"
        >
          <Plus size={13} />
          Tambah operasi manual
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {}
      <div className="flex-1 overflow-y-auto">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[620px]">
            <thead>
              <tr style={{ background: '#caf0f8' }}>
                <th className="w-8 px-2 py-2" aria-label="Drag" />
                <th className="w-10 px-2 py-2 text-center font-semibold text-slate-600 whitespace-nowrap">
                  No.
                </th>
                <th className="px-2 py-2 text-left font-semibold text-slate-600">Operation Text</th>
                <th className="w-[150px] px-2 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">
                  Workcenter
                </th>
                <th
                  className="w-[72px] px-2 py-2 text-right font-semibold text-slate-600 whitespace-nowrap"
                  title="Value-added hours — jam operasi aslinya"
                >
                  VA Hrs
                </th>
                <th
                  className="w-[62px] px-2 py-2 text-right font-semibold text-slate-500 whitespace-nowrap"
                  title="Non-value-added hours, diambil dari master standar"
                >
                  NNVA
                </th>
                <th
                  className="w-[72px] px-2 py-2 text-right font-semibold text-slate-700 whitespace-nowrap"
                  title="Plan hours = VA + NNVA, dihitung otomatis"
                >
                  Plan Hrs
                </th>
                <th className="w-[130px] px-2 py-2 text-left font-semibold text-slate-600 whitespace-nowrap">
                  Remark
                </th>
                <th className="w-8 px-2 py-2" aria-label="Delete" />
              </tr>
            </thead>
            <tbody>
              {editOps.map((op) => {
                const isDragging = dragKey === op._key;
                const isDragOver = dragOverKey === op._key && dragKey !== op._key;

                return (
                  <tr
                    key={op._key}
                    draggable
                    onDragStart={(e) => handleDragStart(e, op._key)}
                    onDragOver={(e) => handleDragOver(e, op._key)}
                    onDrop={(e) => handleDrop(e, op._key)}
                    onDragEnd={handleDragEnd}
                    className={`transition-all
                      ${isDragging ? 'opacity-30 bg-slate-50' : ''}
                      ${isDragOver ? 'bg-[#caf0f8]/50' : 'hover:bg-slate-50'}
                    `}
                    style={{
                      borderTop: isDragOver ? '2px solid #0096c7' : '1px solid #f1f5f9',
                    }}
                  >
                    {}
                    <td className="px-2 py-2">
                      <GripVertical
                        size={13}
                        className="text-slate-300 hover:text-slate-400 mx-auto cursor-grab active:cursor-grabbing"
                      />
                    </td>

                    {}
                    <td className="px-2 py-2 text-center">
                      <span className="font-mono text-[11px] font-bold text-[#0077b6]">
                        {String(op.operation_no).padStart(3, '0')}
                      </span>
                    </td>

                    {}
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={op.operation_text}
                        onChange={(e) => onEdit(op._key, 'operation_text', e.target.value)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 text-slate-800
                                   rounded text-xs focus:outline-none focus:ring-1 focus:ring-[#00b4d8]
                                   focus:border-[#0096c7] transition-all"
                      />
                    </td>

                    {}
                    <td className="px-2 py-1.5">
                      <WorkcenterSelect
                        key={`${op._key}-${wcLoading}`}
                        value={op.machineid}
                        onChange={(value) => handleWcChange(op._key, value)}
                        groupOptions={groupOptions}
                        machineToGroup={machineToGroup}
                        loading={wcLoading}
                      />
                    </td>

                    {}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={op.va_hours ?? ''}
                        onChange={(e) => onEdit(op._key, 'va_hours', e.target.value)}
                        placeholder="0.00"
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 text-slate-800
                                   text-right rounded text-xs focus:outline-none focus:ring-1
                                   focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
                      />
                    </td>

                    {}
                    <td className="px-2 py-1.5 text-right">
                      <span
                        className="tabular-nums text-[11px] text-slate-500"
                        title="Diambil dari master standar operasi"
                      >
                        {fmtHours(op.nnva_hours ?? 0)}
                      </span>
                    </td>

                    {}
                    <td className="px-2 py-1.5 text-right">
                      <span
                        className="tabular-nums text-xs font-semibold text-slate-800"
                        title="VA + NNVA"
                      >
                        {fmtHours(
                          (Number.parseFloat(op.va_hours) || 0) +
                            (Number.parseFloat(op.nnva_hours) || 0)
                        )}
                      </span>
                    </td>

                    {}
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={op.remark ?? ''}
                        onChange={(e) => onEdit(op._key, 'remark', e.target.value)}
                        placeholder="Remark"
                        className="w-full px-2 py-1.5 bg-white border border-slate-200 text-slate-800
                                   rounded text-xs focus:outline-none focus:ring-1
                                   focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
                      />
                    </td>

                    {}
                    <td className="px-2 py-2">
                      <button
                        onClick={() => onDelete(op._key, op._srcId)}
                        className="w-6 h-6 flex items-center justify-center rounded
                                   text-slate-300 hover:text-red-500 hover:bg-red-50
                                   transition-all mx-auto"
                        title="Hapus dari list"
                      >
                        <Trash2 size={11} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {}
        {showAddForm && (
          <div className="border-t-2 border-dashed border-slate-200 p-3 bg-slate-50/80">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2.5">
              Tambah Operasi Manual
            </p>
            <div className="flex flex-col gap-2">
              {}
              <input
                type="text"
                value={newOp.operation_text}
                onChange={(e) => setNewOp((p) => ({ ...p, operation_text: e.target.value }))}
                placeholder="Operation Text *"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddSubmit();
                  if (e.key === 'Escape') setShowAddForm(false);
                }}
                className="w-full px-2.5 py-2 bg-white border border-slate-200 text-slate-800
                           placeholder-slate-400 rounded-lg text-xs focus:outline-none
                           focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
              />

              {}
              <div className="flex gap-2">
                {}
                <div className="flex-1 relative">
                  <WorkcenterSelect
                    value={newOp.machineid}
                    onChange={(value) => setNewOp((p) => ({ ...p, machineid: value }))}
                    groupOptions={groupOptions}
                    machineToGroup={machineToGroup}
                    loading={wcLoading}
                    className="py-2 rounded-lg text-xs focus:ring-2"
                  />
                </div>

                {}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newOp.std_hours}
                  onChange={(e) => setNewOp((p) => ({ ...p, std_hours: e.target.value }))}
                  placeholder="VA Hrs"
                  className="w-[72px] px-2.5 py-2 bg-white border border-slate-200 text-slate-800
                             text-right rounded-lg text-xs focus:outline-none
                             focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
                />
              </div>

              <input
                type="text"
                value={newOp.remark}
                onChange={(e) => setNewOp((p) => ({ ...p, remark: e.target.value }))}
                placeholder="Remark"
                className="w-full px-2.5 py-2 bg-white border border-slate-200 text-slate-800
                           placeholder-slate-400 rounded-lg text-xs focus:outline-none
                           focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
              />

              {}
              <div className="flex gap-2 justify-end mt-0.5">
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setNewOp({ operation_text: '', machineid: '', std_hours: '', remark: '' });
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600
                             bg-white border border-slate-200 rounded-lg
                             hover:bg-slate-50 transition-all active:scale-95"
                >
                  Batal
                </button>
                <button
                  onClick={handleAddSubmit}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold
                             text-white bg-[#0096c7] hover:bg-[#0077b6] rounded-lg
                             transition-all active:scale-95"
                >
                  <Plus size={12} />
                  Tambah
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {}
      {!showAddForm && (
        <div className="flex-shrink-0 px-3 py-2 border-t border-slate-100 bg-white">
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#0096c7]
                       hover:text-[#0077b6] transition-colors min-h-[36px]"
          >
            <Plus size={12} />
            Tambah Operasi Manual
          </button>
        </div>
      )}
    </div>
  );
}

export function TravelCardPreview({
  selectedPart,
  editOps,
  cardInfo,
  printRef,
  revisionLabel = '—',
  revisionDate = '—',
  note = '',
  issuedByName = getAuthUserDisplayName(),
  issuedAt = formatTravelCardIssuedAt(),
}) {
  const [srcDoc, setSrcDoc] = useState('');
  const qrRef = useRef(null);
  const sigQrRef = useRef(null);
  const [nnvaMap, setNnvaMap] = useState({});

  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      const results = {};
      await Promise.all(
        editOps.map(async (op) => {
          const stdId = op._srcId || op.id;
          if (!stdId) return;
          try {
            const res = await fetch(`${API_BASE}/sow/nnva/standard/${stdId}`);
            const json = await res.json();
            results[stdId] = (json.data || []).filter((n) => (n.standard_hours || 0) > 0);
          } catch {
            results[stdId] = [];
          }
        })
      );
      if (!cancelled) setNnvaMap(results);
    };
    fetchAll();
    return () => {
      cancelled = true;
    };
  }, [editOps]);

  const qrValue = cardInfo.productionOrder || selectedPart?.part_number || 'TRAVEL-CARD';
  const signatureQrValue = issuedByName || 'SIGNATURE';

  const getNnvaTotalForOp = useCallback(
    (op) => {
      const snapshot = Number.parseFloat(op.nnva_hours);
      if (Number.isFinite(snapshot)) return snapshot;

      const stdId = op._srcId || op.id;
      return (nnvaMap[stdId] || []).reduce(
        (sum, n) => sum + (parseFloat(n.standard_hours) || 0),
        0
      );
    },
    [nnvaMap]
  );

  const getTravelCardOperationHours = useCallback(
    (op) => {
      const va = Number.parseFloat(op.va_hours);
      if (Number.isFinite(va)) return va;
      const operationHours = parseFloat(op.std_hours) || 0;
      return operationHours - getNnvaTotalForOp(op);
    },
    [getNnvaTotalForOp]
  );

  const directHrs = editOps.reduce((sum, op) => sum + (parseFloat(op.std_hours) || 0), 0);
  const totalHrs = directHrs;
  const totalHoursDisplay = fmtTravelCardHours(totalHrs);

  useEffect(() => {
    let cancelled = false;

    const timer = setTimeout(() => {
      const buildTravelCard = async () => {
        const canvas = qrRef.current?.querySelector('canvas');
        const qrDataUrl = canvas ? canvas.toDataURL('image/png') : '';
        const sigCanvas = sigQrRef.current?.querySelector('canvas');
        const sigDataUrl = sigCanvas ? sigCanvas.toDataURL('image/png') : '';
        const signatureQrHtml = sigDataUrl
          ? `<img src="${sigDataUrl}" alt="Signature" style="width:12mm; height:12mm; object-fit:contain; display:block;">`
          : '';

        const opsRows = [];
        editOps.forEach((rawOp) => {
          const operationHours = getTravelCardOperationHours(rawOp);
          const op =
            rawOp.std_hours !== '' && rawOp.std_hours != null
              ? { ...rawOp, std_hours: operationHours }
              : rawOp;
          const machineId = esc(op.machineid || '—');
          opsRows.push({
            html: `<tr class="op-row">
            <td class="ops-no-tc">${op.operation_no}</td>
            <td>${esc(op.operation_text)}</td>
            <td class="tc">${machineId}</td>
            <td class="hrs-col">${fmtTravelCardHours(op.std_hours)}</td>
            <td></td><td></td><td class="remark-cell">${esc(op.remark || '')}</td>
          </tr>`,
            opText: op.operation_text || '',
            remark: op.remark || '',
          });

          const stdId = op._srcId || op.id;
          const nnvaList = nnvaMap[stdId] || [];
          nnvaList.forEach((n) => {
            opsRows.push({
              html: `<tr class="nnva-row">
              <td class="ops-no"> - </td>
              <td class="ops-no">${esc(n.nnva_name || '')}</td>
              <td class="tc">${machineId}</td>
              <td class="hrs-col">${fmtTravelCardHours(n.standard_hours)}</td>
              <td></td><td></td><td class="remark-cell"></td>
            </tr>`,
              opText: n.nnva_name || '',
              remark: '',
            });
          });
        });

        let html = travelCardHtml
          .replace('{{qrCodeDataUrl}}', qrDataUrl)
          .replace('../assets/ssb.png', ssbLogo)
          .replace('{{documentNo}}', esc(cardInfo.documentNo || '—'))
          .replace('{{revisionLabel}}', esc(revisionLabel || '—'))
          .replace('{{revisionDate}}', esc(revisionDate || '—'))
          .replace('{{signatureQr}}', signatureQrHtml)
          .replace('{{note}}', esc(note || ''))
          .replace('{{productionOrder}}', esc(cardInfo.productionOrder || '—'))
          .replace('{{partName}}', esc(selectedPart?.part_name || '—'))
          .replace('{{customer}}', esc(cardInfo.customer || '—'))
          .replace('{{model}}', esc(selectedPart?.model || '—'))
          .replace('{{ident}}', esc(cardInfo.ident || '—'))
          .replace('{{location}}', esc(cardInfo.location || '—'))
          .replace('{{partNumber}}', esc(selectedPart?.part_number || '—'))
          .replace('{{issuedByName}}', esc(issuedByName || '—'))
          .replace('{{issuedAt}}', esc(issuedAt || '—'))
          .replace('{{totalHours}}', totalHoursDisplay);

        const { card1, card2, card3, wrapperClass } = splitTravelCardTemplate(html);
        const operationBlockPattern =
          /<!--\s*\{\{#each operations\}\}\s*-->[\s\S]*?<!--\s*\{\{\/each\}\}\s*-->/;
        const rowChunks = await chunkRowsByMeasuredHeight({
          html,
          rows: opsRows,
          card1,
          card2,
          card3,
          wrapperClass,
          operationBlockPattern,
        });

        if (cancelled) return;

        const pages = rowChunks
          .map((rows, index) => {
            const pageLabel = `${index + 1} of ${rowChunks.length}`;

            const pageCard1 = card1.replace(
              '<td class="id-val"><span class="colon"></span> 1 of 1</td>',
              `<td class="id-val"><span class="colon"></span> ${pageLabel}</td>`
            );
            const workCard = card2.replace(operationBlockPattern, rows.map((r) => r.html).join(''));

            return `
          <section class="${wrapperClass}">
            ${pageCard1}
            ${workCard}
            ${card3}
          </section>
        `;
          })
          .join('');

        html = html
          .replace('</style>', `${TRAVEL_CARD_RENDER_PATCH}</style>`)
          .replace(
            /<body[^>]*>[\s\S]*?<\/body>/,
            `<body class="travel-card-rendered">${pages}</body>`
          );

        setSrcDoc(html);
      };

      void buildTravelCard();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    qrValue,
    signatureQrValue,
    selectedPart,
    editOps,
    cardInfo,
    totalHoursDisplay,
    revisionLabel,
    revisionDate,
    note,
    issuedByName,
    issuedAt,
    nnvaMap,
    getTravelCardOperationHours,
  ]);

  return (
    <div style={{ background: '#e8e6e0', padding: '20px 16px', minHeight: '100%' }}>
      {}
      <div
        ref={qrRef}
        style={{ position: 'absolute', left: '-9999px', top: 0, pointerEvents: 'none' }}
        aria-hidden="true"
      >
        <QRCodeCanvas value={qrValue} size={232} level="M" bgColor="#ffffff" fgColor="#0a0a0a" />
      </div>

      {}
      <div
        ref={sigQrRef}
        style={{ position: 'absolute', left: '-9999px', top: 0, pointerEvents: 'none' }}
        aria-hidden="true"
      >
        <QRCodeCanvas
          value={signatureQrValue}
          size={160}
          level="M"
          bgColor="#ffffff"
          fgColor="#0a0a0a"
        />
      </div>

      {}
      <iframe
        ref={printRef}
        srcDoc={srcDoc}
        title="Travel Card Preview"
        scrolling="no"
        style={{ width: '210mm', border: 'none', display: 'block', margin: '0 auto' }}
        onLoad={(e) => {
          const body = e.target.contentDocument?.body;
          if (body) e.target.style.height = body.scrollHeight + 1 + 'px';
        }}
      />
    </div>
  );
}

export function OperationCardPreview({
  selectedPart,
  editOps,
  cardInfo,
  printRef,
  selectedKeys,
  onSelectedKeysChange,
  activeOperationKey,
  onActiveOperationChange,
  imagesByKey,
  onImagesByKeyChange,
  revisionNo = 'Original',
  allowDirectSave = true,
}) {
  const [srcDoc, setSrcDoc] = useState('');
  const [selectedImageId, setSelectedImageId] = useState(null);
  const fileInputRef = useRef(null);
  const attachInputRef = useRef(null);
  const qrRef = useRef(null);
  const [loadingAttach, setLoadingAttach] = useState(false);
  const [savingCard, setSavingCard] = useState(false);
  const [attachModal, setAttachModal] = useState(null);
  const [attachPreviewIdx, setAttachPreviewIdx] = useState(0);
  const autoAttachedRef = useRef(new Set());

  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedOps = useMemo(
    () => editOps.filter((op) => selectedKeySet.has(makeOperationCardKey(op))),
    [editOps, selectedKeySet]
  );
  const activeOp = useMemo(
    () =>
      editOps.find((op) => makeOperationCardKey(op) === activeOperationKey) ||
      selectedOps[0] ||
      editOps[0],
    [activeOperationKey, editOps, selectedOps]
  );
  const activeKey = activeOp ? makeOperationCardKey(activeOp) : null;
  const activeImages = activeKey ? imagesByKey[activeKey] || [] : [];

  useEffect(() => {
    if (!activeOperationKey && editOps.length > 0) {
      onActiveOperationChange(makeOperationCardKey(editOps[0]));
    }
  }, [activeOperationKey, editOps, onActiveOperationChange]);

  useEffect(() => {
    if (!editOps.length || !selectedKeys.length) return;

    let cancelled = false;

    const batchLoad = async () => {
      const loaded = [];
      for (const op of editOps) {
        if (cancelled) break;
        const key = makeOperationCardKey(op);
        if (!selectedKeys.includes(key)) continue;
        if (autoAttachedRef.current.has(key)) continue;

        const stdId = op._srcId || op.id;
        if (!stdId) continue;

        const existing = imagesByKey[key];
        if (existing && existing.length > 0) continue;

        try {
          const res = await fetch(`${API_BASE}/sow/standard/operation/${stdId}/attachments`);
          if (!res.ok) continue;
          const attachments = await res.json();
          if (cancelled) return;

          const list = (Array.isArray(attachments) ? attachments : []).filter((att) =>
            /\.(png|jpe?g|gif|webp|pdf)$/i.test(att.original_name || '')
          );
          if (!list.length) continue;

          const first = list[0];
          const fileUrl = resolveAssetUrl(first.file_path);
          const isPdf = /\.pdf$/i.test(first.original_name || '');

          let src = fileUrl;
          if (isPdf) {
            try {
              src = await renderPdfToDataUrl(fileUrl);
            } catch {
              continue;
            }
          }

          autoAttachedRef.current.add(key);
          loaded.push(op);
          onImagesByKeyChange((prev) => ({
            ...prev,
            [key]: [
              ...(prev[key] || []),
              {
                id: `auto-att-${first.id}`,
                src,
                type: isPdf ? 'pdf-image' : 'image',
                name: first.original_name,
                x: AUTO_ATTACH_MARGIN,
                y: AUTO_ATTACH_MARGIN,
                width: OP_MAIN_BOX_W - AUTO_ATTACH_MARGIN * 2,
                height: OP_MAIN_BOX_H - AUTO_ATTACH_MARGIN * 2,
              },
            ],
          }));
        } catch {}
      }

      if (!cancelled) {
        const keysWithAttachments = new Set(loaded.map((op) => makeOperationCardKey(op)));
        for (const key of selectedKeys) {
          if (imagesByKey[key] && imagesByKey[key].length > 0) {
            keysWithAttachments.add(key);
          }
        }

        const filtered = selectedKeys.filter((k) => keysWithAttachments.has(k));
        if (filtered.length !== selectedKeys.length) {
          onSelectedKeysChange(filtered);
          if (!filtered.includes(activeKey)) {
            onActiveOperationChange(filtered[0] || null);
          }
        }

        if (loaded.length > 0) {
          toast.success(
            loaded.length === 1
              ? `Attachment SOP ditambahkan untuk Ops ${loaded[0].operation_no}`
              : `${loaded.length} attachment SOP otomatis ditambahkan`
          );
        } else if (filtered.length === 0) {
          toast.error('Tidak ada operation dengan attachment SOP');
        }
      }
    };

    batchLoad();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const qrByKey = {};
      qrRef.current?.querySelectorAll('[data-op-key]').forEach((node) => {
        const key = node.getAttribute('data-op-key');
        const canvas = node.querySelector('canvas');
        if (key && canvas) qrByKey[key] = canvas.toDataURL('image/png');
      });

      setSrcDoc(
        buildOperationCardsHtml({
          selectedPart,
          editOps,
          selectedKeys,
          imagesByKey,
          qrByKey,
          cardInfo,
        })
      );
    }, 0);

    return () => clearTimeout(timer);
  }, [selectedPart, editOps, selectedKeys, imagesByKey, cardInfo]);

  const handleToggleOperation = useCallback(
    (key) => {
      const exists = selectedKeys.includes(key);
      const next = exists ? selectedKeys.filter((item) => item !== key) : [...selectedKeys, key];
      onSelectedKeysChange(next);
      if (!exists) {
        onActiveOperationChange(key);
        return;
      }
      if (activeOperationKey === key) {
        onActiveOperationChange(next[0] || null);
        setSelectedImageId(null);
      }
    },
    [activeOperationKey, onActiveOperationChange, onSelectedKeysChange, selectedKeys]
  );

  const readImageFile = useCallback(
    (file) =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      }),
    []
  );

  const handleAddImages = useCallback(
    async (event) => {
      const files = Array.from(event.target.files || []).filter((file) =>
        file.type.startsWith('image/')
      );
      if (!activeKey || files.length === 0) return;

      const dataUrls = await Promise.all(files.map(readImageFile));
      const additions = dataUrls.map((src, index) => ({
        id: `img-${Date.now()}-${index}`,
        src,
        x: Math.min(40 + index * 18, OP_MAIN_BOX_W - 180),
        y: Math.min(40 + index * 18, OP_MAIN_BOX_H - 120),
        width: 240,
        height: 160,
      }));

      onImagesByKeyChange((prev) => ({
        ...prev,
        [activeKey]: [...(prev[activeKey] || []), ...additions],
      }));
      setSelectedImageId(additions[additions.length - 1]?.id || null);
      event.target.value = '';
    },
    [activeKey, onImagesByKeyChange, readImageFile]
  );

  const handleFetchAttachments = useCallback(async () => {
    const standardId = activeOp?._srcId || activeOp?.id || activeOp?.standard_id;
    if (!activeKey || !standardId) return;
    setLoadingAttach(true);
    try {
      const res = await fetch(`${API_BASE}/sow/standard/operation/${standardId}/attachments`);
      if (!res.ok) throw new Error('Gagal fetch attachments');
      const attachments = await res.json();
      const list = (Array.isArray(attachments) ? attachments : []).filter((att) =>
        /\.(png|jpe?g|gif|webp|pdf)$/i.test(att.original_name || '')
      );
      if (list.length === 0) {
        toast.error('Tidak ada attachment image/PDF untuk operation ini');
        return;
      }
      setAttachPreviewIdx(0);
      setAttachModal({ list, selected: new Set() });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingAttach(false);
    }
  }, [activeKey, activeOp]);

  const handleAddSelectedAttachments = useCallback(async () => {
    if (!attachModal || !activeKey) return;
    const selectedList = attachModal.list.filter((att) => attachModal.selected.has(att.id));
    if (selectedList.length === 0) {
      toast.error('Pilih minimal satu attachment');
      return;
    }

    setLoadingAttach(true);
    try {
      const additions = [];
      for (let i = 0; i < selectedList.length; i++) {
        const att = selectedList[i];
        const fileUrl = resolveAssetUrl(att.file_path);
        const isPdf = /\.pdf$/i.test(att.original_name || '');
        let src = fileUrl;
        if (isPdf) {
          try {
            src = await renderPdfToDataUrl(fileUrl);
          } catch (e) {
            toast.error(`Gagal render PDF: ${att.original_name}`);
            continue;
          }
        }
        additions.push({
          id: `att-${att.id}`,
          src,
          type: isPdf ? 'pdf-image' : 'image',
          name: att.original_name,
          x: Math.min(20 + additions.length * 20, OP_MAIN_BOX_W - 280),
          y: Math.min(20 + additions.length * 20, OP_MAIN_BOX_H - 200),
          width: 260,
          height: 180,
        });
      }

      if (additions.length === 0) return;

      onImagesByKeyChange((prev) => ({
        ...prev,
        [activeKey]: [...(prev[activeKey] || []), ...additions],
      }));
      setSelectedImageId(additions[additions.length - 1]?.id || null);
      setAttachModal(null);
      toast.success(`${additions.length} attachment ditambahkan`);
    } finally {
      setLoadingAttach(false);
    }
  }, [activeKey, attachModal, onImagesByKeyChange]);

  const updateImage = useCallback(
    (imageId, patch) => {
      if (!activeKey) return;
      onImagesByKeyChange((prev) => ({
        ...prev,
        [activeKey]: (prev[activeKey] || []).map((img) =>
          img.id === imageId ? { ...img, ...patch } : img
        ),
      }));
    },
    [activeKey, onImagesByKeyChange]
  );

  const removeSelectedImage = useCallback(() => {
    if (!activeKey || !selectedImageId) return;
    onImagesByKeyChange((prev) => ({
      ...prev,
      [activeKey]: (prev[activeKey] || []).filter((img) => img.id !== selectedImageId),
    }));
    setSelectedImageId(null);
  }, [activeKey, onImagesByKeyChange, selectedImageId]);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Delete' && selectedImageId && activeKey) {
        e.preventDefault();
        onImagesByKeyChange((prev) => ({
          ...prev,
          [activeKey]: (prev[activeKey] || []).filter((img) => img.id !== selectedImageId),
        }));
        setSelectedImageId(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeKey, onImagesByKeyChange, selectedImageId]);

  const handleSaveOperationCard = useCallback(async () => {
    if (!activeKey || !activeOp) return;
    const stdId = activeOp._cardSourceId || activeOp._srcId || activeOp.id;
    if (!stdId) return;
    setSavingCard(true);
    try {
      const images = imagesByKey[activeKey] || [];
      const orderNo = normalizeProductionOrder(
        cardInfo.productionOrder || selectedPart?.production_order || ''
      );
      const boxImageData = await generateOperationCardBoxImage(images);
      const response = await fetch(`${API_BASE}/sow/operationcard/${stdId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images,
          card_key: activeKey,
          order_no: orderNo,
          operation_no: activeOp.operation_no,
          revision_no: revisionNo,
          box_image_data: boxImageData,
        }),
      });
      if (!response.ok) throw new Error('Gagal simpan operation card');
      const payload = await response.json().catch(() => null);
      if (payload?.data?.images) {
        onImagesByKeyChange((prev) => ({
          ...prev,
          [activeKey]: payload.data.images,
        }));
      }
      toast.success('Operation card tersimpan');
    } catch {
      toast.error('Gagal simpan operation card');
    } finally {
      setSavingCard(false);
    }
  }, [activeKey, activeOp, cardInfo, imagesByKey, onImagesByKeyChange, revisionNo, selectedPart]);

  return (
    <div className="h-full grid grid-cols-[390px_minmax(0,1fr)] bg-slate-100 overflow-hidden">
      <div className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-1.5">
            <StepBadge n={4} active done={false} />
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              Operation Card
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">
            Pilih operation, lalu sisipkan gambar ke main box operation aktif.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-4 space-y-2">
            {editOps.map((op) => {
              const key = makeOperationCardKey(op);
              const checked = selectedKeys.includes(key);
              const active = activeKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onActiveOperationChange(key)}
                  className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left transition-all ${
                    active
                      ? 'border-[#00b4d8] bg-cyan-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleOperation(key);
                    }}
                    className="mt-0.5"
                  >
                    <Checkbox checked={checked} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-bold text-slate-700">
                        Ops {op.operation_no}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">
                        {op.machineid || '-'}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-slate-800">
                      {op.operation_text || '-'}
                    </p>
                    {(imagesByKey[key] || []).length > 0 && (
                      <p className="mt-1 text-[10px] font-semibold text-[#0096c7]">
                        {(imagesByKey[key] || []).length} gambar
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Card Selection
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Checklist menentukan operation yang ikut dicetak. Klik row untuk mengedit preview
              operation tersebut.
            </p>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-white px-3 py-2 text-xs">
              <span className="font-semibold text-slate-600">
                {selectedKeys.length} card dipilih
              </span>
              <span className="text-slate-400">
                {activeImages.length} gambar pada operation aktif
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto p-5" style={{ background: '#e8e6e0' }}>
        <div
          ref={qrRef}
          style={{ position: 'absolute', left: '-9999px', top: 0, pointerEvents: 'none' }}
          aria-hidden="true"
        >
          {selectedOps.map((op) => {
            const key = makeOperationCardKey(op);
            return (
              <div key={key} data-op-key={key}>
                <QRCodeCanvas
                  value={getOperationQrValue({ selectedPart, cardInfo, op })}
                  size={180}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
            );
          })}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleAddImages}
        />

        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Preview Operation Aktif
            </p>
            <p className="truncate text-sm font-bold text-slate-800">
              {activeOp
                ? `Ops ${activeOp.operation_no} - ${activeOp.operation_text || '-'}`
                : 'Tidak ada operation'}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {activeKey && selectedKeys.includes(activeKey)
                ? 'Operation ini dipilih untuk print.'
                : 'Operation ini belum dicentang untuk print.'}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!activeKey}
              className="flex items-center gap-1.5 rounded-lg bg-[#0096c7] px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-[#0077b6] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={12} />
              Add Image
            </button>
            <button
              type="button"
              onClick={handleFetchAttachments}
              disabled={!activeKey || loadingAttach}
              className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-purple-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loadingAttach ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Paperclip size={12} />
              )}
              Attachment
            </button>
            <button
              type="button"
              onClick={removeSelectedImage}
              disabled={!selectedImageId}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-all hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={12} />
              Remove
            </button>
            {allowDirectSave && (
              <button
                type="button"
                onClick={handleSaveOperationCard}
                disabled={!activeKey || savingCard}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-emerald-500 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {savingCard ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Save Card
              </button>
            )}
          </div>
        </div>

        <div
          className="mx-auto bg-white"
          style={{
            width: 794,
            minHeight: 1010,
            border: '2px solid #000',
            fontFamily: 'Arial, sans-serif',
            fontSize: '13px',
          }}
        >
          <table
            style={{ width: '100%', borderCollapse: 'collapse', borderBottom: '2px solid #000' }}
          >
            <tbody>
              <tr>
                <td style={{ padding: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <tbody>
                      <tr>
                        <td style={{ width: 150, padding: 8 }}>Ops. No</td>
                        <td style={{ width: 20, textAlign: 'center' }}>:</td>
                        <td
                          style={{ borderBottom: '1px solid #000', padding: 8, fontWeight: 'bold' }}
                        >
                          {activeOp?.operation_no || '-'}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: 8 }}>Operation Text</td>
                        <td style={{ textAlign: 'center' }}>:</td>
                        <td style={{ borderBottom: '1px solid #000', padding: 8 }}>
                          {activeOp?.operation_text || '-'}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: 8 }}>Work Center</td>
                        <td style={{ textAlign: 'center' }}>:</td>
                        <td style={{ borderBottom: '1px solid #000', padding: 8 }}>
                          {activeOp?.machineid || '-'}
                        </td>
                      </tr>
                      <tr>
                        <td style={{ padding: 8 }}>Confirmation No</td>
                        <td style={{ textAlign: 'center' }}>:</td>
                        <td style={{ padding: 8 }}>
                          {activeOp
                            ? `${normalizeProductionOrder(cardInfo.productionOrder || selectedPart?.production_order || '') || selectedPart?.part_number || 'OP'}-${activeOp.operation_no || activeKey}`
                            : '-'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </td>
                <td
                  style={{
                    width: 152,
                    borderLeft: '2px solid #000',
                    textAlign: 'center',
                    verticalAlign: 'middle',
                  }}
                >
                  {activeOp && (
                    <QRCodeCanvas
                      value={getOperationQrValue({ selectedPart, cardInfo, op: activeOp })}
                      size={114}
                      level="M"
                      bgColor="#ffffff"
                      fgColor="#000000"
                    />
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <div
            key={activeKey}
            style={{
              width: OP_MAIN_BOX_W,
              height: OP_MAIN_BOX_H,
              margin: '19px auto',
              border: '2px solid #000',
              position: 'relative',
              overflow: 'hidden',
              background: '#fff',
            }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setSelectedImageId(null);
            }}
          >
            {activeImages.map((img) => {
              const selected = selectedImageId === img.id;
              return (
                <Rnd
                  key={img.id}
                  size={{ width: img.width, height: img.height }}
                  position={{ x: img.x, y: img.y }}
                  bounds="parent"
                  lockAspectRatio
                  onDragStop={(_, d) => updateImage(img.id, { x: d.x, y: d.y })}
                  onResizeStop={(_, __, ref, ___, pos) =>
                    updateImage(img.id, {
                      x: pos.x,
                      y: pos.y,
                      width: parseFloat(ref.style.width),
                      height: parseFloat(ref.style.height),
                    })
                  }
                  style={{
                    border: selected ? '2px dashed #0096c7' : '2px dashed transparent',
                    boxSizing: 'border-box',
                  }}
                  onMouseDown={() => {
                    setSelectedImageId(img.id);
                  }}
                >
                  <img
                    src={resolveAssetUrl(img.src)}
                    alt={img.name || ''}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      pointerEvents: 'none',
                      display: 'block',
                    }}
                  />
                </Rnd>
              );
            })}
          </div>
        </div>

        <iframe
          ref={printRef}
          srcDoc={srcDoc}
          title="Operation Card Print Output"
          scrolling="no"
          style={{
            position: 'absolute',
            left: '-9999px',
            top: 0,
            width: '210mm',
            border: 'none',
            background: '#fff',
          }}
          onLoad={(e) => {
            const body = e.target.contentDocument?.body;
            if (body) e.target.style.height = body.scrollHeight + 1 + 'px';
          }}
        />
      </div>

      {}
      {attachModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setAttachModal(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 flex-shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-800">Pilih Attachment</h3>
                <p className="text-xs text-slate-500">
                  {attachModal.list.length} file · {attachModal.selected.size} dipilih
                </p>
              </div>
              <button
                onClick={() => setAttachModal(null)}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 min-h-0 flex">
              {}
              <div className="w-72 border-r border-slate-200 overflow-y-auto p-3 space-y-1 flex-shrink-0">
                {attachModal.list.map((att, idx) => {
                  const isSel = attachModal.selected.has(att.id);
                  const isPdf = /\.pdf$/i.test(att.original_name || '');
                  return (
                    <button
                      key={att.id}
                      onClick={() => {
                        setAttachPreviewIdx(idx);
                        setAttachModal((prev) => {
                          if (!prev) return prev;
                          const next = new Set(prev.selected);
                          next.has(att.id) ? next.delete(att.id) : next.add(att.id);
                          return { ...prev, selected: next };
                        });
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-xs transition-all border ${
                        isSel
                          ? 'bg-[#caf0f8] border-[#90e0ef]'
                          : 'bg-white border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => {}}
                        className="w-3.5 h-3.5 rounded accent-[#0096c7] flex-shrink-0"
                      />
                      {isPdf ? (
                        <FileText size={14} className="text-red-400 flex-shrink-0" />
                      ) : (
                        <ImageIcon size={14} className="text-emerald-500 flex-shrink-0" />
                      )}
                      <span className="truncate flex-1 text-slate-700">{att.original_name}</span>
                    </button>
                  );
                })}
              </div>

              {}
              <div className="flex-1 min-w-0 bg-slate-100 flex items-center justify-center p-4 overflow-hidden">
                {attachModal.list[attachPreviewIdx] ? (
                  (() => {
                    const preview = attachModal.list[attachPreviewIdx];
                    const url = resolveAssetUrl(preview.file_path);
                    const isPdf = /\.pdf$/i.test(preview.original_name || '');
                    return isPdf ? (
                      <div className="w-full h-full flex items-center justify-center overflow-hidden">
                        <PdfPreview
                          url={url}
                          style={{
                            maxWidth: '100%',
                            maxHeight: '100%',
                            width: 'auto',
                            height: 'auto',
                          }}
                        />
                      </div>
                    ) : (
                      <img
                        src={url}
                        alt={preview.original_name}
                        className="max-w-full max-h-full object-contain rounded-lg shadow-sm"
                      />
                    );
                  })()
                ) : (
                  <p className="text-xs text-slate-400">Pilih file untuk preview</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 flex-shrink-0">
              <span className="text-xs text-slate-400">
                Klik untuk select/deselect · Preview otomatis
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setAttachModal(null)}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-white border border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  onClick={handleAddSelectedAttachments}
                  disabled={attachModal.selected.size === 0}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#0096c7] hover:bg-[#0077b6] text-white disabled:opacity-40"
                >
                  Add Selected ({attachModal.selected.size})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const SowCreatePage = () => {
  const [selectedPart, setSelectedPart] = useState(null);
  const [checkedOps, setCheckedOps] = useState(new Set());
  const [checkedTemplates, setCheckedTemplates] = useState(new Set());
  const checkedTemplateOpsRef = useRef(new Map());
  const [editOps, setEditOps] = useState([]);
  const [saving, setSaving] = useState(false);
  const [activeStep, setActiveStep] = useState('edit');
  const [cardInfo, setCardInfo] = useState({
    customer: '',
    productionOrder: '',
    location: '',
    ident: '',
    documentNo: '',
    note: '',
  });
  const [documentNos, setDocumentNos] = useState([]);
  const [operationCardKeys, setOperationCardKeys] = useState([]);
  const [activeOperationKey, setActiveOperationKey] = useState(null);
  const [operationCardImages, setOperationCardImages] = useState({});
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [showCreateDoc, setShowCreateDoc] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
  const [newDoc, setNewDoc] = useState({
    documentno: '',
    revision_no: '',
    revision_date: '',
    default: false,
  });
  const [printing, setPrinting] = useState(false);
  const printRef = useRef(null);

  const [savedSows, setSavedSows] = useState([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedSearch, setSavedSearch] = useState('');
  const [showSavedPanel, setShowSavedPanel] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [savedName, setSavedName] = useState('');
  const [savingSow, setSavingSow] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renamingName, setRenamingName] = useState('');
  const issuedByName = getAuthUserDisplayName();
  const issuedAt = useMemo(() => formatTravelCardIssuedAt(), []);

  const { draftAvailable, lastSavedAt, restoreDraft, discardDraft } = useSowDraft({
    context: 'create',
    refKey: '',
    state: { selectedPart, cardInfo, editOps, activeStep, operationCardKeys, operationCardImages },
    enabled: !saving && documentNos.length > 0,
    onRestore: (payload) => {
      if (!payload) return;
      setSelectedPart(payload.selectedPart ?? null);
      setCardInfo((prev) => ({ ...prev, ...(payload.cardInfo || {}) }));
      setEditOps(Array.isArray(payload.editOps) ? payload.editOps : []);
      setActiveStep(payload.activeStep || 'edit');
      setOperationCardKeys(
        Array.isArray(payload.operationCardKeys) ? payload.operationCardKeys : []
      );
      setOperationCardImages(payload.operationCardImages || {});
      setCheckedOps(new Set((payload.editOps || []).map((op) => op._srcId).filter(Boolean)));
      setCheckedTemplates(new Set());
      checkedTemplateOpsRef.current.clear();
    },
  });

  const loadSavedSows = useCallback(async () => {
    setSavedLoading(true);
    try {
      const data = await listSavedSows();
      setSavedSows(Array.isArray(data.data) ? data.data : []);
    } catch (err) {
      toast.error(err.message || 'Gagal memuat saved SOW');
    } finally {
      setSavedLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSavedSows();
  }, [loadSavedSows]);

  const savedFiltered = useMemo(() => {
    const q = savedSearch.trim().toLowerCase();
    if (!q) return savedSows;
    return savedSows.filter((row) =>
      String(row.name || '')
        .toLowerCase()
        .includes(q)
    );
  }, [savedSows, savedSearch]);

  const openSaveModal = () => {
    const base = [selectedPart?.part_number, cardInfo.customer, selectedPart?.part_name]
      .filter(Boolean)
      .join(' - ')
      .trim();
    setSavedName(base || 'Saved SOW');
    setShowSaveModal(true);
  };

  const handleSaveSow = async () => {
    const name = savedName.trim();
    if (!name) {
      toast.error('Nama wajib diisi');
      return;
    }
    if (!selectedPart && editOps.length === 0) {
      toast.error('Belum ada konten untuk disimpan');
      return;
    }
    setSavingSow(true);
    try {
      await createSavedSow({
        name,
        component_id: selectedPart?.component_id ?? null,
        payload: { selectedPart, cardInfo, editOps },
      });
      toast.success('SOW tersimpan');
      setShowSaveModal(false);
      setSavedName('');
      loadSavedSows();
    } catch (err) {
      toast.error(err.message || 'Gagal menyimpan SOW');
    } finally {
      setSavingSow(false);
    }
  };

  const handleLoadSaved = async (row) => {
    try {
      const detail = await getSavedSow(row.id);
      const payload = detail?.payload;
      if (!payload) throw new Error('Saved SOW tidak punya isi');
      setSelectedPart(payload.selectedPart ?? null);
      setCardInfo((prev) => ({ ...prev, ...(payload.cardInfo || {}) }));
      setEditOps(Array.isArray(payload.editOps) ? payload.editOps : []);
      setActiveStep('edit');
      setOperationCardKeys((payload.editOps || []).map(makeOperationCardKey));
      setOperationCardImages({});
      setCheckedOps(new Set((payload.editOps || []).map((op) => op._srcId).filter(Boolean)));
      setCheckedTemplates(new Set());
      checkedTemplateOpsRef.current.clear();
      toast.success(`Saved SOW "${row.name}" dimuat`);
    } catch (err) {
      toast.error(err.message || 'Gagal memuat saved SOW');
    }
  };

  const handleRename = async (id) => {
    const name = renamingName.trim();
    if (!name) {
      toast.error('Nama wajib diisi');
      return;
    }
    try {
      await updateSavedSow(id, { name });
      toast.success('Nama diperbarui');
      setRenamingId(null);
      loadSavedSows();
    } catch (err) {
      toast.error(err.message || 'Gagal rename');
    }
  };

  const handleDeleteSaved = async (row) => {
    if (!window.confirm(`Hapus "${row.name}"?`)) return;
    try {
      await deleteSavedSow(row.id);
      toast.success('Saved SOW dihapus');
      loadSavedSows();
    } catch (err) {
      toast.error(err.message || 'Gagal menghapus');
    }
  };

  const loadDocumentNos = useCallback(async ({ selectDocumentNo } = {}) => {
    try {
      const res = await fetch(`${API_BASE}/sow/documentnos`);
      const json = await res.json();
      const rows = Array.isArray(json.data) ? json.data : [];
      setDocumentNos(rows);
      const defaultDoc = rows.find((row) => row.default)?.documentno || rows[0]?.documentno || '';
      setCardInfo((prev) => ({
        ...prev,
        documentNo: selectDocumentNo || prev.documentNo || defaultDoc,
      }));
      return rows;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    loadDocumentNos();
  }, [loadDocumentNos]);

  const selectedDoc = useMemo(
    () => documentNos.find((row) => row.documentno === cardInfo.documentNo) || null,
    [documentNos, cardInfo.documentNo]
  );
  const revisionLabel =
    selectedDoc?.revision_no != null && String(selectedDoc.revision_no).trim() !== ''
      ? String(selectedDoc.revision_no)
      : '—';
  const revisionDate = formatRevisionDate(selectedDoc?.revision_date);

  const handleCreateDocumentNo = useCallback(async () => {
    const documentno = newDoc.documentno.trim();
    if (!documentno) {
      toast.error('Document No. wajib diisi');
      return;
    }
    setSavingDoc(true);
    try {
      const res = await fetch(`${API_BASE}/sow/documentnos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentno,
          revision_no: newDoc.revision_no.trim(),
          revision_date: newDoc.revision_date || null,
          default: newDoc.default,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Gagal menyimpan Document No.');
      await loadDocumentNos({ selectDocumentNo: json.data?.documentno || documentno });
      toast.success('Document No. tersimpan');
      setNewDoc({ documentno: '', revision_no: '', revision_date: '', default: false });
      setShowCreateDoc(false);
    } catch (err) {
      toast.error(err.message || 'Gagal menyimpan Document No.');
    } finally {
      setSavingDoc(false);
    }
  }, [newDoc, loadDocumentNos]);

  const handlePrint = useCallback(() => {
    const iframe = printRef.current;
    if (!iframe || printing) return;
    setPrinting(true);
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setPrinting(false);
    }
  }, [printing]);

  const wcData = useWorkcenterData();

  const handleGoToOperationCard = useCallback(() => {
    const keys = editOps.map(makeOperationCardKey);
    setOperationCardKeys((prev) => {
      const valid = prev.filter((key) => keys.includes(key));
      return valid.length > 0 ? valid : keys;
    });
    setActiveOperationKey((prev) => (keys.includes(prev) ? prev : keys[0] || null));
    setActiveStep('operation-card');
  }, [editOps]);

  const handleSelectPart = useCallback((part) => {
    setSelectedPart(part);
    setCheckedOps(new Set());
    setCheckedTemplates(new Set());
    checkedTemplateOpsRef.current.clear();
    setEditOps([]);
    setOperationCardKeys([]);
    setActiveOperationKey(null);
    setOperationCardImages({});
    setCardInfo((prev) => ({
      customer: part?.customer_name || '',
      productionOrder: normalizeProductionOrder(part?.production_order || ''),
      location: part?.customer_site_name || part?.customer_site_location || '',
      ident: part?.ssbr_ident || '',
      documentNo: prev.documentNo || '',
      note: prev.note || '',
    }));
  }, []);

  const handleResolveComponent = useCallback((component) => {
    setSelectedPart((prev) => ({
      ...prev,
      component_id: component.component_id,
      part_name: component.part_name,
      part_number: component.part_number,
      model: component.model,
      resolved_component_id: component.component_id,
    }));
    setCheckedOps(new Set());
    setCheckedTemplates(new Set());
    checkedTemplateOpsRef.current.clear();
    setEditOps([]);
    setOperationCardKeys([]);
    setActiveOperationKey(null);
    setOperationCardImages({});
    toast.success('Master component dipilih. Operasi standar siap dimuat.');
  }, []);

  const handleChooseComponentAgain = useCallback(() => {
    setSelectedPart((prev) =>
      prev
        ? {
            ...prev,
            component_id: null,
            resolved_component_id: null,
          }
        : prev
    );
    setCheckedOps(new Set());
    setCheckedTemplates(new Set());
    checkedTemplateOpsRef.current.clear();
    setEditOps([]);
    setOperationCardKeys([]);
    setActiveOperationKey(null);
    setOperationCardImages({});
  }, []);

  const handleToggle = useCallback((op) => {
    setCheckedOps((prev) => {
      const next = new Set(prev);
      if (next.has(op.id)) next.delete(op.id);
      else next.add(op.id);
      return next;
    });

    setEditOps((prev) => {
      const alreadyIn = prev.some((e) => e._srcId === op.id);
      if (alreadyIn) {
        const filtered = prev.filter((e) => e._srcId !== op.id);
        return renumberByStandardOrder(filtered);
      }
      const appended = [...prev, makeEditEntry(op, 0)];
      return renumberByStandardOrder(appended);
    });
  }, []);

  const handleToggleAll = useCallback((ops, selectAll) => {
    if (selectAll) {
      setCheckedOps(new Set(ops.map((o) => o.id)));
      setEditOps(renumberByStandardOrder(ops.map((op) => makeEditEntry(op, 0))));
    } else {
      setCheckedOps(new Set());
      setEditOps([]);
      setCheckedTemplates(new Set());
      checkedTemplateOpsRef.current.clear();
    }
  }, []);

  const handleToggleTemplate = useCallback((ops, selectAll, templateId) => {
    const templateOps = Array.isArray(ops) ? ops : [];
    if (templateOps.length === 0) return;

    setCheckedTemplates((prev) => {
      const next = new Set(prev);
      if (selectAll) next.add(templateId);
      else next.delete(templateId);
      return next;
    });

    if (selectAll) {
      checkedTemplateOpsRef.current.set(templateId, new Set(templateOps.map((op) => op.id)));
    } else {
      checkedTemplateOpsRef.current.delete(templateId);
    }

    setCheckedOps((prev) => {
      const next = new Set(prev);
      if (selectAll) {
        templateOps.forEach((op) => next.add(op.id));
      } else {
        const remainingTemplateOpIds = new Set();
        checkedTemplateOpsRef.current.forEach((opSet) => {
          opSet.forEach((id) => remainingTemplateOpIds.add(id));
        });
        templateOps.forEach((op) => {
          if (!remainingTemplateOpIds.has(op.id)) {
            next.delete(op.id);
          }
        });
      }
      return next;
    });

    setEditOps((prev) => {
      const entryKey = (entry) => (entry._srcId != null ? `std-${entry._srcId}` : entry._key);
      const bySource = new Map(prev.map((op) => [entryKey(op), op]));
      if (selectAll) {
        templateOps.forEach((op) => {
          const key = `std-${op.id}`;
          if (!bySource.has(key)) bySource.set(key, makeEditEntry(op, 0));
        });
      } else {
        const remainingTemplateOpIds = new Set();
        checkedTemplateOpsRef.current.forEach((opSet) => {
          opSet.forEach((id) => remainingTemplateOpIds.add(id));
        });
        templateOps.forEach((op) => {
          if (!remainingTemplateOpIds.has(op.id)) {
            bySource.delete(`std-${op.id}`);
          }
        });
      }
      return renumberByStandardOrder(Array.from(bySource.values()));
    });
  }, []);

  const handleEdit = useCallback((key, field, value) => {
    setEditOps((prev) =>
      prev.map((op) => (op._key === key ? applyOperationEdit(op, field, value) : op))
    );
  }, []);

  const handleEditDelete = useCallback((key, srcId) => {
    setEditOps((prev) => {
      const filtered = prev.filter((op) => op._key !== key);
      return renumberByStandardOrder(filtered);
    });
    if (srcId != null) {
      setCheckedOps((prev) => {
        const next = new Set(prev);
        next.delete(srcId);
        return next;
      });
    }
  }, []);

  const handleReorder = useCallback((fromKey, toKey) => {
    setEditOps((prev) => {
      const items = [...prev];
      const from = items.findIndex((o) => o._key === fromKey);
      const to = items.findIndex((o) => o._key === toKey);
      if (from < 0 || to < 0) return prev;
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return renumberNormalSequential(items);
    });
  }, []);

  const handleAddOp = useCallback((opData) => {
    setEditOps((prev) => {
      const entry = {
        _key: `new-${Date.now()}`,
        _isNew: true,
        _srcId: null,
        _standardOperationNo: null,
        _insertSeq: Date.now(),
        operation_text: opData.operation_text,
        machineid: opData.machineid,
        std_hours: opData.std_hours,
        va_hours: opData.va_hours ?? opData.std_hours,
        nnva_hours: opData.nnva_hours ?? 0,
        remark: opData.remark || '',
        operation_no: getNextOperationNo(prev, opData),
      };
      const appended = [...prev, entry];
      return renumberByStandardOrder(appended);
    });
  }, []);

  const handleCreate = async () => {
    if (!selectedPart) {
      toast.error('Pilih part terlebih dahulu');
      return;
    }
    if (editOps.length === 0) {
      toast.error('Pilih atau tambahkan minimal 1 proses');
      return;
    }

    setSaving(true);
    try {
      const orderNo = normalizeProductionOrder(
        cardInfo.productionOrder || selectedPart.production_order
      );
      if (!orderNo) {
        toast.error('Production order wajib diisi sebelum Create SOW');
        setShowInfoPanel(true);
        return;
      }

      const payload = {
        component_id: selectedPart.component_id,
        receiving_component_id: selectedPart.receiving_component_id,
        order_no: orderNo,
        production_order: selectedPart.production_order,
        ssbr_id: cardInfo.ident || selectedPart.ssbr_ident,
        part_name: selectedPart.part_name,
        part_number: selectedPart.part_number,
        model: selectedPart.model,
        customer: cardInfo.customer || selectedPart.customer_name,
        location:
          cardInfo.location ||
          selectedPart.customer_site_name ||
          selectedPart.customer_site_location,
        type: selectedPart.part_type,
        group: selectedPart.parent_part_name || selectedPart.part_type,
        operations: editOps.map((op) => ({
          operation_no: op.operation_no,
          operation_text: op.operation_text,
          machineid: op.machineid,

          planhours: op.std_hours !== '' ? parseFloat(op.std_hours) : null,
          va_hours: op.va_hours !== '' && op.va_hours != null ? parseFloat(op.va_hours) : null,
          nnva_hours: op.nnva_hours != null ? parseFloat(op.nnva_hours) : 0,
          remark: op.remark || null,
          source_op_id: op._srcId,
        })),
      };

      const res = await fetch(`${API_BASE}/sow/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Server ${res.status}`);
      }

      const result = await res.json().catch(() => ({}));
      const createdRows = Array.isArray(result.data) ? result.data : [];
      const rowsByOperationNo = new Map(createdRows.map((row) => [String(row.operation_no), row]));
      let savedOperationCards = 0;

      for (const op of editOps) {
        const key = makeOperationCardKey(op);
        const images = operationCardImages[key] || [];
        if (!images.length) continue;

        const createdRow = rowsByOperationNo.get(String(op.operation_no));
        const sowId = createdRow?.idsow;
        if (!sowId) continue;

        const boxImageData = await generateOperationCardBoxImage(images);
        const cardResponse = await fetch(`${API_BASE}/sow/operationcard/${sowId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images,
            card_key: key,
            order_no: orderNo,
            operation_no: op.operation_no,
            revision_no: 'Original',
            box_image_data: boxImageData,
          }),
        });
        if (!cardResponse.ok) {
          const payload = await cardResponse.json().catch(() => ({}));
          throw new Error(payload.error || `Gagal simpan operation card ops ${op.operation_no}`);
        }
        savedOperationCards += 1;
      }

      toast.success(
        `SOW berhasil dibuat${savedOperationCards ? `, ${savedOperationCards} operation card tersimpan` : ''}!`
      );
      discardDraft();

      setSelectedPart(null);
      setCheckedOps(new Set());
      setCheckedTemplates(new Set());
      checkedTemplateOpsRef.current.clear();
      setEditOps([]);
      setOperationCardKeys([]);
      setActiveOperationKey(null);
      setOperationCardImages({});
      setActiveStep('edit');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {}
      <div className="flex-shrink-0 px-4 md:px-6 py-3 bg-white border-b border-slate-200">
        <h2 className="text-sm font-bold text-slate-700">Buat SOW</h2>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Pilih part → centang proses → review &amp; edit → buat SOW
        </p>
      </div>

      {}
      {draftAvailable && (
        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 md:px-6">
          <p className="text-xs font-semibold text-amber-800">
            Draft tersimpan
            {lastSavedAt
              ? ` ${lastSavedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}`
              : ''}{' '}
            — lanjutkan dari sini?
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={restoreDraft}
              className="rounded-lg bg-[#0096c7] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#0077b6]"
            >
              Lanjutkan
            </button>
            <button
              type="button"
              onClick={discardDraft}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Buang
            </button>
          </div>
        </div>
      )}

      {}
      <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50/70">
        <button
          type="button"
          onClick={() => setShowSavedPanel((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-2 md:px-6"
        >
          <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
            Saved SOWs ({savedSows.length})
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 text-slate-400 transition ${showSavedPanel ? 'rotate-180' : ''}`}
          />
        </button>
        {showSavedPanel && (
          <div className="px-4 pb-3 md:px-6">
            <div className="mb-2 flex items-center gap-2">
              <input
                value={savedSearch}
                onChange={(e) => setSavedSearch(e.target.value)}
                placeholder="Cari saved SOW..."
                className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none focus:border-[#0096c7]"
              />
              <button
                type="button"
                onClick={openSaveModal}
                disabled={!selectedPart && editOps.length === 0}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-[#0096c7] px-3 text-xs font-bold text-white hover:bg-[#0077b6] disabled:opacity-40"
              >
                <BookmarkPlus className="h-3.5 w-3.5" /> Save SOW
              </button>
            </div>
            {savedLoading ? (
              <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat...
              </div>
            ) : savedFiltered.length === 0 ? (
              <p className="py-2 text-[11px] text-slate-400">
                Belum ada saved SOW. Buat & simpan SOW dulu lewat tombol Save SOW.
              </p>
            ) : (
              <div className="grid max-h-56 gap-1.5 overflow-y-auto md:grid-cols-2 lg:grid-cols-3">
                {savedFiltered.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                  >
                    {renamingId === row.id ? (
                      <input
                        value={renamingName}
                        onChange={(e) => setRenamingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(row.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        autoFocus
                        className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleLoadSaved(row)}
                        className="min-w-0 flex-1 text-left"
                        title="Load saved SOW ini"
                      >
                        <p className="truncate text-xs font-bold text-slate-700">{row.name}</p>
                        <p className="text-[10px] text-slate-400">
                          <span className="tabular-nums">{row.operation_count}</span> ops ·{' '}
                          {fmtHours(row.total_hours)} hrs
                          {row.created_by ? ` · ${row.created_by}` : ''}
                        </p>
                      </button>
                    )}
                    <div className="flex shrink-0 items-center gap-0.5">
                      {renamingId === row.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleRename(row.id)}
                            title="Simpan nama"
                            className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingId(null)}
                            title="Batal"
                            className="rounded p-1 text-slate-400 hover:bg-slate-100"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingId(row.id);
                              setRenamingName(row.name);
                            }}
                            title="Rename"
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          >
                            <PenLine className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSaved(row)}
                            title="Hapus"
                            className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {}
      {activeStep === 'preview' ? (
        <div className="flex-1 overflow-y-auto">
          <TravelCardPreview
            selectedPart={selectedPart}
            editOps={editOps}
            cardInfo={cardInfo}
            printRef={printRef}
            revisionLabel={revisionLabel}
            revisionDate={revisionDate}
            note={cardInfo.note}
            issuedByName={issuedByName}
            issuedAt={issuedAt}
          />
        </div>
      ) : activeStep === 'operation-card' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <OperationCardPreview
            selectedPart={selectedPart}
            editOps={editOps}
            cardInfo={cardInfo}
            printRef={printRef}
            selectedKeys={operationCardKeys}
            onSelectedKeysChange={setOperationCardKeys}
            activeOperationKey={activeOperationKey}
            onActiveOperationChange={setActiveOperationKey}
            imagesByKey={operationCardImages}
            onImagesByKeyChange={setOperationCardImages}
          />
        </div>
      ) : (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
          {!selectedPart ? (
            <div className="flex-1 min-h-0 overflow-hidden bg-slate-50 p-4">
              <ReceivingComponentTable onSelect={handleSelectPart} />
            </div>
          ) : (
            <>
              {}
              {false && (
                <div
                  className="flex-shrink-0 bg-white
                          border-b border-slate-200 md:border-b-0 md:border-r
                          overflow-y-auto px-4 py-3 md:w-80"
                >
                  <div className="flex items-center gap-1.5 mb-3">
                    <StepBadge n={1} active done={false} />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                      Pilih Receiving Component
                    </span>
                  </div>
                  <PartPanel selected={null} onSelect={handleSelectPart} />
                </div>
              )}

              {}
              <div
                className="flex-shrink-0 bg-white
                     border-b border-slate-200 md:border-b-0 md:border-r
                     md:w-[450px] flex flex-col overflow-hidden
                     max-h-64 md:max-h-none"
              >
                <div className="flex-shrink-0 px-4 py-2.5 border-b border-slate-100">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <StepBadge
                        n={2}
                        active={!!selectedPart && checkedOps.size === 0}
                        done={checkedOps.size > 0}
                      />
                      <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                        Pilih Proses
                      </span>
                    </div>
                    {selectedPart && (
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          onClick={handleChooseComponentAgain}
                          className="flex items-center gap-1 text-[10px] font-semibold
                               text-slate-500 hover:text-[#0096c7] transition-colors
                               min-h-[32px] px-1.5 rounded hover:bg-slate-50"
                        >
                          <Search size={10} />
                          Pilih Component
                        </button>
                        <button
                          onClick={() => handleSelectPart(null)}
                          className="flex items-center gap-1 text-[10px] font-semibold
                               text-slate-400 hover:text-[#0096c7] transition-colors
                               min-h-[32px] px-1.5 rounded hover:bg-slate-50"
                        >
                          <ArrowLeft size={10} />
                          Kembali ke Receiving
                        </button>
                      </div>
                    )}
                  </div>
                  {selectedPart && (
                    <div className="mt-1 flex items-center gap-1.5 min-w-0">
                      <span
                        className="text-[10px] font-bold truncate"
                        style={{ color: '#023e8a' }}
                        title={selectedPart.part_name}
                      >
                        {selectedPart.part_name}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 flex-shrink-0">
                        {selectedPart.part_number}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  <ChecklistPanel
                    componentId={selectedPart?.component_id}
                    selectedPart={selectedPart}
                    checked={checkedOps}
                    checkedTemplates={checkedTemplates}
                    onToggle={handleToggle}
                    onToggleAll={handleToggleAll}
                    onToggleTemplate={handleToggleTemplate}
                    onResolveComponent={handleResolveComponent}
                  />
                </div>
              </div>

              {}
              <div className="flex-1 bg-white flex flex-col overflow-hidden min-h-0">
                <div
                  className="flex-shrink-0 flex items-center justify-between gap-2
                          px-4 py-2.5 border-b border-slate-200"
                >
                  <div className="flex items-center gap-1.5">
                    <StepBadge n={3} active={editOps.length > 0} done={false} />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                      Review &amp; Edit
                    </span>
                  </div>
                  {editOps.length > 0 && (
                    <span className="text-[10px] text-slate-400">
                      <span className="font-semibold text-slate-600">{editOps.length}</span> operasi
                      <span className="ml-2 text-slate-300">· drag untuk reorder</span>
                    </span>
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  <EditPanel
                    editOps={editOps}
                    onEdit={handleEdit}
                    onDelete={handleEditDelete}
                    onReorder={handleReorder}
                    onAdd={handleAddOp}
                    wcData={wcData}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {}
      <div
        className="flex-shrink-0 px-4 md:px-6 py-3 bg-white border-t border-slate-200
                      flex items-center justify-between gap-3 flex-wrap"
      >
        {activeStep === 'edit' ? (
          <>
            {}
            <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0">
              {selectedPart ? (
                <>
                  <span className="font-mono text-slate-400 truncate">
                    {selectedPart.part_number}
                  </span>
                  {editOps.length > 0 && (
                    <span className="font-semibold text-[#0096c7] flex-shrink-0">
                      · {editOps.length} operasi
                    </span>
                  )}
                </>
              ) : (
                <span className="text-slate-400">Belum ada part dipilih</span>
              )}
            </div>
            {}
            <button
              onClick={() => setActiveStep('preview')}
              disabled={!selectedPart || editOps.length === 0}
              className="flex items-center gap-1.5 bg-[#0096c7] hover:bg-[#0077b6] text-white
                         px-4 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95
                         disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Preview Travel Card
              <ArrowRight size={13} />
            </button>
          </>
        ) : (
          <>
            {}
            <button
              onClick={() => setActiveStep(activeStep === 'operation-card' ? 'preview' : 'edit')}
              className="flex items-center gap-1.5 bg-white border border-slate-200
                         text-slate-700 hover:bg-slate-50 hover:border-slate-300
                         px-3 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95"
            >
              <ArrowLeft size={13} />
              {activeStep === 'operation-card' ? 'Back to Travel Card' : 'Back to Edit'}
            </button>
            {}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowInfoPanel(true)}
                className="flex items-center gap-1.5 bg-white border border-slate-200
                           text-slate-700 hover:bg-slate-50 hover:border-slate-300
                           px-3 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95"
              >
                <Info size={13} />
                Add Info
              </button>
              <button
                onClick={handlePrint}
                disabled={
                  printing || (activeStep === 'operation-card' && operationCardKeys.length === 0)
                }
                className="flex items-center gap-1.5 bg-white border border-slate-200
                           text-slate-700 hover:bg-slate-50 hover:border-slate-300
                           px-3 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {printing ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
                {printing ? 'Generating…' : 'Print PDF'}
              </button>
              {activeStep === 'preview' && (
                <button
                  onClick={handleGoToOperationCard}
                  className="flex items-center gap-1.5 bg-[#0096c7] hover:bg-[#0077b6] text-white
                             px-4 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95"
                >
                  Next Operation Card
                  <ArrowRight size={13} />
                </button>
              )}
              {activeStep === 'operation-card' && (
                <>
                  <button
                    onClick={openSaveModal}
                    className="flex items-center gap-1.5 bg-white border border-slate-200
                           text-slate-700 hover:bg-slate-50 hover:border-slate-300
                           px-3 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95"
                  >
                    <BookmarkPlus size={13} />
                    Save SOW
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={saving}
                    className="flex items-center gap-1.5 bg-[#0096c7] hover:bg-[#0077b6] text-white
                           px-4 py-2 rounded-lg text-xs font-semibold transition-all active:scale-95
                           disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    Create SOW
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {}
      {showSaveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShowSaveModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-1 text-sm font-bold text-slate-800">Save SOW</h3>
            <p className="mb-4 text-[11px] text-slate-400">
              Simpan snapshot SOW ini — bisa di-load lagi nanti saat create.
            </p>
            <input
              value={savedName}
              onChange={(e) => setSavedName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveSow();
              }}
              autoFocus
              placeholder="Nama saved SOW"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#0096c7]"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveSow}
                disabled={savingSow}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0096c7] px-3 py-2 text-xs font-bold text-white hover:bg-[#0077b6] disabled:opacity-40"
              >
                {savingSow ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <BookmarkPlus className="h-3.5 w-3.5" />
                )}{' '}
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {}
      {showInfoPanel && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 backdrop-blur-sm px-0 md:px-4"
          onClick={() => setShowInfoPanel(false)}
        >
          <div
            className="bg-white w-full md:max-w-sm rounded-t-2xl md:rounded-2xl shadow-xl p-5 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-800">Informasi Travel Card</h3>
              <button
                onClick={() => setShowInfoPanel(false)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400
                           hover:text-slate-600 hover:bg-slate-100 transition-all"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    Document No.
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowCreateDoc((v) => !v)}
                    className="flex items-center gap-1 text-[10px] font-bold text-[#0096c7] hover:text-[#0077b6] transition-colors"
                  >
                    <Plus size={11} />
                    {showCreateDoc ? 'Tutup' : 'Buat Baru'}
                  </button>
                </div>
                <select
                  value={cardInfo.documentNo || ''}
                  onChange={(e) => setCardInfo((p) => ({ ...p, documentNo: e.target.value }))}
                  className="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800
                             rounded-lg text-sm focus:outline-none
                             focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
                >
                  <option value="">—</option>
                  {documentNos.map((item) => (
                    <option key={item.id || item.documentno} value={item.documentno}>
                      {item.documentno}
                      {item.revision_no ? ` · Rev ${item.revision_no}` : ''}
                      {item.default ? ' (Default)' : ''}
                    </option>
                  ))}
                </select>
                {selectedDoc && (
                  <p className="mt-1 text-[10px] text-slate-400">
                    Rev: {revisionLabel} · Date Rev: {revisionDate}
                  </p>
                )}

                {showCreateDoc && (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 flex flex-col gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Document No. Baru
                    </p>
                    <input
                      type="text"
                      value={newDoc.documentno}
                      onChange={(e) => setNewDoc((p) => ({ ...p, documentno: e.target.value }))}
                      placeholder="Document No. (mis. F-PE-001)"
                      className="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800
                                 placeholder-slate-400 rounded-lg text-sm focus:outline-none
                                 focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newDoc.revision_no}
                        onChange={(e) => setNewDoc((p) => ({ ...p, revision_no: e.target.value }))}
                        placeholder="Revision (mis. 0)"
                        className="flex-1 min-w-0 px-3 py-2 bg-white border border-slate-200 text-slate-800
                                   placeholder-slate-400 rounded-lg text-sm focus:outline-none
                                   focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
                      />
                      <input
                        type="date"
                        value={newDoc.revision_date}
                        onChange={(e) =>
                          setNewDoc((p) => ({ ...p, revision_date: e.target.value }))
                        }
                        className="flex-1 min-w-0 px-3 py-2 bg-white border border-slate-200 text-slate-800
                                   rounded-lg text-sm focus:outline-none
                                   focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                      <input
                        type="checkbox"
                        checked={newDoc.default}
                        onChange={(e) => setNewDoc((p) => ({ ...p, default: e.target.checked }))}
                        className="rounded border-slate-300 text-[#0096c7] focus:ring-[#00b4d8]"
                      />
                      Jadikan default
                    </label>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={handleCreateDocumentNo}
                        disabled={savingDoc}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white
                                   bg-[#0096c7] hover:bg-[#0077b6] rounded-lg transition-all active:scale-95
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {savingDoc ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Plus size={13} />
                        )}
                        Simpan Document No.
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {[
                { key: 'productionOrder', label: 'Production Order', placeholder: '1000XXXXXX' },
                { key: 'customer', label: 'Customer', placeholder: 'PT. ...' },
                { key: 'location', label: 'Location', placeholder: 'BMB / GDG ...' },
                { key: 'ident', label: 'Ident', placeholder: 'e.g. SHCP-331' },
              ].map(({ key, label, placeholder }) => (
                <div key={key}>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">
                    {label}
                  </label>
                  <input
                    type="text"
                    value={cardInfo[key]}
                    onChange={(e) => setCardInfo((p) => ({ ...p, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800
                               placeholder-slate-400 rounded-lg text-sm focus:outline-none
                               focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
                  />
                </div>
              ))}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    Note (footer travel card)
                  </label>
                  <span
                    className={`text-[10px] font-semibold tabular-nums ${
                      (cardInfo.note || '').length >= NOTE_MAX_LENGTH
                        ? 'text-red-500'
                        : 'text-slate-400'
                    }`}
                  >
                    {NOTE_MAX_LENGTH - (cardInfo.note || '').length} tersisa
                  </span>
                </div>
                <textarea
                  rows={3}
                  maxLength={NOTE_MAX_LENGTH}
                  value={cardInfo.note || ''}
                  onChange={(e) =>
                    setCardInfo((p) => ({ ...p, note: e.target.value.slice(0, NOTE_MAX_LENGTH) }))
                  }
                  placeholder="Catatan yang tampil di kolom NOTE footer…"
                  className="w-full px-3 py-2 bg-white border border-slate-200 text-slate-800
                             placeholder-slate-400 rounded-lg text-sm focus:outline-none resize-none
                             focus:ring-2 focus:ring-[#00b4d8] focus:border-[#0096c7] transition-all"
                />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button
                onClick={() => setShowInfoPanel(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-200
                           rounded-lg hover:bg-slate-50 transition-all active:scale-95"
              >
                Batal
              </button>
              <button
                onClick={() => setShowInfoPanel(false)}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#0096c7] hover:bg-[#0077b6]
                           rounded-lg transition-all active:scale-95"
              >
                Terapkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export function makeEditEntry(op, operation_no) {
  const hasHours = op.std_hours != null && op.std_hours !== '';
  const total = Number.parseFloat(op.std_hours);
  const totalHours = Number.isFinite(total) ? total : 0;
  const rawNnva = Number.parseFloat(op.nnva_hours);

  const nnva = Number.isFinite(rawNnva) ? Math.min(Math.max(rawNnva, 0), totalHours) : 0;
  return {
    _key: `std-${op.id}`,
    _isNew: false,
    _srcId: op.id,
    _standardOperationNo: op.operation_no ?? null,
    _insertSeq: op.id ?? 0,
    operation_text: op.operation_text,
    machineid: op.machineid || op.workcenter || '',
    std_hours: op.std_hours ?? '',
    va_hours: hasHours ? totalHours - nnva : '',
    nnva_hours: hasHours ? nnva : 0,
    remark: op.remark ?? '',
    operation_no,
  };
}

export function applyOperationEdit(op, field, value) {
  const next = { ...op, [field]: value };
  if (field === 'va_hours' || field === 'nnva_hours') {
    const va = Number.parseFloat(next.va_hours);
    const nnva = Number.parseFloat(next.nnva_hours);
    next.std_hours = (Number.isFinite(va) ? va : 0) + (Number.isFinite(nnva) ? nnva : 0);
  }
  return next;
}

export default SowCreatePage;
