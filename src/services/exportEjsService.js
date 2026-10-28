'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const {
  normalizeVariables,
  assertFullyMapped,
} = require('./pathMappingService');

function slugify(name) {
  return (
    String(name || 'template')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80) || 'template'
  );
}

/**
 * Write EJS file only (no FileTemplate / process_step binding).
 * Accepts a client-supplied draft payload — server does not load/persist drafts.
 */
async function exportDraftEjs(draftInput) {
  const draft =
    draftInput && typeof draftInput === 'object' && !Array.isArray(draftInput)
      ? draftInput
      : null;
  if (!draft || draft.ejs_content == null) {
    const err = new Error('Draft payload with ejs_content is required');
    err.status = 400;
    throw err;
  }

  const variables = normalizeVariables(draft.variables_json);
  assertFullyMapped(variables);

  if (!draft.ejs_content || !String(draft.ejs_content).trim()) {
    const err = new Error('Draft has empty EJS content');
    err.status = 400;
    throw err;
  }

  fs.mkdirSync(config.ejsOutputDir, { recursive: true });
  const fileName = `${slugify(draft.name)}_${Date.now()}.ejs`;
  const absoluteEjsPath = path.join(config.ejsOutputDir, fileName);
  fs.writeFileSync(absoluteEjsPath, draft.ejs_content, 'utf8');

  const relativePath = `${config.pathTemplatePrefix.replace(/\/$/, '')}/${fileName}`;
  const exported = {
    ...draft,
    status: 'exported',
    published_path_template: relativePath,
    updated_time: new Date().toISOString(),
  };

  return {
    absoluteEjsPath,
    pathTemplate: relativePath,
    fileName,
    variables,
    draft: exported,
  };
}

module.exports = {
  exportDraftEjs,
  assertFullyMapped,
  normalizeVariables,
};
