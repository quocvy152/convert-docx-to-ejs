'use strict';

const { getAllowedModel, getAssociation } = require('../config/modelAllowlist');
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

function normalizeHop(h) {
  if (!h || typeof h !== 'object') {
    return { association: '', filters: [] };
  }
  const filters = Array.isArray(h.filters)
    ? h.filters.map(normalizeFilter).filter((f) => Boolean(f.column))
    : [];
  return {
    association: typeof h.association === 'string' ? h.association.trim() : '',
    filters,
  };
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
      leaf: { field: null },
      model: null,
      field: null,
    };
  }

  const kind = v.kind === 'collection' ? 'collection' : 'scalar';
  const name = v.name || '';

  let rootModel = v.rootModel || v.model || null;
  let hops = Array.isArray(v.hops) ? v.hops.map(normalizeHop) : null;
  let leaf =
    v.leaf && typeof v.leaf === 'object'
      ? { field: v.leaf.field || null }
      : null;

  // Legacy → path
  if (!hops) {
    hops = [];
    if (kind === 'collection') {
      if (v.field) {
        hops = [{ association: v.field, filters: [] }];
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
        ? hops[hops.length - 1].association || null
        : null
      : hops.length === 0
        ? leaf && leaf.field
        : leaf && leaf.field;

  const out = {
    name,
    kind,
    rootModel: rootModel || null,
    hops,
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
  /** @type {{ from: string, association: string, to: string }[]} */
  const steps = [];
  let current = rootModel;
  for (let i = 0; i < hops.length; i += 1) {
    const hop = hops[i];
    if (!hop.association) {
      return { ok: false, error: `Hop ${i + 1} missing association`, steps, leafModel: current };
    }
    const assoc = getAssociation(current, hop.association);
    if (!assoc) {
      return {
        ok: false,
        error: `Unknown association "${hop.association}" on ${current}`,
        steps,
        leafModel: current,
      };
    }
    steps.push({ from: current, association: hop.association, to: assoc.model });
    current = assoc.model;
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

  for (const hop of n.hops) {
    if (!hop.association) return false;
    for (const f of hop.filters || []) {
      // Allow empty filter rows only if none partially filled — require all listed filters complete
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
    if (!hop.association) missing.push(`${n.name}.hop${i + 1}`);
    (hop.filters || []).forEach((f, fi) => {
      if (!filterIsComplete(f)) missing.push(`${n.name}.hop${i + 1}.filter${fi + 1}`);
    });
  }
  const resolved = resolveHopModels(n.rootModel, n.hops);
  if (!resolved.ok) missing.push(n.name);

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

    for (let i = 0; i < v.hops.length; i += 1) {
      const hop = v.hops[i];
      const fromModel = i === 0 ? v.rootModel : resolved.steps[i - 1].to;
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
        // Column existence is UI-assisted; export only requires non-empty column + valid op.
        void fromModel;
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
  isVariableMapped,
  unmappedReasons,
  assertFullyMapped,
  filterIsComplete,
  normalizeFilter,
  normalizeHop,
};
