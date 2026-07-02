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

async function sendToTab(tabId, payload) {
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
