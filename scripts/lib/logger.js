/**
 * Shared logger for Discord bot scripts.
 * Standardized prefixes and optional timestamps for readable GitHub Actions output.
 */

function createLogger(opts = {}) {
  const timestamps = opts.timestamps !== false;
  const prefix = timestamps ? () => new Date().toISOString() + ' ' : () => '';

  return {
    run(...args) {
      console.log(prefix() + '[run]', ...args);
    },
    missionBank(...args) {
      console.log(prefix() + '[mission-bank]', ...args);
    },
    channel(...args) {
      console.log(prefix() + '[channel]', ...args);
    },
    send(...args) {
      console.log(prefix() + '[send]', ...args);
    },
    skip(...args) {
      console.log(prefix() + '[skip]', ...args);
    },
    warn(...args) {
      console.warn(prefix() + '[warn]', ...args);
    },
    fatal(err) {
      console.error(prefix() + '[FATAL]', err?.message ?? err);
      if (err?.stack) console.error(err.stack);
      process.exit(1);
    },
  };
}

const defaultLogger = createLogger({ timestamps: true });

module.exports = {
  createLogger,
  defaultLogger,
};
