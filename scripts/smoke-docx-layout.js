'use strict';

/**
 * Local smoke: DOCX typography + spacing + alignment must survive as inline CSS in EJS.
 */
const { convertDocxBufferToEjs, twipsToPx } = require('../src/services/docxToEjs');

async function buildStyledDocx() {
  const JSZip = require('jszip');
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
  // sz=28 → 14pt; left indent 720 twips → 48px; spacing after 200 twips
  zip.folder('word').file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:jc w:val="center"/>
        <w:spacing w:after="200" w:line="360" w:lineRule="auto"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>
          <w:b/>
          <w:sz w:val="28"/>
        </w:rPr>
        <w:t>Centered Title {{customerName}}</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr><w:ind w:left="720"/></w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Arial"/>
          <w:i/>
          <w:sz w:val="22"/>
        </w:rPr>
        <w:t>Indented italic body</w:t>
      </w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function main() {
  const expectedIndentPx = twipsToPx(720);
  const expectedAfterPx = twipsToPx(200);
  const docxBuf = await buildStyledDocx();
  const { ejsContent, variables, layoutRuleCount } = await convertDocxBufferToEjs(docxBuf, {
    title: 'Style smoke',
  });

  const checks = [
    ['ejs_var', ejsContent.includes('<%= customerName %>')],
    ['var_list', variables.some((v) => v.name === 'customerName')],
    ['font_times', /font-family:\s*'Times New Roman'/.test(ejsContent)],
    ['font_size_14', /font-size:\s*14pt/.test(ejsContent)],
    ['font_size_11', /font-size:\s*11pt/.test(ejsContent)],
    ['bold', /<strong>/.test(ejsContent)],
    ['italic', /<em>/.test(ejsContent)],
    ['text_align_center', /text-align:\s*center/.test(ejsContent)],
    ['margin_left', ejsContent.includes(`margin-left: ${expectedIndentPx}px`)],
    ['margin_bottom', ejsContent.includes(`margin-bottom: ${expectedAfterPx}px`)],
    ['line_height', /line-height:\s*1\.5/.test(ejsContent)],
    ['layout_rules', layoutRuleCount >= 2],
  ];

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(ok ? 'PASS' : 'FAIL', name);
    if (!ok) failed += 1;
  }

  if (failed) {
    console.log('--- ejs snippet ---');
    console.log(ejsContent.slice(0, 2000));
    process.exit(1);
  }
  console.log('layout_rule_count', layoutRuleCount);
  console.log('ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
