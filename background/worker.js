/**
 * worker.js — Slumber service worker (MV3)
 *
 * Responsibilities:
 *  - Bootstrap ExtPay on install / startup
 *  - Bootstrap alarms on install / startup
 *  - Route chrome.alarms → suspender
 *  - Route messages from popup → suspender / storage / license
 *  - Listen for tab events to reset idle timers
 *
 * MV3 SERVICE WORKER NOTE (from ExtPay docs):
 *   `extpay` becomes undefined inside service worker callbacks when declared
 *   at the top level. isPro() and openPaymentPage() in pro.js each re-declare
 *   ExtPay(EXTPAY_ID) internally, which is the correct workaround.
 *   startBackground() must only be called once — here at the top level.
 */

import { ExtPay } from '../ExtPay.esm.js';
import { EXTPAY_ID, isPro, openPaymentPage } from './pro.js';
import { suspendTab, suspendTabs, unsuspendTab } from './suspender.js';
import { getSettings, getSuspendedRegistry } from './storage.js';
import {
  ALARM_PREFIX,
  SWEEP_ALARM,
  scheduleTabAlarm,
  clearTabAlarm,
  sweepOrphanedAlarms,
} from './alarms.js';

// ---------------------------------------------------------------------------
// ExtPay — call startBackground() once at top level
// ---------------------------------------------------------------------------

const extpay = ExtPay(EXTPAY_ID);
extpay.startBackground();

const SWEEP_INTERVAL = 5; // minutes

// ---------------------------------------------------------------------------
// Install / startup
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.local.set({
      settings: {
        autoSuspend:      true,
        autoSuspendDelay: 30,
        suspendPinned:    false,
        suspendAudible:   false,
        whitelist:        [],
        syncSettings:     false,
      },
      suspended:     {},
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
  if (settings.autoSuspend) {
    await scheduleTabAlarm(tabId, settings.autoSuspendDelay);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const settings = await getSettings();
  if (settings.autoSuspend) {
    await scheduleTabAlarm(tabId, settings.autoSuspendDelay);
  }
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
