// Run: node scripts/post_daily_mission.js [--force]
// Env: DISCORD_BOT_TOKEN, MISSIONS_CHANNEL_ID
// Node 20+ (global fetch)

const { defaultLogger: log } = require('./lib/logger');
const { getMelbourneDateInfo, getTodaysMission } = require('./lib/missionBank');
const { getChannel, getMessages, createMessage, addReaction } = require('./lib/discord');

const TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const CHANNEL_ID = process.env.MISSIONS_CHANNEL_ID || '';
const FORCE = process.argv.includes('--force');
const BRAND_ORANGE = 0xff7a00;

if (!TOKEN || !CHANNEL_ID) {
  console.error('[FATAL] Missing required env: DISCORD_BOT_TOKEN and/or MISSIONS_CHANNEL_ID');
  process.exit(1);
}

(async () => {
  try {
    log.run('date/time', new Date().toISOString());
    log.run('cwd', process.cwd());

    const { key, label } = getMelbourneDateInfo();

    const channel = await getChannel(TOKEN, CHANNEL_ID);
    log.channel('target channel fetch success', channel?.name ?? CHANNEL_ID);

    if (!FORCE) {
      const recent = await getMessages(TOKEN, CHANNEL_ID, 30);
      const dup = recent.find(
        (m) =>
          m.author?.bot &&
          m.embeds?.length &&
          (m.embeds[0].title?.includes(label) || m.embeds[0].footer?.text?.includes(key))
      );
      if (dup) {
        log.skip('mission already posted today');
        return;
      }
    }

    const mission = await getTodaysMission({ logger: log });
    const embed = {
      title: `🎯 Daily Mission — ${label}`,
      description: mission.missionText,
      color: BRAND_ORANGE,
      footer: { text: `Richard • Kingdom HQ • ${key}` },
      timestamp: new Date().toISOString(),
    };

    const payload = { embeds: [embed], allowed_mentions: { parse: [] } };
    const msg = await createMessage(TOKEN, CHANNEL_ID, payload);

    const reactionResult = await addReaction(TOKEN, CHANNEL_ID, msg.id, '✅');
    if (!reactionResult.ok) {
      log.warn('add reaction failed (non-fatal):', reactionResult.error);
    }

    log.send('success — message id', msg.id);
  } catch (e) {
    log.fatal(e);
  }
})();
