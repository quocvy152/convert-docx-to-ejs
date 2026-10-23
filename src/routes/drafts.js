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

router.get('/', async (_req, res) => {
  try {
    const drafts = await draftService.listDrafts();
    return res.json({ data: drafts });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const draft = await draftService.getDraft(req.params.id);
    return res.json({ data: draft });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
});

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
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const draft = await draftService.updateDraft(req.params.id, req.body || {});
    return res.json({ data: draft });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
});

/** Write .ejs only — requires all variables mapped. No FileTemplate / process_step. */
router.post('/:id/export-ejs', async (req, res) => {
  try {
    const result = await exportDraftEjs(req.params.id);
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
