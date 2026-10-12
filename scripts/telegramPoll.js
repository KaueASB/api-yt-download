// Local dev without a public URL: fetches updates by long polling and handles them like the webhook.
// Telegram refuses getUpdates while a webhook is set; remove it with `pnpm bot:webhook` (no URL)
import { mkdir } from 'node:fs/promises';

import { config } from '../src/config/config.js';
import { telegram } from '../src/lib/telegram.js';
import { telegramService } from '../src/http/services/telegramService.js';

if (!config.telegram) {
  console.error('Set TELEGRAM_BOT_TOKEN in .env first');
  process.exit(1);
}

await mkdir(config.downloadsPath, { recursive: true });

const me = await telegram.call('getMe');
console.log(`Polling as @${me.username}`);

let offset = 0;

while (true) {
  try {
    const updates = await telegram.call('getUpdates', {
      offset,
      timeout: 30,
      allowed_updates: ['message', 'callback_query']
    });

    for (const update of updates) {
      offset = update.update_id + 1;

      // Not awaited: a download must not block the next messages
      telegramService
        .handleUpdate(update)
        .catch((error) => console.error('[BOT] update failed:', error));
    }
  } catch (error) {
    console.error(error.message);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
