// Run: node scripts/post_daily_mission.js [--force]
// Requires: Node 20+ (global fetch)
// Env: DISCORD_BOT_TOKEN, MISSIONS_CHANNEL_ID (text channel)

import fs from 'fs/promises';

const TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const CHANNEL_ID = process.env.MISSIONS_CHANNEL_ID || '';
if (!TOKEN || !CHANNEL_ID) {
  console.error('Missing env: DISCORD_BOT_TOKEN and/or MISSIONS_CHANNEL_ID');
  process.exit(1);
}

const FORCE = process.argv.includes('--force');
const BRAND_ORANGE = 0xff7a00;

// --- helpers ---
function todayKey() {
  const now = new Date();
  // e.g., 2025-11-09 (UTC to be stable)
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
}

function prettyDateAU(d = new Date()) {
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function getRandomDailyMission() {
  const raw = await fs.readFile('./missions/bank.json', 'utf8');
  const bank = JSON.parse(raw);
  const list = bank.daily || [];
  if (!list.length) throw new Error('No daily missions found in missions/bank.json');
  return list[Math.floor(Math.random() * list.length)];
}

async function listRecentMessages(limit = 20) {
  const res = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=${limit}`, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`List messages failed: ${res.status} ${await res.text()}`);
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
  // Emoji must be URL-encoded (✅ is fine as-is)
  await fetch(
    `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages/${messageId}/reactions/${encodeURIComponent(
      emoji
    )}/@me`,
    { method: 'PUT', headers: { Authorization: `Bot ${TOKEN}` } }
  );
}

(async () => {
  try {
    const key = todayKey(); // "YYYY-MM-DD"
    const label = prettyDateAU(new Date());

    // Idempotency: if a message for today already exists, bail unless --force
    if (!FORCE) {
      const recent = await listRecentMessages(25);
      const dup = recent.find(
        (m) =>
          m.author?.bot &&
          m.embeds?.length &&
          (m.embeds[0].title?.includes(key) || m.embeds[0].footer?.text?.includes(key))
      );
      if (dup) {
        console.log(`Mission for ${key} already exists → ${dup.id}. Use --force to post anyway.`);
        process.exit(0);
      }
    }

    const mission = await getRandomDailyMission();

    const embed = {
      title: `🎯 Daily Mission — ${label}`,
      description: mission,
      color: BRAND_ORANGE,
      footer: { text: `Richard • Kingdom HQ • ${key}` },
      timestamp: new Date().toISOString(),
    };

    const payload = {
      // EMBED-ONLY: no plain content to avoid duplicate-looking posts
      embeds: [embed],
      allowed_mentions: { parse: [] },
    };

    const msg = await createMessage(payload);
    // Add the completion reaction for users
    await addReaction(msg.id, '✅');

    console.log(`Posted daily mission ${key}: message ${msg.id}`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
