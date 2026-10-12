import crypto from 'node:crypto';

import { waitUntil } from '@vercel/functions';

import { config } from '../../config/config.js';
import { telegramService } from '../services/telegramService.js';

function isValidSecret(received) {
  const expected = Buffer.from(config.telegram.webhookSecret);
  const actual = Buffer.from(received ?? '');

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export const telegramController = {
  // Telegram retries updates that don't get a quick 200, so answer first and work in the background
  handleWebhook(req, res) {
    if (!isValidSecret(req.get('X-Telegram-Bot-Api-Secret-Token'))) {
      return res.sendStatus(401);
    }

    res.sendStatus(200);

    waitUntil(
      telegramService
        .handleUpdate(req.body)
        .catch((error) => console.error('[BOT] update failed:', error))
    );
  }
};
