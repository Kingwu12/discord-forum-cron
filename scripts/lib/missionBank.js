/**
 * Shared mission bank logic: load missions/bank.json, select today's mission by Melbourne time.
 * Supports grouped format (groups) and legacy format (daily).
 */

const fs = require('fs').promises;
const path = require('path');

const TIME_ZONE = 'Australia/Melbourne';

const GROUP_LABELS = {
  alignment: 'Alignment',
  systems: 'Systems',
  momentum: 'Momentum',
  learning: 'Learning & Skill',
  community: 'Community',
  future: 'Future Builder',
  reflection: 'Reflection',
  energy_env: 'Energy & Environment',
};

function getMelbourneDate() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year').value);
  const m = Number(parts.find((p) => p.type === 'month').value);
  const d = Number(parts.find((p) => p.type === 'day').value);
  return new Date(y, m - 1, d);
}

function getMelbourneDateInfo() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  const key = `${y}-${m}-${d}`;
  const labelDate = new Date(Number(y), Number(m) - 1, Number(d));
  const label = labelDate.toLocaleDateString('en-AU', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return { key, label };
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function formatDayMelbourne(date) {
  return date.toLocaleDateString('en-AU', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatMonthMelbourne(date) {
  return date.toLocaleDateString('en-AU', {
    timeZone: TIME_ZONE,
    month: 'long',
    year: 'numeric',
  });
}

function isoWeekLocal(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  let dayNum = d.getDay();
  if (dayNum === 0) dayNum = 7;
  d.setDate(d.getDate() + 4 - dayNum);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/**
 * Select today's mission from already-parsed bank data.
 * @param {object} data - Parsed bank.json (groups or daily)
 * @param {object} [logger] - Optional logger for [mission-bank] logs
 * @returns {{ missionText: string, groupKey: string|null, groupLabel: string|null }}
 */
function selectTodaysMission(data, logger) {
  const log = logger || { missionBank: (...a) => console.log('[mission-bank]', ...a) };

  if (data.groups && typeof data.groups === 'object') {
    const groupKeys = Object.keys(data.groups).filter(
      (k) => Array.isArray(data.groups[k]) && data.groups[k].length
    );
    if (!groupKeys.length) {
      throw new Error('No mission groups with content found in bank.json');
    }
    const melbDate = getMelbourneDate();
    const doy = dayOfYear(melbDate);
    const groupKey = groupKeys[doy % groupKeys.length];
    const missions = data.groups[groupKey] || [];
    if (!missions.length) {
      throw new Error(`Group "${groupKey}" has no missions`);
    }
    const missionIndex = Math.floor(Math.random() * missions.length);
    const missionText = missions[missionIndex];
    const groupLabel = GROUP_LABELS[groupKey] || groupKey;
    log.missionBank('selected group', groupKey);
    log.missionBank('selected mission index', missionIndex);
    return { missionText, groupKey, groupLabel };
  }

  if (data.daily && Array.isArray(data.daily) && data.daily.length) {
    const missionIndex = Math.floor(Math.random() * data.daily.length);
    const missionText = typeof data.daily[missionIndex] === 'string'
      ? data.daily[missionIndex]
      : String(data.daily[missionIndex]);
    log.missionBank('selected mission index', missionIndex);
    return { missionText, groupKey: null, groupLabel: null };
  }

  throw new Error('Mission bank has neither "groups" nor a non-empty "daily" array.');
}

/**
 * Load and parse mission bank from disk.
 * @param {string} [bankPath] - Path to bank.json (default: process.cwd() + missions/bank.json)
 * @returns {Promise<object>} Parsed bank data
 */
async function loadMissionBank(bankPath) {
  const pathToUse = bankPath || path.join(process.cwd(), 'missions', 'bank.json');
  const raw = await fs.readFile(pathToUse, 'utf8');
  return JSON.parse(raw);
}

/**
 * Load bank and select today's mission (Melbourne time).
 * @param {{ bankPath?: string, logger?: object }} [opts]
 * @returns {Promise<{ missionText: string, groupKey: string|null, groupLabel: string|null }>}
 */
async function getTodaysMission(opts = {}) {
  const { bankPath, logger } = opts;
  const log = logger || { missionBank: (...a) => console.log('[mission-bank]', ...a) };

  const pathToUse = bankPath || path.join(process.cwd(), 'missions', 'bank.json');
  const data = await loadMissionBank(pathToUse);
  log.missionBank('load success');
  return selectTodaysMission(data, logger);
}

module.exports = {
  TIME_ZONE,
  GROUP_LABELS,
  getMelbourneDate,
  getMelbourneDateInfo,
  dayOfYear,
  formatDayMelbourne,
  formatMonthMelbourne,
  isoWeekLocal,
  loadMissionBank,
  selectTodaysMission,
  getTodaysMission,
};
