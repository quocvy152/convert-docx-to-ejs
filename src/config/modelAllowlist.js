'use strict';

/**
 * CRM models allowed for variable mapping (idea: relation-path-variable-mapping).
 * `table` is the MySQL table name used to load columns from INFORMATION_SCHEMA.
 * `associations` map relation hops to a related allowlisted model (multi-hop paths).
 */
const MODEL_ALLOWLIST = [
  {
    name: 'Company',
    table: 'company',
    tableAlts: ['companies', 'company'],
    associations: [
      { name: 'members', model: 'CompanyMember' },
      { name: 'positions', model: 'CompanyPosition' },
      { name: 'shares', model: 'CompanyShare' },
      { name: 'interests', model: 'CompanyInterest' },
    ],
  },
  { name: 'Task', table: 'task', tableAlts: ['task'], associations: [] },
  {
    name: 'CompanyMember',
    table: 'company_member',
    tableAlts: ['companymembers', 'company_members'],
    associations: [
      { name: 'country', model: 'Country' },
      { name: 'positions', model: 'CompanyPosition' },
      { name: 'company', model: 'Company' },
    ],
  },
  {
    name: 'CompanyPosition',
    table: 'company_position',
    tableAlts: ['companypositions', 'company_positions'],
    associations: [
      { name: 'member', model: 'CompanyMember' },
      { name: 'company', model: 'Company' },
    ],
  },
  { name: 'CompanyShare', table: 'company_share', tableAlts: ['companyshares'], associations: [] },
  {
    name: 'CompanyInterest',
    table: 'company_interest',
    tableAlts: ['companyinterests'],
    associations: [],
  },
  {
    name: 'Country',
    table: 'country',
    tableAlts: ['countries', 'country'],
    associations: [],
  },
  {
    name: 'Order',
    table: 'order',
    tableAlts: ['order'],
    associations: [{ name: 'items', model: 'OrderItem' }],
  },
  { name: 'OrderItem', table: 'order_item', tableAlts: ['orderitems'], associations: [] },
  { name: 'Service', table: 'service', tableAlts: ['service'], associations: [] },
  {
    name: 'ChangeRequest',
    table: 'change_request',
    tableAlts: ['change_requests'],
    associations: [{ name: 'items', model: 'ChangeRequestItem' }],
  },
  {
    name: 'ChangeRequestItem',
    table: 'change_request_item',
    tableAlts: ['change_request_items'],
    associations: [],
  },
  {
    name: 'Process',
    table: 'process',
    tableAlts: ['processes'],
    associations: [{ name: 'steps', model: 'ProcessStep' }],
  },
  { name: 'ProcessStep', table: 'process_step', tableAlts: ['process_steps'], associations: [] },
];

const byName = new Map(MODEL_ALLOWLIST.map((m) => [m.name, m]));

function listAllowedModels() {
  return MODEL_ALLOWLIST.map(({ name, table }) => ({ name, table }));
}

function getAllowedModel(name) {
  return byName.get(name) || null;
}

function listAssociationsForModel(modelName) {
  const model = getAllowedModel(modelName);
  if (!model) return null;
  return (model.associations || []).map((a) => ({
    name: a.name,
    model: a.model,
  }));
}

function getAssociation(modelName, associationName) {
  const list = listAssociationsForModel(modelName);
  if (!list) return null;
  return list.find((a) => a.name === associationName) || null;
}

module.exports = {
  MODEL_ALLOWLIST,
  listAllowedModels,
  getAllowedModel,
  listAssociationsForModel,
  getAssociation,
};
