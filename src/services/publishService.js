'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const {
  sequelize,
  FileTemplate,
  ProcessStep,
  ProcessStepHasFileTemplate,
} = require('../db/models');
const { resolveDraftStore } = require('../db/draftRepository');

function slugify(name) {
  return String(name || 'template')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80) || 'template';
}

async function publishDraft(draftId, { processStepIds, replaceFileTemplateId, mode } = {}) {
  const store = await resolveDraftStore();
  const draft = await store.findActiveById(draftId);
  if (!draft) {
    const err = new Error('Draft not found');
    err.status = 404;
    throw err;
  }
  if (draft.status === 'published') {
    const err = new Error('Already published');
    err.status = 400;
    throw err;
  }

  const stepIds = Array.isArray(processStepIds)
    ? processStepIds.map(Number).filter(Boolean)
    : (draft.process_step_ids_json || []).map(Number).filter(Boolean);

  if (!stepIds.length) {
    const err = new Error('At least one process_step_id is required');
    err.status = 400;
    throw err;
  }

  const steps = await ProcessStep.findAll({
    where: { id: stepIds, is_deleted: false },
    attributes: ['id'],
  });
  if (steps.length !== stepIds.length) {
    const err = new Error('One or more process_step_id not found');
    err.status = 400;
    throw err;
  }

  const publishMode = mode || (replaceFileTemplateId || draft.replace_file_template_id ? 'replace' : 'create');
  const replaceId = replaceFileTemplateId || draft.replace_file_template_id || null;

  if (publishMode === 'replace' && !replaceId) {
    const err = new Error('replace_file_template_id required for replace mode');
    err.status = 400;
    throw err;
  }

  fs.mkdirSync(config.ejsOutputDir, { recursive: true });
  const fileName = `${slugify(draft.name)}_${Date.now()}.ejs`;
  const absoluteEjsPath = path.join(config.ejsOutputDir, fileName);
  fs.writeFileSync(absoluteEjsPath, draft.ejs_content, 'utf8');

  const pathTemplate = `${config.pathTemplatePrefix.replace(/\/$/, '')}/${fileName}`.replace(/\\/g, '/');

  const result = await sequelize.transaction(async (t) => {
    let fileTemplate;

    if (publishMode === 'replace') {
      fileTemplate = await FileTemplate.findOne({
        where: { id: replaceId, is_deleted: false },
        transaction: t,
      });
      if (!fileTemplate) {
        const err = new Error('FileTemplate to replace not found');
        err.status = 404;
        throw err;
      }

      fileTemplate.name = draft.name;
      fileTemplate.description = draft.description || draft.name;
      fileTemplate.path_template = pathTemplate;
      fileTemplate.version = (fileTemplate.version || 1) + 1;
      await fileTemplate.save({ transaction: t });

      await ProcessStepHasFileTemplate.destroy({
        where: { file_template_id: fileTemplate.id },
        transaction: t,
      });
    } else {
      fileTemplate = await FileTemplate.create(
        {
          name: draft.name,
          description: draft.description || draft.name,
          path_template: pathTemplate,
          is_not_signed: false,
          is_esign: false,
          is_signed_for_FATCA: false,
          is_deleted: false,
          is_inactive: false,
          version: 1,
        },
        { transaction: t }
      );
    }

    for (let i = 0; i < stepIds.length; i += 1) {
      await ProcessStepHasFileTemplate.create(
        {
          process_step_id: stepIds[i],
          file_template_id: fileTemplate.id,
          order: i + 1,
          is_begin: i === 0,
        },
        { transaction: t }
      );
    }

    return {
      fileTemplate,
      processStepIds: stepIds,
      absoluteEjsPath,
      pathTemplate,
      mode: publishMode,
    };
  });

  draft.status = 'published';
  draft.process_step_ids_json = stepIds;
  draft.replace_file_template_id = replaceId;
  draft.published_file_template_id = result.fileTemplate.id;
  draft.published_path_template = result.pathTemplate;
  draft.updated_time = new Date();
  await draft.save();

  return { ...result, draft };
}

module.exports = { publishDraft };
