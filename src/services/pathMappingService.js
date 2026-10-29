'use strict';

const { getAllowedModel, legacyRelatedModel } = require('../config/modelAllowlist');
const { getFilterOperator, operatorNeedsValue } = require('../config/filterOperators');

function emptyFilter() {
  return { column: '', op: 'eq', value: '' };
}

function normalizeFilter(f) {
  if (!f || typeof f !== 'object') return emptyFilter();
  const op = typeof f.op === 'string' && f.op ? f.op : 'eq';
  let value = f.value;
  if (value == null) value = '';
  else if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    value = String(value);
  } else {
    value = String(value);
  }
  return {
    column: typeof f.column === 'string' ? f.column.trim() : f.path ? String(f.path).trim() : '',
    op,
    value,
  };
}

function emptyHop() {
  return { relatedModel: '', filters: [] };
}

/**
 * Resolve hop target model. Prefers relatedModel; migrates legacy association names.
 */
function hopRelatedModel(fromModel, hop) {
  if (!hop || typeof hop !== 'object') return '';
  if (typeof hop.relatedModel === 'string' && hop.relatedModel.trim()) {
    return hop.relatedModel.trim();
  }
  const assoc = typeof hop.association === 'string' ? hop.association.trim() : '';
  if (!assoc) return '';
  if (getAllowedModel(assoc)) return assoc;
  return legacyRelatedModel(fromModel, assoc) || '';
}

function normalizeHop(h, fromModel) {
  if (!h || typeof h !== 'object') return emptyHop();
  const filters = Array.isArray(h.filters)
    ? h.filters.map(normalizeFilter).filter((f) => Boolean(f.column))
    : [];
  return {
    relatedModel: hopRelatedModel(fromModel, h),
    filters,
  };
}

/**
 * Normalize stored valueSourceHop. null = default (last hop / root if no hops).
 * Invalid non-integers become NaN so validation can reject them.
 */
function normalizeValueSourceHop(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n)) return NaN;
  return n;
}

/**
 * Effective hop index for value fields. -1 = rootModel.
 * Returns null when an explicit valueSourceHop is out of range / invalid.
 */
function effectiveValueSourceHop(v) {
  const hops = v && Array.isArray(v.hops) ? v.hops : [];
  const raw = v ? v.valueSourceHop : null;
  if (raw === null || raw === undefined || raw === '') {
    return hops.length === 0 ? -1 : hops.length - 1;
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < -1 || n >= hops.length) return null;
  return n;
}

function isValueSourceHopValid(v) {
  if (!v) return false;
  if (v.valueSourceHop === null || v.valueSourceHop === undefined || v.valueSourceHop === '') {
    return true;
  }
  return effectiveValueSourceHop(v) !== null;
}

/** Model name at valueSourceHop (-1 = root). */
function modelAtValueSource(rootModel, hops, valueSourceHop) {
  if (valueSourceHop === -1) return rootModel || null;
  const list = Array.isArray(hops) ? hops : [];
  if (!Number.isInteger(valueSourceHop) || valueSourceHop < 0 || valueSourceHop >= list.length) {
    return null;
  }
  return list[valueSourceHop].relatedModel || null;
}

/**
 * Clamp explicit valueSourceHop into [-1, last]. Clears nothing — caller clears fields.
 * Omits / null stay null (default semantics).
 */
function clampValueSourceHop(v) {
  if (!v || typeof v !== 'object') return v;
  if (v.valueSourceHop === null || v.valueSourceHop === undefined || v.valueSourceHop === '') {
    v.valueSourceHop = null;
    return v;
  }
  const hops = Array.isArray(v.hops) ? v.hops : [];
  const max = hops.length === 0 ? -1 : hops.length - 1;
  const n = typeof v.valueSourceHop === 'number' ? v.valueSourceHop : Number(v.valueSourceHop);
  if (!Number.isInteger(n) || n < -1 || n > max) {
    v.valueSourceHop = max;
  } else {
    v.valueSourceHop = n;
  }
  return v;
}

/**
 * Migrate legacy { model, field } into path shape; keep model/field mirrors for older readers.
 */
function normalizeVariable(v) {
  if (!v || typeof v !== 'object') {
    return {
      name: '',
      kind: 'scalar',
      rootModel: null,
      hops: [],
      valueSourceHop: null,
      leaf: { field: null },
      model: null,
      field: null,
    };
  }

  const kind = v.kind === 'collection' ? 'collection' : 'scalar';
  const name = v.name || '';

  let rootModel = v.rootModel || v.model || null;
  let rawHops = Array.isArray(v.hops) ? v.hops : null;
  let leaf =
    v.leaf && typeof v.leaf === 'object'
      ? { field: v.leaf.field || null }
      : null;

  // Legacy → path
  if (!rawHops) {
    rawHops = [];
    if (kind === 'collection') {
      if (v.field) {
        rawHops = [{ relatedModel: String(v.field), filters: [] }];
      }
      leaf = null;
    } else {
      leaf = { field: v.field || null };
    }
  }

  if (kind === 'scalar' && !leaf) {
    leaf = { field: v.field || null };
  }
  if (kind === 'collection') {
    leaf = null;
  }

  /** @type {{ relatedModel: string, filters: ReturnType<typeof normalizeFilter>[] }[]} */
  const hops = [];
  let from = rootModel;
  for (const raw of rawHops) {
    const hop = normalizeHop(raw, from);
    hops.push(hop);
    from = hop.relatedModel || null;
  }

  const itemFields =
    kind === 'collection'
      ? Array.isArray(v.itemFields)
        ? v.itemFields.map((f) => ({
            name: f.name,
            field: f.field || null,
          }))
        : []
      : undefined;

  const legacyField =
    kind === 'collection'
      ? hops.length
        ? hops[hops.length - 1].relatedModel || null
        : null
      : hops.length === 0
        ? leaf && leaf.field
        : leaf && leaf.field;

  const valueSourceHop = normalizeValueSourceHop(v.valueSourceHop);

  const out = {
    name,
    kind,
    rootModel: rootModel || null,
    hops,
    valueSourceHop: Number.isNaN(valueSourceHop) ? v.valueSourceHop : valueSourceHop,
    leaf: kind === 'scalar' ? leaf || { field: null } : null,
    model: rootModel || null,
    field: legacyField || null,
  };

  if (kind === 'collection') {
    out.itemKind = v.itemKind === 'string' ? 'string' : 'object';
    out.itemFields = itemFields;
  }

  return out;
}

function normalizeVariables(variablesJson) {
  if (!Array.isArray(variablesJson)) return [];
  return variablesJson.map(normalizeVariable);
}

function resolveHopModels(rootModel, hops) {
  /** @type {{ from: string, relatedModel: string, to: string }[]} */
  const steps = [];
  let current = rootModel;
  for (let i = 0; i < hops.length; i += 1) {
    const hop = hops[i];
    const related = hopRelatedModel(current, hop);
    if (!related) {
      return { ok: false, error: `Hop ${i + 1} missing related model`, steps, leafModel: current };
    }
    if (!getAllowedModel(related)) {
      return {
        ok: false,
        error: `Unknown related model "${related}" on ${current}`,
        steps,
        leafModel: current,
      };
    }
    steps.push({ from: current, relatedModel: related, to: related });
    current = related;
  }
  return { ok: true, error: null, steps, leafModel: current };
}

function filterIsComplete(f) {
  if (!f || !f.column) return false;
  if (!getFilterOperator(f.op)) return false;
  if (operatorNeedsValue(f.op) && String(f.value ?? '').trim() === '') return false;
  return true;
}

function isVariableMapped(v) {
  const n = normalizeVariable(v);
  if (!n.rootModel || !getAllowedModel(n.rootModel)) return false;
  if (!isValueSourceHopValid(n)) return false;

  for (const hop of n.hops) {
    if (!hop.relatedModel) return false;
    for (const f of hop.filters || []) {
      if (!filterIsComplete(f)) return false;
    }
  }

  const resolved = resolveHopModels(n.rootModel, n.hops);
  if (!resolved.ok) return false;

  if (n.kind === 'collection') {
    if (!n.hops.length) return false;
    if (n.itemKind === 'string') return true;
    return (n.itemFields || []).every((f) => Boolean(f.field));
  }

  return Boolean(n.leaf && n.leaf.field);
}

function unmappedReasons(v) {
  const n = normalizeVariable(v);
  /** @type {string[]} */
  const missing = [];
  if (!n.rootModel) {
    missing.push(n.name || '(unnamed)');
    return missing;
  }
  if (!getAllowedModel(n.rootModel)) {
    missing.push(n.name);
    return missing;
  }
  for (let i = 0; i < n.hops.length; i += 1) {
    const hop = n.hops[i];
    if (!hop.relatedModel) missing.push(`${n.name}.hop${i + 1}`);
    (hop.filters || []).forEach((f, fi) => {
      if (!filterIsComplete(f)) missing.push(`${n.name}.hop${i + 1}.filter${fi + 1}`);
    });
  }
  const resolved = resolveHopModels(n.rootModel, n.hops);
  if (!resolved.ok) missing.push(n.name);
  if (!isValueSourceHopValid(n)) missing.push(`${n.name}.valueSourceHop`);

  if (n.kind === 'collection') {
    if (!n.hops.length) missing.push(n.name);
    if (n.itemKind !== 'string') {
      for (const f of n.itemFields || []) {
        if (!f.field) missing.push(`${n.name}.${f.name}`);
      }
    }
  } else if (!n.leaf || !n.leaf.field) {
    missing.push(n.name);
  }

  return missing;
}

function assertFullyMapped(variables) {
  if (!variables.length) return;

  /** @type {string[]} */
  const missing = [];

  for (const raw of variables) {
    const v = normalizeVariable(raw);
    if (!v.rootModel) {
      missing.push(v.name);
      continue;
    }
    if (!getAllowedModel(v.rootModel)) {
      const err = new Error(`Variable "${v.name}" mapped to non-allowlisted model: ${v.rootModel}`);
      err.status = 400;
      throw err;
    }

    const resolved = resolveHopModels(v.rootModel, v.hops);
    if (!resolved.ok) {
      const err = new Error(`Variable "${v.name}": ${resolved.error}`);
      err.status = 400;
      throw err;
    }

    if (!isValueSourceHopValid(v)) {
      missing.push(`${v.name}.valueSourceHop`);
      continue;
    }

    for (let i = 0; i < v.hops.length; i += 1) {
      const hop = v.hops[i];
      for (const f of hop.filters || []) {
        if (!filterIsComplete(f)) {
          missing.push(`${v.name}.hop${i + 1}.filter`);
          continue;
        }
        if (!getFilterOperator(f.op)) {
          const err = new Error(`Variable "${v.name}": unsupported filter op "${f.op}"`);
          err.status = 400;
          throw err;
        }
      }
    }

    if (v.kind === 'collection') {
      if (!v.hops.length) {
        missing.push(v.name);
        continue;
      }
      if (v.itemKind !== 'string') {
        for (const f of v.itemFields || []) {
          if (!f.field) missing.push(`${v.name}.${f.name}`);
        }
      }
      continue;
    }

    if (!v.leaf || !v.leaf.field) {
      missing.push(v.name);
    }
  }

  if (missing.length) {
    const err = new Error(`Map all variables before export. Unmapped: ${missing.join(', ')}`);
    err.status = 400;
    err.unmapped = missing;
    throw err;
  }
}

module.exports = {
  normalizeVariable,
  normalizeVariables,
  resolveHopModels,
  hopRelatedModel,
  effectiveValueSourceHop,
  modelAtValueSource,
  isValueSourceHopValid,
  clampValueSourceHop,
  normalizeValueSourceHop,
  isVariableMapped,
  unmappedReasons,
  assertFullyMapped,
  filterIsComplete,
  normalizeFilter,
  normalizeHop,
  emptyHop,
};
