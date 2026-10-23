'use strict';

const fs = require('fs');
const path = require('path');
const { convertDocxBufferToEjs } = require('../src/services/docxToEjs');

/**
 * Builds a minimal DOCX (OOXML zip) with {{customerName}} for smoke tests.
 * Uses only Node built-ins + the `jszip`-free approach via PowerShell Compress-Archive
 * is avoided; we ship a tiny prebuilt buffer written with `zlib` store entries —
 * instead reuse mammoth empty.docx and verify convert path separately if zip build fails.
 */
async function buildMinimalDocx(text) {
  // Prefer dynamic require of jszip if present via mammoth dependency tree
  let JSZip;
  try {
    JSZip = require('jszip');
  } catch {
    JSZip = null;
  }
  if (!JSZip) {
    throw new Error('jszip not available; install mammoth first');
  }

  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.folder('_rels').file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.folder('word').file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Company: ${text}</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function main() {
  const docxBuf = await buildMinimalDocx('{{customerName}}');
  const local = await convertDocxBufferToEjs(docxBuf, { title: 'Smoke' });
  console.log('local_variables', local.variables);
  console.log('local_has_ejs', local.ejsContent.includes('<%= customerName %>'));

  const outPath = path.join(__dirname, '..', 'storage', 'uploads', '_smoke.docx');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, docxBuf);

  const boundary = '----smokeBoundary';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nSmoke DOCX\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="docx"; filename="smoke.docx"\r\n` +
        `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`
    ),
    docxBuf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const base = process.env.SMOKE_BASE || 'http://localhost:4050';
  const res = await fetch(`${base}/api/drafts/upload`, {
    method: 'POST',
    headers: {
      'X-Template-Builder-Key': process.env.SMOKE_API_KEY || 'dev-key-change-me',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  const json = await res.json();
  console.log('upload_status', res.status);
  if (!res.ok) {
    console.log(json);
    process.exit(1);
  }
  console.log('draft_id', json.data.id);
  console.log('variables', json.data.variables_json);

  const models = await fetch(`${base}/api/catalog/models`, {
    headers: { 'X-Template-Builder-Key': process.env.SMOKE_API_KEY || 'dev-key-change-me' },
  });
  const modelsJson = await models.json();
  console.log('models_status', models.status);
  console.log(
    'models_available',
    (modelsJson.data || []).filter((m) => m.available).map((m) => m.name)
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
