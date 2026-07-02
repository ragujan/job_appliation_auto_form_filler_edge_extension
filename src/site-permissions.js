// ─── Per-site optional host permissions (requested on user click) ─────────────

function originPattern(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.origin === 'null' || !/^https?:$/i.test(parsed.protocol)) return null;
    return `${parsed.origin}/*`;
  } catch {
    return null;
  }
}

function siteLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'this site';
  }
}

async function hasHostPermission(url) {
  const pattern = originPattern(url);
  if (!pattern) return false;
  return chrome.permissions.contains({ origins: [pattern] });
}

async function requestHostPermission(url) {
  const pattern = originPattern(url);
  if (!pattern) return false;

  if (await hasHostPermission(url)) return true;

  try {
    return await chrome.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

async function ensureHostPermission(url) {
  if (await hasHostPermission(url)) return true;
  return requestHostPermission(url);
}

const PERMISSION_DENIED_MSG = 'Allow access to this site to use FillyJobber on this page.';
