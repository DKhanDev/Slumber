/**
 * media-relay.js — runs in the ISOLATED content-script world.
 *
 * Listens for the CustomEvent fired by media-monitor.js (MAIN world) and
 * forwards the active-capture state to the background service worker.
 * Tracks per-frame state so that a single busy iframe doesn't get cleared
 * by a quiet sibling frame: the tab is "capturing" if any frame says so.
 */
window.addEventListener('__slumber_capture', e => {
  chrome.runtime.sendMessage({
    type:    'SET_CAPTURE_STATE',
    payload: { capturing: Boolean(e.detail?.active) },
  }).catch(() => {});
});
