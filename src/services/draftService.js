'use strict';

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const config = require('../config');
const { resolveDraftStore } = require('../db/draftRepository');
const { convertDocxBufferToEjs } = require('./docxToEjs');

function ensureDirs() {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

async function createDraftFromDocx({ file, name, description, createdBy }) {
  ensureDirs();
  const id = uuidv4();
  const docxPath = path.join(config.uploadsDir, `${id}.docx`);
  fs.writeFileSync(docxPath, file.buffer);

  const { ejsContent, variables } = await convertDocxBufferToEjs(file.buffer, {
    title: name || file.originalname || 'Untitled template',
  });

  const store = await resolveDraftStore();
  const draft = await store.create({
    id,
    name: name || path.parse(file.originalname || 'template').name,
    description: description || '',
    status: 'draft',
    // Reuse column for source path (DOCX); name kept for schema compatibility
    original_pdf_path: docxPath,
    ejs_content: ejsContent,
    variables_json: variables,
    process_step_ids_json: [],
    created_by: createdBy || null,
    is_deleted: false,
  });

  return draft;
}

async function listDrafts() {
  const store = await resolveDraftStore();
  return store.findAllActive();
}

async function getDraft(id) {
  const store = await resolveDraftStore();
  const draft = await store.findActiveById(id);
  if (!draft) {
    const err = new Error('Draft not found');
    err.status = 404;
    throw err;
  }
  return draft;
}

async function updateDraft(id, payload) {
  const draft = await getDraft(id);
  if (draft.status === 'published') {
    const err = new Error('Draft already published to FileTemplate');
    err.status = 400;
    throw err;
  }

  const allowed = ['name', 'description', 'ejs_content', 'variables_json', 'process_step_ids_json', 'replace_file_template_id'];
  for (const key of allowed) {
    if (payload[key] !== undefined) {
      draft[key] = payload[key];
    }
  }
  // Re-export allowed after remapping
  if (draft.status === 'exported' && payload.variables_json !== undefined) {
    draft.status = 'draft';
  }
  draft.updated_time = new Date();
  await draft.save();
  return draft;
}

async function searchFileTemplates(q) {
  const { FileTemplate } = require('../db/models');
  const where = { is_deleted: false };
  if (q) {
    where[Op.or] = [
      { name: { [Op.like]: `%${q}%` } },
      { description: { [Op.like]: `%${q}%` } },
    ];
  }
  return FileTemplate.findAll({
    where,
    attributes: ['id', 'name', 'description', 'path_template', 'version', 'is_inactive'],
    order: [['id', 'DESC']],
    limit: 50,
  });
}

async function listProcessSteps(q) {
  const { ProcessStep } = require('../db/models');
  const where = { is_deleted: false };
  if (q) {
    where[Op.or] = [
      { name: { [Op.like]: `%${q}%` } },
      { description: { [Op.like]: `%${q}%` } },
      { description_display: { [Op.like]: `%${q}%` } },
    ];
  }
  return ProcessStep.findAll({
    where,
    attributes: ['id', 'name', 'description', 'description_display', 'process_step_type_id', 'order'],
    order: [['id', 'ASC']],
    limit: 200,
  });
}

module.exports = {
  createDraftFromDocx,
  listDrafts,
  getDraft,
  updateDraft,
  searchFileTemplates,
  listProcessSteps,
};
