'use strict';

/**
 * Local smoke: paragraph {{#collection}} above a Word table → EJS forEach + item fields.
 */
const { convertDocxBufferToEjs, transformCollectionTables } = require('../src/services/docxToEjs');

async function buildCollectionDocx() {
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
  zip.folder('word').file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>Company {{companyName}}</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>{{#directors}}</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Passport</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>{{name}}</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>{{passport}}</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

function unitTransformChecks() {
  const html = `<p>Company {{companyName}}</p><p>{{#directors}}</p><table><tr><td><p>Name</p></td><td><p>Passport</p></td></tr><tr><td><p>{{name}}</p></td><td><p>{{passport}}</p></td></tr></table>`;
  const { html: out, collections } = transformCollectionTables(html);
  return [
    ['unit_collection_name', collections[0] && collections[0].name === 'directors'],
    ['unit_item_fields', collections[0] && collections[0].itemFields.join(',') === 'name,passport'],
    ['unit_foreach', out.includes('directors || []).forEach')],
    ['unit_item_name', out.includes('<%= item.name %>')],
    ['unit_item_passport', out.includes('<%= item.passport %>')],
    ['unit_marker_removed', !out.includes('{{#directors}}')],
    ['unit_scalar_kept', out.includes('{{companyName}}')],
  ];
}

async function main() {
  const checks = [...unitTransformChecks()];

  const docxBuf = await buildCollectionDocx();
  const { ejsContent, variables } = await convertDocxBufferToEjs(docxBuf, {
    title: 'Collection smoke',
  });

  const directors = variables.find((v) => v.name === 'directors');
  const company = variables.find((v) => v.name === 'companyName');

  checks.push(
    ['ejs_scalar', ejsContent.includes('<%= companyName %>')],
    ['ejs_foreach', /directors\s*\|\|\s*\[\]\)\.forEach/.test(ejsContent)],
    ['ejs_item_name', ejsContent.includes('<%= item.name %>')],
    ['ejs_item_passport', ejsContent.includes('<%= item.passport %>')],
    ['ejs_no_global_in_row', !/forEach[\s\S]*<%= companyName %>/.test(ejsContent)],
    ['var_scalar', company && company.kind === 'scalar'],
    ['var_collection', directors && directors.kind === 'collection'],
    [
      'var_item_fields',
      directors &&
        directors.itemFields.map((f) => f.name).sort().join(',') === 'name,passport',
    ],
    ['var_no_flat_name', !variables.some((v) => v.kind === 'scalar' && v.name === 'name')],
    ['var_no_flat_passport', !variables.some((v) => v.kind === 'scalar' && v.name === 'passport')]
  );

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(ok ? 'PASS' : 'FAIL', name);
    if (!ok) failed += 1;
  }

  if (failed) {
    console.log('--- ejs snippet ---');
    console.log(ejsContent.slice(0, 2500));
    console.log('--- variables ---');
    console.log(JSON.stringify(variables, null, 2));
    process.exit(1);
  }
  console.log('ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
