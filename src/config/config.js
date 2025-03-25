import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..', '..');

// Ensure required environment variables are present
const requiredEnvVars = ['IS_LOCAL'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.warn(`Warning: ${envVar} environment variable is not set. Using default value.`);
  }
}

export const config = {
  isLocal: process.env.IS_LOCAL === 'true',
  basePath: process.env.IS_LOCAL === 'true' ? projectRoot : '/opt/render/project/src',
  port: parseInt(process.env.PORT || '3333', 10),
  downloadsPath: path.join(projectRoot, 'src', '_downloads'),
  cookiesPath: path.join(projectRoot, 'src', 'cookies.txt'),
  ytdlpPath: process.env.IS_LOCAL === 'true' ? 'yt-dlp' : path.join(projectRoot, 'bin', 'yt-dlp'),
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

// Log configuration on startup
console.log('Configuration:', {
  isLocal: config.isLocal,
  basePath: config.basePath,
  port: config.port,
  downloadsPath: config.downloadsPath,
  cookiesPath: config.cookiesPath,
  ytdlpPath: config.ytdlpPath,
  downloadOptions: {
    sleepRequests: config.downloadOptions.sleepRequests,
    minSleepInterval: config.downloadOptions.minSleepInterval,
    maxSleepInterval: config.downloadOptions.maxSleepInterval,
    retries: config.downloadOptions.retries
  }
}); 