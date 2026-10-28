'use strict';

const { sequelize } = require('../db/models');
const {
  listAllowedModels,
  getAllowedModel,
  listAssociationsForModel,
} = require('../config/modelAllowlist');

async function tableExists(tableName) {
  const [rows] = await sequelize.query(
    `SELECT 1 AS ok
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tableName
     LIMIT 1`,
    { replacements: { tableName } }
  );
  return rows.length > 0;
}

async function resolveTableName(model) {
  const candidates = [model.table, ...(model.tableAlts || [])];
  for (const table of candidates) {
    if (await tableExists(table)) return table;
  }
  return null;
}

async function listModels() {
  const models = listAllowedModels();
  // Resolve in parallel — sequential INFORMATION_SCHEMA round-trips to remote
  // MySQL made the first catalog call after DOCX convert slow/flaky in the UI.
  return Promise.all(
    models.map(async (m) => {
      const full = getAllowedModel(m.name);
      const resolved = await resolveTableName(full);
      return {
        name: m.name,
        table: resolved || m.table,
        available: Boolean(resolved),
      };
    })
  );
}

async function listFieldsForModel(modelName) {
  const model = getAllowedModel(modelName);
  if (!model) {
    const err = new Error(`Model not in allowlist: ${modelName}`);
    err.status = 400;
    throw err;
  }

  const tableName = await resolveTableName(model);
  if (!tableName) {
    const err = new Error(
      `Table not found for model ${model.name} (tried ${[model.table, ...(model.tableAlts || [])].join(', ')})`
    );
    err.status = 404;
    throw err;
  }

  const [rows] = await sequelize.query(
    `SELECT COLUMN_NAME AS name, DATA_TYPE AS dataType, IS_NULLABLE AS nullable, COLUMN_KEY AS columnKey
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tableName
     ORDER BY ORDINAL_POSITION`,
    { replacements: { tableName } }
  );

  return {
    model: model.name,
    table: tableName,
    fields: rows.map((r) => ({
      name: r.name,
      dataType: r.dataType,
      nullable: r.nullable === 'YES',
      columnKey: r.columnKey || '',
    })),
  };
}

async function listAssociations(modelName) {
  const model = getAllowedModel(modelName);
  if (!model) {
    const err = new Error(`Model not in allowlist: ${modelName}`);
    err.status = 400;
    throw err;
  }

  const associations = listAssociationsForModel(modelName) || [];
  return Promise.all(
    associations.map(async (a) => {
      const related = getAllowedModel(a.model);
      const resolved = related ? await resolveTableName(related) : null;
      return {
        name: a.name,
        model: a.model,
        available: Boolean(resolved),
      };
    })
  ).then((rows) => ({
    model: model.name,
    associations: rows,
  }));
}

module.exports = {
  listModels,
  listFieldsForModel,
  listAssociations,
};
