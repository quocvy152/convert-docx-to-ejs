'use strict';

const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

async function main() {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([400, 200]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText('MVP smoke form', { x: 40, y: 140, size: 18, font });
  const form = pdfDoc.getForm();
  const field = form.createTextField('companyName');
  field.setText('');
  field.addToPage(page, { x: 40, y: 100, width: 200, height: 24 });
  const bytes = await pdfDoc.save();
  const pdfPath = path.join(__dirname, '..', 'storage', 'uploads', '_smoke.pdf');
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
  fs.writeFileSync(pdfPath, bytes);

  const boundary = '----smokeBoundary';
  const name = 'MVP Smoke Template';
  const fileBuf = fs.readFileSync(pdfPath);
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${name}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="pdf"; filename="smoke.pdf"\r\nContent-Type: application/pdf\r\n\r\n`
    ),
    fileBuf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const res = await fetch('http://localhost:4050/api/drafts/upload', {
    method: 'POST',
    headers: {
      'X-Template-Builder-Key': 'dev-key-change-me',
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
  console.log('draft_status', json.data.status);
  console.log('variables', json.data.variables_json);

  const catalog = await fetch('http://localhost:4050/api/catalog/process-steps?q=', {
    headers: { 'X-Template-Builder-Key': 'dev-key-change-me' },
  });
  const catalogJson = await catalog.json();
  console.log('catalog_status', catalog.status);
  console.log('process_steps_sample', (catalogJson.data || []).slice(0, 3).map((s) => ({ id: s.id, name: s.name })));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
