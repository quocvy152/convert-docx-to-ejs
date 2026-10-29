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

  /** Legacy hop.association → model (match server allowlist migration). */
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

  function emptyFilter() {
    return { column: '', op: 'eq', value: '' };
  }

  function emptyHop() {
    return { relatedModel: '', filters: [] };
  }

  function normalizeFilter(f) {
    if (!f || typeof f !== 'object') return emptyFilter();
    return {
      column: typeof f.column === 'string' ? f.column.trim() : f.path ? String(f.path).trim() : '',
      op: typeof f.op === 'string' && f.op ? f.op : 'eq',
      value: f.value == null ? '' : String(f.value),
    };
  }

  function hopRelatedModel(fromModel, hop) {
    if (!hop || typeof hop !== 'object') return '';
    if (typeof hop.relatedModel === 'string' && hop.relatedModel.trim()) {
      return hop.relatedModel.trim();
    }
    const assoc = typeof hop.association === 'string' ? hop.association.trim() : '';
    if (!assoc) return '';
    const legacy = fromModel && LEGACY_ASSOCIATION_TARGETS[fromModel];
    if (legacy && legacy[assoc]) return legacy[assoc];
    return assoc;
  }

  function normalizeHop(h, fromModel) {
    if (!h || typeof h !== 'object') return emptyHop();
    return {
      relatedModel: hopRelatedModel(fromModel, h),
      filters: Array.isArray(h.filters) ? h.filters.map(normalizeFilter) : [],
    };
  }

  function normalizeValueSourceHop(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n)) return NaN;
    return n;
  }

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

  function modelAtValueSource(rootModel, hops, valueSourceHop) {
    if (valueSourceHop === -1) return rootModel || null;
    const list = Array.isArray(hops) ? hops : [];
    if (!Number.isInteger(valueSourceHop) || valueSourceHop < 0 || valueSourceHop >= list.length) {
      return null;
    }
    return list[valueSourceHop].relatedModel || null;
  }

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

  function clearValueFields(v) {
    if (!v) return v;
    if (v.leaf) v.leaf.field = null;
    if (v.itemFields) {
      v.itemFields.forEach((f) => {
        f.field = null;
      });
    }
    return v;
  }

  function syncMirrors(v) {
    v.model = v.rootModel || null;
    if (v.kind === 'collection') {
      v.field = v.hops.length ? v.hops[v.hops.length - 1].relatedModel || null : null;
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
        valueSourceHop: null,
        leaf: { field: null },
      });
    }

    const kind = v.kind === 'collection' ? 'collection' : 'scalar';
    let rawHops = Array.isArray(v.hops) ? v.hops : null;
    let rootModel = v.rootModel || v.model || null;
    let leaf =
      v.leaf && typeof v.leaf === 'object' ? { field: v.leaf.field || null } : null;

    if (!rawHops) {
      rawHops = [];
      if (kind === 'collection') {
        if (v.field) rawHops = [{ relatedModel: v.field, filters: [] }];
        leaf = null;
      } else {
        leaf = { field: v.field || null };
      }
    }

    if (kind === 'scalar' && !leaf) leaf = { field: v.field || null };
    if (kind === 'collection') leaf = null;

    const hops = [];
    let from = rootModel;
    for (const raw of rawHops) {
      const hop = normalizeHop(raw, from);
      hops.push(hop);
      from = hop.relatedModel || null;
    }

    const valueSourceHop = normalizeValueSourceHop(v.valueSourceHop);

    const out = {
      name: v.name || '',
      kind,
      rootModel,
      hops,
      valueSourceHop: Number.isNaN(valueSourceHop) ? v.valueSourceHop : valueSourceHop,
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
    if (!isValueSourceHopValid(n)) return false;
    for (const hop of n.hops) {
      if (!hop.relatedModel) return false;
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
      let seg = hop.relatedModel || '?';
      const chips = (hop.filters || [])
        .filter((f) => f.column)
        .map(formatFilterChip)
        .filter(Boolean);
      if (chips.length) seg += `[${chips.join(' & ')}]`;
      parts.push(seg);
    }
    const path = parts.join(' → ');
    const srcIdx = effectiveValueSourceHop(n);
    const srcModel =
      srcIdx === null ? null : modelAtValueSource(n.rootModel, n.hops, srcIdx);
    if (n.kind === 'scalar') {
      const field = n.leaf && n.leaf.field ? n.leaf.field : '…';
      if (srcModel) return `${path} ⇒ ${srcModel}.${field}`;
      return `${path} → ${field}`;
    }
    if (srcModel && n.hops.length) {
      const last = n.hops[n.hops.length - 1].relatedModel;
      if (srcModel !== last) return `${path} ⇒ ${srcModel}`;
    }
    return path;
  }

  function setDirectField(variable, rootModel, field) {
    const v = normalizeVariable(variable);
    v.rootModel = rootModel || null;
    v.hops = [];
    v.valueSourceHop = null;
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
    setDirectField,
    effectiveValueSourceHop,
    modelAtValueSource,
    isValueSourceHopValid,
    clampValueSourceHop,
    clearValueFields,
    opNeedsValue,
    filterComplete,
    formatFilterChip,
  };
})();
