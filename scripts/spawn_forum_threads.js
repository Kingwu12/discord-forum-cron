// Run: node scripts/spawn_forum_threads.js <daily|weekly|monthly|all> [--embed-only|--no-embed-only]
// Node 20+ (global fetch)

// ─────────────────────────────────────────────────────────────────────────────
// Env config
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const kindArg = (args[0] || 'daily').toLowerCase();

// default: embed-only = true
// override with --no-embed-only if you also want plain text content
const EMBED_ONLY = args.includes('--embed-only') || !args.includes('--no-embed-only');

const kinds = kindArg === 'all' ? ['daily', 'weekly', 'monthly'] : [kindArg];

const forumByKind = {
  daily: FORUM_DAILY_ID,
  weekly: FORUM_REFLECT_ID,
  monthly: FORUM_REFLECT_ID,
};

// ─────────────────────────────────────────────────────────────────────────────
// Time helpers (Melbourne-local)
// ─────────────────────────────────────────────────────────────────────────────
const TIME_ZONE = 'Australia/Melbourne';
const BRAND_ORANGE = 0xff7a00;

function getMelbourneDate() {
  // Convert "now" into a date object representing local Melbourne date (midnight there)
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
  return new Date(y, m - 1, d); // local JS Date at Melbourne's calendar day
}

function isoWeekLocal(date) {
  // ISO week calculation based on Melbourne calendar day
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  let dayNum = d.getDay();
  if (dayNum === 0) dayNum = 7; // Sunday -> 7

  d.setDate(d.getDate() + 4 - dayNum);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
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

// ─────────────────────────────────────────────────────────────────────────────
// Naming + embed content
// ─────────────────────────────────────────────────────────────────────────────
const melDate = getMelbourneDate();
const fmtDay = formatDayMelbourne(melDate);
const fmtMonth = formatMonthMelbourne(melDate);
const week = isoWeekLocal(melDate);

const nameByKind = {
  daily: `Daily — ${fmtDay}`,
  weekly: `Week ${week} — ${melDate.getFullYear()}`,
  monthly: `Monthly — ${fmtMonth}`,
};

const titleByKind = {
  daily: '🎯 Daily Check-In',
  weekly: '🧭 Weekly Reflection',
  monthly: '🗓️ Monthly Review',
};

// Content strings (no markdown duplication in embed)
const promptByKind = {
  daily: 'What’s your **ONE focus** today?\nReply with ✅ when done.',
  weekly: '**Weekly reflection**\n1) What went well?\n2) What didn’t?\n3) Plan for next week?',
  monthly: '**Monthly review**\n• Top 3 wins\n• 1 bottleneck to fix\n• Theme for next month',
};

function buildEmbed(kind) {
  return [
    {
      title: titleByKind[kind],
      description: promptByKind[kind],
      color: BRAND_ORANGE,
      footer: { text: 'Richard • Kingdom HQ' },
      timestamp: new Date().toISOString(), // keeps ISO timestamp for Discord
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  try {
    // whoami (good sanity check)
    const meRes = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
    });
    if (!meRes.ok) throw new Error(`WHOAMI failed: ${await meRes.text()}`);
    const me = await meRes.json();
    console.log('BOT:', me.username, me.id);
    console.log('Kinds:', kinds.join(', '), '| EMBED_ONLY =', EMBED_ONLY);

    const results = {};

    for (const k of kinds) {
      const channel_id = forumByKind[k];
      if (!channel_id) {
        results[k] = { ok: false, error: `No forum for kind ${k}` };
        continue;
      }

      // read forum
      const chRes = await fetch(`https://discord.com/api/v10/channels/${channel_id}`, {
        headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
      });
      const channel = await chRes.json();
      if (!chRes.ok) {
        results[k] = { ok: false, error: `Cannot read channel: ${JSON.stringify(channel)}` };
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

      // idempotency: don’t create the same thread name
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

      // ---- create thread ----
      const body = {
        name,
        applied_tags: [],
        message: {
          embeds: buildEmbed(k),
          allowed_mentions: { parse: [] }, // prevent accidental pings
        },
      };

      if (!EMBED_ONLY) {
        body.message.content = promptByKind[k];
      }

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

      // small delay so we don't hammer Discord
      await new Promise((r) => setTimeout(r, 400));
    }

    console.log('RESULTS:', JSON.stringify(results, null, 2));

    // mark failure if any kind failed
    const anyError = Object.values(results).some((r) => r && r.ok === false);
    if (anyError) {
      console.error('One or more thread spawns failed.');
      process.exitCode = 1;
    }
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
