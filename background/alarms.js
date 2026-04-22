/**
 * alarms.js — chrome.alarms helpers
 *
 * Extracted into its own module so both worker.js and suspender.js
 * can import alarm utilities without creating a circular dependency.
 */

export const ALARM_PREFIX = 'slumber-tab-';
export const SWEEP_ALARM  = 'slumber-sweep';

/**
 * Schedule (or reset) the auto-suspend alarm for a tab.
 * @param {number} tabId
 * @param {number} delayInMinutes
 */
export async function scheduleTabAlarm(tabId, delayInMinutes) {
  const alarmName = `${ALARM_PREFIX}${tabId}`;
  await chrome.alarms.clear(alarmName);
  await chrome.alarms.create(alarmName, { delayInMinutes });
}

/**
 * Clear the auto-suspend alarm for a tab.
 * @param {number} tabId
 */
export async function clearTabAlarm(tabId) {
  await chrome.alarms.clear(`${ALARM_PREFIX}${tabId}`);
}

/**
 * Remove alarms for tabs that no longer exist.
 */
export async function sweepOrphanedAlarms() {
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
