(() => {
  let currentDraftId = null;
  let currentDraftName = '';
  /** @type {{ name: string, model: string|null, field: string|null }[]} */
  let variables = [];
  /** @type {{ name: string, table: string, available: boolean }[]} */
  let modelsCache = [];
  /** @type {Record<string, { name: string }[]>} */
  let fieldsCache = {};

  const API_KEY_STORAGE = 'templateBuilder.apiKey';

  const apiKeyInput = document.getElementById('apiKey');
  const savedKey = sessionStorage.getItem(API_KEY_STORAGE);
  if (savedKey) apiKeyInput.value = savedKey;

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
    return variables.filter((v) => !v.model || !v.field).map((v) => v.name);
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
    // Preview: strip EJS tags to placeholders so iframe shows structure
    const html = raw.replace(/<%[=-]?\s*([\s\S]*?)%>/g, (_m, expr) => {
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

  async function ensureModels() {
    if (modelsCache.length) return;
    const { data } = await api('/api/catalog/models', { headers: headers(false) });
    modelsCache = data || [];
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

  function renderVariableList() {
    const list = document.getElementById('variableList');
    const empty = document.getElementById('variableEmpty');
    list.innerHTML = '';
    empty.hidden = variables.length > 0;

    variables.forEach((v, index) => {
      const li = document.createElement('li');
      li.className = 'var-map-item' + (v.model && v.field ? ' is-mapped' : ' is-unmapped');

      const nameEl = document.createElement('div');
      nameEl.className = 'var-map-name';
      nameEl.innerHTML = `<code></code>`;
      nameEl.querySelector('code').textContent = `<%= ${v.name} %>`;

      const modelLabel = document.createElement('label');
      modelLabel.className = 'field';
      modelLabel.innerHTML = `<span>Model</span>`;
      const modelSelect = document.createElement('select');
      modelSelect.dataset.index = String(index);
      modelSelect.dataset.role = 'model';
      const opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = 'Select model…';
      modelSelect.appendChild(opt0);
      modelsCache.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.name;
        opt.textContent = m.available ? m.name : `${m.name} (table missing)`;
        opt.disabled = !m.available;
        if (v.model === m.name) opt.selected = true;
        modelSelect.appendChild(opt);
      });
      modelLabel.appendChild(modelSelect);

      const fieldLabel = document.createElement('label');
      fieldLabel.className = 'field';
      fieldLabel.innerHTML = `<span>Field</span>`;
      const fieldSelect = document.createElement('select');
      fieldSelect.dataset.index = String(index);
      fieldSelect.dataset.role = 'field';
      fieldSelect.disabled = !v.model;
      const f0 = document.createElement('option');
      f0.value = '';
      f0.textContent = v.model ? 'Select field…' : 'Select model first';
      fieldSelect.appendChild(f0);
      fieldLabel.appendChild(fieldSelect);

      modelSelect.addEventListener('change', async () => {
        const i = Number(modelSelect.dataset.index);
        variables[i].model = modelSelect.value || null;
        variables[i].field = null;
        try {
          await populateFields(fieldSelect, variables[i].model, null);
          updateMapStatus();
        } catch (err) {
          showError(err);
        }
      });

      fieldSelect.addEventListener('change', () => {
        const i = Number(fieldSelect.dataset.index);
        variables[i].field = fieldSelect.value || null;
        li.classList.toggle('is-mapped', Boolean(variables[i].model && variables[i].field));
        li.classList.toggle('is-unmapped', !(variables[i].model && variables[i].field));
        updateMapStatus();
      });

      li.appendChild(nameEl);
      li.appendChild(modelLabel);
      li.appendChild(fieldLabel);
      list.appendChild(li);

      if (v.model) {
        populateFields(fieldSelect, v.model, v.field).catch(showError);
      }
    });

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

  async function refreshDrafts() {
    const { data } = await api('/api/drafts', { headers: headers(false) });
    const list = document.getElementById('draftList');
    const empty = document.getElementById('draftEmpty');
    list.innerHTML = '';
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
    const { data } = await api(`/api/drafts/${id}`, { headers: headers(false) });
    currentDraftId = data.id;
    currentDraftName = data.name || `Draft #${data.id}`;
    syncEditorVisibility();
    markActiveDraft(data.id);

    document.getElementById('draftTitle').textContent = currentDraftName;
    document.getElementById('draftMeta').textContent = `#${data.id} · ${data.status}`;
    document.getElementById('ejsContent').value = data.ejs_content || '';
    setEjsSourceOpen(false);
    refreshPreview();

    variables = Array.isArray(data.variables_json)
      ? data.variables_json.map((v) => ({
          name: v.name,
          model: v.model || null,
          field: v.field || null,
        }))
      : [];

    clearStatus();
    document.getElementById('result').textContent = '';
    document.getElementById('result').classList.remove('is-error');

    try {
      await ensureModels();
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
      await refreshDrafts();
      clearStatus();
      document.getElementById('result').textContent = '';
      document.getElementById('result').classList.remove('is-error');
      setAuthStatus('ok', 'Connected');
    } catch (err) {
      const isAuth = err.status === 401 || /unauthorized|invalid auth/i.test(String(err.message || ''));
      setAuthStatus('error', isAuth ? 'Invalid Key' : 'Request failed');
      showError(err);
    } finally {
      setBusy(btn, false);
    }
  }

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
      const res = await fetch('/api/drafts/upload', {
        method: 'POST',
        headers: { 'X-Template-Builder-Key': currentApiKey() },
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || res.statusText);
      form.reset();
      await refreshDrafts();
      await openDraft(body.data.id);
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
      const { data } = await api(`/api/drafts/${currentDraftId}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
          variables_json: variables,
          ejs_content: document.getElementById('ejsContent').value,
        }),
      });
      variables = Array.isArray(data.variables_json)
        ? data.variables_json.map((v) => ({
            name: v.name,
            model: v.model || null,
            field: v.field || null,
          }))
        : variables;
      const out = document.getElementById('result');
      out.classList.remove('is-error');
      out.textContent = JSON.stringify(
        { id: data.id, status: data.status, variables: data.variables_json },
        null,
        2
      );
      document.getElementById('draftMeta').textContent = `#${data.id} · ${data.status}`;
      await refreshDrafts();
      markActiveDraft(currentDraftId);
      updateMapStatus();
      const banner = document.getElementById('statusBanner');
      banner.hidden = false;
      banner.classList.add('is-ok');
      banner.textContent = 'Mapping saved';
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
      // Persist mapping first
      await api(`/api/drafts/${currentDraftId}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ variables_json: variables }),
      });
      const { data } = await api(`/api/drafts/${currentDraftId}/export-ejs`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({}),
      });

      const fileName = data.file_name || `${currentDraftName || 'template'}.ejs`;
      const content =
        data.ejs_content != null
          ? data.ejs_content
          : document.getElementById('ejsContent').value;
      downloadTextFile(fileName, content);

      const out = document.getElementById('result');
      out.classList.remove('is-error');
      out.textContent = JSON.stringify(
        {
          file_name: data.file_name,
          path_template: data.path_template,
          absolute_ejs_path: data.absolute_ejs_path,
          downloaded: true,
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
  if (apiKeyInput.value.trim()) {
    submitApiKey();
  }
})();
