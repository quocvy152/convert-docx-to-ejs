'use strict';

const express = require('express');
const draftService = require('../services/draftService');
const modelCatalogService = require('../services/modelCatalogService');
const { listFilterOperators } = require('../config/filterOperators');
const { listPathRecipes } = require('../config/pathRecipes');

const router = express.Router();

router.get('/models', async (_req, res) => {
  try {
    const data = await modelCatalogService.listModels();
    return res.json({ data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/models/:name/fields', async (req, res) => {
  try {
    const data = await modelCatalogService.listFieldsForModel(req.params.name);
    return res.json({ data });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
});

router.get('/models/:name/associations', async (req, res) => {
  try {
    const data = await modelCatalogService.listAssociations(req.params.name);
    return res.json({ data });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message });
  }
});

router.get('/filter-operators', (_req, res) => {
  return res.json({ data: listFilterOperators() });
});

router.get('/path-recipes', (req, res) => {
  const kind = req.query.kind === 'collection' || req.query.kind === 'scalar' ? req.query.kind : null;
  return res.json({ data: listPathRecipes(kind) });
});

router.get('/process-steps', async (req, res) => {
  try {
    const data = await draftService.listProcessSteps(req.query.q);
    return res.json({ data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/file-templates', async (req, res) => {
  try {
    const data = await draftService.searchFileTemplates(req.query.q);
    return res.json({ data });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
