/**
 * license.js — stub retained for import compatibility
 *
 * With ExtensionPay, all Pro checks and payment page calls are handled
 * directly in worker.js, which re-declares ExtPay(EXTPAY_ID) inside each
 * service worker callback as required by the MV3 service worker spec.
 *
 * This file is intentionally minimal. Nothing outside worker.js needs to
 * import from here — isPro() and openPaymentPage() live in worker.js.
 *
 * Keeping this file avoids breaking any future imports and documents
 * the architectural decision clearly.
 */

// No exports needed — worker.js owns all ExtPay logic.
