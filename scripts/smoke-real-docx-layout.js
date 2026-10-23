'use strict';

const fs = require('fs');
const path = require('path');
const { convertDocxBufferToEjs } = require('../src/services/docxToEjs');

async function main() {
  const p = path.join(
    __dirname,
    '..',
    'storage',
    'uploads',
    'd895106a-5ddd-4517-8332-cf849dd05c40.docx'
  );
  if (!fs.existsSync(p)) {
    console.log('skip: sample docx missing');
    return;
  }
  const buf = fs.readFileSync(p);
  const r = await convertDocxBufferToEjs(buf, { title: 'real' });
  console.log('layoutRuleCount', r.layoutRuleCount);
  console.log('has_font_family', /font-family:/.test(r.ejsContent));
  console.log('has_font_size', /font-size:/.test(r.ejsContent));
  console.log('has_text_align', /text-align:/.test(r.ejsContent));
  console.log('has_margin_top_or_bottom', /margin-(top|bottom):/.test(r.ejsContent));
  console.log('has_line_height', /line-height:/.test(r.ejsContent));
  console.log('has_strong', /<strong>/.test(r.ejsContent));
  const styles = [];
  const re = /style="([^"]+)"/g;
  let m;
  while ((m = re.exec(r.ejsContent)) !== null && styles.length < 12) {
    styles.push(m[1]);
  }
  console.log('sample_styles', styles);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
