// ─── FillyJobber — Local backup, export/import, folder sync ──────────────────

const BACKUP_VERSION = 1;
const BACKUP_DB_NAME = 'jobfill-backup';
const BACKUP_STORE = 'handles';
const DIR_HANDLE_KEY = 'backupDir';

const BACKUP_FILES = {
  meta: 'jobfill-meta.json',
  profile: 'jobfill-profile.json',
  applications: 'jobfill-applications.json',
  settings: 'jobfill-settings.json',
  resumePdf: 'jobfill-resume.pdf',
  resumeTxt: 'jobfill-resume.txt'
};

const SETTINGS_KEYS = [
  'autoFill', 'fuzzyMatch', 'notify', 'aiProvider', 'model',
  'customEndpoint', 'customModel', 'backupIncludeApiKey', 'backupFolderName'
];

const STORAGE_KEYS = [
  'profileData', 'profileName', 'applications', 'resumeName',
  'resumeText', 'resumeB64', 'apiKey', ...SETTINGS_KEYS
];

let syncTimer = null;
let syncInProgress = false;

function supportsFolderSync() {
  return typeof window.showDirectoryPicker === 'function';
}

function openBackupDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BACKUP_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BACKUP_STORE)) {
        db.createObjectStore(BACKUP_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDirHandle(handle) {
  const db = await openBackupDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, 'readwrite');
    tx.objectStore(BACKUP_STORE).put(handle, DIR_HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadDirHandle() {
  const db = await openBackupDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, 'readonly');
    const req = tx.objectStore(BACKUP_STORE).get(DIR_HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function clearDirHandle() {
  const db = await openBackupDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE, 'readwrite');
    tx.objectStore(BACKUP_STORE).delete(DIR_HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function verifyDirPermission(handle, writable = true) {
  if (!handle) return false;
  const mode = writable ? 'readwrite' : 'read';
  let perm = await handle.queryPermission({ mode });
  if (perm === 'granted') return true;
  perm = await handle.requestPermission({ mode });
  return perm === 'granted';
}

async function writeFile(handle, name, contents) {
  const fileHandle = await handle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(contents);
  await writable.close();
}

async function readFileText(handle, name) {
  try {
    const fileHandle = await handle.getFileHandle(name);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

async function readFileBlob(handle, name) {
  try {
    const fileHandle = await handle.getFileHandle(name);
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      resolve(dataUrl.split(',')[1] || '');
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function storageGet(keys) {
  return new Promise(resolve => {
    chrome.storage.local.get(keys, resolve);
  });
}

function storageSet(data) {
  return new Promise(resolve => {
    chrome.storage.local.set(data, resolve);
  });
}

function storageRemove(keys) {
  return new Promise(resolve => {
    chrome.storage.local.remove(keys, resolve);
  });
}

async function collectBackupData(includeApiKey = false) {
  const data = await storageGet(STORAGE_KEYS);
  const includeKey = includeApiKey && data.backupIncludeApiKey;

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'FillyJobber',
    profile: {
      data: data.profileData || {},
      name: data.profileName || ''
    },
    applications: normalizeApplicationsList(data.applications),
    settings: {
      autoFill: data.autoFill ?? false,
      fuzzyMatch: data.fuzzyMatch ?? true,
      notify: data.notify ?? true,
      aiProvider: data.aiProvider || 'anthropic',
      model: data.model || '',
      customEndpoint: data.customEndpoint || '',
      customModel: data.customModel || ''
    },
    resume: {
      name: data.resumeName || '',
      text: data.resumeText || null,
      b64: data.resumeB64 || null
    },
    apiKey: includeKey ? (data.apiKey || '') : undefined
  };
}

async function applyBackupPayload(payload, { mergeApplications: merge = false } = {}) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid backup file.');
  }
  if (payload.version && payload.version > BACKUP_VERSION) {
    throw new Error('This backup was created with a newer version of FillyJobber.');
  }

  const current = await storageGet(['applications', 'profileData']);
  const patch = {};

  if (payload.profile) {
    patch.profileData = payload.profile.data || {};
    patch.profileName = payload.profile.name || 'Imported Profile';
  }

  if (payload.applications) {
    const incoming = normalizeApplicationsList(payload.applications);
    patch.applications = merge
      ? mergeApplications(current.applications, incoming)
      : incoming;
  }

  if (payload.settings) {
    Object.assign(patch, {
      autoFill: payload.settings.autoFill ?? false,
      fuzzyMatch: payload.settings.fuzzyMatch ?? true,
      notify: payload.settings.notify ?? true,
      aiProvider: payload.settings.aiProvider || 'anthropic',
      model: payload.settings.model || '',
      customEndpoint: payload.settings.customEndpoint || '',
      customModel: payload.settings.customModel || ''
    });
  }

  if (payload.resume) {
    patch.resumeName = payload.resume.name || '';
    patch.resumeText = payload.resume.text || null;
    patch.resumeB64 = payload.resume.b64 || null;
    if (!patch.resumeText && !patch.resumeB64) {
      patch.resumeName = '';
    }
  }

  if (payload.apiKey) {
    patch.apiKey = payload.apiKey;
  }

  await storageSet(patch);
  return patch;
}

async function exportBackupDownload(includeApiKey = false) {
  const payload = await collectBackupData(includeApiKey);
  const json = JSON.stringify(payload, null, 2);
  const date = new Date().toISOString().slice(0, 10);
  return { filename: `jobfill-backup-${date}.json`, content: json };
}

async function importBackupFromText(text, options = {}) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON backup file.');
  }
  return applyBackupPayload(payload, options);
}

async function chooseBackupFolder() {
  if (!supportsFolderSync()) {
    throw new Error('Folder sync is not supported in this browser. Use Export/Import instead.');
  }

  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  const granted = await verifyDirPermission(handle, true);
  if (!granted) {
    throw new Error('Folder permission was not granted.');
  }

  await saveDirHandle(handle);
  await storageSet({
    backupFolderName: handle.name,
    backupMode: 'folder',
    pendingDiskSync: false
  });

  const metaText = await readFileText(handle, BACKUP_FILES.meta);
  const local = await storageGet(['profileData', 'applications']);
  const hasLocal =
    Object.keys(local.profileData || {}).length > 0 ||
    normalizeApplicationsList(local.applications).length > 0;

  if (metaText && !hasLocal) {
    await loadFromBackupFolder({ preferDisk: true });
  } else {
    await syncToBackupFolder({ force: true });
  }

  return handle.name;
}

async function disconnectBackupFolder() {
  await clearDirHandle();
  await storageSet({ backupFolderName: '', backupMode: 'browser', pendingDiskSync: false });
}

async function getBackupFolderStatus() {
  const data = await storageGet(['backupFolderName', 'backupMode', 'pendingDiskSync', 'lastDiskSyncAt']);
  const handle = await loadDirHandle();
  let connected = false;

  if (handle && data.backupMode === 'folder') {
    connected = await verifyDirPermission(handle, true);
    if (!connected) {
      return {
        ...data,
        connected: false,
        needsReconnect: true,
        folderName: data.backupFolderName || handle.name
      };
    }
  }

  return {
    ...data,
    connected: connected && data.backupMode === 'folder',
    needsReconnect: !!handle && data.backupMode === 'folder' && !connected,
    folderName: data.backupFolderName || handle?.name || '',
    folderSyncSupported: supportsFolderSync()
  };
}

async function syncToBackupFolder({ force = false } = {}) {
  if (syncInProgress) return { skipped: true };
  if (!supportsFolderSync()) return { skipped: true, reason: 'unsupported' };

  const status = await storageGet(['backupMode']);
  if (status.backupMode !== 'folder' && !force) return { skipped: true };

  const handle = await loadDirHandle();
  if (!handle) return { skipped: true, reason: 'no-folder' };

  const granted = await verifyDirPermission(handle, true);
  if (!granted) {
    await storageSet({ pendingDiskSync: true });
    return { skipped: true, reason: 'permission' };
  }

  syncInProgress = true;
  try {
    const payload = await collectBackupData(true);
    const exportedAt = new Date().toISOString();

    await writeFile(handle, BACKUP_FILES.profile, JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt,
      ...payload.profile
    }, null, 2));

    await writeFile(handle, BACKUP_FILES.applications, JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt,
      applications: payload.applications
    }, null, 2));

    await writeFile(handle, BACKUP_FILES.settings, JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt,
      settings: payload.settings,
      apiKey: payload.apiKey || undefined
    }, null, 2));

    if (payload.resume.b64) {
      const binary = Uint8Array.from(atob(payload.resume.b64), c => c.charCodeAt(0));
      await writeFile(handle, BACKUP_FILES.resumePdf, binary);
      try {
        const txtHandle = await handle.getFileHandle(BACKUP_FILES.resumeTxt);
        await txtHandle.remove();
      } catch { /* no txt file */ }
    } else if (payload.resume.text) {
      await writeFile(handle, BACKUP_FILES.resumeTxt, payload.resume.text);
      try {
        const pdfHandle = await handle.getFileHandle(BACKUP_FILES.resumePdf);
        await pdfHandle.remove();
      } catch { /* no pdf file */ }
    }

    await writeFile(handle, BACKUP_FILES.meta, JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt,
      app: 'FillyJobber',
      files: Object.values(BACKUP_FILES)
    }, null, 2));

    await storageSet({
      pendingDiskSync: false,
      lastDiskSyncAt: exportedAt,
      backupFolderName: handle.name
    });

    return { ok: true, exportedAt };
  } finally {
    syncInProgress = false;
  }
}

async function loadFromBackupFolder({ preferDisk = false } = {}) {
  const handle = await loadDirHandle();
  if (!handle) return { skipped: true };

  const granted = await verifyDirPermission(handle, false);
  if (!granted) return { skipped: true, reason: 'permission' };

  const metaText = await readFileText(handle, BACKUP_FILES.meta);
  let diskExportedAt = 0;
  if (metaText) {
    try {
      diskExportedAt = new Date(JSON.parse(metaText).exportedAt || 0).getTime();
    } catch { /* ignore */ }
  }

  const local = await storageGet(['lastDiskSyncAt', 'profileData', 'applications']);
  const localExportedAt = new Date(local.lastDiskSyncAt || 0).getTime();
  const hasLocalData =
    Object.keys(local.profileData || {}).length > 0 ||
    normalizeApplicationsList(local.applications).length > 0;

  if (!preferDisk && localExportedAt >= diskExportedAt && hasLocalData) {
    return { skipped: true, reason: 'local-newer' };
  }

  const profileText = await readFileText(handle, BACKUP_FILES.profile);
  const appsText = await readFileText(handle, BACKUP_FILES.applications);
  const settingsText = await readFileText(handle, BACKUP_FILES.settings);

  const payload = { version: BACKUP_VERSION };

  if (profileText) {
    const profile = JSON.parse(profileText);
    payload.profile = { data: profile.data || {}, name: profile.name || '' };
  }

  if (appsText) {
    const apps = JSON.parse(appsText);
    payload.applications = normalizeApplicationsList(apps.applications);
  }

  if (settingsText) {
    const settings = JSON.parse(settingsText);
    payload.settings = settings.settings || {};
    if (settings.apiKey) payload.apiKey = settings.apiKey;
  }

  const pdfBlob = await readFileBlob(handle, BACKUP_FILES.resumePdf);
  if (pdfBlob) {
    payload.resume = {
      name: 'jobfill-resume.pdf',
      b64: await blobToBase64(pdfBlob),
      text: null
    };
  } else {
    const resumeText = await readFileText(handle, BACKUP_FILES.resumeTxt);
    if (resumeText) {
      payload.resume = { name: 'jobfill-resume.txt', text: resumeText, b64: null };
    }
  }

  await applyBackupPayload(payload, { mergeApplications: true });
  await storageSet({
    lastDiskSyncAt: metaText ? JSON.parse(metaText).exportedAt : new Date().toISOString(),
    pendingDiskSync: false,
    backupFolderName: handle.name,
    backupMode: 'folder'
  });

  return { ok: true, payload };
}

function scheduleBackupSync() {
  storageSet({ pendingDiskSync: true });
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    const status = await storageGet(['backupMode']);
    if (status.backupMode === 'folder') {
      await syncToBackupFolder();
    }
  }, 800);
}

async function runStartupBackupTasks() {
  const status = await getBackupFolderStatus();
  let loaded = false;

  if (status.connected) {
    const pending = await storageGet(['pendingDiskSync']);
    if (pending.pendingDiskSync) {
      await syncToBackupFolder();
    } else {
      const result = await loadFromBackupFolder({ preferDisk: false });
      loaded = !!result.ok;
    }
  }

  return { status, loaded };
}
