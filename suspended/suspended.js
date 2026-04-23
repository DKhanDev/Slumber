/**
 * suspended.js — sleeping tab controller
 *
 * Reads tab metadata from the URL hash (set by suspender.js),
 * renders the page, and restores the original tab on user interaction.
 *
 * Hash format (URLSearchParams-encoded):
 *   suspended.html#url=https://...&title=Page+Title&favicon=https://...
 *
 * Restoration: navigates to the original URL directly — the worker
 * will detect the URL change via onUpdated and clean up the registry.
 */

(function () {

  // -------------------------------------------------------------------------
  // Parse metadata from hash
  // -------------------------------------------------------------------------

  const params  = new URLSearchParams(location.hash.slice(1));
  const origUrl = params.get('url')    || '';
  const title   = params.get('title')  || origUrl || 'Sleeping tab';
  const favicon = params.get('favicon')|| '';

  // -------------------------------------------------------------------------
  // Populate DOM
  // -------------------------------------------------------------------------

  // Page title
  document.title = title ? `💤 ${title}` : 'Sleeping tab';

  // Site title
  const titleEl = document.getElementById('site-title');
  if (titleEl) titleEl.textContent = title;

  // Favicon
  const faviconEl = document.getElementById('site-favicon');
  if (faviconEl && favicon) {
    faviconEl.src = favicon;
    faviconEl.onerror = () => { faviconEl.src = ''; };
  }

  // Domain
  const domainEl = document.getElementById('site-domain');
  if (domainEl && origUrl) {
    try {
      domainEl.textContent = new URL(origUrl).hostname.replace(/^www\./, '');
    } catch {
      domainEl.textContent = '';
    }
  }

  // Time asleep — read suspendedAt from storage via the extension runtime
  renderAsleepSince();

  // -------------------------------------------------------------------------
  // Wake interaction
  // -------------------------------------------------------------------------

  function wake() {
    if (!origUrl) return;
    location.href = origUrl;
  }

  // Button
  const wakeBtn = document.getElementById('wake-btn');
  if (wakeBtn) {
    wakeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      wake();
    });
  }

  // Click anywhere on stage (but not on the button — it handles itself)
  document.addEventListener('click', (e) => {
    if (e.target === wakeBtn) return;
    if (e.target === document.body || e.target.closest('.stage')) {
      wake();
    }
  });

  // Keyboard: Space or Enter
  document.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      wake();
    }
  });

  // -------------------------------------------------------------------------
  // Asleep duration
  // -------------------------------------------------------------------------

  /**
   * Asks the extension runtime for the suspended registry entry so we can
   * display how long this tab has been sleeping. Falls back gracefully if
   * the runtime isn't reachable (e.g. extension reloaded mid-session).
   */
  async function renderAsleepSince() {
    const el = document.getElementById('asleep-since');
    if (!el) return;

    try {
      const [tab, res] = await Promise.all([
        chrome.tabs.getCurrent(),
        chrome.runtime.sendMessage({ type: 'GET_TABS', payload: {} }),
      ]);
      if (!res?.ok || !tab) return;

      const entry = res.registry[tab.id];
      if (!entry?.suspendedAt) return;

      // Initial render
      el.textContent = formatDuration(entry.suspendedAt);

      // Update every 30 seconds
      setInterval(() => {
        el.textContent = formatDuration(entry.suspendedAt);
      }, 30_000);

    } catch {
      // Runtime not available — silently skip the duration display
    }
  }

  function formatDuration(suspendedAt) {
    const seconds = Math.floor((Date.now() - suspendedAt) / 1000);

    if (seconds < 60)   return 'Sleeping for less than a minute';
    if (seconds < 3600) return `Sleeping for ${Math.floor(seconds / 60)}m`;

    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0
      ? `Sleeping for ${h}h ${m}m`
      : `Sleeping for ${h}h`;
  }

})();
