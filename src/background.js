// ─── JobFill AI — Background Service Worker ───────────────────────────────────

const POPUP_URL = chrome.runtime.getURL('popup.html?window=1');
const POPUP_WIDTH = 420;
const POPUP_HEIGHT = 720;

const CONTENT_SCRIPT_FILES = ['src/applications.js', 'src/content.js'];

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

async function pingContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId) {
  if (!tabId) throw new Error('No active tab.');

  const tab = await chrome.tabs.get(tabId);
  if (!isInjectableUrl(tab.url)) {
    throw new Error('This page cannot be accessed. Open a regular web page first.');
  }

  if (await pingContentScript(tabId)) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES
  });

  for (let attempt = 0; attempt < 5; attempt++) {
    if (await pingContentScript(tabId)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  throw new Error('Content script failed to load. Try refreshing the page.');
}

async function sendToTab(tabId, payload) {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, payload);
}

function configureSidePanel() {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
}

function openFloatingWindow() {
  chrome.windows.create({
    url: POPUP_URL,
    type: 'popup',
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    focused: true
  });
}

configureSidePanel();

chrome.runtime.onInstalled.addListener(() => {
  console.log('JobFill AI installed.');
  configureSidePanel();

  chrome.storage.local.get(['autoFill', 'fuzzyMatch', 'notify', 'aiProvider', 'model'], res => {
    const defaults = {};
    if (res.autoFill === undefined) defaults.autoFill = false;
    if (res.fuzzyMatch === undefined) defaults.fuzzyMatch = true;
    if (res.notify === undefined) defaults.notify = true;
    if (res.aiProvider === undefined) defaults.aiProvider = 'anthropic';
    if (res.model === undefined) defaults.model = 'claude-sonnet-4-20250514';
    if (Object.keys(defaults).length) chrome.storage.local.set(defaults);
  });

  chrome.storage.local.get(['backupMode'], res => {
    if (res.backupMode === undefined) {
      chrome.storage.local.set({ backupMode: 'browser' });
    }
  });
});

if (!chrome.sidePanel) {
  chrome.action.onClicked.addListener(() => {
    openFloatingWindow();
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'OPEN_FLOATING_WINDOW') {
    openFloatingWindow();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'SEND_TO_TAB') {
    sendToTab(message.tabId, message.payload)
      .then(response => sendResponse({ ok: true, response }))
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }
});
