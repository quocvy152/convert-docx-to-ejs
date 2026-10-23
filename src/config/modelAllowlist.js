'use strict';

/**
 * CRM models allowed for variable mapping (idea: docx-to-ejs-one-screen).
 * `table` is the MySQL table name used to load columns from INFORMATION_SCHEMA.
 */
const MODEL_ALLOWLIST = [
  { name: 'Company', table: 'company', tableAlts: ['companies', 'company'] },
  { name: 'Task', table: 'task', tableAlts: ['task'] },
  { name: 'CompanyMember', table: 'company_member', tableAlts: ['companymembers'] },
  { name: 'CompanyPosition', table: 'company_position', tableAlts: ['companypositions'] },
  { name: 'CompanyShare', table: 'company_share', tableAlts: ['companyshares'] },
  { name: 'CompanyInterest', table: 'company_interest', tableAlts: ['companyinterests'] },
  { name: 'Order', table: 'order', tableAlts: ['order'] },
  { name: 'OrderItem', table: 'order_item', tableAlts: ['orderitems'] },
  { name: 'Service', table: 'service', tableAlts: ['service'] },
  { name: 'ChangeRequest', table: 'change_request', tableAlts: ['change_requests'] },
  { name: 'ChangeRequestItem', table: 'change_request_item', tableAlts: ['change_request_items'] },
  { name: 'Process', table: 'process', tableAlts: ['processes'] },
  { name: 'ProcessStep', table: 'process_step', tableAlts: ['process_steps'] },
];

const byName = new Map(MODEL_ALLOWLIST.map((m) => [m.name, m]));

function listAllowedModels() {
  return MODEL_ALLOWLIST.map(({ name, table }) => ({ name, table }));
}

function getAllowedModel(name) {
  return byName.get(name) || null;
}

module.exports = {
  MODEL_ALLOWLIST,
  listAllowedModels,
  getAllowedModel,
};
