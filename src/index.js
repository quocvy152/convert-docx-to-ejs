'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { sequelize } = require('./db/models');
const { getDraftStoreMode } = require('./db/draftRepository');
const { requireTemplateBuilderAccess } = require('./middleware/auth');
const draftsRouter = require('./routes/drafts');
const catalogRouter = require('./routes/catalog');

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', async (_req, res) => {
  try {
    await sequelize.authenticate();
    const draftStore = await getDraftStoreMode();
    return res.json({ ok: true, db: true, draft_store: draftStore });
  } catch (error) {
    return res.status(500).json({ ok: false, db: false, error: error.message });
  }
});

app.use('/api', requireTemplateBuilderAccess);
app.use('/api/drafts', draftsRouter);
app.use('/api/catalog', catalogRouter);

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  return res.status(status).json({ error: err.message || 'Server error' });
});

async function start() {
  await sequelize.authenticate();
  const draftStore = await getDraftStoreMode();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`pdf-ejs-template-builder MVP listening on http://localhost:${config.port}`);
    // eslint-disable-next-line no-console
    console.log(`draft store: ${draftStore}${draftStore === 'fs' ? ' (MySQL draft table missing or DRAFT_STORE=fs)' : ''}`);
  });
}

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start:', error.message);
  process.exit(1);
});
