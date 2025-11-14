// Run: node scripts/post_daily_mission.js [--force]
// Env: DISCORD_BOT_TOKEN, MISSIONS_CHANNEL_ID
// Node 20+ (global fetch)

const fs = require('fs').promises;

const TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const CHANNEL_ID = process.env.MISSIONS_CHANNEL_ID || '';
const FORCE = process.argv.includes('--force');
const BRAND_ORANGE = 0xff7a00;
const TIME_ZONE = 'Australia/Melbourne';

if (!TOKEN || !CHANNEL_ID) {
  console.error('Missing env: DISCORD_BOT_TOKEN and/or MISSIONS_CHANNEL_ID');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// Date helpers (Melbourne-local day)
// ─────────────────────────────────────────────────────────────
function getMelbourneDateInfo() {
  const now = new Date();

  // Get YYYY-MM-DD for Melbourne calendar day
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

  const key = `${y}-${m}-${d}`; // YYYY-MM-DD

  // Build a pretty AU date label using the same Melbourne day
  const labelDate = new Date(Number(y), Number(m) - 1, Number(d));
  const label = labelDate.toLocaleDateString('en-AU', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return { key, label };
}

// ─────────────────────────────────────────────────────────────
// Mission bank
// ─────────────────────────────────────────────────────────────
async function getRandomDailyMission() {
  let bank;
  try {
    const raw = await fs.readFile('./missions/bank.json', 'utf8');
    bank = JSON.parse(raw).daily || [];
  } catch {
    bank = [
      'What’s your ONE focus today? React ✅ when done.',
      'Do a 5-minute task you’ve been avoiding. React ✅ when complete.',
      'List your top 3 priorities for today. Mark ✅ after finishing #1.',
      'Eliminate ONE distraction for the next hour. React ✅ to commit.',
      'Do a 2-minute workspace reset right now. React ✅ when done.',
    ];
  }
  if (!bank.length) throw new Error('No daily missions available.');
  return bank[Math.floor(Math.random() * bank.length)];
}

// ─────────────────────────────────────────────────────────────
// Discord helpers
// ─────────────────────────────────────────────────────────────
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
    const { key, label } = getMelbourneDateInfo();
    console.log(`Melbourne day key = ${key}, label = ${label}`);

    if (!FORCE) {
      const recent = await listRecentMessages(30);
      const dup = recent.find(
        (m) =>
          m.author?.bot &&
          m.embeds?.length &&
          (m.embeds[0].title?.includes(label) || m.embeds[0].footer?.text?.includes(key))
      );
      if (dup) {
        console.log(`Mission for ${key} already exists → ${dup.id}. Use --force to post anyway.`);
        return;
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

    const payload = { embeds: [embed], allowed_mentions: { parse: [] } };
    const msg = await createMessage(payload);
    await addReaction(msg.id, '✅');

    console.log(`Posted daily mission ${key}: message ${msg.id}`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
