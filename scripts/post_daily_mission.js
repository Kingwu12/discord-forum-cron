// Run: node scripts/post_daily_mission.js [--force]
// Env: DISCORD_BOT_TOKEN, MISSIONS_CHANNEL_ID
// Node 20+ (global fetch)

const fs = require('fs').promises;

const TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const CHANNEL_ID = process.env.MISSIONS_CHANNEL_ID || '';
const FORCE = process.argv.includes('--force');
const BRAND_ORANGE = 0xff7a00;

if (!TOKEN || !CHANNEL_ID) {
  console.error('Missing env: DISCORD_BOT_TOKEN and/or MISSIONS_CHANNEL_ID');
  process.exit(1);
}

function todayKeyUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10); // YYYY-MM-DD
}
function prettyDateAU(d = new Date()) {
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function getRandomDailyMission() {
  // Put your bank here or read from /missions/bank.json if you prefer
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

async function listRecentMessages(limit = 25) {
  const res = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages?limit=${limit}`, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`List messages failed: ${res.status} ${await res.text()}`);
  return res.json();
}
async function createMessage(payload) {
  const res = await fetch(`https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
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

(async () => {
  try {
    const key = todayKeyUTC();
    const label = prettyDateAU(new Date());

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
