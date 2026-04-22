/**
 * suspender.js — core suspend / unsuspend logic
 *
 * A "suspended" tab is replaced with the extension's suspended.html page.
 * The original URL, title, and favicon are encoded into the hash so the
 * suspended page can display them and restore the tab on user interaction.
 *
 * Free tier: max FREE_TIER_LIMIT tabs suspended concurrently.
 * Pro: unlimited.
 */

import { getSettings, getSuspendedRegistry, FREE_TIER_LIMIT } from './storage.js';
import { isPro } from './pro.js';
import { clearTabAlarm } from './alarms.js';

const SUSPENDED_PAGE = chrome.runtime.getURL('suspended/suspended.html');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Suspend a single tab.
 * @param {number} tabId
 * @param {{ source: 'auto' | 'manual' }} opts
 */
export async function suspendTab(tabId, opts = {}) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;

  // Guard: never suspend a tab that is already suspended
  if (isSlumberPage(tab.url)) return;

  // Guard: never suspend the active tab (auto-suspend only; manual is explicit)
  if (opts.source === 'auto' && tab.active) return;

  // Guard: whitelist / exemption checks
  if (await isExempt(tab)) return;

  // Guard: free tier cap
  if (!await isPro()) {
    const registry = await getSuspendedRegistry();
    const count = Object.keys(registry).length;
    if (count >= FREE_TIER_LIMIT) {
      console.info(`[Slumber] Free tier limit (${FREE_TIER_LIMIT}) reached. Skipping tab ${tabId}.`);
      return;
    }
  }

  // Persist metadata before navigating away
  const entry = {
    url:         tab.url,
    title:       tab.title  || tab.url,
    favicon:     tab.favIconUrl || '',
    suspendedAt: Date.now(),
  };

  const registry = await getSuspendedRegistry();
  registry[tabId] = entry;

  // Increment lifetime stats counter
  const { slumber_stats: stats = {} } = await chrome.storage.local.get('slumber_stats');
  stats.totalSuspended = (stats.totalSuspended ?? 0) + 1;
  if (!stats.installDate) stats.installDate = Date.now();

  await chrome.storage.local.set({ suspended: registry, slumber_stats: stats });

  // Build the suspended page URL — metadata lives in the hash (never sent to a server)
  const suspendedUrl = buildSuspendedUrl(entry);

  await chrome.tabs.update(tabId, { url: suspendedUrl });
  await clearTabAlarm(tabId);
}

/**
 * Suspend multiple tabs (Pro feature — caller must have already checked).
 * @param {number[]} tabIds
 * @param {{ source: 'auto' | 'manual' }} opts
 */
export async function suspendTabs(tabIds, opts = {}) {
  for (const tabId of tabIds) {
    await suspendTab(tabId, opts);
  }
}

/**
 * Restore a suspended tab to its original URL.
 * @param {number} tabId
 */
export async function unsuspendTab(tabId) {
  const registry = await getSuspendedRegistry();
  const entry = registry[tabId];
  if (!entry) return;

  await chrome.tabs.update(tabId, { url: entry.url });

  delete registry[tabId];
  await chrome.storage.local.set({ suspended: registry });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build the URL for the suspended page, encoding tab metadata in the hash.
 * Example: chrome-extension://.../suspended.html#url=...&title=...&favicon=...
 */
function buildSuspendedUrl({ url, title, favicon }) {
  const hash = new URLSearchParams({
    url,
    title,
    favicon,
  }).toString();
  return `${SUSPENDED_PAGE}#${hash}`;
}

/**
 * True if a URL is already a Slumber suspended page.
 */
function isSlumberPage(url = '') {
  return url.startsWith(SUSPENDED_PAGE);
}

/**
 * True if the tab should never be suspended based on settings + tab state.
 */
async function isExempt(tab) {
  const settings = await getSettings();

  // Pinned tabs
  if (tab.pinned && !settings.suspendPinned) return true;

  // Tabs playing audio
  if (tab.audible && !settings.suspendAudible) return true;

  // Tabs with no URL or browser/extension internal pages
  if (!tab.url
    || tab.url.startsWith('chrome://')
    || tab.url.startsWith('chrome-extension://')
    || tab.url.startsWith('about:')
    || tab.url.startsWith('file://')
  ) {
    return true;
  }

  // Domain whitelist (Pro feature — free users get pinned+audible exemption only)
  if (settings.whitelist?.length && await isPro()) {
    const tabHost = extractHostname(tab.url);
    if (settings.whitelist.some(domain => tabHost === domain || tabHost.endsWith(`.${domain}`))) {
      return true;
    }
  }

  return false;
}

function extractHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
