import 'dotenv/config';
import path from 'node:path';
import os from 'node:os';

export const config = {
  port: parseInt(process.env.PORT || '3333', 10),

  downloadsPath: path.join(
    os.tmpdir(),
    'downloads'
  ),

  cookiesPath: path.join(
    process.cwd(),
    'src',
    'cookies.txt'
  ),

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

console.log('Configuration:', {
  port: config.port,
  downloadsPath: config.downloadsPath,
  cookiesPath: config.cookiesPath,
  downloadOptions: config.downloadOptions
});