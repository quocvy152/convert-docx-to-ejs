(() => {
  const DB_NAME = 'templateBuilder';
  const DB_VERSION = 1;
  const HANDLE_STORE = 'handles';
  const HANDLE_KEY = 'draftsDir';
  const FOLDER_NAME = 'convert-ejs-tool';

  function isSupported() {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(HANDLE_STORE)) {
          db.createObjectStore(HANDLE_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readonly');
      const req = tx.objectStore(HANDLE_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getStoredHandle() {
    return idbGet(HANDLE_KEY);
  }

  async function setStoredHandle(handle) {
    await idbSet(HANDLE_KEY, handle);
  }

  async function queryPermission(handle, mode = 'readwrite') {
    if (!handle?.queryPermission) return false;
    const state = await handle.queryPermission({ mode });
    return state === 'granted';
  }

  async function requestPermission(handle, mode = 'readwrite') {
    if (!handle?.requestPermission) return false;
    const state = await handle.requestPermission({ mode });
    return state === 'granted';
  }

  async function ensurePermission(handle, mode = 'readwrite') {
    if (!handle) return false;
    if (await queryPermission(handle, mode)) return true;
    return requestPermission(handle, mode);
  }

  /**
   * Default target: Documents/convert-ejs-tool.
   * If the user confirms Documents (picker starts there), create the subfolder.
   * If they somehow land on convert-ejs-tool itself, use it as-is.
   */
  async function resolveToolDirectory(picked) {
    if (!picked) throw new Error('No directory selected');
    if (picked.name === FOLDER_NAME) return picked;
    return picked.getDirectoryHandle(FOLDER_NAME, { create: true });
  }

  /**
   * Silent check — no prompts. Use on page load.
   */
  async function peekAccess() {
    if (!isSupported()) return null;
    const handle = await getStoredHandle();
    if (!handle) return null;
    if (!(await queryPermission(handle, 'readwrite'))) return null;
    return handle;
  }

  /**
   * Must run from a user gesture.
   * - Returning users: permission prompt only (Allow / Deny) for Documents/convert-ejs-tool
   * - First time: browser requires confirming Documents once; we then create convert-ejs-tool
   */
  async function ensureAccess() {
    if (!isSupported()) {
      const err = new Error(
        'This browser cannot write to a local folder. Use Chrome or Edge.'
      );
      err.code = 'FS_UNSUPPORTED';
      throw err;
    }

    const stored = await getStoredHandle();
    if (stored) {
      if (await ensurePermission(stored, 'readwrite')) {
        return stored;
      }
      const denied = new Error('Permission denied for Documents/convert-ejs-tool');
      denied.code = 'FS_DENIED';
      throw denied;
    }

    // First grant only: open at Documents (path is fixed by us after confirm).
    let documents;
    try {
      documents = await window.showDirectoryPicker({
        id: FOLDER_NAME,
        mode: 'readwrite',
        startIn: 'documents',
      });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        const cancelled = new Error('Permission cancelled');
        cancelled.code = 'FS_CANCELLED';
        throw cancelled;
      }
      throw err;
    }

    const toolDir = await resolveToolDirectory(documents);
    if (!(await ensurePermission(toolDir, 'readwrite'))) {
      const denied = new Error('Permission denied for Documents/convert-ejs-tool');
      denied.code = 'FS_DENIED';
      throw denied;
    }
    await setStoredHandle(toolDir);
    return toolDir;
  }

  /** @deprecated use ensureAccess */
  async function connectFolder() {
    return ensureAccess();
  }

  /** @deprecated use peekAccess / ensureAccess */
  async function reconnect() {
    return peekAccess();
  }

  function draftFileName(id) {
    return `${id}.json`;
  }

  async function listDrafts(dirHandle) {
    const drafts = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.json')) continue;
      try {
        const file = await handle.getFile();
        const raw = JSON.parse(await file.text());
        if (raw && raw.is_deleted) continue;
        drafts.push(raw);
      } catch (_err) {
        // skip corrupt
      }
    }
    drafts.sort((a, b) => String(b.updated_time || '').localeCompare(String(a.updated_time || '')));
    return drafts;
  }

  async function readDraft(dirHandle, id) {
    try {
      const fileHandle = await dirHandle.getFileHandle(draftFileName(id));
      const file = await fileHandle.getFile();
      const raw = JSON.parse(await file.text());
      if (raw.is_deleted) return null;
      return raw;
    } catch (err) {
      if (err && (err.name === 'NotFoundError' || err.code === 'NotFoundError')) return null;
      throw err;
    }
  }

  async function writeDraft(dirHandle, draft) {
    if (!draft || !draft.id) throw new Error('Draft id is required');
    const now = new Date().toISOString();
    const record = {
      ...draft,
      updated_time: now,
      created_time: draft.created_time || now,
      is_deleted: draft.is_deleted ?? false,
    };
    const fileHandle = await dirHandle.getFileHandle(draftFileName(record.id), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(record, null, 2));
    await writable.close();
    return record;
  }

  window.LocalDraftStore = {
    FOLDER_NAME,
    isSupported,
    ensureAccess,
    peekAccess,
    connectFolder,
    reconnect,
    ensurePermission,
    listDrafts,
    readDraft,
    writeDraft,
    getStoredHandle,
  };
})();
