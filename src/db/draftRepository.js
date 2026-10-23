'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { TemplateBuilderDraft, sequelize } = require('./models');

function draftsDir() {
  return path.join(path.dirname(config.uploadsDir), 'drafts');
}

function draftFile(id) {
  return path.join(draftsDir(), `${id}.json`);
}

function ensureDraftsDir() {
  fs.mkdirSync(draftsDir(), { recursive: true });
}

const fsMethods = {
  async save() {
    ensureDraftsDir();
    this.updated_time = new Date().toISOString();
    const plain = Object.assign({}, this);
    fs.writeFileSync(draftFile(this.id), JSON.stringify(plain, null, 2), 'utf8');
    return this;
  },
  get(opts) {
    if (opts && opts.plain) return Object.assign({}, this);
    return this;
  },
};

function wrapFsRecord(data) {
  return Object.assign(Object.create(fsMethods), data);
}

const mysqlStore = {
  mode: 'mysql',
  async create(payload) {
    return TemplateBuilderDraft.create(payload);
  },
  async findAllActive() {
    return TemplateBuilderDraft.findAll({
      where: { is_deleted: false },
      order: [['updated_time', 'DESC']],
    });
  },
  async findActiveById(id) {
    return TemplateBuilderDraft.findOne({ where: { id, is_deleted: false } });
  },
};

const fsStore = {
  mode: 'fs',
  async create(payload) {
    ensureDraftsDir();
    const now = new Date().toISOString();
    const record = wrapFsRecord({
      ...payload,
      created_time: payload.created_time || now,
      updated_time: payload.updated_time || now,
      is_deleted: payload.is_deleted ?? false,
    });
    await record.save();
    return record;
  },
  async findAllActive() {
    ensureDraftsDir();
    const files = fs.readdirSync(draftsDir()).filter((f) => f.endsWith('.json'));
    const drafts = [];
    for (const file of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(draftsDir(), file), 'utf8'));
        if (!raw.is_deleted) drafts.push(wrapFsRecord(raw));
      } catch (_err) {
        // skip corrupt draft files
      }
    }
    drafts.sort((a, b) => String(b.updated_time).localeCompare(String(a.updated_time)));
    return drafts;
  },
  async findActiveById(id) {
    const file = draftFile(id);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw.is_deleted) return null;
    return wrapFsRecord(raw);
  },
};

let activeStore = null;

async function mysqlDraftTableExists() {
  try {
    const [rows] = await sequelize.query(
      "SHOW TABLES LIKE 'template_builder_draft'"
    );
    return rows.length > 0;
  } catch (_error) {
    return false;
  }
}

async function resolveDraftStore() {
  if (activeStore) return activeStore;

  const configured = (config.draftStore || 'auto').toLowerCase();
  if (configured === 'fs') {
    activeStore = fsStore;
    return activeStore;
  }
  if (configured === 'mysql') {
    activeStore = mysqlStore;
    return activeStore;
  }

  activeStore = (await mysqlDraftTableExists()) ? mysqlStore : fsStore;
  return activeStore;
}

async function getDraftStoreMode() {
  const store = await resolveDraftStore();
  return store.mode;
}

module.exports = {
  resolveDraftStore,
  getDraftStoreMode,
};
