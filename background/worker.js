/**
 * worker.js — Slumber service worker (classic, non-module)
 *
 * All background modules are inlined here. No external scripts are loaded.
 * Payment is handled by Paddle Billing; pro status is stored in
 * chrome.storage.sync so it follows the user's Chrome account.
 */

// ---------------------------------------------------------------------------
// ── alarms.js ───────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

const ALARM_PREFIX    = 'slumber-tab-';
const SWEEP_ALARM     = 'slumber-sweep';
const SCHEDULE_ALARM  = 'slumber-schedule-window';

async function scheduleTabAlarm(tabId, delayInMinutes) {
  const alarmName = `${ALARM_PREFIX}${tabId}`;
  await chrome.alarms.clear(alarmName);
  await chrome.alarms.create(alarmName, { delayInMinutes });
}

async function clearTabAlarm(tabId) {
  await chrome.alarms.clear(`${ALARM_PREFIX}${tabId}`);
}

async function sweepOrphanedAlarms() {
  const [alarms, tabs] = await Promise.all([
    chrome.alarms.getAll(),
    chrome.tabs.query({}),
  ]);
  const tabIds = new Set(tabs.map(t => t.id));
  await Promise.all(
    alarms
      .filter(a => a.name.startsWith(ALARM_PREFIX))
      .filter(a => !tabIds.has(parseInt(a.name.slice(ALARM_PREFIX.length), 10)))
      .map(a => chrome.alarms.clear(a.name))
  );
}

async function sweepOrphanedRegistry() {
  const [registry, tabs] = await Promise.all([
    getSuspendedRegistry(),
    chrome.tabs.query({}),
  ]);
  const tabIds = new Set(tabs.map(t => t.id));
  const orphaned = Object.keys(registry).filter(id => !tabIds.has(parseInt(id, 10)));
  if (orphaned.length === 0) return;
  orphaned.forEach(id => delete registry[id]);
  await chrome.storage.local.set({ suspended: registry });
}

// Returns true when auto-suspend is allowed at the current moment.
// Always returns true if no schedule is configured or it is disabled.
function isWithinSchedule(schedule) {
  if (!schedule?.enabled) return true;
  const now = new Date();
  if (!Array.isArray(schedule.days) || !schedule.days.includes(now.getDay())) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = (schedule.startTime ?? '09:00').split(':').map(Number);
  const [eh, em] = (schedule.endTime   ?? '18:00').split(':').map(Number);
  const start = sh * 60 + sm;
  const end   = eh * 60 + em;
  if (end <= start) return false;
  return nowMin >= start && nowMin < end;
}

// Sets (or clears) a one-shot alarm that fires at the next scheduled window
// start. When it fires we reschedule all tab alarms so suspension kicks in.
async function scheduleWindowAlarm(schedule) {
  await chrome.alarms.clear(SCHEDULE_ALARM);
  if (!schedule?.enabled || !Array.isArray(schedule.days) || !schedule.days.length) return;

  const [sh, sm] = (schedule.startTime ?? '09:00').split(':').map(Number);
  const now = new Date();
  for (let d = 0; d <= 7; d++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + d);
    candidate.setHours(sh, sm, 0, 0);
    if (candidate > now && schedule.days.includes(candidate.getDay())) {
      const delayMs = candidate.getTime() - now.getTime();
      await chrome.alarms.create(SCHEDULE_ALARM, { delayInMinutes: delayMs / 60_000 });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// ── storage.js ──────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings ?? defaultSettings();
}

async function getSuspendedRegistry() {
  const { suspended } = await chrome.storage.local.get('suspended');
  return suspended ?? {};
}

function defaultSettings() {
  return {
    autoSuspend:       true,
    autoSuspendDelay:  30,
    suspendPinned:     false,
    suspendAudible:    false,
    suspendCapturing:  false,
    whitelist:         [],
    syncSettings:      false,
    schedule: {
      enabled:   false,
      days:      [1, 2, 3, 4, 5],
      startTime: '09:00',
      endTime:   '18:00',
    },
  };
}

// ---------------------------------------------------------------------------
// ── pro.js ──────────────────────────────────────────────────────────────────
// Pro status is stored in chrome.storage.sync under 'slumber_license':
//   { licenseKey, valid, email, validatedAt }
// It syncs automatically across all Chrome instances signed in with the
// same Google account. The options page writes it after server validation.
// ---------------------------------------------------------------------------

const LICENSE_VALIDATE_ENDPOINT =
  'https://dkhandev-site-payment-worker.wolf001349.workers.dev/validate';

async function isPro() {
  const { slumber_license } = await chrome.storage.sync.get('slumber_license');
  return Boolean(slumber_license?.valid);
}

// Re-validates the stored license key on startup. If the server is
// unreachable the last stored valid state is preserved unchanged.
async function revalidateLicense() {
  const { slumber_license } = await chrome.storage.sync.get('slumber_license');
  if (!slumber_license?.licenseKey) return;

  let data;
  try {
    const res = await fetch(
      `${LICENSE_VALIDATE_ENDPOINT}?key=${encodeURIComponent(slumber_license.licenseKey)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return; // server error — keep last stored state
    data = await res.json();
  } catch {
    return; // network failure — keep last stored state
  }

  await chrome.storage.sync.set({
    slumber_license: {
      ...slumber_license,
      valid:       Boolean(data.valid),
      email:       data.email ?? slumber_license.email,
      validatedAt: Date.now(),
    },
  });
}


// ---------------------------------------------------------------------------
// ── suspender.js ────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

const SUSPENDED_PAGE = chrome.runtime.getURL('suspended/suspended.html');

async function suspendTab(tabId, opts = {}) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;

  if (isSlumberPage(tab.url)) return;
  if (opts.source === 'auto' && tab.active) return;
  if (await isExempt(tab)) return;

  const entry = {
    url:         tab.url,
    title:       tab.title || tab.url,
    favicon:     tab.favIconUrl || '',
    suspendedAt: Date.now(),
  };

  const registry = await getSuspendedRegistry();
  registry[tabId] = entry;

  const { slumber_stats: stats = {} } = await chrome.storage.local.get('slumber_stats');
  stats.totalSuspended = (stats.totalSuspended ?? 0) + 1;
  if (!stats.installDate) stats.installDate = Date.now();

  await chrome.storage.local.set({ suspended: registry, slumber_stats: stats });
  await chrome.tabs.update(tabId, { url: buildSuspendedUrl(entry) });
  await clearTabAlarm(tabId);
}

async function suspendTabs(tabIds, opts = {}) {
  for (const tabId of tabIds) {
    await suspendTab(tabId, opts);
  }
}

async function unsuspendTab(tabId) {
  const registry = await getSuspendedRegistry();
  const entry = registry[tabId];
  if (!entry) return;

  await chrome.tabs.update(tabId, { url: entry.url });
  delete registry[tabId];
  await chrome.storage.local.set({ suspended: registry });
}

function buildSuspendedUrl({ url, title, favicon }) {
  const hash = new URLSearchParams({ url, title, favicon }).toString();
  return `${SUSPENDED_PAGE}#${hash}`;
}

function isSlumberPage(url = '') {
  return url.startsWith(SUSPENDED_PAGE);
}

// tabId → Set<frameId> for frames that currently have an active media capture.
// Populated by SET_CAPTURE_STATE messages from content/media-relay.js.
const _capturingFrames = new Map();

function isTabCapturing(tabId) {
  const frames = _capturingFrames.get(tabId);
  return frames !== undefined && frames.size > 0;
}

async function isExempt(tab) {
  const settings = await getSettings();

  if (tab.pinned    && !settings.suspendPinned)    return true;
  if (tab.audible   && !settings.suspendAudible)   return true;
  if (isTabCapturing(tab.id) && !settings.suspendCapturing) return true;

  if (!tab.url
    || tab.url.startsWith('chrome://')
    || tab.url.startsWith('chrome-extension://')
    || tab.url.startsWith('about:')
    || tab.url.startsWith('file://')
  ) return true;

  if (settings.whitelist?.length && await isPro()) {
    const tabHost = extractHostname(tab.url);
    if (settings.whitelist.some(d => tabHost === d || tabHost.endsWith(`.${d}`))) {
      return true;
    }
  }

  return false;
}

function extractHostname(url) {
  try { return new URL(url).hostname; }
  catch { return ''; }
}

// ---------------------------------------------------------------------------
// Install / startup
// ---------------------------------------------------------------------------

const SWEEP_INTERVAL = 5;

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await chrome.storage.local.set({
      settings:     defaultSettings(),
      suspended:    {},
      slumber_stats: { totalSuspended: 0, installDate: Date.now() },
    });
    await chrome.tabs.create({
      url: chrome.runtime.getURL('options/options.html#general'),
    });
  }
  await bootstrapAlarms();
});

chrome.runtime.onStartup.addListener(async () => {
  await bootstrapAlarms();
  revalidateLicense(); // fire-and-forget; network failures keep last stored state
});

async function bootstrapAlarms() {
  await chrome.alarms.clear(SWEEP_ALARM);
  await chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: SWEEP_INTERVAL });
  if (await isPro()) {
    const settings = await getSettings();
    await scheduleWindowAlarm(settings.schedule);
  }
}

// ---------------------------------------------------------------------------
// Alarm handling
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SWEEP_ALARM) {
    await sweepOrphanedAlarms();
    await sweepOrphanedRegistry();
    return;
  }
  if (alarm.name === SCHEDULE_ALARM) {
    const [settings, pro] = await Promise.all([getSettings(), isPro()]);
    if (pro && settings.autoSuspend && isWithinSchedule(settings.schedule)) {
      const tabs = await chrome.tabs.query({});
      await Promise.all(tabs.map(t => scheduleTabAlarm(t.id, settings.autoSuspendDelay)));
    }
    if (pro) await scheduleWindowAlarm(settings.schedule);
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
  if (await isPro() && !isWithinSchedule(settings.schedule)) return;

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
  if (settings.autoSuspend) await scheduleTabAlarm(tabId, settings.autoSuspendDelay);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  if (changeInfo.url.startsWith(SUSPENDED_PAGE)) return;

  // Navigation invalidates any previously tracked capture state for this tab.
  _capturingFrames.delete(tabId);

  const registry = await getSuspendedRegistry();
  if (registry[tabId]) {
    delete registry[tabId];
    await chrome.storage.local.set({ suspended: registry });
  }

  const settings = await getSettings();
  if (settings.autoSuspend) await scheduleTabAlarm(tabId, settings.autoSuspendDelay);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  _capturingFrames.delete(tabId);
  await clearTabAlarm(tabId);
  const registry = await getSuspendedRegistry();
  if (registry[tabId]) {
    delete registry[tabId];
    await chrome.storage.local.set({ suspended: registry });
  }
});

// ---------------------------------------------------------------------------
// Keyboard shortcut commands
// ---------------------------------------------------------------------------

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'unsuspend-all-tabs') {
    const registry = await getSuspendedRegistry();
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const sleeping = tabs.filter(t => registry[t.id]);
    await Promise.all(sleeping.map(t => unsuspendTab(t.id)));
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (command === 'suspend-tab' && !isSlumberPage(tab.url)) {
    await suspendTab(tab.id, { source: 'manual' });
  } else if (command === 'unsuspend-tab' && isSlumberPage(tab.url)) {
    await unsuspendTab(tab.id);
  }
});

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(err => {
      console.error('[Slumber worker] message error:', err);
      sendResponse({ ok: false, error: err.message });
    });
  return true;
});

async function handleMessage({ type, payload }, sender = {}) {
  switch (type) {

    case 'SET_CAPTURE_STATE': {
      const tabId   = sender.tab?.id;
      const frameId = sender.frameId ?? 0;
      if (tabId == null) return { ok: true };

      if (!_capturingFrames.has(tabId)) _capturingFrames.set(tabId, new Set());
      const frames = _capturingFrames.get(tabId);
      if (payload.capturing) {
        frames.add(frameId);
      } else {
        frames.delete(frameId);
        if (frames.size === 0) _capturingFrames.delete(tabId);
      }
      return { ok: true };
    }

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
      if (await isPro()) await scheduleWindowAlarm(settings.schedule);
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

    default:
      return { ok: false, error: `Unknown message type: ${type}` };
  }
}
