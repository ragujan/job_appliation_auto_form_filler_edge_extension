// ─── JobFill AI — Application tracking helpers ───────────────────────────────

const APPLICATION_STATUSES = [
  { value: 'applied', label: 'Applied' },
  { value: 'screening', label: 'Screening' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' }
];

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'fbclid', 'gclid', 'gh_src', 'source', 'src'
]);

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    const keys = [...u.searchParams.keys()];
    for (const key of keys) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        u.searchParams.delete(key);
      }
    }
    let path = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.origin}${path}${u.search ? u.search : ''}`;
  } catch {
    return (url || '').trim();
  }
}

function generateApplicationId() {
  return crypto.randomUUID ? crypto.randomUUID() : `app-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function findApplicationByUrl(apps, url) {
  const normalized = normalizeUrl(url);
  return normalizeApplicationsList(apps).find(a => normalizeUrl(a.url) === normalized) || null;
}

function createApplication(metadata) {
  const now = new Date().toISOString();
  const url = normalizeUrl(metadata.url || '');
  return {
    id: generateApplicationId(),
    url,
    title: (metadata.title || '').trim(),
    company: (metadata.company || '').trim(),
    status: metadata.status || 'applied',
    notes: (metadata.notes || '').trim(),
    snippet: (metadata.snippet || '').slice(0, 200),
    appliedAt: now,
    updatedAt: now
  };
}

function updateApplication(apps, id, patch) {
  return normalizeApplicationsList(apps).map(app => {
    if (app.id !== id) return app;
    return {
      ...app,
      ...patch,
      url: patch.url != null ? normalizeUrl(patch.url) : app.url,
      updatedAt: new Date().toISOString()
    };
  });
}

function deleteApplication(apps, id) {
  return normalizeApplicationsList(apps).filter(app => app.id !== id);
}

function getStatusLabel(status) {
  return APPLICATION_STATUSES.find(s => s.value === status)?.label || status;
}

function normalizeApplicationsList(apps) {
  if (!apps) return [];
  if (Array.isArray(apps)) return apps.filter(app => app && typeof app === 'object');
  if (typeof apps === 'object' && apps.id) return [apps];
  return [];
}

function normalizeJobText(text) {
  return (text || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function applicationsMatch(a, b) {
  const urlA = normalizeUrl(a.url);
  const urlB = normalizeUrl(b.url);
  if (urlA && urlB && urlA === urlB) return true;

  const companyA = normalizeJobText(a.company);
  const companyB = normalizeJobText(b.company);
  const titleA = normalizeJobText(a.title);
  const titleB = normalizeJobText(b.title);
  return !!(companyA && companyB && titleA && titleB && companyA === companyB && titleA === titleB);
}

function mergeApplicationRecords(prev, incoming) {
  const prevTime = new Date(prev.updatedAt || prev.appliedAt || 0).getTime();
  const nextTime = new Date(incoming.updatedAt || incoming.appliedAt || 0).getTime();
  const newerWins = nextTime >= prevTime;
  const older = newerWins ? prev : incoming;
  const newer = newerWins ? incoming : prev;
  const merged = { ...older, ...newer, id: prev.id };
  const newerUrl = normalizeUrl(newer.url);
  merged.url = newerUrl || normalizeUrl(prev.url) || '';
  return merged;
}

function mergeApplications(existing, incoming) {
  const list = [...normalizeApplicationsList(existing)];
  for (const app of normalizeApplicationsList(incoming)) {
    const idx = list.findIndex(item => applicationsMatch(item, app));
    if (idx === -1) list.push(app);
    else list[idx] = mergeApplicationRecords(list[idx], app);
  }
  return list.sort(
    (a, b) => new Date(b.appliedAt || 0) - new Date(a.appliedAt || 0)
  );
}

function loadApplications() {
  return new Promise(resolve => {
    chrome.storage.local.get(['applications'], res => {
      resolve(normalizeApplicationsList(res.applications));
    });
  });
}

function saveApplications(apps) {
  const list = normalizeApplicationsList(apps);
  return new Promise(resolve => {
    chrome.storage.local.set({ applications: list, pendingDiskSync: true }, () => {
      if (typeof scheduleBackupSync === 'function') scheduleBackupSync();
      resolve();
    });
  });
}

function appendApplication(apps, metadata) {
  const list = normalizeApplicationsList(apps);
  const existing = findApplicationByUrl(list, metadata.url);
  if (existing) return { apps: list, application: existing, duplicate: true };
  const application = createApplication(metadata);
  return { apps: [application, ...list], application, duplicate: false };
}

function formatApplicationsAsText(apps) {
  const lines = [
    'JobFill AI — Applications Export',
    `Generated: ${new Date().toLocaleString()}`,
    `Total: ${(apps || []).length}`,
    ''
  ];

  (apps || []).forEach((app, i) => {
    if (i > 0) lines.push('');
    lines.push('---');
    lines.push(`Title: ${app.title || 'Untitled role'}`);
    lines.push(`Company: ${app.company || 'Unknown company'}`);
    lines.push(`Status: ${getStatusLabel(app.status)}`);
    lines.push(`Applied: ${app.appliedAt ? new Date(app.appliedAt).toLocaleDateString() : '—'}`);
    if (app.updatedAt && app.updatedAt !== app.appliedAt) {
      lines.push(`Updated: ${new Date(app.updatedAt).toLocaleDateString()}`);
    }
    lines.push(`URL: ${app.url || ''}`);
    if (app.notes) lines.push(`Notes: ${app.notes}`);
  });

  return lines.join('\n');
}
