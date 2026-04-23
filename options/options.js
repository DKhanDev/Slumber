/**
 * options.js — Slumber options page controller
 *
 * Sections: General | Whitelist | License | Stats
 *
 * All communication with the background worker goes through
 * chrome.runtime.sendMessage — same message API as the popup.
 * Stats are read directly from storage.local (no worker message needed).
 *
 * License section uses ExtensionPay via the OPEN_PAYMENT_PAGE background
 * message. No license key input — ExtPay handles everything.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const $ = id => document.getElementById(id);

function msg(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, payload });
}

function showSaveConfirm(id) {
  const el = $(id);
  if (!el) return;
  el.hidden = false;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.hidden = true; }, 2200);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const navItems  = document.querySelectorAll('.nav-item');
const sections  = document.querySelectorAll('.section');

function activateSection(name) {
  navItems.forEach(a => a.classList.toggle('active', a.dataset.section === name));
  sections.forEach(s => {
    const match = s.id === `section-${name}`;
    s.hidden = !match;
    if (!match) s.classList.remove('active');
    else s.classList.add('active');
  });

  // Lazy-load section data on first visit
  if (name === 'stats')     loadStats();
  if (name === 'license')   loadLicense();
  if (name === 'whitelist') loadWhitelist();
}

navItems.forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    activateSection(a.dataset.section);
  });
});

// Handle direct hash navigation (e.g. chrome opens options to #license)
function routeFromHash() {
  const hash = location.hash.slice(1);
  const valid = ['general', 'whitelist', 'license', 'stats'];
  activateSection(valid.includes(hash) ? hash : 'general');
}
window.addEventListener('hashchange', routeFromHash);

// ---------------------------------------------------------------------------
// Config — update before submission
// ---------------------------------------------------------------------------

const GITHUB_URL = 'https://github.com/DKhanDev/Slumber';

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  const manifest = chrome.runtime.getManifest();
  const verEl = $('version-label');
  if (verEl) verEl.textContent = `v${manifest.version}`;

  // Wire GitHub sidebar link
  const ghLink = $('link-github');
  if (ghLink) ghLink.href = GITHUB_URL;

  const settingsRes = await msg('GET_SETTINGS');
  if (settingsRes.ok) {
    applySettings(settingsRes.settings, settingsRes.isPro);
    _whitelist = settingsRes.settings.whitelist ?? [];
  }

  bindGeneralEvents();
  bindWhitelistEvents();
  bindLicenseEvents();
  bindStatsEvents();
  await maybeShowWelcomeCard();

  routeFromHash();
}

// ---------------------------------------------------------------------------
// General settings
// ---------------------------------------------------------------------------

function applySettings(settings, isPro) {
  $('toggle-auto').checked    = settings.autoSuspend    ?? true;
  $('input-delay').value      = settings.autoSuspendDelay ?? 30;
  $('toggle-pinned').checked  = settings.suspendPinned  ?? false;
  $('toggle-audible').checked = settings.suspendAudible ?? false;
  $('toggle-sync').checked    = settings.syncSettings   ?? false;

  $('row-delay').hidden = !$('toggle-auto').checked;

  // Lock Pro features for free users
  const syncCard = $('card-sync');
  if (syncCard) syncCard.classList.toggle('pro-locked', !isPro);
}

function bindGeneralEvents() {
  $('toggle-auto').addEventListener('change', () => {
    $('row-delay').hidden = !$('toggle-auto').checked;
  });

  $('btn-save-general').addEventListener('click', async () => {
    const settings = {
      autoSuspend:      $('toggle-auto').checked,
      autoSuspendDelay: Math.max(1, parseInt($('input-delay').value, 10) || 30),
      suspendPinned:    $('toggle-pinned').checked,
      suspendAudible:   $('toggle-audible').checked,
      syncSettings:     $('toggle-sync').checked,
      whitelist:        await getCurrentWhitelist(),
    };

    const res = await msg('SAVE_SETTINGS', { settings });
    if (res.ok) showSaveConfirm('save-confirm-general');
  });
}

// ---------------------------------------------------------------------------
// Whitelist
// ---------------------------------------------------------------------------

let _whitelist = [];

async function loadWhitelist() {
  const res = await msg('GET_SETTINGS');
  _whitelist = res.ok ? (res.settings.whitelist ?? []) : [];
  renderDomainList();

  // Lock if not Pro
  const card = $('whitelist-card');
  if (card) card.classList.toggle('pro-locked', !res.isPro);

  // Disable "Clear all" for free users
  const clearBtn = $('btn-clear-whitelist');
  if (clearBtn) {
    clearBtn.disabled = !res.isPro;
    clearBtn.title = res.isPro ? '' : 'Upgrade to Pro to manage whitelist';
  }
}

function renderDomainList() {
  const list  = $('domain-list');
  const empty = $('empty-domains');

  list.innerHTML = '';

  if (_whitelist.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  _whitelist.forEach(domain => {
    const row = document.createElement('div');
    row.className = 'domain-row';
    row.setAttribute('role', 'listitem');

    const name = document.createElement('span');
    name.className   = 'domain-name';
    name.textContent = domain;

    const removeBtn = document.createElement('button');
    removeBtn.className   = 'btn-danger-sm';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => removeDomain(domain));

    row.append(name, removeBtn);
    list.appendChild(row);
  });
}

async function addDomain() {
  const input  = $('whitelist-input');
  const raw    = input.value.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');

  if (!raw || _whitelist.includes(raw)) {
    input.value = '';
    return;
  }

  _whitelist.push(raw);
  input.value = '';
  renderDomainList();
  await persistWhitelist();
  showSaveConfirm('save-confirm-whitelist');
}

async function removeDomain(domain) {
  _whitelist = _whitelist.filter(d => d !== domain);
  renderDomainList();
  await persistWhitelist();
  showSaveConfirm('save-confirm-whitelist');
}

async function persistWhitelist() {
  const settingsRes = await msg('GET_SETTINGS');
  if (!settingsRes.ok) return;
  await msg('SAVE_SETTINGS', {
    settings: { ...settingsRes.settings, whitelist: _whitelist },
  });
}

async function getCurrentWhitelist() {
  return _whitelist;
}

function bindWhitelistEvents() {
  $('btn-add-domain').addEventListener('click', addDomain);
  $('whitelist-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addDomain();
  });
  $('btn-clear-whitelist').addEventListener('click', async () => {
    const proRes = await msg('GET_SETTINGS');
    if (!proRes.isPro) return;
    if (!confirm('Clear all whitelisted domains?')) return;
    _whitelist = [];
    renderDomainList();
    await persistWhitelist();
  });
}

// ---------------------------------------------------------------------------
// License — ExtensionPay
// ---------------------------------------------------------------------------

async function loadLicense() {
  const res = await msg('GET_SETTINGS');
  renderLicenseState(res.isPro ?? false);
}

function renderLicenseState(isPro) {
  $('pro-active-card').hidden = !isPro;
  $('free-card').hidden       =  isPro;
}

function openPaymentPage() {
  // Delegates to background worker which calls extpay.openPaymentPage()
  msg('OPEN_PAYMENT_PAGE');
}

function bindLicenseEvents() {
  // Upgrade button — opens ExtPay payment / Stripe page
  $('btn-upgrade').addEventListener('click', openPaymentPage);

  // "Sign in to restore access" — same payment page handles login flow
  $('link-login').addEventListener('click', e => {
    e.preventDefault();
    openPaymentPage();
  });

  // "Sign in to your ExtensionPay account" link on Pro active card
  $('link-manage').addEventListener('click', e => {
    e.preventDefault();
    openPaymentPage();
  });
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

const STATS_KEY  = 'slumber_stats';
const MB_PER_TAB = 80; // conservative estimate, MB saved per suspended tab

async function loadStats() {
  const { slumber_stats: stats = {}, suspended = {} } =
    await chrome.storage.local.get([STATS_KEY, 'suspended']);

  const totalSuspended  = stats.totalSuspended  ?? 0;
  const installDate     = stats.installDate     ?? Date.now();
  const currentSleeping = Object.keys(suspended).length;
  const daysActive      = Math.max(1, Math.floor((Date.now() - installDate) / 86_400_000));
  const memoryMB        = totalSuspended * MB_PER_TAB;

  $('stat-total-suspended').textContent   = totalSuspended.toLocaleString();
  $('stat-currently-sleeping').textContent = currentSleeping.toLocaleString();
  $('stat-memory').textContent            = memoryMB >= 1000
    ? `~${(memoryMB / 1000).toFixed(1)} GB`
    : `~${memoryMB} MB`;
  $('stat-days-active').textContent       = daysActive.toLocaleString();
}

function bindStatsEvents() {
  $('btn-reset-stats').addEventListener('click', async () => {
    if (!confirm('Reset all stats? This cannot be undone.')) return;
    await chrome.storage.local.set({
      [STATS_KEY]: { totalSuspended: 0, installDate: Date.now() },
    });
    loadStats();
  });
}

// ---------------------------------------------------------------------------
// Welcome card (first install only)
// ---------------------------------------------------------------------------

async function maybeShowWelcomeCard() {
  const { slumber_welcomed } = await chrome.storage.local.get('slumber_welcomed');
  if (slumber_welcomed) return;

  const card    = $('welcome-card');
  const dismiss = $('welcome-card-dismiss');
  if (!card) return;

  card.hidden = false;

  dismiss.addEventListener('click', async () => {
    card.style.animation  = 'none';
    card.style.opacity    = '0';
    card.style.transition = 'opacity 0.2s';
    setTimeout(() => { card.hidden = true; }, 200);
    await chrome.storage.local.set({ slumber_welcomed: true });
  });
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

init();
