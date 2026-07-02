// ─── Helpers ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const isFloatingWindow = new URLSearchParams(location.search).get('window') === '1';

if (isFloatingWindow) {
  document.body.classList.add('floating-window');
  $('panelHint')?.classList.add('hidden');
  $('popOutBtn')?.classList.add('hidden');
}

$('popOutBtn')?.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_FLOATING_WINDOW' });
});

function showResult(elId, msg, type = 'success') {
  const el = $(elId);
  el.textContent = msg;
  el.className = `result-msg ${type}`;
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadJsonFile(filename, data) {
  const content = JSON.stringify(data, null, 2);
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function collectProfileFromUI() {
  const data = {};
  document.querySelectorAll('.profile-field-item').forEach(item => {
    const key = item.querySelector('.field-key-input').value.trim();
    const val = item.querySelector('.field-val-input').value.trim();
    if (key) data[key] = val;
  });
  return data;
}

function parseProfileFile(text, filename) {
  const trimmed = text.trim();
  if (!trimmed) return {};

  if (filename.endsWith('.json') || filename.endsWith('.txt')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      if (filename.endsWith('.json')) throw new Error('Invalid JSON file.');
    }
  }

  if (filename.endsWith('.csv') || filename.endsWith('.txt')) {
    return parseCSV(text);
  }

  throw new Error('Unsupported profile file format.');
}

function setStatus(type) {
  $('status-dot').className = `status-dot ${type}`;
}

function showBackupResult(msg, type = 'success') {
  const el = $('backupResult');
  if (!el) return;
  el.textContent = msg;
  el.className = `result-msg ${type}`;
}

async function refreshBackupUI() {
  const status = await getBackupFolderStatus();
  const el = $('backupFolderStatus');
  const chooseBtn = $('chooseFolderBtn');
  const syncBtn = $('syncNowBtn');
  const disconnectBtn = $('disconnectFolderBtn');
  const reconnectBtn = $('reconnectFolderBtn');

  if (!el) return;

  if (!status.folderSyncSupported) {
    el.textContent = 'Browser storage only — folder sync not supported here. Use Export/Import.';
    el.className = 'backup-status warning';
    chooseBtn?.classList.add('hidden');
    syncBtn?.classList.add('hidden');
    disconnectBtn?.classList.add('hidden');
    reconnectBtn?.classList.add('hidden');
    return;
  }

  chooseBtn?.classList.remove('hidden');

  if (status.connected) {
    const syncTime = status.lastDiskSyncAt
      ? `Last sync: ${new Date(status.lastDiskSyncAt).toLocaleString()}`
      : 'Not synced yet';
    el.textContent = `✓ Folder: ${status.folderName}\n${syncTime}`;
    el.className = 'backup-status connected';
    syncBtn?.classList.remove('hidden');
    disconnectBtn?.classList.remove('hidden');
    reconnectBtn?.classList.add('hidden');
  } else if (status.needsReconnect) {
    el.textContent = `⚠ Folder "${status.folderName}" needs permission. Click Reconnect.`;
    el.className = 'backup-status warning';
    syncBtn?.classList.add('hidden');
    disconnectBtn?.classList.remove('hidden');
    reconnectBtn?.classList.remove('hidden');
  } else {
    el.textContent = 'Browser storage only — choose a folder to auto-sync backups.';
    el.className = 'backup-status muted';
    syncBtn?.classList.add('hidden');
    disconnectBtn?.classList.add('hidden');
    reconnectBtn?.classList.add('hidden');
  }
}

async function reloadUIFromStorage() {
  const res = await storageGet([
    'autoFill', 'fuzzyMatch', 'notify', 'apiKey', 'aiProvider', 'model',
    'customEndpoint', 'customModel', 'profileData', 'profileName', 'resumeName',
    'backupIncludeApiKey'
  ]);

  $('autoFillToggle').checked = res.autoFill ?? false;
  $('fuzzyMatchToggle').checked = res.fuzzyMatch ?? true;
  $('notifyToggle').checked = res.notify ?? true;
  if (res.apiKey) $('apiKeyInput').value = res.apiKey;
  if (res.aiProvider) $('providerSelect').value = res.aiProvider;
  if (res.customEndpoint) $('customEndpointInput').value = res.customEndpoint;
  if (res.customModel) {
    $('customModelInput').value = res.customModel;
  } else if (res.model && (res.aiProvider === 'ollama' || res.aiProvider === 'custom')) {
    $('customModelInput').value = res.model;
  }
  updateProviderUI(res.model);

  if (res.profileName) {
    $('profileFileName').textContent = res.profileName;
    $('profileFileName').classList.remove('muted');
  }
  if (res.resumeName) {
    $('resumeFileName').textContent = res.resumeName;
    $('resumeFileName').classList.remove('muted');
  }
  if ($('backupIncludeApiKeyToggle')) {
    $('backupIncludeApiKeyToggle').checked = !!res.backupIncludeApiKey;
  }

  renderProfilePreview(res.profileData || {});
  renderApplicationsList();
  await refreshBackupUI();
}

function maybeShowSetupModal() {
  chrome.storage.local.get(['setupComplete'], res => {
    if (res.setupComplete) return;
    $('setupModal')?.classList.remove('hidden');
  });
}

async function completeSetup(mode) {
  if (mode === 'folder') {
    try {
      await chooseBackupFolder();
      await reloadUIFromStorage();
      showBackupResult('✓ Backup folder connected.', 'success');
    } catch (err) {
      if (err.name !== 'AbortError') {
        showBackupResult('⚠ ' + err.message, 'error');
      }
      await storageSet({ backupMode: 'browser' });
    }
  } else {
    await storageSet({ backupMode: 'browser' });
  }

  await storageSet({ setupComplete: true });
  $('setupModal')?.classList.add('hidden');
  await refreshBackupUI();
}

// ─── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'applications') {
      refreshApplicationsTab();
    }
  });
});

// ─── Load settings on open ───────────────────────────────────────────────────
chrome.storage.local.get(['autoFill', 'fuzzyMatch', 'notify', 'apiKey', 'aiProvider', 'model', 'customEndpoint', 'customModel', 'profileData', 'profileName', 'resumeName', 'backupIncludeApiKey'], res => {
  $('autoFillToggle').checked = res.autoFill ?? false;
  $('fuzzyMatchToggle').checked = res.fuzzyMatch ?? true;
  $('notifyToggle').checked = res.notify ?? true;
  if (res.apiKey) $('apiKeyInput').value = res.apiKey;
  if (res.aiProvider) $('providerSelect').value = res.aiProvider;
  if (res.customEndpoint) $('customEndpointInput').value = res.customEndpoint;
  if (res.customModel) {
    $('customModelInput').value = res.customModel;
  } else if (res.model && (res.aiProvider === 'ollama' || res.aiProvider === 'custom')) {
    $('customModelInput').value = res.model;
  }
  updateProviderUI(res.model);
  if (res.profileName) {
    $('profileFileName').textContent = res.profileName;
    $('profileFileName').classList.remove('muted');
  }
  if (res.resumeName) {
    $('resumeFileName').textContent = res.resumeName;
    $('resumeFileName').classList.remove('muted');
  }
  if ($('backupIncludeApiKeyToggle')) {
    $('backupIncludeApiKeyToggle').checked = !!res.backupIncludeApiKey;
  }
  renderProfilePreview(res.profileData || {});
  populateStatusSelects();
  renderApplicationsList();
  runStartupBackupTasks().then(async ({ loaded }) => {
    if (loaded) await reloadUIFromStorage();
    else await refreshBackupUI();
    maybeShowSetupModal();
  });
});

// ─── Applications tracking ────────────────────────────────────────────────────
let currentTabUrl = '';
let currentTrackedApp = null;
let manualInsertMode = false;

function populateStatusSelects() {
  ['trackStatus', 'trackEditStatus'].forEach(id => {
    const sel = $(id);
    if (!sel || sel.options.length > 0) return;
    APPLICATION_STATUSES.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.value;
      opt.textContent = s.label;
      sel.appendChild(opt);
    });
  });
}

function showTrackResult(msg, type = 'success') {
  const el = $('trackResult');
  el.textContent = msg;
  el.className = `result-msg ${type}`;
}

function formatAppDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function fetchPageMetadata(tab) {
  if (!tab?.id || !isInjectableUrl(tab.url)) return null;
  try {
    const meta = await sendToTab(tab.id, { type: 'GET_PAGE_METADATA' });
    return meta || null;
  } catch {
    return {
      title: tab.title?.split('|')[0]?.trim() || '',
      company: '',
      url: tab.url || '',
      snippet: ''
    };
  }
}

function setTrackFormMode(existing) {
  currentTrackedApp = existing || null;
  if (existing) {
    $('trackExistingCard').classList.remove('hidden');
    $('trackNewCard').classList.add('hidden');
    $('trackEditTitle').value = existing.title || '';
    $('trackEditCompany').value = existing.company || '';
    $('trackEditStatus').value = existing.status || 'applied';
    $('trackEditNotes').value = existing.notes || '';
  } else {
    $('trackExistingCard').classList.add('hidden');
    $('trackNewCard').classList.remove('hidden');
  }
}

function resetTrackForm() {
  $('trackUrl').value = '';
  $('trackTitle').value = '';
  $('trackCompany').value = '';
  $('trackStatus').value = 'applied';
  $('trackNotes').value = '';
  setTrackFormMode(null);
}

function populateTrackFormFromMetadata(meta, tabUrl) {
  $('trackUrl').value = tabUrl || meta.url || '';
  $('trackTitle').value = meta.title || '';
  $('trackCompany').value = meta.company || '';
  $('trackStatus').value = 'applied';
  $('trackNotes').value = '';
}

async function refreshApplicationsTab() {
  populateStatusSelects();
  const tab = await getActiveTab();
  currentTabUrl = tab?.url || '';

  if (!tab || !currentTabUrl || currentTabUrl.startsWith('chrome://') || currentTabUrl.startsWith('chrome-extension://')) {
    setTrackFormMode(null);
    $('trackNewCard').classList.add('hidden');
    showTrackResult('Open a job page in the browser to track an application.', 'error');
    await renderApplicationsList();
    return;
  }

  $('trackResult').classList.add('hidden');
  $('trackNewCard').classList.remove('hidden');

  if (manualInsertMode) {
    setTrackFormMode(null);
  } else {
    const apps = await loadApplications();
    const existing = findApplicationByUrl(apps, currentTabUrl);

    if (existing) {
      setTrackFormMode(existing);
    } else {
      setTrackFormMode(null);
      const meta = await fetchPageMetadata(tab);
      if (meta) populateTrackFormFromMetadata(meta, currentTabUrl);
    }
  }

  await renderApplicationsList();
}

function renderApplicationsList() {
  loadApplications().then(apps => {
    const list = $('applicationsList');
    const query = ($('appSearchInput')?.value || '').toLowerCase().trim();
    $('appCount').textContent = String(apps.length);

    const filtered = apps.filter(app => {
      if (!query) return true;
      const hay = [app.title, app.company, app.url, app.notes, getStatusLabel(app.status)]
        .join(' ').toLowerCase();
      return hay.includes(query);
    });

    if (filtered.length === 0) {
      list.innerHTML = `<p class="hint muted apps-empty">${apps.length === 0 ? 'No applications tracked yet.' : 'No matches found.'}</p>`;
      return;
    }

    list.innerHTML = '';
    filtered.forEach(app => {
      list.appendChild(createApplicationCard(app));
    });
  });
}

function createApplicationCard(app) {
  const card = document.createElement('div');
  card.className = 'app-card';
  card.dataset.id = app.id;

  const title = app.title || 'Untitled role';
  const company = app.company || 'Unknown company';

  card.innerHTML = `
    <div class="app-card-header">
      <div>
        <div class="app-card-title">${escHtml(title)}</div>
        <div class="app-card-company">${escHtml(company)}</div>
      </div>
      <span class="status-badge status-${app.status}">${escHtml(getStatusLabel(app.status))}</span>
    </div>
    <div class="app-card-meta">Applied ${escHtml(formatAppDate(app.appliedAt))}</div>
    ${app.notes ? `<div class="app-card-notes">${escHtml(app.notes)}</div>` : ''}
    <div class="app-card-actions">
      <select class="app-status-select" data-id="${app.id}"></select>
      <a class="btn-app-link app-open-link" target="_blank" rel="noopener">Open</a>
      <button class="btn-app-delete" data-id="${app.id}" title="Delete">×</button>
    </div>
  `;

  card.querySelector('.app-open-link').href = app.url;

  const sel = card.querySelector('.app-status-select');
  APPLICATION_STATUSES.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.value;
    opt.textContent = s.label;
    if (s.value === app.status) opt.selected = true;
    sel.appendChild(opt);
  });

  sel.addEventListener('change', async () => {
    await updateTrackedApplication(app.id, { status: sel.value });
    renderApplicationsList();
    if (currentTrackedApp?.id === app.id) {
      $('trackEditStatus').value = sel.value;
    }
  });

  card.querySelector('.btn-app-delete').addEventListener('click', async () => {
    if (!confirm(`Delete tracking for "${title}" at ${company}?`)) return;
    await removeTrackedApplication(app.id);
    if (currentTrackedApp?.id === app.id) {
      await refreshApplicationsTab();
    } else {
      renderApplicationsList();
    }
  });

  return card;
}

async function addTrackedApplication(metadata) {
  const apps = await loadApplications();
  const result = appendApplication(apps, metadata);
  if (!result.duplicate) await saveApplications(result.apps);
  return result;
}

async function updateTrackedApplication(id, patch) {
  const apps = await loadApplications();
  const updated = updateApplication(apps, id, patch);
  await saveApplications(updated);
  return updated;
}

async function removeTrackedApplication(id) {
  const apps = await loadApplications();
  const updated = deleteApplication(apps, id);
  await saveApplications(updated);
  return updated;
}

$('refreshTrackBtn').addEventListener('click', async () => {
  manualInsertMode = false;
  $('trackResult').classList.add('hidden');
  await refreshApplicationsTab();
});

$('clearTrackBtn').addEventListener('click', () => {
  manualInsertMode = true;
  resetTrackForm();
  $('trackResult').classList.add('hidden');
});

$('trackAppBtn').addEventListener('click', async () => {
  const tab = await getActiveTab();
  const url = ($('trackUrl').value.trim() || tab?.url || '').trim();

  if (!url) {
    showTrackResult('Enter a job page URL or open a job page in the browser.', 'error');
    return;
  }

  const metadata = {
    url,
    title: $('trackTitle').value.trim(),
    company: $('trackCompany').value.trim(),
    status: $('trackStatus').value,
    notes: $('trackNotes').value.trim()
  };

  const pageMeta = tab?.id && isInjectableUrl(tab.url) ? await fetchPageMetadata(tab) : null;
  if (pageMeta?.snippet && !metadata.snippet) metadata.snippet = pageMeta.snippet;

  const { application, duplicate } = await addTrackedApplication(metadata);

  if (duplicate) {
    showTrackResult('This URL is already tracked.', 'error');
    if (!manualInsertMode) setTrackFormMode(application);
    return;
  }

  manualInsertMode = false;
  showTrackResult(`✓ Saved: ${application.company || 'Application'} — ${application.title || 'Untitled'}`, 'success');
  resetTrackForm();
  renderApplicationsList();
  setStatus('success');
  setTimeout(() => setStatus('idle'), 2000);
});

$('updateTrackedBtn').addEventListener('click', async () => {
  if (!currentTrackedApp) return;

  const updated = await updateTrackedApplication(currentTrackedApp.id, {
    title: $('trackEditTitle').value.trim(),
    company: $('trackEditCompany').value.trim(),
    status: $('trackEditStatus').value,
    notes: $('trackEditNotes').value.trim()
  });

  currentTrackedApp = updated.find(a => a.id === currentTrackedApp.id);
  showTrackResult('✓ Application updated.', 'success');
  renderApplicationsList();
  setStatus('success');
  setTimeout(() => setStatus('idle'), 2000);
});

$('appSearchInput')?.addEventListener('input', () => renderApplicationsList());

$('exportAppsBtn')?.addEventListener('click', async () => {
  const apps = await loadApplications();
  if (apps.length === 0) {
    alert('No applications to export.');
    return;
  }
  const date = new Date().toISOString().slice(0, 10);
  downloadTextFile(`job-applications-${date}.txt`, formatApplicationsAsText(apps));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.applications) {
    const appsTab = document.querySelector('.tab[data-tab="applications"]');
    if (appsTab?.classList.contains('active')) {
      renderApplicationsList();
    }
  }
  if (area === 'local' && (changes.applications || changes.profileData || changes.pendingDiskSync)) {
    refreshBackupUI();
  }
});


function getSelectedProvider() {
  return $('providerSelect').value || 'anthropic';
}

function getSelectedModel() {
  const provider = getSelectedProvider();
  const config = getProviderConfig(provider);
  if (config.customModel) return $('customModelInput').value.trim();
  return $('modelSelect').value;
}

function updateProviderUI(savedModel) {
  const provider = getSelectedProvider();
  const config = getProviderConfig(provider);

  $('keyHint').textContent = config.keyHint || '';
  $('apiKeyInput').placeholder = config.keyPlaceholder || 'API key';

  $('customEndpointSection').classList.toggle('hidden', !config.customEndpoint);
  $('customModelSection').classList.toggle('hidden', !config.customModel);
  $('modelSelectSection').classList.toggle('hidden', !!config.customModel);

  if (config.customEndpoint && ! $('customEndpointInput').value && config.defaultEndpoint) {
    $('customEndpointInput').value = config.defaultEndpoint;
  }

  if (config.customModel) {
    if (! $('customModelInput').value && config.defaultModel) {
      $('customModelInput').value = config.defaultModel;
    }
    return;
  }

  const select = $('modelSelect');
  select.innerHTML = '';
  config.models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.value;
    opt.textContent = m.label;
    select.appendChild(opt);
  });

  const preferredModel = savedModel || config.defaultModel;
  if (preferredModel && [...select.options].some(o => o.value === preferredModel)) {
    select.value = preferredModel;
  }
}

$('providerSelect').addEventListener('change', () => updateProviderUI());

// ─── Data & Backup ───────────────────────────────────────────────────────────
$('chooseFolderBtn')?.addEventListener('click', async () => {
  try {
    const name = await chooseBackupFolder();
    await reloadUIFromStorage();
    showBackupResult(`✓ Saving to folder: ${name}`, 'success');
    await refreshBackupUI();
  } catch (err) {
    if (err.name !== 'AbortError') {
      showBackupResult('⚠ ' + err.message, 'error');
    }
  }
});

$('reconnectFolderBtn')?.addEventListener('click', async () => {
  try {
    const result = await syncToBackupFolder({ force: true });
    if (result.ok) {
      showBackupResult('✓ Folder reconnected and synced.', 'success');
    } else {
      showBackupResult('⚠ Could not access folder. Choose it again.', 'error');
    }
    await refreshBackupUI();
  } catch (err) {
    showBackupResult('⚠ ' + err.message, 'error');
  }
});

$('syncNowBtn')?.addEventListener('click', async () => {
  try {
    const result = await syncToBackupFolder();
    if (result.ok) {
      showBackupResult('✓ Synced to backup folder.', 'success');
    } else if (result.reason === 'permission') {
      showBackupResult('⚠ Folder permission needed. Click Reconnect.', 'error');
    } else {
      showBackupResult('ℹ Nothing to sync.', 'error');
    }
    await refreshBackupUI();
  } catch (err) {
    showBackupResult('⚠ ' + err.message, 'error');
  }
});

$('disconnectFolderBtn')?.addEventListener('click', async () => {
  if (!confirm('Stop syncing to the backup folder? Browser data will stay intact.')) return;
  await disconnectBackupFolder();
  showBackupResult('✓ Folder disconnected. Data remains in browser.', 'success');
  await refreshBackupUI();
});

$('exportBackupBtn')?.addEventListener('click', async () => {
  try {
    const includeKey = $('backupIncludeApiKeyToggle')?.checked ?? false;
    const { filename, content } = await exportBackupDownload(includeKey);
    downloadTextFile(filename, content);
    showBackupResult('✓ Backup downloaded.', 'success');
  } catch (err) {
    showBackupResult('⚠ ' + err.message, 'error');
  }
});

$('importBackupBtn')?.addEventListener('click', () => $('importBackupInput')?.click());

$('importBackupInput')?.addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;

  try {
    const text = await file.text();
    const merge = $('mergeAppsOnImportToggle')?.checked ?? true;
    await importBackupFromText(text, { mergeApplications: merge });
    await reloadUIFromStorage();
    scheduleBackupSync();
    showBackupResult(`✓ Imported from ${file.name}`, 'success');
    setStatus('success');
    setTimeout(() => setStatus('idle'), 2000);
  } catch (err) {
    showBackupResult('⚠ ' + err.message, 'error');
  }
});

$('backupIncludeApiKeyToggle')?.addEventListener('change', e => {
  chrome.storage.local.set({ backupIncludeApiKey: e.target.checked });
});

$('setupContinueBtn')?.addEventListener('click', async () => {
  const mode = document.querySelector('input[name="setupMode"]:checked')?.value || 'browser';
  await completeSetup(mode);
});

$('setupSkipBtn')?.addEventListener('click', async () => {
  await storageSet({ setupComplete: true, backupMode: 'browser' });
  $('setupModal')?.classList.add('hidden');
});

// ─── Toggle persistence ───────────────────────────────────────────────────────
$('autoFillToggle').addEventListener('change', e => {
  chrome.storage.local.set({ autoFill: e.target.checked });
  scheduleBackupSync();
});
$('fuzzyMatchToggle').addEventListener('change', e => {
  chrome.storage.local.set({ fuzzyMatch: e.target.checked });
  scheduleBackupSync();
});
$('notifyToggle').addEventListener('change', e => {
  chrome.storage.local.set({ notify: e.target.checked });
  scheduleBackupSync();
});

// ─── API Key ─────────────────────────────────────────────────────────────────
$('showKeyBtn').addEventListener('click', () => {
  const inp = $('apiKeyInput');
  inp.type = inp.type === 'password' ? 'text' : 'password';
});

$('saveKeyBtn').addEventListener('click', () => {
  const provider = getSelectedProvider();
  const config = getProviderConfig(provider);
  const key = $('apiKeyInput').value.trim();
  const model = getSelectedModel();
  const customEndpoint = $('customEndpointInput').value.trim();
  const customModel = $('customModelInput').value.trim();

  if (config.requiresKey && !key) {
    $('keyStatus').textContent = '⚠ API key is required for this provider';
    $('keyStatus').style.color = '#f87171';
    return;
  }
  if (config.customEndpoint && !customEndpoint) {
    $('keyStatus').textContent = '⚠ API endpoint is required';
    $('keyStatus').style.color = '#f87171';
    return;
  }
  if (config.customModel && !customModel) {
    $('keyStatus').textContent = '⚠ Model name is required';
    $('keyStatus').style.color = '#f87171';
    return;
  }

  chrome.storage.local.set({
    apiKey: key,
    aiProvider: provider,
    model: config.customModel ? customModel : model,
    customEndpoint: config.customEndpoint ? customEndpoint : '',
    customModel: config.customModel ? customModel : ''
  }, () => {
    $('keyStatus').textContent = '✓ Saved';
    $('keyStatus').style.color = '#4ade80';
    scheduleBackupSync();
    setTimeout(() => $('keyStatus').textContent = '', 2000);
  });
});

// ─── Profile File Load / Export ───────────────────────────────────────────────
$('loadProfileBtn').addEventListener('click', () => $('profileFileInput').click());

$('exportProfileBtn').addEventListener('click', () => {
  const data = collectProfileFromUI();
  if (Object.keys(data).length === 0) {
    alert('No profile data to export. Load or add fields first.');
    return;
  }

  chrome.storage.local.get(['profileName'], res => {
    const baseName = (res.profileName || 'my-profile').replace(/\.(json|csv|txt)$/i, '');
    downloadJsonFile(`${baseName}.json`, data);
    showResult('fillResult', '✓ Profile exported as JSON.', 'success');
    setStatus('success');
    setTimeout(() => setStatus('idle'), 2000);
  });
});

$('profileFileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;

  const text = await file.text();
  let data = {};

  try {
    data = parseProfileFile(text, file.name.toLowerCase());
  } catch (err) {
    alert(err.message || 'Could not read profile file.');
    return;
  }

  chrome.storage.local.set({ profileData: data, profileName: file.name }, () => {
    $('profileFileName').textContent = file.name;
    $('profileFileName').classList.remove('muted');
    renderProfilePreview(data);
    scheduleBackupSync();
  });
});

function parseCSV(text) {
  const lines = text.trim().split('\n').filter(l => l.trim());
  const result = {};
  for (const line of lines) {
    const commaIdx = line.indexOf(',');
    if (commaIdx === -1) continue;
    const key = line.slice(0, commaIdx).trim().replace(/^["']|["']$/g, '');
    const val = line.slice(commaIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) result[key] = val;
  }
  return result;
}

function renderProfilePreview(data) {
  const list = $('profileFields');
  list.innerHTML = '';
  
  const entries = Object.entries(data);
  if (entries.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'hint muted';
    emptyMsg.style.textAlign = 'center';
    emptyMsg.style.padding = '10px 0';
    emptyMsg.id = 'emptyProfileMsg';
    emptyMsg.textContent = 'No fields. Add custom fields below or load a file.';
    list.appendChild(emptyMsg);
  } else {
    entries.forEach(([k, v]) => {
      createFieldRow(k, v);
    });
  }
  
  $('profilePreview').classList.remove('hidden');
}

function createFieldRow(key, value) {
  const list = $('profileFields');
  const emptyMsg = $('emptyProfileMsg');
  if (emptyMsg) emptyMsg.remove();

  const row = document.createElement('div');
  row.className = 'profile-field-item';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.className = 'field-key-input';
  keyInput.value = key;
  keyInput.placeholder = 'Key';
  keyInput.title = 'Profile key';

  const valInput = document.createElement('input');
  valInput.type = 'text';
  valInput.className = 'field-val-input';
  valInput.value = value;
  valInput.placeholder = 'Value';
  valInput.title = 'Value for autofill';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-field-delete';
  deleteBtn.innerHTML = '×';
  deleteBtn.title = 'Delete field';
  deleteBtn.addEventListener('click', () => {
    row.remove();
    if (list.children.length === 0) {
      renderProfilePreview({});
    }
  });

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(deleteBtn);
  list.appendChild(row);
}

// ─── Profile Editor Event Handlers ───────────────────────────────────────────
// Search filtering
$('profileSearchInput').addEventListener('input', e => {
  const q = e.target.value.toLowerCase().trim();
  const items = document.querySelectorAll('.profile-field-item');
  items.forEach(item => {
    const key = item.querySelector('.field-key-input').value.toLowerCase();
    const val = item.querySelector('.field-val-input').value.toLowerCase();
    if (key.includes(q) || val.includes(q)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });
});

// Add Field
$('addFieldBtn').addEventListener('click', () => {
  const keyInput = $('newFieldKey');
  const valInput = $('newFieldValue');
  const key = keyInput.value.trim();
  const val = valInput.value.trim();

  if (!key) {
    alert('Please enter a field key/name.');
    keyInput.focus();
    return;
  }

  createFieldRow(key, val);
  
  keyInput.value = '';
  valInput.value = '';
  keyInput.focus();

  const container = document.querySelector('.fields-container-scroll');
  container.scrollTop = container.scrollHeight;
});

// Enter key helper on Add Field inputs
$('newFieldKey').addEventListener('keypress', e => {
  if (e.key === 'Enter') $('newFieldValue').focus();
});
$('newFieldValue').addEventListener('keypress', e => {
  if (e.key === 'Enter') $('addFieldBtn').click();
});

// Save Profile changes
$('saveProfileBtn').addEventListener('click', () => {
  const items = document.querySelectorAll('.profile-field-item');
  const newData = {};
  
  items.forEach(item => {
    const key = item.querySelector('.field-key-input').value.trim();
    const val = item.querySelector('.field-val-input').value.trim();
    if (key) {
      newData[key] = val;
    }
  });

  chrome.storage.local.get(['profileName'], res => {
    const currentName = res.profileName || 'Custom Profile';
    const newName = currentName.includes('(Modified)') ? currentName : `${currentName} (Modified)`;
    
    chrome.storage.local.set({ profileData: newData, profileName: newName }, () => {
      $('profileFileName').textContent = newName;
      $('profileFileName').classList.remove('muted');
      
      renderProfilePreview(newData);
      
      showResult('fillResult', '✓ Profile changes saved locally!', 'success');
      setStatus('success');
      scheduleBackupSync();
      setTimeout(() => setStatus('idle'), 3000);
    });
  });
});

// Clear Profile data
$('clearProfileBtn').addEventListener('click', () => {
  if (!confirm('Are you sure you want to clear all profile data?')) return;
  
  chrome.storage.local.remove(['profileData', 'profileName'], () => {
    $('profileFileName').textContent = 'No file loaded';
    $('profileFileName').classList.add('muted');
    renderProfilePreview({});
    showResult('fillResult', '✓ Profile cleared successfully.', 'success');
    setStatus('success');
    scheduleBackupSync();
    setTimeout(() => setStatus('idle'), 3000);
  });
});

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Fill Now ─────────────────────────────────────────────────────────────────
$('fillNowBtn').addEventListener('click', async () => {
  setStatus('active');
  $('fillNowBtn').disabled = true;

  try {
    const tab = await getActiveTab();
    if (!tab?.id || !isInjectableUrl(tab.url)) {
      showResult('fillResult', '⚠ Open a job application page first.', 'error');
      setStatus('error');
      return;
    }

    const res = await chrome.storage.local.get(['profileData', 'fuzzyMatch']);
    if (!res.profileData || Object.keys(res.profileData).length === 0) {
      showResult('fillResult', '⚠ No profile data loaded. Load a JSON profile file first.', 'error');
      setStatus('error');
      return;
    }

    const response = await sendToTab(tab.id, {
      type: 'FILL_FORM',
      profileData: res.profileData,
      fuzzyMatch: res.fuzzyMatch ?? true
    });

    if (response?.filled > 0) {
      showResult('fillResult', `✓ Filled ${response.filled} field(s) successfully!`, 'success');
      setStatus('success');
    } else {
      showResult('fillResult', 'ℹ No matching fields found on this page.', 'error');
      setStatus('idle');
    }
  } catch {
    showResult('fillResult', '⚠ Could not reach page. Try refreshing.', 'error');
    setStatus('error');
  } finally {
    $('fillNowBtn').disabled = false;
    setTimeout(() => setStatus('idle'), 3000);
  }
});

// ─── Resume Upload ────────────────────────────────────────────────────────────
$('loadResumeBtn').addEventListener('click', () => $('resumeFileInput').click());

$('resumeFileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;

  let text = '';
  if (file.name.endsWith('.pdf')) {
    // For PDF we store the base64 and extract text via AI
    const ab = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
    chrome.storage.local.set({ resumeB64: b64, resumeName: file.name, resumeText: null }, () => {
      scheduleBackupSync();
    });
    $('resumeFileName').textContent = file.name + ' (PDF — Anthropic & Gemini)';
  } else {
    text = await file.text();
    chrome.storage.local.set({ resumeText: text, resumeName: file.name, resumeB64: null }, () => {
      scheduleBackupSync();
    });
    $('resumeFileName').textContent = file.name;
  }
  $('resumeFileName').classList.remove('muted');
});

// ─── Detect Job Description from Page ────────────────────────────────────────
$('detectJobBtn').addEventListener('click', async () => {
  try {
    const tab = await getActiveTab();
    if (!tab?.id || !isInjectableUrl(tab.url)) {
      $('jobDescInput').placeholder = 'Could not auto-detect. Paste manually.';
      return;
    }

    const response = await sendToTab(tab.id, { type: 'GET_JOB_DESC' });
    if (!response?.text) {
      $('jobDescInput').placeholder = 'Could not auto-detect. Paste manually.';
      return;
    }
    $('jobDescInput').value = response.text.slice(0, 3000);
  } catch {
    $('jobDescInput').placeholder = 'Could not auto-detect. Paste manually.';
  }
});

// ─── Tailor Resume ────────────────────────────────────────────────────────────
$('tailorBtn').addEventListener('click', async () => {
  const jobDesc = $('jobDescInput').value.trim();
  if (!jobDesc) { alert('Please paste or detect a job description first.'); return; }

  chrome.storage.local.get(['apiKey', 'aiProvider', 'model', 'customEndpoint', 'resumeText', 'resumeB64'], async res => {
    const provider = res.aiProvider || 'anthropic';
    const config = getProviderConfig(provider);
    if (config.requiresKey && !res.apiKey) {
      alert(`Please add your ${config.label} API key in Settings.`);
      return;
    }
    if (!res.resumeText && !res.resumeB64) { alert('Please upload your resume first.'); return; }

    $('tailorBtn').disabled = true;
    $('tailorBtn').textContent = '⏳ Tailoring...';
    setStatus('active');

    try {
      const systemPrompt = `You are a professional resume writer. 
Rewrite the provided resume to be optimally tailored for the given job description.
- Emphasize relevant skills and experience
- Mirror key terms from the job description naturally
- Keep it truthful — only reframe existing content, don't invent experience
- Output clean plain text formatted as a proper resume
- Include: Summary, Skills, Experience, Education sections`;

      const output = await tailorResumeWithAI({
        provider,
        apiKey: res.apiKey,
        model: res.model || config.defaultModel,
        customEndpoint: res.customEndpoint,
        systemPrompt,
        resumeText: res.resumeText,
        resumeB64: res.resumeB64,
        jobDesc
      });

      $('tailoredOutput').value = output;
      $('tailorResult').classList.remove('hidden');
      setStatus('success');
    } catch (err) {
      alert('AI Error: ' + err.message);
      setStatus('error');
    } finally {
      $('tailorBtn').disabled = false;
      $('tailorBtn').textContent = '🤖 Tailor Resume with AI';
      setTimeout(() => setStatus('idle'), 3000);
    }
  });
});

// ─── Copy / Download tailored resume ─────────────────────────────────────────
$('copyResumeBtn').addEventListener('click', () => {
  navigator.clipboard.writeText($('tailoredOutput').value);
  $('copyResumeBtn').textContent = '✓ Copied!';
  setTimeout(() => $('copyResumeBtn').textContent = '📋 Copy', 2000);
});

$('downloadResumeBtn').addEventListener('click', () => {
  downloadTextFile('tailored-resume.txt', $('tailoredOutput').value);
});
