(() => {
  const FILTER_OPS_FALLBACK = [
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

  function emptyFilter() {
    return { column: '', op: 'eq', value: '' };
  }

  function emptyHop() {
    return { association: '', filters: [] };
  }

  function normalizeFilter(f) {
    if (!f || typeof f !== 'object') return emptyFilter();
    return {
      column: typeof f.column === 'string' ? f.column.trim() : f.path ? String(f.path).trim() : '',
      op: typeof f.op === 'string' && f.op ? f.op : 'eq',
      value: f.value == null ? '' : String(f.value),
    };
  }

  function normalizeHop(h) {
    if (!h || typeof h !== 'object') return emptyHop();
    return {
      association: typeof h.association === 'string' ? h.association.trim() : '',
      filters: Array.isArray(h.filters) ? h.filters.map(normalizeFilter) : [],
    };
  }

  function syncMirrors(v) {
    v.model = v.rootModel || null;
    if (v.kind === 'collection') {
      v.field = v.hops.length ? v.hops[v.hops.length - 1].association || null : null;
    } else {
      v.field = v.leaf && v.leaf.field ? v.leaf.field : null;
    }
    return v;
  }

  function normalizeVariable(v) {
    if (!v || typeof v !== 'object') {
      return syncMirrors({
        name: '',
        kind: 'scalar',
        rootModel: null,
        hops: [],
        leaf: { field: null },
      });
    }

    const kind = v.kind === 'collection' ? 'collection' : 'scalar';
    let hops = Array.isArray(v.hops) ? v.hops.map(normalizeHop) : null;
    let rootModel = v.rootModel || v.model || null;
    let leaf =
      v.leaf && typeof v.leaf === 'object' ? { field: v.leaf.field || null } : null;

    if (!hops) {
      hops = [];
      if (kind === 'collection') {
        if (v.field) hops = [{ association: v.field, filters: [] }];
        leaf = null;
      } else {
        leaf = { field: v.field || null };
      }
    }

    if (kind === 'scalar' && !leaf) leaf = { field: v.field || null };
    if (kind === 'collection') leaf = null;

    const out = {
      name: v.name || '',
      kind,
      rootModel,
      hops,
      leaf: kind === 'scalar' ? leaf || { field: null } : null,
    };

    if (kind === 'collection') {
      out.itemKind = v.itemKind === 'string' ? 'string' : 'object';
      out.itemFields = Array.isArray(v.itemFields)
        ? v.itemFields.map((f) => ({ name: f.name, field: f.field || null }))
        : [];
    }

    return syncMirrors(out);
  }

  function opNeedsValue(op, ops) {
    const list = ops && ops.length ? ops : FILTER_OPS_FALLBACK;
    const def = list.find((o) => o.op === op);
    return def ? def.needsValue : true;
  }

  function filterComplete(f, ops) {
    if (!f || !String(f.column || '').trim()) return false;
    if (opNeedsValue(f.op, ops) && String(f.value ?? '').trim() === '') return false;
    return true;
  }

  function isDirectMode(v) {
    const n = normalizeVariable(v);
    return n.kind === 'scalar' && n.hops.length === 0;
  }

  function isVariableMapped(v, ops) {
    const n = normalizeVariable(v);
    if (!n.rootModel) return false;
    for (const hop of n.hops) {
      if (!hop.association) return false;
      for (const f of hop.filters || []) {
        if (!String(f.column || '').trim()) continue;
        if (!filterComplete(f, ops)) return false;
      }
    }
    if (n.kind === 'collection') {
      if (!n.hops.length) return false;
      if (n.itemKind === 'string') return true;
      return (n.itemFields || []).every((f) => Boolean(f.field));
    }
    return Boolean(n.leaf && n.leaf.field);
  }

  function unmappedNames(variables, ops) {
    /** @type {string[]} */
    const missing = [];
    for (const raw of variables) {
      const v = normalizeVariable(raw);
      if (!isVariableMapped(v, ops)) {
        if (!v.rootModel || (v.kind === 'scalar' && !(v.leaf && v.leaf.field))) {
          missing.push(v.name);
        } else if (v.kind === 'collection') {
          if (!v.hops.length) missing.push(v.name);
          else {
            for (const f of v.itemFields || []) {
              if (!f.field) missing.push(`${v.name}.${f.name}`);
            }
            if (!(v.itemFields || []).length || (v.itemFields || []).every((f) => f.field)) {
              if (!isVariableMapped(v, ops)) missing.push(v.name);
            }
          }
        } else {
          missing.push(v.name);
        }
      }
    }
    return [...new Set(missing)];
  }

  function formatFilterChip(f) {
    if (!f || !f.column) return '';
    if (f.op === 'is_null') return `${f.column}∅`;
    if (f.op === 'is_not_null') return `${f.column}≠∅`;
    return `${f.column}${f.op === 'eq' ? '=' : f.op}${f.value}`;
  }

  function pathSummary(v) {
    const n = normalizeVariable(v);
    if (!n.rootModel) return 'Unmapped';
    const parts = [n.rootModel];
    for (const hop of n.hops) {
      let seg = hop.association || '?';
      const chips = (hop.filters || [])
        .filter((f) => f.column)
        .map(formatFilterChip)
        .filter(Boolean);
      if (chips.length) seg += `[${chips.join(' & ')}]`;
      parts.push(seg);
    }
    if (n.kind === 'scalar') {
      parts.push(n.leaf && n.leaf.field ? n.leaf.field : '…');
    }
    return parts.join(' → ');
  }

  function applyRecipe(variable, recipe) {
    const v = normalizeVariable(variable);
    if (!recipe || recipe.kind !== v.kind) return v;
    v.rootModel = recipe.rootModel;
    v.hops = (recipe.hops || []).map(normalizeHop);
    if (v.kind === 'scalar') {
      v.leaf = { field: (recipe.leaf && recipe.leaf.field) || null };
    }
    if (v.itemFields) {
      v.itemFields.forEach((f) => {
        f.field = null;
      });
    }
    return syncMirrors(v);
  }

  function setDirectField(variable, rootModel, field) {
    const v = normalizeVariable(variable);
    v.rootModel = rootModel || null;
    v.hops = [];
    if (v.kind === 'scalar') v.leaf = { field: field || null };
    return syncMirrors(v);
  }

  window.PathMapping = {
    FILTER_OPS_FALLBACK,
    emptyFilter,
    emptyHop,
    normalizeVariable,
    syncMirrors,
    isDirectMode,
    isVariableMapped,
    unmappedNames,
    pathSummary,
    applyRecipe,
    setDirectField,
    opNeedsValue,
    filterComplete,
    formatFilterChip,
  };
})();
