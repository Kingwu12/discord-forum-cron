// Run: node scripts/spawn_forum_threads.js <daily|weekly|monthly|all> [--embed-only|--no-embed-only]
// Env: DISCORD_BOT_TOKEN, FORUM_DAILY_ID, FORUM_REFLECT_ID
// Node 20+ (global fetch)

const { createLogger } = require('./lib/logger');
const {
  getMelbourneDate,
  formatDayMelbourne,
  formatMonthMelbourne,
  isoWeekLocal,
  getTodaysMission,
} = require('./lib/missionBank');
const { getChannel, getMe } = require('./lib/discord');

const log = createLogger({ timestamps: true });

// ─────────────────────────────────────────────────────────────────────────────
// Env config
// ─────────────────────────────────────────────────────────────────────────────
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const FORUM_DAILY_ID = process.env.FORUM_DAILY_ID || '';
const FORUM_REFLECT_ID = process.env.FORUM_REFLECT_ID || '';

const REPLACE_PREFIX = 'REPLACE_WITH_';
const missingEnv =
  !DISCORD_BOT_TOKEN ||
  DISCORD_BOT_TOKEN.startsWith(REPLACE_PREFIX) ||
  !FORUM_DAILY_ID ||
  FORUM_DAILY_ID.startsWith(REPLACE_PREFIX) ||
  !FORUM_REFLECT_ID ||
  FORUM_REFLECT_ID.startsWith(REPLACE_PREFIX);

if (missingEnv) {
  console.error('[FATAL] Missing required env: DISCORD_BOT_TOKEN, FORUM_DAILY_ID, FORUM_REFLECT_ID');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const kindArg = (args[0] || 'daily').toLowerCase();
const EMBED_ONLY = args.includes('--embed-only') || !args.includes('--no-embed-only');
const kinds = kindArg === 'all' ? ['daily', 'weekly', 'monthly'] : [kindArg];

const forumByKind = {
  daily: FORUM_DAILY_ID,
  weekly: FORUM_REFLECT_ID,
  monthly: FORUM_REFLECT_ID,
};

const BRAND_ORANGE = 0xff7a00;
const melDate = getMelbourneDate();
const fmtDay = formatDayMelbourne(melDate);
const fmtMonth = formatMonthMelbourne(melDate);
const week = isoWeekLocal(melDate);

const nameByKind = {
  daily: `Mission — ${fmtDay}`,
  weekly: `Week ${week} — ${melDate.getFullYear()}`,
  monthly: `Monthly — ${fmtMonth}`,
};

const titleByKind = {
  daily: `🎯 Daily Mission — ${fmtDay}`,
  weekly: '🧭 Weekly Reflection',
  monthly: '🗓️ Monthly Review',
};

const promptByKind = {
  weekly: "**Weekly reflection**\n1) What went well?\n2) What didn't?\n3) Plan for next week?",
  monthly: '**Monthly review**\n• Top 3 wins\n• 1 bottleneck to fix\n• Theme for next month',
};

function buildEmbed(kind, { missionText, groupLabel } = {}) {
  let description;
  let footerText = 'Richard • Kingdom HQ';

  if (kind === 'daily') {
    description =
      `**Today's Mission**\n` +
      `${missionText}\n\n` +
      `**How to check in:**\n` +
      `🌅 Morning — Comment your **one focus** or how you'll approach this mission.\n` +
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
      timestamp: new Date().toISOString(),
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const me = await getMe(DISCORD_BOT_TOKEN);
    log.run('BOT', me.username, me.id);
    log.run('kinds', kinds.join(', '), 'EMBED_ONLY', EMBED_ONLY);

    const results = {};

    for (const k of kinds) {
      const channel_id = forumByKind[k];
      if (!channel_id) {
        results[k] = { ok: false, error: `No forum for kind ${k}` };
        continue;
      }

      let channel;
      try {
        channel = await getChannel(DISCORD_BOT_TOKEN, channel_id);
      } catch (err) {
        results[k] = { ok: false, error: `Channel fetch failed: ${err.message}` };
        continue;
      }
      log.channel('target channel fetch success', channel?.name ?? channel_id);

      if (channel.type !== 15) {
        results[k] = {
          ok: false,
          error: `Channel ${channel_id} is not a Forum (type=${channel.type})`,
        };
        continue;
      }

      const guild_id = channel.guild_id;

      const activeRes = await fetch(
        `https://discord.com/api/v10/guilds/${guild_id}/threads/active`,
        { headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` } }
      );
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
        log.skip(k, 'thread already exists', dup.id);
        results[k] = { skipped: true, reason: 'duplicate_active', thread_id: dup.id, name };
        continue;
      }

      let missionText = null;
      let groupLabel = null;

      if (k === 'daily') {
        try {
          const mission = await getTodaysMission({ logger: log });
          missionText = mission.missionText;
          groupLabel = mission.groupLabel;
        } catch (err) {
          log.warn('mission bank failed, using fallback', err?.message);
          missionText = "What's your ONE focus today? React with ✅ when done.";
        }
      }

      const body = {
        name,
        applied_tags: [],
        message: {
          embeds: buildEmbed(k, { missionText, groupLabel }),
          allowed_mentions: { parse: [] },
        },
      };

      if (!EMBED_ONLY) {
        if (k === 'daily') {
          body.message.content =
            `Today's Mission:\n${missionText}\n\n` +
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
        results[k] = { ok: false, error: `Create failed (${createRes.status}): ${txt}` };
        continue;
      }
      const created = JSON.parse(txt);
      log.send(k, 'thread created', created.id);
      results[k] = { ok: true, thread_id: created.id, name };

      await new Promise((r) => setTimeout(r, 400));
    }

    console.log('RESULTS:', JSON.stringify(results, null, 2));

    const anyError = Object.values(results).some((r) => r && r.ok === false);
    if (anyError) {
      console.error('[FATAL] One or more thread spawns failed.');
      process.exit(1);
    }
  } catch (e) {
    log.fatal(e);
  }
})();
