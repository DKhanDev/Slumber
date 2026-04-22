/**
 * pro.js — Pro status check via ExtensionPay
 *
 * Extracted into its own module to break the circular dependency that would
 * arise if suspender.js imported isPro from worker.js (which imports suspender.js).
 *
 * MV3 SERVICE WORKER NOTE:
 *   Top-level `extpay` variables go undefined inside service worker callbacks.
 *   The fix (per ExtPay docs) is to call ExtPay(EXTPAY_ID) fresh inside each
 *   function. startBackground() is NOT called here — only in worker.js.
 */

import { ExtPay } from '../ExtPay.esm.js';

// Must match the EXTPAY_ID in worker.js — single source of truth via this import
export const EXTPAY_ID = 'slumber-pro'; // ExtensionPay short-id

/**
 * Returns true if the current user has paid.
 * Re-declares ExtPay inside the function body (MV3 service worker requirement).
 * @returns {Promise<boolean>}
 */
export async function isPro() {
  try {
    const ep = ExtPay(EXTPAY_ID);
    const user = await ep.getUser();
    return Boolean(user.paid);
  } catch (err) {
    console.warn('[Slumber] ExtPay getUser error — defaulting to false:', err);
    return false;
  }
}

/**
 * Opens the ExtensionPay payment / login page in a new tab.
 * Re-declares ExtPay inside the function body (MV3 service worker requirement).
 */
export function openPaymentPage() {
  const ep = ExtPay(EXTPAY_ID);
  ep.openPaymentPage();
}
