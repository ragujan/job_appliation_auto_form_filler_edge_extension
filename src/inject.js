// ─── Popup → background bridge for on-demand content script injection ────────

const RESTRICTED_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'devtools://',
  'view-source:',
  'chrome-search://',
  'chrome-devtools://'
];

function isInjectableUrl(url) {
  if (!url) return false;
  return !RESTRICTED_URL_PREFIXES.some(prefix => url.startsWith(prefix));
}

async function sendToTab(tabId, payload, tabUrl) {
  if (!tabUrl || !isInjectableUrl(tabUrl)) {
    throw new Error('Open a job page in the browser.');
  }

  const granted = await ensureHostPermission(tabUrl);
  if (!granted) {
    throw new Error(PERMISSION_DENIED_MSG);
  }

  const result = await chrome.runtime.sendMessage({
    type: 'SEND_TO_TAB',
    tabId,
    payload
  });

  if (!result?.ok) {
    throw new Error(result?.error || 'Could not reach page.');
  }

  return result.response;
}
