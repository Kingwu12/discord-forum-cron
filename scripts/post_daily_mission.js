// Run: node scripts/post_daily_mission.js [--force]
// Env: DISCORD_BOT_TOKEN, MISSIONS_CHANNEL_ID
// Node 20+ (global fetch)

const fs = require('fs').promises;
const path = require('path');

const TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const CHANNEL_ID = process.env.MISSIONS_CHANNEL_ID || '';
const FORCE = process.argv.includes('--force');
const BRAND_ORANGE = 0xff7a00;
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

if (!TOKEN || !CHANNEL_ID) {
  console.error('Missing env: DISCORD_BOT_TOKEN and/or MISSIONS_CHANNEL_ID');
  process.exit(1);
}

function logFatal(err) {
  console.error('[FATAL]', new Date().toISOString());
  console.error(err?.message ?? err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// Date helpers (Melbourne-local day)
// ─────────────────────────────────────────────────────────────
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

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

// ─────────────────────────────────────────────────────────────
// Mission bank (supports groups + legacy daily)
// ─────────────────────────────────────────────────────────────
async function getRandomDailyMission() {
  const bankPath = path.join(process.cwd(), 'missions', 'bank.json');
  let data;
  try {
    const raw = await fs.readFile(bankPath, 'utf8');
    data = JSON.parse(raw);
    console.log('[mission-bank] load success');
  } catch (err) {
    throw new Error(`Failed to load mission bank from ${bankPath}: ${err?.message ?? err}`);
  }

  // New grouped format (preferred)
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
    console.log('[mission-bank] selected group', groupKey);
    console.log('[mission-bank] selected mission index', missionIndex);
    return { missionText, groupKey, groupLabel };
  }

  // Legacy format: { daily: [...] }
  if (data.daily && Array.isArray(data.daily) && data.daily.length) {
    const missionIndex = Math.floor(Math.random() * data.daily.length);
    const missionText = typeof data.daily[missionIndex] === 'string'
      ? data.daily[missionIndex]
      : String(data.daily[missionIndex]);
    console.log('[mission-bank] selected mission index', missionIndex);
    return { missionText, groupKey: null, groupLabel: null };
  }

  throw new Error('Mission bank has neither "groups" nor a non-empty "daily" array.');
}

// ─────────────────────────────────────────────────────────────
// Discord helpers
// ─────────────────────────────────────────────────────────────
async function fetchChannel() {
  const res = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}`, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`Channel fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function listRecentMessages(limit = 25) {
  const res = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=${limit}`, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`List messages failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function createMessage(payload) {
  const res = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`Create message failed: ${res.status} ${txt}`);
  return JSON.parse(txt);
}

async function addReaction(messageId, emoji) {
  await fetch(
    `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages/${messageId}/reactions/${encodeURIComponent(
      emoji
    )}/@me`,
    { method: 'PUT', headers: { Authorization: `Bot ${TOKEN}` } }
  );
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log('[run] date/time', new Date().toISOString());
    console.log('[run] cwd', process.cwd());

    const { key, label } = getMelbourneDateInfo();

    const channel = await fetchChannel();
    console.log('[channel] target channel fetch success');

    if (!FORCE) {
      const recent = await listRecentMessages(30);
      const dup = recent.find(
        (m) =>
          m.author?.bot &&
          m.embeds?.length &&
          (m.embeds[0].title?.includes(label) || m.embeds[0].footer?.text?.includes(key))
      );
      if (dup) {
        console.log('[skip] mission already posted today');
        return;
      }
    }

    const mission = await getRandomDailyMission();
    const embed = {
      title: `🎯 Daily Mission — ${label}`,
      description: mission.missionText,
      color: BRAND_ORANGE,
      footer: { text: `Richard • Kingdom HQ • ${key}` },
      timestamp: new Date().toISOString(),
    };

    const payload = { embeds: [embed], allowed_mentions: { parse: [] } };
    const msg = await createMessage(payload);
    await addReaction(msg.id, '✅');

    console.log('[send] success — message id', msg.id);
  } catch (e) {
    logFatal(e);
  }
})();
