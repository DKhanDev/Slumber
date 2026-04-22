/**
 * ExtPay.esm.js — ES module shim for ExtPay.js
 *
 * ExtPay.js is an IIFE that assigns `var ExtPay = ...` to the global scope.
 * Module service workers don't support importScripts(), so we load the IIFE
 * via a dynamic import (which executes it and sets globalThis.ExtPay), then
 * re-export ExtPay so background ES modules can import it normally.
 *
 * This avoids any bundler requirement and keeps the background as ES modules.
 */

// Dynamic import of the IIFE executes it and sets globalThis.ExtPay
await import(chrome.runtime.getURL('ExtPay.js'));

export const ExtPay = globalThis.ExtPay;
export default globalThis.ExtPay;
