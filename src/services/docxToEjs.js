'use strict';

const mammoth = require('mammoth');

const MUSTACHE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const EJS_EXPR_RE = /<%[=-]?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*%>/g;
const PARAGRAPH_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

/** Word twips → CSS px at 96dpi (1 inch = 1440 twips = 96px). */
function twipsToPx(twips) {
  if (twips == null || twips === '') return null;
  const n = parseInt(String(twips), 10);
  if (!Number.isFinite(n) || n === 0) return null;
  return Math.round((n / 1440) * 96 * 100) / 100;
}

function normalizeTextAlign(alignment) {
  if (!alignment) return null;
  const v = String(alignment).toLowerCase();
  if (v === 'center' || v === 'centre') return 'center';
  if (v === 'right' || v === 'end') return 'right';
  if (v === 'both' || v === 'justify' || v === 'distribute') return 'justify';
  return null;
}

function headingTagFor(paragraph) {
  const name = String(paragraph.styleName || '');
  const id = String(paragraph.styleId || '');
  const fromName = name.match(/^heading\s*([1-6])$/i);
  if (fromName) return `h${fromName[1]}`;
  const fromId = id.match(/^heading([1-6])$/i);
  if (fromId) return `h${fromId[1]}`;
  return null;
}

function attr(xml, name) {
  const re = new RegExp(`(?:w:)?${name}="([^"]*)"`, 'i');
  const m = String(xml || '').match(re);
  return m ? m[1] : null;
}

function paragraphPropertiesXml(paragraphXml) {
  const m = String(paragraphXml).match(/<w:pPr\b[^>]*\/>|<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/);
  return m ? m[0] : '';
}

/** Skip paragraphs mammoth drops (track-changes delete). */
function isDeletedParagraph(paragraphXml) {
  const pPr = paragraphPropertiesXml(paragraphXml);
  return /<w:del\b/.test(pPr);
}

function spacingCssFromPpr(pPrXml) {
  const spacingTag = String(pPrXml).match(/<w:spacing\b[^>]*\/?>/);
  if (!spacingTag) return '';
  const tag = spacingTag[0];
  const parts = [];
  const before = twipsToPx(attr(tag, 'before'));
  const after = twipsToPx(attr(tag, 'after'));
  if (before != null) parts.push(`margin-top: ${before}px`);
  if (after != null) parts.push(`margin-bottom: ${after}px`);

  const line = attr(tag, 'line');
  if (line != null && line !== '') {
    const lineVal = parseInt(line, 10);
    if (Number.isFinite(lineVal) && lineVal > 0) {
      const rule = (attr(tag, 'lineRule') || 'auto').toLowerCase();
      if (rule === 'exact' || rule === 'atleast') {
        parts.push(`line-height: ${lineVal / 20}pt`);
      } else {
        parts.push(`line-height: ${Math.round((lineVal / 240) * 1000) / 1000}`);
      }
    }
  }
  return parts.join('; ');
}

/**
 * Paragraph extras mammoth does not expose (spacing). Order = document.xml `w:p` order
 * (depth-first through tables), matching mammoth's walk when deletions are skipped.
 */
async function extractParagraphExtras(docxBuffer) {
  let JSZip;
  try {
    JSZip = require('jszip');
  } catch {
    return [];
  }
  const zip = await JSZip.loadAsync(docxBuffer);
  const file = zip.file('word/document.xml');
  if (!file) return [];
  const xml = await file.async('string');
  const blocks = xml.match(PARAGRAPH_RE) || [];
  const extras = [];
  for (const block of blocks) {
    if (isDeletedParagraph(block)) continue;
    const pPr = paragraphPropertiesXml(block);
    extras.push({
      spacingCss: spacingCssFromPpr(pPr),
    });
  }
  return extras;
}

function paragraphLayoutCss(paragraph, extra = {}) {
  const parts = [];
  const align = normalizeTextAlign(paragraph.alignment);
  if (align) parts.push(`text-align: ${align}`);

  const indent = paragraph.indent || {};
  const marginLeft = twipsToPx(indent.start);
  const marginRight = twipsToPx(indent.end);
  if (marginLeft != null) parts.push(`margin-left: ${marginLeft}px`);
  if (marginRight != null) parts.push(`margin-right: ${marginRight}px`);

  const firstLine = twipsToPx(indent.firstLine);
  const hanging = twipsToPx(indent.hanging);
  if (firstLine != null) {
    parts.push(`text-indent: ${firstLine}px`);
  } else if (hanging != null) {
    parts.push(`text-indent: ${-hanging}px`);
  }

  if (extra.spacingCss) parts.push(extra.spacingCss);
  return parts.filter(Boolean).join('; ');
}

function runTypographyCss(run) {
  const parts = [];
  if (run.font) {
    const safe = String(run.font).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    parts.push(`font-family: '${safe}', sans-serif`);
  }
  if (run.fontSize != null && Number.isFinite(Number(run.fontSize))) {
    parts.push(`font-size: ${run.fontSize}pt`);
  }
  return parts.join('; ');
}

function escapeStyleMapValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Mammoth parses font/size/align/indent but only emits semantic tags (strong/em).
 * Two-pass: collect layout → synthetic style names → styleMap with inline CSS.
 * Spacing comes from a parallel OOXML pass (mammoth does not expose w:spacing).
 */
function createStylePreservingOptions(paragraphExtras) {
  /** @type {Map<string, { styleName: string, styleId: string, css: string, tag: string, kind: 'p'|'r' }>} */
  const byKey = new Map();
  let paragraphIndex = 0;

  function register(kind, styleNameBase, styleIdBase, css, tag) {
    const key = `${kind}\0${styleNameBase || ''}\0${styleIdBase || ''}\0${css}\0${tag}`;
    let entry = byKey.get(key);
    if (!entry) {
      const token = `S${byKey.size}`;
      entry = {
        kind,
        styleName: styleNameBase ? `${styleNameBase}__S__${token}` : `__S__${token}`,
        styleId: styleIdBase ? `${styleIdBase}__S__${token}` : token,
        css,
        tag,
      };
      byKey.set(key, entry);
    }
    return entry;
  }

  function transformParagraph(paragraph) {
    const extra = paragraphExtras[paragraphIndex++] || {};
    const css = paragraphLayoutCss(paragraph, extra);
    if (!css) return paragraph;
    const tag = headingTagFor(paragraph) || 'p';
    const entry = register('p', paragraph.styleName, paragraph.styleId, css, tag);
    return {
      ...paragraph,
      styleName: entry.styleName,
      styleId: entry.styleId,
    };
  }

  function transformRun(run) {
    const css = runTypographyCss(run);
    if (!css) return run;
    const entry = register('r', run.styleName, run.styleId, css, 'span');
    return {
      ...run,
      styleName: entry.styleName,
      styleId: entry.styleId,
    };
  }

  function buildStyleMap() {
    return [...byKey.values()].map(({ kind, styleName, css, tag }) => {
      const left = kind === 'r' ? 'r' : 'p';
      return `${left}[style-name='${escapeStyleMapValue(styleName)}'] => ${tag}[style='${escapeStyleMapValue(css)}']:fresh`;
    });
  }

  function resetParagraphIndex() {
    paragraphIndex = 0;
  }

  const transformDocument = (document) => {
    const withRuns = mammoth.transforms.run(transformRun)(document);
    return mammoth.transforms.paragraph(transformParagraph)(withRuns);
  };

  return {
    transformDocument,
    collectStyleMap: buildStyleMap,
    resetParagraphIndex,
    getRuleCount: () => byKey.size,
  };
}

const COLLECTION_MARKER_TEXT_RE = /^\{\{#\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/;
const COLLECTION_FIELD_RE = /\{\{\s*(\.|item|[a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const LEFTOVER_COLLECTION_MARKER_RE = /\{\{#\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\}\}/;

function stripHtmlToText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractVariableNames(html) {
  const names = new Set();
  const text = String(html || '');
  for (const re of [MUSTACHE_RE, EJS_EXPR_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(text)) !== null) {
      names.add(match[1]);
    }
  }
  return [...names];
}

function mustacheToEjs(html) {
  return String(html || '').replace(MUSTACHE_RE, (_full, name) => `<%= ${name} %>`);
}

/**
 * Table-first arrays: paragraph `{{#collection}}` immediately above a <table>
 * with exactly one sample data row of {{field}} markers.
 * Markers in that row become item.* only (no globals in loop scope).
 */
function transformCollectionTable(tableHtml, collectionName) {
  const trMatches = [...String(tableHtml).matchAll(/<tr\b[\s\S]*?<\/tr>/gi)];
  const rowsWithMarkers = trMatches.filter((tr) => /\{\{/.test(tr[0]));

  if (!rowsWithMarkers.length) {
    return {
      error: `Collection "{{#${collectionName}}}" table has no {{field}} markers in a row`,
    };
  }
  if (rowsWithMarkers.length > 1) {
    return {
      error: `Collection "{{#${collectionName}}}" must have exactly one sample data row (found ${rowsWithMarkers.length})`,
    };
  }

  const sampleRow = rowsWithMarkers[0][0];
  /** @type {string[]} */
  const itemFields = [];
  let hasStringItem = false;
  let hasObjectField = false;

  const convertedRow = sampleRow.replace(COLLECTION_FIELD_RE, (_full, field) => {
    if (field === '.' || field === 'item') {
      hasStringItem = true;
      return '<%= item %>';
    }
    hasObjectField = true;
    itemFields.push(field);
    return `<%= item.${field} %>`;
  });

  if (/\{\{/.test(convertedRow)) {
    return {
      error: `Collection "{{#${collectionName}}}" sample row has invalid markers (only {{field}}, {{item}}, or {{.}} allowed)`,
    };
  }
  if (hasStringItem && hasObjectField) {
    return {
      error: `Collection "{{#${collectionName}}}" cannot mix {{.}}/{{item}} with object fields`,
    };
  }

  const loopOpen = `<% (${collectionName} || []).forEach(function (item) { %>`;
  const loopClose = '<% }) %>';
  const transformedTable = String(tableHtml).replace(
    sampleRow,
    `${loopOpen}${convertedRow}${loopClose}`
  );

  return {
    transformedTable,
    itemFields: [...new Set(itemFields)],
    itemKind: hasStringItem ? 'string' : 'object',
  };
}

function transformCollectionTables(html) {
  /** @type {{ name: string, itemFields: string[], itemKind: 'object'|'string' }[]} */
  const collections = [];
  /** @type {string[]} */
  const errors = [];

  // pInner must not cross </p> (non-greedy [\s\S]*? still backtracks across paragraphs
  // until </p> immediately before <table>, swallowing earlier paragraphs).
  const re = /<p(\s[^>]*)?>((?:(?!<\/p>)[\s\S])*)<\/p>\s*(<table\b[\s\S]*?<\/table>)/gi;
  const out = String(html || '').replace(re, (full, _pAttrs, pInner, tableHtml) => {
    const text = stripHtmlToText(pInner);
    const marker = text.match(COLLECTION_MARKER_TEXT_RE);
    if (!marker) return full;

    const collectionName = marker[1];
    if (collections.some((c) => c.name === collectionName)) {
      errors.push(`Duplicate collection marker "{{#${collectionName}}}"`);
      return full;
    }

    const result = transformCollectionTable(tableHtml, collectionName);
    if (result.error) {
      errors.push(result.error);
      return full;
    }

    collections.push({
      name: collectionName,
      itemFields: result.itemFields,
      itemKind: result.itemKind,
    });
    return result.transformedTable;
  });

  if (LEFTOVER_COLLECTION_MARKER_RE.test(out)) {
    errors.push(
      'Collection marker {{#name}} must be a paragraph immediately above a table (and only that marker in the paragraph)'
    );
  }

  if (errors.length) {
    const err = new Error(errors.join('; '));
    err.status = 400;
    throw err;
  }

  return { html: out, collections };
}

function buildVariablesFromHtml(html, collections) {
  const scalarNames = extractVariableNames(html).filter((n) => n !== 'item');
  const collectionNames = new Set((collections || []).map((c) => c.name));

  const scalars = scalarNames
    .filter((name) => !collectionNames.has(name))
    .map((name) => ({
      name,
      kind: 'scalar',
      model: null,
      field: null,
    }));

  const collectionVars = (collections || []).map((c) => ({
    name: c.name,
    kind: 'collection',
    itemKind: c.itemKind,
    model: null,
    field: null,
    itemFields:
      c.itemKind === 'string'
        ? []
        : c.itemFields.map((fieldName) => ({
            name: fieldName,
            field: null,
          })),
  }));

  return [...scalars, ...collectionVars];
}

/**
 * HTML collapses runs of spaces/tabs and empty block boxes. Word authors use both
 * for vertical gaps and alignment padding — map them to &nbsp; so PDF/HTML keep them.
 */
function encodeTextWhitespace(text) {
  return String(text || '')
    .replace(/\t/g, '\u00A0\u00A0\u00A0\u00A0')
    .replace(/ {2,}/g, (run) => '\u00A0'.repeat(run.length))
    .replace(/\u00A0/g, '&nbsp;');
}

function preserveSignificantWhitespace(html) {
  const s = String(html || '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '<') {
      const close = s.indexOf('>', i);
      if (close === -1) {
        out += s.slice(i);
        break;
      }
      out += s.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== '<') j += 1;
    out += encodeTextWhitespace(s.slice(i, j));
    i = j;
  }

  // Empty paragraphs (blank lines in Word) need a line box or they collapse.
  return out.replace(/<(p|h[1-6]|li|td|th)(\s[^>]*)?>\s*<\/\1>/gi, '<$1$2>&nbsp;</$1>');
}

const BLOCK_TAG_RE =
  /^(?:p|h[1-6]|div|table|thead|tbody|tfoot|tr|ul|ol|li|section|header|footer|article|blockquote)$/i;
const VOID_TAG_RE = /^(?:br|hr|img|input|meta|link)$/i;

function prettyPrintHtml(html) {
  const raw = String(html || '').trim();
  if (!raw) return '';

  /** @type {string[]} */
  const tokens = [];
  const re = /(<[^>]+>)|([^<]+)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    tokens.push(m[0]);
  }

  let depth = 0;
  const lines = [];

  for (const token of tokens) {
    if (token.startsWith('<')) {
      const closeMatch = token.match(/^<\/\s*([a-z0-9]+)/i);
      const openMatch = !closeMatch && token.match(/^<\s*([a-z0-9]+)/i);
      const tagName = (closeMatch || openMatch)?.[1] || '';
      const isBlock = BLOCK_TAG_RE.test(tagName);
      const isVoid = VOID_TAG_RE.test(tagName) || /\/>$/.test(token);
      const isClose = Boolean(closeMatch);

      if (isBlock && isClose) depth = Math.max(0, depth - 1);

      if (isBlock) {
        lines.push(`${'  '.repeat(depth)}${token.trim()}`);
      } else if (lines.length === 0) {
        lines.push(`${'  '.repeat(depth)}${token}`);
      } else {
        lines[lines.length - 1] += token;
      }

      if (isBlock && openMatch && !isClose && !isVoid) depth += 1;
      continue;
    }

    const text = token.replace(/^\s+|\s+$/g, (ws) => (ws ? ' ' : ''));
    if (!text) continue;
    if (lines.length === 0) {
      lines.push(`${'  '.repeat(depth)}${text}`);
    } else {
      lines[lines.length - 1] += text;
    }
  }

  return lines.join('\n');
}

function wrapEjsDocument(bodyHtml, title) {
  const safeTitle = String(title || 'Template').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const indentedBody = String(bodyHtml || '')
    .split('\n')
    .map((line) => (line.length ? `    ${line}` : line))
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle}</title>
  <style>
    /* PDF page box — matches production Board Resolutions chrome. */
    @page {
      size: A4;
      margin: 25mm;
    }
    body {
      font-family: "Times New Roman", Times, serif;
      font-size: 11pt;
      color: #000;
      background: #fff;
      margin: 0;
      line-height: 1.7;
    }
    .page {
      max-width: 210mm;
      margin: 0 auto;
      box-sizing: border-box;
    }
    /* HTML preview: mirror @page margin. Print/PDF uses @page only (avoid double inset). */
    @media screen {
      body {
        padding: 25mm;
      }
    }
    @media print {
      body {
        padding: 0;
      }
    }
    /* Per-paragraph typography/spacing/alignment still come from DOCX inline styles. */
    p, h1, h2, h3, h4, h5, h6 {
      margin: 0 0 0.25em;
    }
    p:empty {
      min-height: 1em;
    }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ccc; padding: 4px 8px; vertical-align: top; }
    td p, th p { margin: 0; }
    img { max-width: 100%; }
  </style>
</head>
<body>
  <div class="page">
${indentedBody}
  </div>
</body>
</html>
`;
}

/**
 * Convert DOCX buffer → EJS HTML.
 * - `{{var}}` → `<%= var %>`
 * - Paragraph `{{#collection}}` immediately above a table → forEach over one sample row
 *   (`<%= item.field %>` / `<%= item %>`); globals forbidden inside that row.
 * Preserves (best-effort, pure Node): font, size, bold/italic (mammoth), spacing, alignment, indent,
 * significant spaces/tabs, and empty paragraph gaps. Output body is pretty-printed.
 */
async function convertDocxBufferToEjs(docxBuffer, options = {}) {
  const paragraphExtras = await extractParagraphExtras(docxBuffer);
  const styleOpts = createStylePreservingOptions(paragraphExtras);
  const input = { buffer: docxBuffer };

  const convertOnce = async (styleMap) => {
    styleOpts.resetParagraphIndex();
    return mammoth.convertToHtml(input, {
      transformDocument: styleOpts.transformDocument,
      styleMap: styleMap || [],
      ignoreEmptyParagraphs: false,
    });
  };

  // Pass 1: discover style signatures (HTML discarded)
  await convertOnce([]);
  const styleMap = styleOpts.collectStyleMap();

  // Pass 2: emit HTML with inline typography / spacing / alignment
  const result = await convertOnce(styleMap);

  const { html: withCollections, collections } = transformCollectionTables(result.value || '');
  const bodyWithEjs = prettyPrintHtml(
    preserveSignificantWhitespace(mustacheToEjs(withCollections))
  );
  const variables = buildVariablesFromHtml(bodyWithEjs, collections);
  const ejsContent = wrapEjsDocument(bodyWithEjs, options.title);

  return {
    ejsContent,
    variables,
    warnings: result.messages || [],
    layoutRuleCount: styleMap.length,
  };
}

module.exports = {
  convertDocxBufferToEjs,
  mustacheToEjs,
  extractVariableNames,
  transformCollectionTables,
  transformCollectionTable,
  buildVariablesFromHtml,
  paragraphLayoutCss,
  runTypographyCss,
  twipsToPx,
  normalizeTextAlign,
  extractParagraphExtras,
  preserveSignificantWhitespace,
  prettyPrintHtml,
  encodeTextWhitespace,
};
