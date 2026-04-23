/**
 * worker.js — Slumber service worker (classic, non-module)
 *
 * All background modules are inlined here so we can use importScripts()
 * to load ExtPay.js without needing "type":"module" on the service worker.
 * Top-level await is not allowed in service workers — this avoids that entirely.
 *
 * Load order:
 *   1. ExtPay.js       — sets globalThis.ExtPay
 *   2. This file       — uses ExtPay, defines all logic
 */

importScripts('../ExtPay.js');

// ---------------------------------------------------------------------------
// ExtPay init — startBackground() called once at top level
// ---------------------------------------------------------------------------

const EXTPAY_ID = 'slumber-pro';
const extpay = ExtPay(EXTPAY_ID);
extpay.startBackground();

// ---------------------------------------------------------------------------
// ── alarms.js ───────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

const ALARM_PREFIX = 'slumber-tab-';
const SWEEP_ALARM  = 'slumber-sweep';

async function scheduleTabAlarm(tabId, delayInMinutes) {
  const alarmName = `${ALARM_PREFIX}${tabId}`;
  await chrome.alarms.clear(alarmName);
  await chrome.alarms.create(alarmName, { delayInMinutes });
}

async function clearTabAlarm(tabId) {
  await chrome.alarms.clear(`${ALARM_PREFIX}${tabId}`);
}

async function sweepOrphanedAlarms() {
  const [alarms, tabs] = await Promise.all([
    chrome.alarms.getAll(),
    chrome.tabs.query({}),
  ]);
  const tabIds = new Set(tabs.map(t => t.id));
  await Promise.all(
    alarms
      .filter(a => a.name.startsWith(ALARM_PREFIX))
      .filter(a => !tabIds.has(parseInt(a.name.slice(ALARM_PREFIX.length), 10)))
      .map(a => chrome.alarms.clear(a.name))
  );
}

async function sweepOrphanedRegistry() {
  const [registry, tabs] = await Promise.all([
    getSuspendedRegistry(),
    chrome.tabs.query({}),
  ]);
  const tabIds = new Set(tabs.map(t => t.id));
  const orphaned = Object.keys(registry).filter(id => !tabIds.has(parseInt(id, 10)));
  if (orphaned.length === 0) return;
  orphaned.forEach(id => delete registry[id]);
  await chrome.storage.local.set({ suspended: registry });
}

// ---------------------------------------------------------------------------
// ── storage.js ──────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

const FREE_TIER_LIMIT = 10;

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings ?? defaultSettings();
}

async function getSuspendedRegistry() {
  const { suspended } = await chrome.storage.local.get('suspended');
  return suspended ?? {};
}

function defaultSettings() {
  return {
    autoSuspend:      true,
    autoSuspendDelay: 30,
    suspendPinned:    false,
    suspendAudible:   false,
    whitelist:        [],
    syncSettings:     false,
  };
}

// ---------------------------------------------------------------------------
// ── pro.js ──────────────────────────────────────────────────────────────────
// MV3 note: top-level extpay goes undefined in callbacks — re-declare inside
// each function that needs it. startBackground() must only be called once.
// ---------------------------------------------------------------------------

async function isPro() {
  try {
    const ep = ExtPay(EXTPAY_ID);
    const user = await ep.getUser();
    return Boolean(user.paid);
  } catch (err) {
    console.warn('[Slumber] ExtPay getUser error — defaulting to false:', err);
    return false;
  }
}

function openPaymentPage() {
  const ep = ExtPay(EXTPAY_ID);
  ep.openPaymentPage();
}

// ---------------------------------------------------------------------------
// ── suspender.js ────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

const SUSPENDED_PAGE = chrome.runtime.getURL('suspended/suspended.html');

async function suspendTab(tabId, opts = {}) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;

  if (isSlumberPage(tab.url)) return;
  if (opts.source === 'auto' && tab.active) return;
  if (await isExempt(tab)) return;

  if (!await isPro()) {
    const registry = await getSuspendedRegistry();
    if (Object.keys(registry).length >= FREE_TIER_LIMIT) {
      console.info(`[Slumber] Free tier limit (${FREE_TIER_LIMIT}) reached. Skipping tab ${tabId}.`);
      return;
    }
  }

  const entry = {
    url:         tab.url,
    title:       tab.title || tab.url,
    favicon:     tab.favIconUrl || '',
    suspendedAt: Date.now(),
  };

  const registry = await getSuspendedRegistry();
  registry[tabId] = entry;

  const { slumber_stats: stats = {} } = await chrome.storage.local.get('slumber_stats');
  stats.totalSuspended = (stats.totalSuspended ?? 0) + 1;
  if (!stats.installDate) stats.installDate = Date.now();

  await chrome.storage.local.set({ suspended: registry, slumber_stats: stats });
  await chrome.tabs.update(tabId, { url: buildSuspendedUrl(entry) });
  await clearTabAlarm(tabId);
}

async function suspendTabs(tabIds, opts = {}) {
  for (const tabId of tabIds) {
    await suspendTab(tabId, opts);
  }
}

async function unsuspendTab(tabId) {
  const registry = await getSuspendedRegistry();
  const entry = registry[tabId];
  if (!entry) return;

  await chrome.tabs.update(tabId, { url: entry.url });
  delete registry[tabId];
  await chrome.storage.local.set({ suspended: registry });
}

function buildSuspendedUrl({ url, title, favicon }) {
  const hash = new URLSearchParams({ url, title, favicon }).toString();
  return `${SUSPENDED_PAGE}#${hash}`;
}

function isSlumberPage(url = '') {
  return url.startsWith(SUSPENDED_PAGE);
}

async function isExempt(tab) {
  const settings = await getSettings();

  if (tab.pinned && !settings.suspendPinned) return true;
  if (tab.audible && !settings.suspendAudible) return true;

  if (!tab.url
    || tab.url.startsWith('chrome://')
    || tab.url.startsWith('chrome-extension://')
    || tab.url.startsWith('about:')
    || tab.url.startsWith('file://')
  ) return true;

  if (settings.whitelist?.length && await isPro()) {
    const tabHost = extractHostname(tab.url);
    if (settings.whitelist.some(d => tabHost === d || tabHost.endsWith(`.${d}`))) {
      return true;
    }
  }

  return false;
}

function extractHostname(url) {
  try { return new URL(url).hostname; }
  catch { return ''; }
}

// ---------------------------------------------------------------------------
// Install / startup
// ---------------------------------------------------------------------------

const SWEEP_INTERVAL = 5;

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.local.set({
      settings:     defaultSettings(),
      suspended:    {},
      slumber_stats: { totalSuspended: 0, installDate: Date.now() },
    });
    await chrome.tabs.create({
      url: chrome.runtime.getURL('options/options.html#general'),
    });
  }
  await bootstrapAlarms();
});

chrome.runtime.onStartup.addListener(bootstrapAlarms);

async function bootstrapAlarms() {
  await chrome.alarms.clear(SWEEP_ALARM);
  await chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: SWEEP_INTERVAL });
}

// ---------------------------------------------------------------------------
// Alarm handling
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SWEEP_ALARM) {
    await sweepOrphanedAlarms();
    await sweepOrphanedRegistry();
    return;
  }
  if (alarm.name.startsWith(ALARM_PREFIX)) {
    const tabId = parseInt(alarm.name.slice(ALARM_PREFIX.length), 10);
    await handleAutoSuspend(tabId);
  }
});

async function handleAutoSuspend(tabId) {
  const settings = await getSettings();
  if (!settings.autoSuspend) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;

  if (tab.active) {
    await scheduleTabAlarm(tabId, settings.autoSuspendDelay);
    return;
  }

  await suspendTab(tabId, { source: 'auto' });
}

// ---------------------------------------------------------------------------
// Tab event listeners
// ---------------------------------------------------------------------------

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const settings = await getSettings();
  if (settings.autoSuspend) await scheduleTabAlarm(tabId, settings.autoSuspendDelay);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  if (changeInfo.url.startsWith(SUSPENDED_PAGE)) return;

  const registry = await getSuspendedRegistry();
  if (registry[tabId]) {
    delete registry[tabId];
    await chrome.storage.local.set({ suspended: registry });
  }

  const settings = await getSettings();
  if (settings.autoSuspend) await scheduleTabAlarm(tabId, settings.autoSuspendDelay);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await clearTabAlarm(tabId);
  const registry = await getSuspendedRegistry();
  if (registry[tabId]) {
    delete registry[tabId];
    await chrome.storage.local.set({ suspended: registry });
  }
});

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch(err => {
      console.error('[Slumber worker] message error:', err);
      sendResponse({ ok: false, error: err.message });
    });
  return true;
});

async function handleMessage({ type, payload }) {
  switch (type) {

    case 'SUSPEND_TAB': {
      await suspendTab(payload.tabId, { source: 'manual' });
      return { ok: true };
    }

    case 'SUSPEND_TABS': {
      if (!await isPro()) return { ok: false, error: 'PRO_REQUIRED' };
      await suspendTabs(payload.tabIds, { source: 'manual' });
      return { ok: true };
    }

    case 'UNSUSPEND_TAB': {
      await unsuspendTab(payload.tabId);
      return { ok: true };
    }

    case 'GET_TABS': {
      const [tabs, registry, pro] = await Promise.all([
        chrome.tabs.query({ currentWindow: true }),
        getSuspendedRegistry(),
        isPro(),
      ]);
      return { ok: true, tabs, registry, isPro: pro };
    }

    case 'GET_SETTINGS': {
      const [settings, pro] = await Promise.all([getSettings(), isPro()]);
      return { ok: true, settings, isPro: pro };
    }

    case 'SAVE_SETTINGS': {
      const { settings } = payload;
      await chrome.storage.local.set({ settings });
      const alarms = await chrome.alarms.getAll();
      const tabAlarms = alarms.filter(a => a.name.startsWith(ALARM_PREFIX));
      if (settings.autoSuspend) {
        const tabs = await chrome.tabs.query({});
        await Promise.all(tabs.map(t => scheduleTabAlarm(t.id, settings.autoSuspendDelay)));
      } else {
        await Promise.all(tabAlarms.map(a => chrome.alarms.clear(a.name)));
      }
      return { ok: true };
    }

    case 'OPEN_PAYMENT_PAGE': {
      openPaymentPage();
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unknown message type: ${type}` };
  }
}
