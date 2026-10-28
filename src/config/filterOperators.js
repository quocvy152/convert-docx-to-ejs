'use strict';

/** Operators allowed on path hop filters (MVP). */
const FILTER_OPERATORS = [
  { op: 'eq', label: '=', needsValue: true },
  { op: 'neq', label: '≠', needsValue: true },
  { op: 'gt', label: '>', needsValue: true },
  { op: 'gte', label: '≥', needsValue: true },
  { op: 'lt', label: '<', needsValue: true },
  { op: 'lte', label: '≤', needsValue: true },
  { op: 'in', label: 'in', needsValue: true },
  { op: 'like', label: 'like', needsValue: true },
  { op: 'is_null', label: 'is null', needsValue: false },
  { op: 'is_not_null', label: 'not null', needsValue: false },
];

const byOp = new Map(FILTER_OPERATORS.map((o) => [o.op, o]));

function listFilterOperators() {
  return FILTER_OPERATORS.map((o) => ({ ...o }));
}

function getFilterOperator(op) {
  return byOp.get(op) || null;
}

function operatorNeedsValue(op) {
  const def = byOp.get(op);
  return def ? def.needsValue : true;
}

module.exports = {
  FILTER_OPERATORS,
  listFilterOperators,
  getFilterOperator,
  operatorNeedsValue,
};
