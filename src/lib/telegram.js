import { openAsBlob } from 'node:fs';

import { config } from '../config/config.js';

export class TelegramError extends Error {
  constructor(method, description, code) {
    super(`Telegram ${method} failed: ${description}`);
    this.code = code;
  }
}

async function request(method, init) {
  const response = await fetch(
    `https://api.telegram.org/bot${config.telegram.botToken}/${method}`,
    { method: 'POST', ...init }
  );

  // Oversized uploads can be rejected by a proxy with a non-JSON body
  const data = await response.json().catch(() => ({
    ok: false,
    description: `HTTP ${response.status}`,
    error_code: response.status
  }));

  if (!data.ok) {
    throw new TelegramError(method, data.description, data.error_code);
  }

  return data.result;
}

// Minimal Bot API client: https://core.telegram.org/bots/api
export const telegram = {
  call(method, params = {}) {
    return request(method, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
  },

  // multipart/form-data with the file streamed from disk (up to 50 MB on the public Bot API)
  async upload(method, params, field, filePath, filename) {
    const form = new FormData();

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }

    form.append(field, await openAsBlob(filePath), filename);

    return request(method, { body: form });
  },

  sendMessage(chatId, text, extra = {}) {
    return this.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
  },

  async editMessageText(chatId, messageId, text, extra = {}) {
    try {
      return await this.call('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'HTML',
        ...extra
      });
    } catch (error) {
      // Editing with the same text is harmless (e.g. two progress updates with the same value)
      if (error.message.includes('message is not modified')) return null;
      throw error;
    }
  }
};
