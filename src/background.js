// ─── JobFill AI — Background Service Worker ───────────────────────────────────

const POPUP_URL = chrome.runtime.getURL('popup.html?window=1');
const POPUP_WIDTH = 420;
const POPUP_HEIGHT = 720;

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

// Fallback for browsers without side panel support
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
});
