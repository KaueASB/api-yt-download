// Points the bot at a deployed API: pnpm bot:webhook https://your-api.vercel.app
// Without a URL it removes the webhook (needed before `pnpm bot:poll`)
import 'dotenv/config';

const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret } = process.env;
const baseUrl = process.argv[2];

if (!token || !secret) {
  console.error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env first');
  process.exit(1);
}

async function call(method, params) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  return response.json();
}

const result = baseUrl
  ? await call('setWebhook', {
      url: `${baseUrl.replace(/\/$/, '')}/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true
    })
  : await call('deleteWebhook', { drop_pending_updates: true });

console.log(result);
console.log(await call('getWebhookInfo', {}));
