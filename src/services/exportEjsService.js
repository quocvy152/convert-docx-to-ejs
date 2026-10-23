'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getAllowedModel } = require('../config/modelAllowlist');
const { resolveDraftStore } = require('../db/draftRepository');

function slugify(name) {
  return (
    String(name || 'template')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 80) || 'template'
  );
}

function normalizeVariables(variablesJson) {
  if (!Array.isArray(variablesJson)) return [];
  return variablesJson.map((v) => ({
    name: v.name,
    model: v.model || null,
    field: v.field || null,
  }));
}

function assertFullyMapped(variables) {
  if (!variables.length) {
    return; // no placeholders — allow export of static EJS
  }
  const missing = variables.filter((v) => !v.model || !v.field);
  if (missing.length) {
    const err = new Error(
      `Map all variables before export. Unmapped: ${missing.map((v) => v.name).join(', ')}`
    );
    err.status = 400;
    err.unmapped = missing.map((v) => v.name);
    throw err;
  }
  for (const v of variables) {
    if (!getAllowedModel(v.model)) {
      const err = new Error(`Variable "${v.name}" mapped to non-allowlisted model: ${v.model}`);
      err.status = 400;
      throw err;
    }
  }
}

/**
 * Write EJS file only (no FileTemplate / process_step binding).
 */
async function exportDraftEjs(draftId) {
  const store = await resolveDraftStore();
  const draft = await store.findActiveById(draftId);
  if (!draft) {
    const err = new Error('Draft not found');
    err.status = 404;
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

  draft.status = 'exported';
  draft.published_path_template = relativePath;
  draft.updated_time = new Date();
  await draft.save();

  return {
    absoluteEjsPath,
    pathTemplate: relativePath,
    fileName,
    variables,
    draft,
  };
}

module.exports = {
  exportDraftEjs,
  assertFullyMapped,
  normalizeVariables,
};
