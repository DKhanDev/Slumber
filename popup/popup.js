/**
 * popup.js — Slumber popup controller
 *
 * Responsibilities:
 *  - Render tab list for current window
 *  - Handle per-row sleep/wake actions
 *  - Handle select mode (Pro: multi-select + bulk suspend)
 *  - Render free tier meter / Pro status
 *  - Settings panel: read, edit, save
 *  - Pro upgrade: opens options/options.html#license in a new tab
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  tabs:       [],       // chrome.tabs objects for current window
  registry:   {},       // { [tabId]: SuspendedEntry }
  settings:   {},
  isPro:      false,
  selected:   new Set(), // tabIds selected in select mode
  selectMode: false,
};


// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const $ = id => document.getElementById(id);

const els = {
  tabList:          $('tab-list'),
  emptyState:       $('empty-state'),
  tabSummary:       $('tab-summary'),

  defaultToolbar:   $('default-toolbar'),
  selectToolbar:    $('select-toolbar'),
  selectCount:      $('select-count'),

  btnSleepAll:      $('btn-sleep-all'),
  btnWakeAll:       $('btn-wake-all'),
  btnSelectAll:     $('btn-select-all'),
  btnSelectNone:    $('btn-select-none'),
  btnSleepSelected: $('btn-sleep-selected'),

  btnUpgrade:          $('btn-upgrade'),
  btnUpgradeFooter:    $('btn-upgrade-footer'),
  btnHelp:             $('btn-help'),
  btnSettings:         $('btn-settings'),

  footerSleepingCount: $('footer-sleeping-count'),

  settingsPanel:    $('settings-panel'),
  btnCloseSettings: $('btn-close-settings'),
  btnSaveSettings:  $('btn-save-settings'),

  toggleAuto:       $('toggle-auto'),
  inputDelay:       $('input-delay'),
  rowDelay:         $('row-delay'),
  togglePinned:     $('toggle-pinned'),
  toggleAudible:    $('toggle-audible'),
  toggleCapturing:  $('toggle-capturing'),
  toggleSync:       $('toggle-sync'),
  rowSync:          $('row-sync'),
  toggleSchedule:   $('toggle-schedule'),
  rowSchedule:      $('row-schedule'),
  scheduleHint:     $('schedule-hint'),
  btnOpenShortcuts: $('btn-open-shortcuts'),

  whitelistWrap:    $('whitelist-wrap'),
  whitelistTags:    $('whitelist-tags'),
  whitelistInput:   $('whitelist-input'),
  btnAddDomain:     $('btn-add-domain'),
};

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function init() {
  const res = await msg('GET_TABS');
  if (!res.ok) return;

  state.tabs     = res.tabs;
  state.registry = res.registry;
  state.isPro    = res.isPro;

  const settingsRes = await msg('GET_SETTINGS');
  if (settingsRes.ok) state.settings = settingsRes.settings;

  renderAll();
  bindEvents();
  await maybeShowWelcome();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderAll() {
  renderHeader();
  renderTabList();
  renderFooter();
}

function renderHeader() {
  const badge = els.btnUpgrade;
  if (state.isPro) {
    badge.textContent = 'Pro ✓';
    badge.setAttribute('aria-label', 'Slumber Pro active');
    badge.classList.remove('badge-free');
    badge.classList.add('badge-pro');
  } else {
    badge.textContent = 'Free';
    badge.setAttribute('aria-label', 'Upgrade to Pro');
  }
}

function renderTabList() {
  // Clear existing rows (but keep empty-state node)
  const rows = els.tabList.querySelectorAll('.section-label, .tab-row');
  rows.forEach(r => r.remove());

  const active   = state.tabs.filter(t => !isSleeping(t));
  const sleeping = state.tabs.filter(t => isSleeping(t));

  if (active.length === 0 && sleeping.length === 0) {
    els.emptyState.hidden = false;
    return;
  }
  els.emptyState.hidden = true;

  // Toolbar summary
  els.tabSummary.textContent =
    `${active.length} active · ${sleeping.length} sleeping`;

  // Active tabs
  if (active.length) {
    els.tabList.insertBefore(sectionLabel('Active'), els.emptyState);
    active.forEach(tab => els.tabList.insertBefore(buildTabRow(tab, false), els.emptyState));
  }

  // Sleeping tabs
  if (sleeping.length) {
    els.tabList.insertBefore(sectionLabel('Sleeping'), els.emptyState);
    sleeping.forEach(tab => els.tabList.insertBefore(buildTabRow(tab, true), els.emptyState));
  }
}

function renderFooter() {
  const sleepingCount = Object.keys(state.registry).length;
  els.footerSleepingCount.textContent = `${sleepingCount} sleeping`;
  els.btnUpgradeFooter.hidden = state.isPro;
}

function renderSelectToolbar() {
  const n = state.selected.size;
  els.selectCount.textContent         = `${n} selected`;
  els.btnSleepSelected.disabled       = n === 0;
}

// ---------------------------------------------------------------------------
// Tab row builder
// ---------------------------------------------------------------------------

function buildTabRow(tab, sleeping) {
  const row = document.createElement('div');
  row.className = 'tab-row' + (sleeping ? ' is-sleeping' : '');
  row.dataset.tabId = tab.id;
  row.setAttribute('role', 'listitem');

  if (state.selected.has(tab.id)) row.classList.add('is-selected');

  // Checkbox (visible in select mode)
  const checkbox = document.createElement('div');
  checkbox.className = 'tab-checkbox';
  if (state.selected.has(tab.id)) checkbox.classList.add('checked');

  // Favicon
  let faviconEl;
  const extensionOrigin = chrome.runtime.getURL('').replace(/\/$/, '');

  // While a just-woken tab is still navigating away from the suspended page,
  // Chrome reports the extension icon as favIconUrl and the 💤 title. Parse
  // the original metadata directly from the suspended page URL hash instead.
  const transitioning  = !sleeping && !!tab.favIconUrl?.startsWith(extensionOrigin);
  const suspendedMeta  = transitioning ? parseSuspendedPageMeta(tab.url) : null;

  const faviconUrl = sleeping
    ? chrome.runtime.getURL('icons/icon-16.png')
    : (transitioning ? (suspendedMeta.favicon || '') : (tab.favIconUrl || ''));

  if (faviconUrl) {
    faviconEl = document.createElement('img');
    faviconEl.className = 'tab-favicon';
    faviconEl.src       = faviconUrl;
    faviconEl.alt       = '';
    faviconEl.width     = 14;
    faviconEl.height    = 14;
    faviconEl.onerror   = () => faviconEl.replaceWith(fallbackFavicon());
  } else {
    faviconEl = fallbackFavicon();
  }

  // Meta
  const meta = document.createElement('div');
  meta.className = 'tab-meta';

  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = sleeping
    ? (state.registry[tab.id]?.title || tab.title || 'Sleeping tab')
    : (transitioning ? (suspendedMeta.title || tab.title || tab.url) : (tab.title || tab.url));

  const domain = document.createElement('div');
  domain.className = 'tab-domain';
  domain.textContent = extractDomain(sleeping
    ? (state.registry[tab.id]?.url || '')
    : (transitioning ? suspendedMeta.url : (tab.url || '')));

  meta.append(title, domain);

  // Per-row action button
  const actionBtn = document.createElement('button');
  actionBtn.className = 'tab-row-action' + (sleeping ? ' wake' : '');
  actionBtn.textContent = sleeping ? 'Wake' : 'Sleep';
  actionBtn.addEventListener('click', e => {
    e.stopPropagation();
    sleeping ? wakeTab(tab.id) : sleepTab(tab.id);
  });

  row.append(checkbox, faviconEl, meta, actionBtn);

  // Row click: toggle selection (if Pro + select mode) or no-op for sleeping
  row.addEventListener('click', () => {
    if (sleeping) return;
    if (!state.isPro) return;
    toggleSelect(tab.id, row, checkbox);
  });

  return row;
}

function fallbackFavicon() {
  const el = document.createElement('div');
  el.className = 'tab-favicon-fallback';
  return el;
}

function sectionLabel(text) {
  const el = document.createElement('div');
  el.className   = 'section-label';
  el.textContent = text;
  return el;
}

// ---------------------------------------------------------------------------
// Select mode
// ---------------------------------------------------------------------------

function enterSelectMode() {
  state.selectMode = true;
  document.body.classList.add('select-mode');
  els.defaultToolbar.hidden = true;
  els.selectToolbar.hidden  = false;
  renderSelectToolbar();
}

function exitSelectMode() {
  state.selectMode = false;
  state.selected.clear();
  document.body.classList.remove('select-mode');
  els.defaultToolbar.hidden = false;
  els.selectToolbar.hidden  = true;
  // Remove selection styling
  els.tabList.querySelectorAll('.tab-row').forEach(r => {
    r.classList.remove('is-selected');
    r.querySelector('.tab-checkbox')?.classList.remove('checked');
  });
}

function toggleSelect(tabId, row, checkbox) {
  if (state.selected.has(tabId)) {
    state.selected.delete(tabId);
    row.classList.remove('is-selected');
    checkbox.classList.remove('checked');
  } else {
    state.selected.add(tabId);
    row.classList.add('is-selected');
    checkbox.classList.add('checked');
  }

  if (!state.selectMode && state.selected.size > 0) enterSelectMode();
  if (state.selectMode && state.selected.size === 0) exitSelectMode();
  else renderSelectToolbar();
}

// ---------------------------------------------------------------------------
// Sleep / wake actions
// ---------------------------------------------------------------------------

async function sleepTab(tabId) {
  await msg('SUSPEND_TAB', { tabId });
  await refresh();
}

async function wakeTab(tabId) {
  await msg('UNSUSPEND_TAB', { tabId });
  await refresh();
}

async function sleepAll() {
  const active = state.tabs.filter(t => !isSleeping(t));
  for (const tab of active) {
    await msg('SUSPEND_TAB', { tabId: tab.id });
  }
  await refresh();
}

async function wakeAll() {
  const sleeping = state.tabs.filter(t => isSleeping(t));
  for (const tab of sleeping) {
    await msg('UNSUSPEND_TAB', { tabId: tab.id });
  }
  await refresh();
}

async function sleepSelected() {
  const tabIds = [...state.selected];
  const res = await msg('SUSPEND_TABS', { tabIds });
  if (res.error === 'PRO_REQUIRED') { openPaymentPage(); return; }
  exitSelectMode();
  await refresh();
}

async function refresh() {
  const res = await msg('GET_TABS');
  if (!res.ok) return;
  state.tabs     = res.tabs;
  state.registry = res.registry;
  state.isPro    = res.isPro;
  renderAll();
}

// ---------------------------------------------------------------------------
// Pro upgrade — opens the License tab in options
// ---------------------------------------------------------------------------

function openPaymentPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#license') });
  window.close();
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

function openSettings() {
  const s = state.settings;
  els.toggleAuto.checked       = s.autoSuspend      ?? true;
  els.inputDelay.value         = s.autoSuspendDelay ?? 30;
  els.togglePinned.checked     = s.suspendPinned    ?? false;
  els.toggleAudible.checked    = s.suspendAudible   ?? false;
  els.toggleCapturing.checked  = s.suspendCapturing ?? false;
  els.toggleSync.checked       = s.syncSettings     ?? false;
  els.toggleSchedule.checked   = s.schedule?.enabled ?? false;
  els.scheduleHint.textContent = scheduleWindowText(s.schedule);

  els.rowDelay.hidden = !els.toggleAuto.checked;

  renderWhitelistTags(s.whitelist ?? []);

  // Lock Pro-only rows for free users
  const proRows = [els.whitelistWrap, els.rowSync, els.rowSchedule];
  proRows.forEach(el => {
    el.classList.toggle('pro-locked', !state.isPro);
  });

  els.settingsPanel.hidden = false;
}

function closeSettings() {
  els.settingsPanel.hidden = true;
}

async function saveSettings() {
  const whitelist = [...els.whitelistTags.querySelectorAll('.whitelist-tag')]
    .map(tag => tag.dataset.domain)
    .filter(Boolean);

  const settings = {
    ...state.settings,
    autoSuspend:      els.toggleAuto.checked,
    autoSuspendDelay: Math.max(1, parseInt(els.inputDelay.value, 10) || 30),
    suspendPinned:    els.togglePinned.checked,
    suspendAudible:   els.toggleAudible.checked,
    suspendCapturing: els.toggleCapturing.checked,
    whitelist,
    syncSettings:     els.toggleSync.checked,
    schedule: { ...(state.settings.schedule ?? {}), enabled: els.toggleSchedule.checked },
  };

  const res = await msg('SAVE_SETTINGS', { settings });
  if (res.ok) {
    state.settings = settings;
    closeSettings();
  }
}

function renderWhitelistTags(domains) {
  els.whitelistTags.innerHTML = '';
  domains.forEach(domain => addWhitelistTag(domain));
}

function addWhitelistTag(domain) {
  if (!domain) return;
  const tag = document.createElement('div');
  tag.className     = 'whitelist-tag';
  tag.dataset.domain = domain;
  tag.innerHTML = `
    <span>${domain}</span>
    <button aria-label="Remove ${domain}">✕</button>
  `;
  tag.querySelector('button').addEventListener('click', () => tag.remove());
  els.whitelistTags.appendChild(tag);
}

// ---------------------------------------------------------------------------
// Welcome banner
// ---------------------------------------------------------------------------

async function maybeShowWelcome() {
  const { slumber_welcomed } = await chrome.storage.local.get('slumber_welcomed');
  if (slumber_welcomed) return;

  const banner  = $('welcome-banner');
  const dismiss = $('welcome-dismiss');
  if (!banner) return;

  banner.hidden = false;

  dismiss.addEventListener('click', async () => {
    banner.hidden = true;
    await chrome.storage.local.set({ slumber_welcomed: true });
  });
}

// ---------------------------------------------------------------------------
// Event binding
// ---------------------------------------------------------------------------

function bindEvents() {
  // Header / footer upgrade buttons → opens options license tab
  els.btnUpgrade.addEventListener('click', () => { if (!state.isPro) openPaymentPage(); });
  els.btnUpgradeFooter.addEventListener('click', openPaymentPage);

  els.btnHelp.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#general') });
    window.close();
  });
  els.btnSettings.addEventListener('click', openSettings);

  // Default toolbar
  els.btnSleepAll.addEventListener('click', sleepAll);
  els.btnWakeAll.addEventListener('click', wakeAll);

  // Select toolbar
  els.btnSelectAll.addEventListener('click', () => {
    const active = state.tabs.filter(t => !isSleeping(t));
    active.forEach(tab => state.selected.add(tab.id));
    renderTabList();
    enterSelectMode();
  });
  els.btnSelectNone.addEventListener('click', exitSelectMode);
  els.btnSleepSelected.addEventListener('click', sleepSelected);

  els.btnOpenShortcuts.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#shortcuts') });
    window.close();
  });

  // Settings
  els.btnCloseSettings.addEventListener('click', closeSettings);
  els.btnSaveSettings.addEventListener('click', saveSettings);
  els.toggleAuto.addEventListener('change', () => {
    els.rowDelay.hidden = !els.toggleAuto.checked;
  });
  els.btnAddDomain.addEventListener('click', () => {
    const domain = normalizeDomain(els.whitelistInput.value);
    if (domain) {
      addWhitelistTag(domain);
      els.whitelistInput.value = '';
    }
  });
  els.whitelistInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') els.btnAddDomain.click();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSleeping(tab) {
  return !!state.registry[tab.id];
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

function parseSuspendedPageMeta(url) {
  try {
    const params = new URLSearchParams(new URL(url).hash.slice(1));
    return {
      url:     params.get('url')     || '',
      title:   params.get('title')   || '',
      favicon: params.get('favicon') || '',
    };
  } catch {
    return { url: '', title: '', favicon: '' };
  }
}

function scheduleWindowText(schedule) {
  if (!schedule?.enabled) return 'Only suspend during set hours';
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = (schedule.days ?? []).map(d => DAY[d]).join(', ') || 'No days';
  return `${days} · ${schedule.startTime ?? '09:00'}–${schedule.endTime ?? '18:00'}`;
}

function normalizeDomain(raw) {
  const trimmed = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return trimmed || null;
}

function msg(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, payload });
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

init();
