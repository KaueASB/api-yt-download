import 'dotenv/config';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
  }

  return value;
}

export const config = {
  port: parseInt(process.env.PORT || '3333', 10),

  // Local scratch dir: yt-dlp writes here, then the file is uploaded to R2 and deleted
  downloadsPath: path.join(
    os.tmpdir(),
    'downloads'
  ),

  cookiesPath: path.join(
    process.cwd(),
    'src',
    'cookies.txt'
  ),
  // Off by default: expired/rotated cookies make YouTube return 403 on larger formats
  useCookies: process.env.YTDLP_USE_COOKIES === 'true',
  // Netscape cookie file as base64 (used on Vercel); falls back to cookiesPath when unset
  cookiesContent: process.env.YTDLP_COOKIES_BASE64
    ? Buffer.from(process.env.YTDLP_COOKIES_BASE64, 'base64').toString('utf8')
    : null,

  redis: {
    url: requireEnv('UPSTASH_REDIS_REST_URL'),
    token: requireEnv('UPSTASH_REDIS_REST_TOKEN')
  },

  r2: {
    accountId: requireEnv('R2_ACCOUNT_ID'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    bucket: requireEnv('R2_BUCKET'),
    // Optional: point to a local S3-compatible server instead of R2
    endpoint: process.env.R2_ENDPOINT || undefined
  },

  jobs: {
    // Job state in Redis expires after this (match the R2 lifecycle rule)
    ttlSeconds: 60 * 60 * 24,
    // Minimum interval between progress writes to Redis (saves Upstash commands)
    progressWriteIntervalMs: 2000,
    // How long the signed R2 download URL stays valid
    downloadUrlExpiresSeconds: 60 * 60
  },

  supportedFormats: {
    video: ['webm', 'mp4', 'mkv'],
    audio: ['opus', 'aac', 'mp3', 'm4a', 'wav']
  },

  downloadOptions: {
    sleepRequests: 1,
    minSleepInterval: 3,
    maxSleepInterval: 5,
    retries: 'infinite'
  }
};

if (config.useCookies) {
  if (config.cookiesContent === null && !existsSync(config.cookiesPath)) {
    throw new Error(`YTDLP_USE_COOKIES=true but neither YTDLP_COOKIES_BASE64 nor ${config.cookiesPath} exists`);
  }

  // A wrong value (not base64, or not a Netscape cookie file) would silently send no cookies
  if (config.cookiesContent !== null && !config.cookiesContent.includes('\t')) {
    throw new Error('YTDLP_COOKIES_BASE64 does not decode to a Netscape cookie file');
  }
}

console.log('Configuration:', {
  port: config.port,
  downloadsPath: config.downloadsPath,
  useCookies: config.useCookies,
  cookiesSource: !config.useCookies
    ? 'none'
    : config.cookiesContent !== null ? 'YTDLP_COOKIES_BASE64' : config.cookiesPath,
  r2Bucket: config.r2.bucket,
  downloadOptions: config.downloadOptions
});
