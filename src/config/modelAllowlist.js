'use strict';

/**
 * CRM models allowed for variable mapping.
 * `table` is the MySQL table name used to load columns from INFORMATION_SCHEMA.
 * Related models for hops are discovered from FK constraints (not listed here).
 */
const MODEL_ALLOWLIST = [
  {
    name: 'Company',
    table: 'company',
    tableAlts: ['companies', 'company'],
  },
  { name: 'Task', table: 'task', tableAlts: ['task'] },
  {
    name: 'CompanyMember',
    table: 'company_member',
    tableAlts: ['companymembers', 'company_members'],
  },
  {
    name: 'CompanyPosition',
    table: 'company_position',
    tableAlts: ['companypositions', 'company_positions'],
  },
  { name: 'CompanyShare', table: 'company_share', tableAlts: ['companyshares'] },
  {
    name: 'CompanyInterest',
    table: 'company_interest',
    tableAlts: ['companyinterests'],
  },
  {
    name: 'Country',
    table: 'country',
    tableAlts: ['countries', 'country'],
  },
  {
    name: 'Order',
    table: 'order',
    tableAlts: ['order'],
  },
  { name: 'OrderItem', table: 'order_item', tableAlts: ['orderitems'] },
  { name: 'Service', table: 'service', tableAlts: ['service'] },
  {
    name: 'ChangeRequest',
    table: 'change_request',
    tableAlts: ['change_requests'],
  },
  {
    name: 'ChangeRequestItem',
    table: 'change_request_item',
    tableAlts: ['change_request_items'],
  },
  {
    name: 'Process',
    table: 'process',
    tableAlts: ['processes'],
  },
  { name: 'ProcessStep', table: 'process_step', tableAlts: ['process_steps'] },
];

/**
 * Legacy hop.association → related model (older drafts). New hops use relatedModel.
 */
const LEGACY_ASSOCIATION_TARGETS = {
  Company: {
    members: 'CompanyMember',
    positions: 'CompanyPosition',
    shares: 'CompanyShare',
    interests: 'CompanyInterest',
  },
  CompanyMember: {
    country: 'Country',
    positions: 'CompanyPosition',
    company: 'Company',
  },
  CompanyPosition: {
    member: 'CompanyMember',
    company: 'Company',
  },
  Order: { items: 'OrderItem' },
  ChangeRequest: { items: 'ChangeRequestItem' },
  Process: { steps: 'ProcessStep' },
};

const byName = new Map(MODEL_ALLOWLIST.map((m) => [m.name, m]));

function listAllowedModels() {
  return MODEL_ALLOWLIST.map(({ name, table }) => ({ name, table }));
}

function getAllowedModel(name) {
  return byName.get(name) || null;
}

/** All candidate table names → model name (for FK discovery). */
function tableNameToModelMap() {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const m of MODEL_ALLOWLIST) {
    const names = [m.table, ...(m.tableAlts || [])];
    for (const t of names) {
      if (t) map.set(String(t).toLowerCase(), m.name);
    }
  }
  return map;
}

function legacyRelatedModel(fromModel, associationName) {
  if (!fromModel || !associationName) return null;
  const row = LEGACY_ASSOCIATION_TARGETS[fromModel];
  return (row && row[associationName]) || null;
}

module.exports = {
  MODEL_ALLOWLIST,
  listAllowedModels,
  getAllowedModel,
  tableNameToModelMap,
  legacyRelatedModel,
};
