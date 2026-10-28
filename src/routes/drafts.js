'use strict';

const express = require('express');
const multer = require('multer');
const draftService = require('../services/draftService');
const { exportDraftEjs } = require('../services/exportEjsService');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const okMime =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.mimetype === 'application/msword' ||
      file.mimetype === 'application/octet-stream';
    if (!okMime && !name.endsWith('.docx')) {
      return cb(new Error('Only DOCX files are allowed'));
    }
    return cb(null, true);
  },
});

/** Drafts are client-local; these routes remain as soft 410 so old clients fail clearly. */
router.get('/', async (_req, res) => {
  return res.status(410).json({
    error: 'Drafts are stored on the client only',
    hint: 'Connect Documents/convert-ejs-tool in the UI and list local JSON files',
  });
});

router.get('/:id', async (_req, res) => {
  return res.status(410).json({
    error: 'Drafts are stored on the client only',
  });
});

/** Convert DOCX → draft payload (not persisted on server). */
router.post('/upload', upload.single('docx'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'docx file is required (field name: docx)' });
    }
    const draft = await draftService.createDraftFromDocx({
      file: req.file,
      name: req.body.name,
      description: req.body.description,
      createdBy: req.builderUser?.id,
    });
    return res.status(201).json({ data: draft });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
});

router.patch('/:id', async (_req, res) => {
  return res.status(410).json({
    error: 'Drafts are stored on the client only — save JSON locally',
  });
});

/** Write .ejs only — requires all variables mapped. Draft body from client. */
router.post('/:id/export-ejs', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await exportDraftEjs({
      id: body.id || req.params.id,
      name: body.name,
      ejs_content: body.ejs_content,
      variables_json: body.variables_json,
      description: body.description,
      status: body.status,
    });
    return res.json({
      data: {
        absolute_ejs_path: result.absoluteEjsPath,
        path_template: result.pathTemplate,
        file_name: result.fileName,
        ejs_content: result.draft.ejs_content,
        variables: result.variables,
        draft: result.draft,
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message,
      unmapped: error.unmapped || undefined,
    });
  }
});

module.exports = router;
