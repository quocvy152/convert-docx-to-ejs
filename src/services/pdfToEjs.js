'use strict';

const { PDFDocument } = require('pdf-lib');

function toCamelVar(name, index) {
  const cleaned = String(name || `field_${index}`)
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
  const base = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
  if (!base || !/^[a-zA-Z_]/.test(base)) return `field_${index}`;
  return base;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * MVP converter:
 * - Prefer AcroForm field names → EJS variables
 * - If no fields, emit a scaffold with common placeholders for the user to edit
 */
async function convertPdfBufferToEjs(pdfBuffer, options = {}) {
  const title = options.title || 'Generated Template';
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const fields = form.getFields();

  const variables = [];
  const fieldBlocks = [];

  fields.forEach((field, index) => {
    const rawName = field.getName();
    const varName = toCamelVar(rawName, index + 1);
    variables.push({ name: varName, source: rawName, type: field.constructor?.name || 'PDFField' });
    fieldBlocks.push(`    <div class="field">
      <label>${escapeHtml(rawName)}</label>
      <div class="value"><%= typeof ${varName} !== 'undefined' ? ${varName} : '' %></div>
    </div>`);
  });

  if (variables.length === 0) {
    const defaults = ['companyName', 'directorName', 'signDate', 'address'];
    defaults.forEach((name) => {
      variables.push({ name, source: null, type: 'manual_placeholder' });
      fieldBlocks.push(`    <div class="field">
      <label>${name}</label>
      <div class="value"><%= typeof ${name} !== 'undefined' ? ${name} : '' %></div>
    </div>`);
    });
  }

  const pageCount = pdfDoc.getPageCount();
  const ejsContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: 'Times New Roman', Times, serif; font-size: 14px; line-height: 1.4; margin: 24px; }
    h1 { font-size: 18px; margin-bottom: 16px; }
    .meta { color: #666; font-size: 12px; margin-bottom: 24px; }
    .field { margin-bottom: 12px; }
    .field label { display: block; font-weight: bold; margin-bottom: 4px; }
    .field .value { min-height: 1.2em; border-bottom: 1px solid #333; padding: 2px 0; }
    .hint { margin-top: 32px; padding: 12px; background: #f7f7f7; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">Auto-draft from PDF (${pageCount} page(s)). Review variables before submit.</div>
${fieldBlocks.join('\n')}
  <div class="hint">
    <!-- MVP: layout is a scaffold from AcroForm fields (or defaults). Edit freely, then submit. -->
  </div>
</body>
</html>
`;

  return { ejsContent, variables, pageCount, fieldCount: fields.length };
}

module.exports = { convertPdfBufferToEjs, toCamelVar };
