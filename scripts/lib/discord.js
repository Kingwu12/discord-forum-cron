/**
 * Shared Discord API helpers. Node 20+ (global fetch).
 * All functions take token first; channel/message IDs as needed.
 */

const API_BASE = 'https://discord.com/api/v10';

function headers(token) {
  return {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Fetch a channel by ID.
 * @returns {Promise<object>} Channel object
 */
async function getChannel(token, channelId) {
  const res = await fetch(`${API_BASE}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Channel fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * List recent messages in a channel.
 * @returns {Promise<object[]>} Array of message objects
 */
async function getMessages(token, channelId, limit = 25) {
  const res = await fetch(
    `${API_BASE}/channels/${channelId}/messages?limit=${limit}`,
    { headers: { Authorization: `Bot ${token}` } }
  );
  if (!res.ok) {
    throw new Error(`List messages failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

/**
 * Create a message in a channel (text or embeds).
 * @param {object} payload - { content?, embeds?, allowed_mentions? }
 * @returns {Promise<object>} Created message object
 */
async function createMessage(token, channelId, payload) {
  const res = await fetch(`${API_BASE}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(payload),
  });
  const txt = await res.text();
  if (!res.ok) {
    throw new Error(`Create message failed: ${res.status} ${txt}`);
  }
  return JSON.parse(txt);
}

/**
 * Add a reaction to a message. Non-critical: returns { ok } so caller can warn instead of throw.
 * @returns {{ ok: boolean, error?: string }}
 */
async function addReaction(token, channelId, messageId, emoji) {
  const encoded = encodeURIComponent(emoji);
  const res = await fetch(
    `${API_BASE}/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`,
    { method: 'PUT', headers: { Authorization: `Bot ${token}` } }
  );
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `${res.status} ${text}` };
  }
  return { ok: true };
}

/**
 * Get current bot user (@me).
 * @returns {Promise<object>} User object
 */
async function getMe(token) {
  const res = await fetch(`${API_BASE}/users/@me`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) {
    throw new Error(`WHOAMI failed: ${await res.text()}`);
  }
  return res.json();
}

module.exports = {
  getChannel,
  getMessages,
  createMessage,
  addReaction,
  getMe,
};
