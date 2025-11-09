// Run: node scripts/spawn.js <daily|weekly|monthly|all>
// Node 20+ (global fetch)

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || 'REPLACE_WITH_YOUR_DISCORD_BOT_TOKEN';
const FORUM_DAILY_ID = process.env.FORUM_DAILY_ID || 'REPLACE_WITH_DAILY_FORUM_CHANNEL_ID';
const FORUM_REFLECT_ID = process.env.FORUM_REFLECT_ID || 'REPLACE_WITH_REFLECT_FORUM_CHANNEL_ID';

if (
  !DISCORD_BOT_TOKEN ||
  DISCORD_BOT_TOKEN.startsWith('REPLACE_WITH_') ||
  !FORUM_DAILY_ID ||
  FORUM_DAILY_ID.startsWith('REPLACE_WITH_') ||
  !FORUM_REFLECT_ID ||
  FORUM_REFLECT_ID.startsWith('REPLACE_WITH_')
) {
  console.error('Missing config. Set DISCORD_BOT_TOKEN, FORUM_DAILY_ID, FORUM_REFLECT_ID (env or inline).');
  process.exit(1);
}

const kindArg = (process.argv[2] || 'daily').toLowerCase();
const kinds = kindArg === 'all' ? ['daily', 'weekly', 'monthly'] : [kindArg];

const forumByKind = {
  daily: FORUM_DAILY_ID,
  weekly: FORUM_REFLECT_ID,
  monthly: FORUM_REFLECT_ID,
};

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
}

(async () => {
  try {
    // WHOAMI
    const meRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    if (!meRes.ok) throw new Error(`WHOAMI failed: ${await meRes.text()}`);
    const me = await meRes.json();
    console.log('BOT:', me.username, me.id);

    const now = new Date();
    const fmtDay = now.toLocaleDateString('en-AU', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const fmtMonth = now.toLocaleDateString('en-AU', {
      month: 'long',
      year: 'numeric',
    });
    const week = isoWeek(now);

    const nameByKind = {
      daily: `Daily — ${fmtDay}`,
      weekly: `Week ${week} — ${now.getFullYear()}`,
      monthly: `Monthly — ${fmtMonth}`,
    };
    const titleByKind = {
      daily: '🎯 Daily Check-In',
      weekly: '🧭 Weekly Reflection',
      monthly: '🗓️ Monthly Review',
    };
    const contentByKind = {
      daily: 'What’s your ONE focus today?\nPost it below and reply with ✅ when done.',
      weekly: 'Weekly reflection:\n1) What went well?\n2) What didn’t?\n3) Plan for next week?',
      monthly: 'Monthly review:\n• Top 3 wins\n• 1 bottleneck to fix\n• Your theme for next month',
    };

    const results = {};

    for (const k of kinds) {
      const channel_id = forumByKind[k];
      if (!channel_id) {
        results[k] = { ok: false, error: `No forum for kind ${k}` };
        continue;
      }

      // Read forum channel (guild + tags)
      const chRes = await fetch(`https://discord.com/api/v10/channels/${channel_id}`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
      });
      const channel = await chRes.json();
      if (!chRes.ok) {
        results[k] = {
          ok: false,
          error: `Cannot read channel: ${JSON.stringify(channel)}`,
        };
        continue;
      }
      if (channel.type !== 15) {
        results[k] = {
          ok: false,
          error: `Channel ${channel_id} is not a Forum (type=${channel.type})`,
        };
        continue;
      }

      const guild_id = channel.guild_id;
      console.log(`[${k}] forum: ${channel.name} (${channel_id}) guild=${guild_id}`);

      // Idempotency: list active guild threads and filter by parent_id + name
      const activeRes = await fetch(`https://discord.com/api/v10/guilds/${guild_id}/threads/active`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
      });
      const active = await activeRes.json();
      if (!activeRes.ok) {
        results[k] = {
          ok: false,
          error: `Cannot list active threads: ${JSON.stringify(active)}`,
        };
        continue;
      }

      const name = nameByKind[k];
      const dup = active?.threads?.find((t) => t.parent_id === channel_id && t.name === name);
      if (dup) {
        console.log(`[${k}] already exists -> ${dup.id}`);
        results[k] = {
          skipped: true,
          reason: 'duplicate_active',
          thread_id: dup.id,
          name,
        };
        continue;
      }

      // Create thread
      const content = contentByKind[k];
      const body = {
        name,
        applied_tags: [],
        message: {
          content,
          embeds: [{ title: titleByKind[k], description: content, color: 0xff7a00 }],
        },
      };

      const createRes = await fetch(`https://discord.com/api/v10/channels/${channel_id}/threads`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const txt = await createRes.text();
      if (!createRes.ok) {
        results[k] = {
          ok: false,
          error: `Create failed (${createRes.status}): ${txt}`,
        };
        continue;
      }
      const created = JSON.parse(txt);
      console.log(`[${k}] created -> ${created.id}`);
      results[k] = { ok: true, thread_id: created.id, name };
      await new Promise((r) => setTimeout(r, 400)); // gentle rate limit
    }

    console.log('RESULTS:', JSON.stringify(results, null, 2));
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
