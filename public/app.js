(() => {
  let currentDraftId = null;
  let currentDraftName = '';
  /** @type {FileSystemDirectoryHandle|null} */
  let draftsDirHandle = null;
  const PM = window.PathMapping;
  /** @type {ReturnType<typeof PM.normalizeVariable>[]} */
  let variables = [];
  /** @type {{ name: string, table: string, available: boolean }[]} */
  let modelsCache = [];
  /** @type {Promise<void>|null} */
  let modelsLoadPromise = null;
  /** @type {Record<string, { name: string, dataType?: string }[]>} */
  let fieldsCache = {};
  /** @type {Record<string, { name: string, table?: string, available: boolean }[]>} */
  let relatedModelsCache = {};
  /** @type {{ op: string, label: string, needsValue: boolean }[]} */
  let filterOpsCache = PM.FILTER_OPS_FALLBACK.slice();
  /** @type {Promise<void>|null} */
  let filterOpsLoadPromise = null;

  function normalizeVariable(v) {
    return PM.normalizeVariable(v);
  }

  function isVariableMapped(v) {
    return PM.isVariableMapped(v, filterOpsCache);
  }

  const API_KEY_STORAGE = 'templateBuilder.apiKey';
  const store = window.LocalDraftStore;

  const apiKeyInput = document.getElementById('apiKey');
  const savedKey = sessionStorage.getItem(API_KEY_STORAGE);
  if (savedKey) apiKeyInput.value = savedKey;

  function setFolderStatus(state, message) {
    const gate = document.getElementById('folderGate');
    const el = document.getElementById('folderStatus');
    const connected = Boolean(draftsDirHandle);
    gate.classList.toggle('is-connected', connected);
    if (!message) {
      el.hidden = !connected;
      el.textContent = connected ? `Saving to ${store.FOLDER_NAME}` : '';
      el.classList.toggle('is-ok', connected);
      el.classList.remove('is-error');
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle('is-ok', state === 'ok');
    el.classList.toggle('is-error', state === 'error');
  }

  async function requireDraftsFolder() {
    if (!store || !store.isSupported()) {
      const err = new Error('Use Chrome or Edge to save drafts on this PC');
      err.code = 'FS_UNSUPPORTED';
      throw err;
    }
    if (draftsDirHandle && (await store.ensurePermission(draftsDirHandle))) {
      return draftsDirHandle;
    }
    // User gesture path: permission only when handle exists; first time confirms Documents.
    draftsDirHandle = await store.ensureAccess();
    setFolderStatus('ok', `Saving to Documents/${store.FOLDER_NAME}`);
    return draftsDirHandle;
  }

  async function allowLocalDrafts() {
    const btn = document.getElementById('connectFolder');
    setBusy(btn, true);
    try {
      if (!store || !store.isSupported()) {
        throw Object.assign(new Error('Use Chrome or Edge to save drafts on this PC'), {
          code: 'FS_UNSUPPORTED',
        });
      }
      draftsDirHandle = await store.ensureAccess();
      setFolderStatus('ok', `Saving to Documents/${store.FOLDER_NAME}`);
      await refreshDrafts();
    } catch (err) {
      if (err.code === 'FS_CANCELLED' || (err && err.name === 'AbortError')) {
        setFolderStatus('error', 'Permission cancelled');
        return;
      }
      setFolderStatus('error', err.message || 'Could not get folder permission');
      showError(err);
    } finally {
      setBusy(btn, false);
    }
  }

  function currentApiKey() {
    return apiKeyInput.value
      .trim()
      .replace(/^TEMPLATE_BUILDER_API_KEYS=/i, '')
      .replace(/^["']|["']$/g, '');
  }

  function headers(json = true) {
    const h = { 'X-Template-Builder-Key': currentApiKey() };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  async function api(url, options = {}) {
    const res = await fetch(url, options);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || res.statusText);
      err.status = res.status;
      err.hint = body.hint;
      err.unmapped = body.unmapped;
      throw err;
    }
    return body;
  }

  function setBusy(el, busy) {
    if (!el) return;
    el.classList.toggle('is-busy', busy);
    el.disabled = busy;
  }

  function syncEditorVisibility() {
    const hasDraft = Boolean(currentDraftId);
    document.getElementById('editorSection').hidden = !hasDraft;
    document.getElementById('editorEmpty').hidden = hasDraft;
    document.getElementById('editorActions').hidden = !hasDraft;
    if (!hasDraft) {
      document.getElementById('draftTitle').textContent = 'Templates';
      document.getElementById('draftMeta').textContent = 'Upload or open a draft';
    }
  }

  function markActiveDraft(id) {
    document.querySelectorAll('#draftList li').forEach((li) => {
      li.classList.toggle('is-active', String(li.dataset.id) === String(id));
    });
  }

  function unmappedNames() {
    return PM.unmappedNames(variables, filterOpsCache);
  }

  async function ensureMappingMeta() {
    await ensureModels();
    if (!filterOpsLoadPromise) {
      filterOpsLoadPromise = (async () => {
        try {
          const opsRes = await api('/api/catalog/filter-operators', {
            headers: headers(false),
          });
          if (Array.isArray(opsRes.data) && opsRes.data.length) {
            filterOpsCache = opsRes.data;
          }
        } catch (_err) {
          /* keep fallbacks */
        }
      })();
    }
    await filterOpsLoadPromise;
  }

  async function modelAfterHops(rootModel, hops) {
    let current = rootModel;
    for (const hop of hops || []) {
      if (!hop.relatedModel || !current) return null;
      current = hop.relatedModel;
    }
    return current;
  }

  function updateMapStatus() {
    const el = document.getElementById('mapStatus');
    const exportBtn = document.getElementById('exportEjs');
    const missing = unmappedNames();
    const countEl = document.getElementById('varsCount');
    countEl.textContent = String(variables.length);

    if (!variables.length) {
      el.textContent = 'No variables — export allowed';
      el.className = 'map-status is-ok';
      exportBtn.disabled = false;
      return;
    }
    if (missing.length) {
      el.textContent = `${missing.length} unmapped — export blocked`;
      el.className = 'map-status is-warn';
      exportBtn.disabled = true;
      return;
    }
    el.textContent = 'All mapped — ready to export';
    el.className = 'map-status is-ok';
    exportBtn.disabled = false;
  }

  function refreshPreview() {
    const raw = document.getElementById('ejsContent').value || '';
    // Preview: drop control tags; show output expressions as placeholders
    const html = raw
      .replace(/<%(?![=-])[\s\S]*?%>/g, '')
      .replace(/<%[=-]\s*([\s\S]*?)%>/g, (_m, expr) => {
        const name = String(expr).trim();
        return `<span class="ejs-var">{{${name}}}</span>`;
      });
    const iframe = document.getElementById('ejsPreview');
    // Force a document rebuild — identical srcdoc assignments can no-op.
    iframe.removeAttribute('srcdoc');
    iframe.srcdoc = html;
  }

  const toggleEjsSourceBtn = document.getElementById('toggleEjsSource');
  const ejsContentEl = document.getElementById('ejsContent');
  const previewSheet = document.getElementById('previewSheet');
  const previewPaneTitle = document.getElementById('previewPaneTitle');
  let ejsSourceOpen = false;

  function setEjsSourceOpen(open) {
    const next = Boolean(open);
    const wasOpen = ejsSourceOpen;
    ejsSourceOpen = next;
    previewSheet.classList.toggle('is-showing-source', ejsSourceOpen);
    toggleEjsSourceBtn.setAttribute('aria-pressed', ejsSourceOpen ? 'true' : 'false');
    toggleEjsSourceBtn.textContent = ejsSourceOpen ? 'Hide EJS' : 'View EJS';
    toggleEjsSourceBtn.title = ejsSourceOpen
      ? 'Show rendered template preview'
      : 'Show EJS source in the A4 preview frame';
    previewPaneTitle.textContent = ejsSourceOpen ? 'EJS source' : 'Template preview';
    if (ejsSourceOpen) {
      ejsContentEl.focus();
      return;
    }
    if (wasOpen) {
      refreshPreview();
      toggleEjsSourceBtn.focus();
    }
  }

  toggleEjsSourceBtn.addEventListener('click', () => {
    setEjsSourceOpen(!ejsSourceOpen);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ejsSourceOpen) {
      e.preventDefault();
      setEjsSourceOpen(false);
    }
  });

  async function fetchModelsOnce() {
    const { data } = await api('/api/catalog/models', { headers: headers(false) });
    modelsCache = Array.isArray(data) ? data : [];
  }

  /**
   * Load CRM model allowlist once. Prefetch on auth so the first post-upload
   * openDraft does not race a cold catalog call against a busy/remote DB.
   * Dedupes in-flight callers and retries once on transient failure.
   */
  async function ensureModels() {
    if (modelsCache.length) return;
    if (modelsLoadPromise) return modelsLoadPromise;

    modelsLoadPromise = (async () => {
      try {
        await fetchModelsOnce();
      } catch (firstErr) {
        // One retry — remote MySQL / idle pool drops show up as a one-shot 500 here.
        await new Promise((r) => setTimeout(r, 400));
        try {
          await fetchModelsOnce();
        } catch (_retryErr) {
          throw firstErr;
        }
      } finally {
        modelsLoadPromise = null;
      }
    })();

    return modelsLoadPromise;
  }

  async function loadFields(modelName) {
    if (!modelName) return [];
    if (fieldsCache[modelName]) return fieldsCache[modelName];
    const { data } = await api(`/api/catalog/models/${encodeURIComponent(modelName)}/fields`, {
      headers: headers(false),
    });
    fieldsCache[modelName] = (data && data.fields) || [];
    return fieldsCache[modelName];
  }

  async function loadRelatedModels(modelName) {
    if (!modelName) return [];
    if (relatedModelsCache[modelName]) return relatedModelsCache[modelName];
    const { data } = await api(
      `/api/catalog/models/${encodeURIComponent(modelName)}/related-models`,
      { headers: headers(false) }
    );
    relatedModelsCache[modelName] = (data && data.relatedModels) || [];
    return relatedModelsCache[modelName];
  }

  function appendModelOptions(selectEl, selectedModel) {
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = 'Select model…';
    selectEl.appendChild(opt0);
    modelsCache.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.available ? m.name : `${m.name} (table missing)`;
      opt.disabled = !m.available;
      if (selectedModel === m.name) opt.selected = true;
      selectEl.appendChild(opt);
    });
  }

  function touchVar(index, li) {
    variables[index] = PM.syncMirrors(variables[index]);
    if (li) {
      li.classList.toggle('is-mapped', isVariableMapped(variables[index]));
      li.classList.toggle('is-unmapped', !isVariableMapped(variables[index]));
      const sum = li.querySelector('.path-summary');
      if (sum) sum.textContent = PM.pathSummary(variables[index]);
    }
    updateMapStatus();
  }

  async function populateFields(selectEl, modelName, selectedField) {
    selectEl.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    if (!modelName) {
      placeholder.textContent = 'Select model first';
      selectEl.appendChild(placeholder);
      selectEl.disabled = true;
      return;
    }
    placeholder.textContent = 'Select field…';
    selectEl.appendChild(placeholder);
    selectEl.disabled = true;
    const fields = await loadFields(modelName);
    fields.forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f.name;
      opt.textContent = f.name;
      if (selectedField === f.name) opt.selected = true;
      selectEl.appendChild(opt);
    });
    selectEl.disabled = false;
  }

  async function populateRelatedModels(selectEl, modelName, selectedModel) {
    selectEl.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    if (!modelName) {
      placeholder.textContent = 'Select model first';
      selectEl.appendChild(placeholder);
      selectEl.disabled = true;
      return;
    }
    placeholder.textContent = 'Select related model…';
    selectEl.appendChild(placeholder);
    selectEl.disabled = true;
    const related = await loadRelatedModels(modelName);
    if (!related.length) {
      placeholder.textContent = 'No related models (FK) found';
      selectEl.disabled = true;
      return;
    }
    related.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.available ? m.name : `${m.name} (missing)`;
      opt.disabled = !m.available;
      if (selectedModel === m.name) opt.selected = true;
      selectEl.appendChild(opt);
    });
    selectEl.disabled = false;
  }

  function renderVariableList() {
    const list = document.getElementById('variableList');
    const empty = document.getElementById('variableEmpty');
    list.innerHTML = '';
    empty.hidden = variables.length > 0;

    variables.forEach((raw, index) => {
      variables[index] = normalizeVariable(raw);
      const v = variables[index];
      const li = document.createElement('li');
      li.className =
        'var-map-item' + (isVariableMapped(v) ? ' is-mapped' : ' is-unmapped');
      if (v.kind === 'collection') li.classList.add('is-collection');

      const nameEl = document.createElement('div');
      nameEl.className = 'var-map-name';
      const code = document.createElement('code');
      code.textContent =
        v.kind === 'collection' ? `{{#${v.name}}}` : `<%= ${v.name} %>`;
      nameEl.appendChild(code);
      if (v.kind === 'collection') {
        const badge = document.createElement('span');
        badge.className = 'var-kind-badge';
        badge.textContent = v.itemKind === 'string' ? 'array' : 'collection';
        nameEl.appendChild(badge);
      }
      li.appendChild(nameEl);

      const summary = document.createElement('p');
      summary.className = 'path-summary';
      summary.textContent = PM.pathSummary(v);
      summary.title = summary.textContent;
      li.appendChild(summary);

      const directMode = v.kind === 'scalar' && PM.isDirectMode(v);
      if (v.kind === 'scalar') {
        const modeRow = document.createElement('div');
        modeRow.className = 'segmented path-mode';
        modeRow.setAttribute('role', 'group');
        modeRow.setAttribute('aria-label', 'Mapping mode');
        const mkBtn = (label, active, onClick) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'segment' + (active ? ' is-active' : '');
          b.textContent = label;
          b.addEventListener('click', onClick);
          return b;
        };
        modeRow.appendChild(
          mkBtn('Direct field', directMode, () => {
            variables[index] = PM.setDirectField(
              variables[index],
              variables[index].rootModel,
              variables[index].leaf && variables[index].leaf.field
            );
            variables[index].hops = [];
            renderVariableList();
          })
        );
        modeRow.appendChild(
          mkBtn('Relation path', !directMode, () => {
            if (!variables[index].hops.length) {
              variables[index].hops = [PM.emptyHop()];
            }
            PM.syncMirrors(variables[index]);
            renderVariableList();
          })
        );
        li.appendChild(modeRow);
      }

      const rootLab = document.createElement('label');
      rootLab.className = 'field';
      rootLab.innerHTML = '<span>Root model</span>';
      const rootSel = document.createElement('select');
      appendModelOptions(rootSel, v.rootModel);
      rootSel.addEventListener('change', () => {
        variables[index].rootModel = rootSel.value || null;
        variables[index].hops = v.kind === 'collection' || !directMode ? [] : [];
        variables[index].valueSourceHop = null;
        if (v.kind === 'scalar') {
          if (!directMode) variables[index].hops = [PM.emptyHop()];
          variables[index].leaf = { field: null };
        } else {
          variables[index].hops = [PM.emptyHop()];
          (variables[index].itemFields || []).forEach((f) => {
            f.field = null;
          });
        }
        PM.syncMirrors(variables[index]);
        renderVariableList();
      });
      rootLab.appendChild(rootSel);
      li.appendChild(rootLab);

      const editor = document.createElement('div');
      editor.className = 'path-editor';
      li.appendChild(editor);

      (async () => {
        try {
          if (v.kind === 'scalar' && directMode) {
            const fieldLab = document.createElement('label');
            fieldLab.className = 'field';
            fieldLab.innerHTML = '<span>Field</span>';
            const fieldSel = document.createElement('select');
            fieldLab.appendChild(fieldSel);
            editor.appendChild(fieldLab);
            await populateFields(fieldSel, v.rootModel, v.leaf && v.leaf.field);
            fieldSel.addEventListener('change', () => {
              variables[index].leaf = { field: fieldSel.value || null };
              variables[index].hops = [];
              touchVar(index, li);
            });
            return;
          }

          // Relation path hops
          let fromModel = v.rootModel;
          for (let hi = 0; hi < v.hops.length; hi += 1) {
            const hop = v.hops[hi];
            const hopEl = document.createElement('div');
            hopEl.className = 'path-hop';
            const hopHead = document.createElement('div');
            hopHead.className = 'path-hop-head';
            hopHead.innerHTML = `<span class="path-hop-label">Hop ${hi + 1}</span>`;
            const removeHop = document.createElement('button');
            removeHop.type = 'button';
            removeHop.className = 'btn btn-ghost btn-sm';
            removeHop.textContent = 'Remove';
            removeHop.disabled = v.kind === 'collection' && v.hops.length === 1;
            removeHop.addEventListener('click', () => {
              variables[index].hops.splice(hi, 1);
              if (v.kind === 'scalar' && !variables[index].hops.length) {
                /* stay in path mode with empty hop */
                variables[index].hops = [PM.emptyHop()];
              }
              PM.clampValueSourceHop(variables[index]);
              PM.clearValueFields(variables[index]);
              PM.syncMirrors(variables[index]);
              renderVariableList();
            });
            hopHead.appendChild(removeHop);
            hopEl.appendChild(hopHead);

            const relatedLab = document.createElement('label');
            relatedLab.className = 'field';
            relatedLab.innerHTML = '<span>Related model</span>';
            const relatedSel = document.createElement('select');
            relatedLab.appendChild(relatedSel);
            hopEl.appendChild(relatedLab);
            await populateRelatedModels(relatedSel, fromModel, hop.relatedModel);

            relatedSel.addEventListener('change', async () => {
              variables[index].hops[hi].relatedModel = relatedSel.value || '';
              variables[index].hops = variables[index].hops.slice(0, hi + 1);
              PM.clampValueSourceHop(variables[index]);
              PM.clearValueFields(variables[index]);
              PM.syncMirrors(variables[index]);
              renderVariableList();
            });

            const filtersBox = document.createElement('div');
            filtersBox.className = 'path-filters';
            const filtersHead = document.createElement('div');
            filtersHead.className = 'path-filters-head';
            filtersHead.innerHTML = '<span>Filters (AND)</span>';
            const addFilterBtn = document.createElement('button');
            addFilterBtn.type = 'button';
            addFilterBtn.className = 'btn btn-ghost btn-sm';
            addFilterBtn.textContent = '+ Filter';
            addFilterBtn.addEventListener('click', () => {
              if (!variables[index].hops[hi].filters) {
                variables[index].hops[hi].filters = [];
              }
              variables[index].hops[hi].filters.push(PM.emptyFilter());
              renderVariableList();
            });
            filtersHead.appendChild(addFilterBtn);
            filtersBox.appendChild(filtersHead);

            // Filters apply on the related model of this hop
            const filterModelName = hop.relatedModel || null;
            const cols = filterModelName
              ? await loadFields(filterModelName)
              : fromModel
                ? await loadFields(fromModel)
                : [];

            (hop.filters || []).forEach((filt, fi) => {
              const row = document.createElement('div');
              row.className = 'path-filter-row';
              const colSel = document.createElement('select');
              colSel.setAttribute('aria-label', 'Filter column');
              const c0 = document.createElement('option');
              c0.value = '';
              c0.textContent = 'Column…';
              colSel.appendChild(c0);
              cols.forEach((c) => {
                const o = document.createElement('option');
                o.value = c.name;
                o.textContent = c.name;
                if (filt.column === c.name) o.selected = true;
                colSel.appendChild(o);
              });
              const opSel = document.createElement('select');
              opSel.setAttribute('aria-label', 'Filter operator');
              filterOpsCache.forEach((op) => {
                const o = document.createElement('option');
                o.value = op.op;
                o.textContent = op.label;
                if (filt.op === op.op) o.selected = true;
                opSel.appendChild(o);
              });
              const valInput = document.createElement('input');
              valInput.type = 'text';
              valInput.placeholder = 'Value';
              valInput.value = filt.value || '';
              valInput.disabled = !PM.opNeedsValue(filt.op, filterOpsCache);
              const rm = document.createElement('button');
              rm.type = 'button';
              rm.className = 'btn btn-ghost btn-sm';
              rm.textContent = '×';
              rm.setAttribute('aria-label', 'Remove filter');
              const commitFilter = () => {
                variables[index].hops[hi].filters[fi] = {
                  column: colSel.value,
                  op: opSel.value,
                  value: valInput.value,
                };
                valInput.disabled = !PM.opNeedsValue(opSel.value, filterOpsCache);
                touchVar(index, li);
              };
              colSel.addEventListener('change', commitFilter);
              opSel.addEventListener('change', commitFilter);
              valInput.addEventListener('change', commitFilter);
              valInput.addEventListener('input', () => {
                variables[index].hops[hi].filters[fi].value = valInput.value;
                touchVar(index, li);
              });
              rm.addEventListener('click', () => {
                variables[index].hops[hi].filters.splice(fi, 1);
                renderVariableList();
              });
              row.appendChild(colSel);
              row.appendChild(opSel);
              row.appendChild(valInput);
              row.appendChild(rm);
              filtersBox.appendChild(row);
            });
            hopEl.appendChild(filtersBox);
            editor.appendChild(hopEl);

            fromModel = hop.relatedModel || null;
          }

          const addHopBtn = document.createElement('button');
          addHopBtn.type = 'button';
          addHopBtn.className = 'btn btn-secondary btn-sm path-add-hop';
          addHopBtn.textContent = '+ Hop';
          addHopBtn.disabled = !fromModel;
          addHopBtn.addEventListener('click', () => {
            const prevLen = variables[index].hops.length;
            const prevEffective = PM.effectiveValueSourceHop(variables[index]);
            variables[index].hops.push(PM.emptyHop());
            // Keep default "last hop" pinned so source does not jump to the empty new hop
            if (
              (variables[index].valueSourceHop === null ||
                variables[index].valueSourceHop === undefined) &&
              prevLen > 0 &&
              prevEffective === prevLen - 1
            ) {
              variables[index].valueSourceHop = prevLen - 1;
            } else {
              PM.clampValueSourceHop(variables[index]);
            }
            PM.clearValueFields(variables[index]);
            PM.syncMirrors(variables[index]);
            renderVariableList();
          });
          editor.appendChild(addHopBtn);

          const sourceIdx = PM.effectiveValueSourceHop(variables[index]);
          const sourceModel =
            sourceIdx === null
              ? fromModel
              : PM.modelAtValueSource(v.rootModel, v.hops, sourceIdx);

          const valueFromLab = document.createElement('label');
          valueFromLab.className = 'field';
          valueFromLab.innerHTML = '<span>Value from</span>';
          const valueFromSel = document.createElement('select');
          valueFromSel.setAttribute('aria-label', 'Value source model on path');
          const rootOpt = document.createElement('option');
          rootOpt.value = '-1';
          rootOpt.textContent = `${v.rootModel || 'Root'} (root)`;
          if (sourceIdx === -1) rootOpt.selected = true;
          valueFromSel.appendChild(rootOpt);
          (v.hops || []).forEach((hop, hopIdx) => {
            if (!hop.relatedModel) return;
            const o = document.createElement('option');
            o.value = String(hopIdx);
            o.textContent = `${hop.relatedModel} (hop ${hopIdx + 1})`;
            if (sourceIdx === hopIdx) o.selected = true;
            valueFromSel.appendChild(o);
          });
          valueFromSel.addEventListener('change', () => {
            const next = Number(valueFromSel.value);
            variables[index].valueSourceHop = Number.isInteger(next) ? next : null;
            PM.clearValueFields(variables[index]);
            PM.syncMirrors(variables[index]);
            renderVariableList();
          });
          valueFromLab.appendChild(valueFromSel);
          editor.appendChild(valueFromLab);

          if (v.kind === 'scalar') {
            const leafLab = document.createElement('label');
            leafLab.className = 'field';
            leafLab.innerHTML = '<span>Value field</span>';
            const leafSel = document.createElement('select');
            leafLab.appendChild(leafSel);
            editor.appendChild(leafLab);
            await populateFields(leafSel, sourceModel, v.leaf && v.leaf.field);
            leafSel.addEventListener('change', () => {
              variables[index].leaf = { field: leafSel.value || null };
              touchVar(index, li);
            });
          } else if (v.itemKind !== 'string' && (v.itemFields || []).length) {
            const itemFieldsList = document.createElement('ul');
            itemFieldsList.className = 'var-item-fields';
            for (let fi = 0; fi < v.itemFields.length; fi += 1) {
              const f = v.itemFields[fi];
              const row = document.createElement('li');
              row.className = 'var-item-field';
              const lab = document.createElement('label');
              lab.className = 'field';
              const span = document.createElement('span');
              const c = document.createElement('code');
              c.textContent = f.name;
              span.appendChild(c);
              lab.appendChild(span);
              const sel = document.createElement('select');
              lab.appendChild(sel);
              row.appendChild(lab);
              itemFieldsList.appendChild(row);
              await populateFields(sel, sourceModel, f.field);
              sel.addEventListener('change', () => {
                variables[index].itemFields[fi].field = sel.value || null;
                touchVar(index, li);
              });
            }
            editor.appendChild(itemFieldsList);
          }

          touchVar(index, li);
        } catch (err) {
          showError(err);
        }
      })();

      list.appendChild(li);
    });

    updateMapStatus();
  }

  async function refreshDrafts() {
    const list = document.getElementById('draftList');
    const empty = document.getElementById('draftEmpty');
    list.innerHTML = '';

    let data = [];
    try {
      const dir = await requireDraftsFolder();
      data = await store.listDrafts(dir);
    } catch (err) {
      empty.hidden = false;
      empty.textContent =
        err.code === 'FS_UNSUPPORTED'
          ? 'Local drafts need Chrome or Edge.'
          : 'Allow access to Documents/convert-ejs-tool to see drafts.';
      throw err;
    }

    empty.textContent = 'No drafts yet. Upload a DOCX to start.';
    empty.hidden = data.length > 0;

    data.forEach((d) => {
      const li = document.createElement('li');
      li.dataset.id = String(d.id);
      if (currentDraftId === d.id) li.classList.add('is-active');

      const info = document.createElement('div');
      info.className = 'draft-info';
      info.innerHTML = `<span class="draft-name"></span><span class="draft-status"></span>`;
      info.querySelector('.draft-name').textContent = d.name;
      info.querySelector('.draft-status').textContent = d.status;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-ghost';
      btn.textContent = 'Open';
      btn.onclick = () => openDraft(d.id);

      li.appendChild(info);
      li.appendChild(btn);
      li.addEventListener('click', (e) => {
        if (e.target === btn) return;
        openDraft(d.id);
      });
      list.appendChild(li);
    });
  }

  async function openDraft(id) {
    const dir = await requireDraftsFolder();
    const data = await store.readDraft(dir, id);
    if (!data) {
      const err = new Error('Draft not found in local folder');
      err.status = 404;
      throw err;
    }
    currentDraftId = data.id;
    currentDraftName = data.name || `Draft #${data.id}`;
    syncEditorVisibility();
    markActiveDraft(data.id);

    document.getElementById('draftTitle').textContent = currentDraftName;
    document.getElementById('draftMeta').textContent = `${data.id} · ${data.status}`;
    document.getElementById('ejsContent').value = data.ejs_content || '';
    setEjsSourceOpen(false);
    refreshPreview();

    variables = Array.isArray(data.variables_json)
      ? data.variables_json.map(normalizeVariable)
      : [];

    clearStatus();
    document.getElementById('result').textContent = '';
    document.getElementById('result').classList.remove('is-error');

    try {
      await ensureMappingMeta();
      renderVariableList();
    } catch (err) {
      showError(err);
      renderVariableList();
    }
  }

  function clearStatus() {
    const banner = document.getElementById('statusBanner');
    banner.hidden = true;
    banner.textContent = '';
    banner.classList.remove('is-ok');
  }

  function setAuthStatus(state, message) {
    const el = document.getElementById('authStatus');
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      el.classList.remove('is-ok', 'is-error');
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle('is-ok', state === 'ok');
    el.classList.toggle('is-error', state === 'error');
  }

  async function submitApiKey() {
    const key = apiKeyInput.value.trim();
    const btn = document.getElementById('submitApiKey');
    if (!key) {
      setAuthStatus('error', 'Enter API key');
      showError(new Error('Unauthorized'));
      return;
    }

    const normalized = key.replace(/^TEMPLATE_BUILDER_API_KEYS=/i, '').replace(/^["']|["']$/g, '');
    if (normalized !== key) apiKeyInput.value = normalized;

    sessionStorage.setItem(API_KEY_STORAGE, normalized);
    setBusy(btn, true);
    setAuthStatus(null, '');
    try {
      // Auth check via model catalog (drafts are local-only).
      await ensureModels();
      clearStatus();
      document.getElementById('result').textContent = '';
      document.getElementById('result').classList.remove('is-error');
      setAuthStatus('ok', 'Connected');
      const peeked = store && store.isSupported() ? await store.peekAccess() : null;
      if (peeked) {
        draftsDirHandle = peeked;
        setFolderStatus('ok', `Saving to Documents/${store.FOLDER_NAME}`);
        await refreshDrafts();
      } else if (!store || !store.isSupported()) {
        setFolderStatus('error', 'Use Chrome or Edge for local drafts');
      } else {
        setFolderStatus(null, '');
      }
    } catch (err) {
      const isAuth = err.status === 401 || /unauthorized|invalid auth/i.test(String(err.message || ''));
      setAuthStatus('error', isAuth ? 'Invalid Key' : 'Request failed');
      showError(err);
    } finally {
      setBusy(btn, false);
    }
  }

  document.getElementById('connectFolder').addEventListener('click', () => {
    allowLocalDrafts();
  });

  document.getElementById('refreshDrafts').addEventListener('click', () => {
    refreshDrafts().catch(showError);
  });

  document.getElementById('apiKeyForm').addEventListener('submit', (e) => {
    e.preventDefault();
    submitApiKey();
  });

  document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const fd = new FormData(form);
    setBusy(submitBtn, true);
    try {
      const dir = await requireDraftsFolder();
      const res = await fetch('/api/drafts/upload', {
        method: 'POST',
        headers: { 'X-Template-Builder-Key': currentApiKey() },
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      const saved = await store.writeDraft(dir, body.data);
      form.reset();
      await refreshDrafts();
      await openDraft(saved.id);
      const banner = document.getElementById('statusBanner');
      banner.hidden = false;
      banner.classList.add('is-ok');
      banner.textContent = `Draft saved to ${store.FOLDER_NAME}`;
    } catch (err) {
      showError(err);
    } finally {
      setBusy(submitBtn, false);
    }
  });

  document.getElementById('saveDraft').addEventListener('click', async () => {
    if (!currentDraftId) return;
    const btn = document.getElementById('saveDraft');
    setBusy(btn, true);
    try {
      const dir = await requireDraftsFolder();
      const existing = (await store.readDraft(dir, currentDraftId)) || { id: currentDraftId };
      const data = await store.writeDraft(dir, {
        ...existing,
        id: currentDraftId,
        name: currentDraftName || existing.name,
        status: existing.status === 'exported' ? 'draft' : existing.status || 'draft',
        variables_json: variables,
        ejs_content: document.getElementById('ejsContent').value,
      });
      variables = Array.isArray(data.variables_json)
        ? data.variables_json.map(normalizeVariable)
        : variables;
      const out = document.getElementById('result');
      out.classList.remove('is-error');
      out.textContent = JSON.stringify(
        { id: data.id, status: data.status, variables: data.variables_json, saved: 'local' },
        null,
        2
      );
      document.getElementById('draftMeta').textContent = `${data.id} · ${data.status}`;
      await refreshDrafts();
      markActiveDraft(currentDraftId);
      updateMapStatus();
      const banner = document.getElementById('statusBanner');
      banner.hidden = false;
      banner.classList.add('is-ok');
      banner.textContent = 'Mapping saved locally';
    } catch (err) {
      showError(err);
    } finally {
      setBusy(btn, false);
    }
  });

  document.getElementById('exportEjs').addEventListener('click', async () => {
    if (!currentDraftId) return;
    const missing = unmappedNames();
    if (missing.length) {
      showError(new Error(`Map all variables before export. Unmapped: ${missing.join(', ')}`));
      return;
    }
    const btn = document.getElementById('exportEjs');
    setBusy(btn, true);
    try {
      const dir = await requireDraftsFolder();
      const existing = (await store.readDraft(dir, currentDraftId)) || { id: currentDraftId };
      const ejsContent = document.getElementById('ejsContent').value;
      const localDraft = await store.writeDraft(dir, {
        ...existing,
        id: currentDraftId,
        name: currentDraftName || existing.name,
        variables_json: variables,
        ejs_content: ejsContent,
      });

      const { data } = await api(`/api/drafts/${currentDraftId}/export-ejs`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          id: localDraft.id,
          name: localDraft.name,
          ejs_content: localDraft.ejs_content,
          variables_json: localDraft.variables_json,
          description: localDraft.description,
        }),
      });

      if (data.draft) {
        await store.writeDraft(dir, { ...localDraft, ...data.draft });
      }

      const fileName = data.file_name || `${currentDraftName || 'template'}.ejs`;
      const content =
        data.ejs_content != null
          ? data.ejs_content
          : ejsContent;
      downloadTextFile(fileName, content);

      const out = document.getElementById('result');
      out.classList.remove('is-error');
      out.textContent = JSON.stringify(
        {
          file_name: data.file_name,
          path_template: data.path_template,
          absolute_ejs_path: data.absolute_ejs_path,
          downloaded: true,
          saved: 'local',
        },
        null,
        2
      );
      const banner = document.getElementById('statusBanner');
      banner.hidden = false;
      banner.classList.add('is-ok');
      banner.textContent = `Downloaded ${fileName}`;
      await refreshDrafts();
      await openDraft(currentDraftId);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(btn, false);
    }
  });

  function downloadTextFile(fileName, content) {
    const safeName = String(fileName || 'template.ejs').replace(/[\\/:*?"<>|]/g, '_');
    const blob = new Blob([content ?? ''], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName.endsWith('.ejs') ? safeName : `${safeName}.ejs`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function showError(err) {
    const message = String(err.message || err);
    const banner = document.getElementById('statusBanner');
    banner.hidden = false;
    banner.classList.remove('is-ok');
    banner.textContent = message;
    const out = document.getElementById('result');
    out.classList.add('is-error');
    out.textContent = message;
  }

  syncEditorVisibility();

  (async () => {
    if (store && store.isSupported()) {
      try {
        const handle = await store.peekAccess();
        if (handle) {
          draftsDirHandle = handle;
          setFolderStatus('ok', `Saving to Documents/${store.FOLDER_NAME}`);
        } else {
          setFolderStatus(null, '');
        }
      } catch (_err) {
        setFolderStatus(null, '');
      }
    } else {
      setFolderStatus('error', 'Use Chrome or Edge for local drafts');
    }
    if (apiKeyInput.value.trim()) {
      submitApiKey();
    }
  })();
})();
