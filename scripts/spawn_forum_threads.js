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
// Deps
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs').promises;

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

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  return Math.floor(diff / 86400000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mission bank (daily, grouped)
// ─────────────────────────────────────────────────────────────────────────────

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

async function getRandomDailyMission(melbourneDate) {
  let data;
  try {
    const raw = await fs.readFile('./missions/bank.json', 'utf8');
    data = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read missions/bank.json, using fallback daily missions.', err);
    const fallback = [
      'What’s your ONE focus today? React with ✅ when done.',
      'Do a 5-minute task you’ve been avoiding. React with ✅ when complete.',
      'List your top 3 priorities for today. Mark ✅ after finishing #1.',
      'Eliminate ONE distraction for the next hour. React with ✅ to commit.',
      'Do a 2-minute workspace reset right now. React with ✅ when done.',
    ];
    const missionText = fallback[Math.floor(Math.random() * fallback.length)];
    return { missionText, groupKey: null, groupLabel: null };
  }

  // New grouped format: { groups: { alignment: [...], systems: [...], ... } }
  if (data.groups && typeof data.groups === 'object') {
    const groupKeys = Object.keys(data.groups).filter((k) => Array.isArray(data.groups[k]) && data.groups[k].length);
    if (!groupKeys.length) {
      throw new Error('No mission groups with content found in bank.json');
    }

    const d = melbourneDate || getMelbourneDate();
    const doy = dayOfYear(d);
    const groupKey = groupKeys[doy % groupKeys.length]; // rotate groups by day-of-year
    const missions = data.groups[groupKey] || [];
    if (!missions.length) {
      throw new Error(`Group "${groupKey}" has no missions`);
    }

    const missionText = missions[Math.floor(Math.random() * missions.length)];
    const groupLabel = GROUP_LABELS[groupKey] || groupKey;
    return { missionText, groupKey, groupLabel };
  }

  // Legacy format: { daily: [...] }
  const bank = data.daily || [];
  if (!bank.length) throw new Error('No daily missions available in bank.json');
  const missionText = bank[Math.floor(Math.random() * bank.length)];
  return { missionText, groupKey: null, groupLabel: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Naming + embed content
// ─────────────────────────────────────────────────────────────────────────────
const melDate = getMelbourneDate();
const fmtDay = formatDayMelbourne(melDate);
const fmtMonth = formatMonthMelbourne(melDate);
const week = isoWeekLocal(melDate);

const nameByKind = {
  // Daily threads are now missions
  daily: `Mission — ${fmtDay}`,
  weekly: `Week ${week} — ${melDate.getFullYear()}`,
  monthly: `Monthly — ${fmtMonth}`,
};

const titleByKind = {
  // Include date in daily title for clarity
  daily: `🎯 Daily Mission — ${fmtDay}`,
  weekly: '🧭 Weekly Reflection',
  monthly: '🗓️ Monthly Review',
};

// Only weekly/monthly use static prompts now.
// Daily description is composed from mission + check-in instructions.
const promptByKind = {
  weekly: '**Weekly reflection**\n1) What went well?\n2) What didn’t?\n3) Plan for next week?',
  monthly: '**Monthly review**\n• Top 3 wins\n• 1 bottleneck to fix\n• Theme for next month',
};

function buildEmbed(kind, { missionText, groupLabel } = {}) {
  let description;
  let footerText = 'Richard • Kingdom HQ';

  if (kind === 'daily') {
    description =
      `**Today’s Mission**\n` +
      `${missionText}\n\n` +
      `**How to check in:**\n` +
      `🌅 Morning — Comment your **one focus** or how you’ll approach this mission.\n` +
      `🌙 Night — Reply with your progress or proof (photo, numbers, or reflection).`;

    if (groupLabel) {
      description += `\n\n*Theme: \`${groupLabel}\`*`;
      footerText = `Richard • Kingdom HQ • ${groupLabel}`;
    }
  } else {
    description = promptByKind[kind];
  }

  return [
    {
      title: titleByKind[kind],
      description,
      color: BRAND_ORANGE,
      footer: { text: footerText },
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

      // For daily, pick a random mission from grouped bank
      let missionText = null;
      let groupLabel = null;

      if (k === 'daily') {
        try {
          const mission = await getRandomDailyMission(melDate);
          missionText = mission.missionText;
          groupLabel = mission.groupLabel;
          console.log(`[daily] selected mission (group=${mission.groupKey || 'none'}): ${missionText}`);
        } catch (err) {
          console.error('Failed to load daily mission bank, using fallback.', err);
          missionText = 'What’s your ONE focus today? React with ✅ when done.';
        }
      }

      // ---- create thread ----
      const body = {
        name,
        applied_tags: [],
        message: {
          embeds: buildEmbed(k, { missionText, groupLabel }),
          allowed_mentions: { parse: [] }, // prevent accidental pings
        },
      };

      if (!EMBED_ONLY) {
        if (k === 'daily') {
          body.message.content =
            `Today’s Mission:\n${missionText}\n\n` +
            `Morning: share your focus.\n` +
            `Night: share your proof / reflection.`;
        } else {
          body.message.content = promptByKind[k];
        }
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
