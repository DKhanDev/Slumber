/**
 * storage.js — typed wrappers around chrome.storage.local
 *
 * All reads/writes go through here so the rest of the codebase never
 * touches raw storage keys directly. Easy to swap storage.local →
 * storage.sync for Pro cross-device sync later.
 */

export const FREE_TIER_LIMIT = 10;

/** @returns {Promise<SlumberSettings>} */
export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings ?? defaultSettings();
}

/** @returns {Promise<SuspendedRegistry>} */
export async function getSuspendedRegistry() {
  const { suspended } = await chrome.storage.local.get('suspended');
  return suspended ?? {};
}

// Note: getStoredKey() and storeKey() removed — Pro status is now managed
// entirely by ExtensionPay (stored in storage.sync under ExtPay's own keys).

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

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
// JSDoc types (no build step needed — just documentation)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SlumberSettings
 * @property {boolean}  autoSuspend       - Enable timer-based auto-suspend
 * @property {number}   autoSuspendDelay  - Minutes before auto-suspend
 * @property {boolean}  suspendPinned     - Allow suspending pinned tabs
 * @property {boolean}  suspendAudible    - Allow suspending tabs playing audio
 * @property {string[]} whitelist         - Domains to never suspend (Pro)
 * @property {boolean}  syncSettings      - Sync settings across devices (Pro)
 */

/**
 * @typedef {Object} SuspendedEntry
 * @property {string} url
 * @property {string} title
 * @property {string} favicon
 * @property {number} suspendedAt  - Unix timestamp (ms)
 */

/**
 * @typedef {Object.<number, SuspendedEntry>} SuspendedRegistry
 */
