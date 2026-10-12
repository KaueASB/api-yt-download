import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { copyFile, readdir, unlink, writeFile } from 'node:fs/promises';

import { waitUntil } from '@vercel/functions';

import { config } from '../../config/config.js';
import { jobStore } from '../../lib/jobStore.js';
import { storage } from '../../lib/storage.js';
import { parseFormats } from '../../utils/formatParser.js';

// yt-dlp prints warnings (e.g. expired cookies) to stderr too; keep only the real errors
function extractYtDlpError(stderr) {
  const lines = stderr.trim().split('\n');
  const errors = lines.filter((line) => line.startsWith('ERROR:'));

  return (errors.length ? errors.join('\n') : lines.at(-1)) || 'Unknown yt-dlp error';
}

class DownloadService {
  // yt-dlp rewrites the cookie file it is given, so each run gets its own copy
  // (keeps the exported cookies intact and avoids concurrent writes)
  async prepareCookieArgs(id) {
    if (!config.useCookies) return [];

    const copyPath = path.join(config.downloadsPath, `${id}.cookies.txt`);

    if (config.cookiesContent !== null) {
      await writeFile(copyPath, config.cookiesContent);
    } else {
      await copyFile(config.cookiesPath, copyPath);
    }

    return ['--cookies', copyPath];
  }

  async getVideoInfo(videoUrl) {
    const runId = crypto.randomUUID();
    const cookieArgs = await this.prepareCookieArgs(runId);

    return new Promise((resolve, reject) => {
      const ytDlpProcess = spawn('yt-dlp', [
        ...cookieArgs,
        '-J',
        '--no-playlist',
        videoUrl
      ]);
      let output = '';
      let errorOutput = '';

      ytDlpProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      ytDlpProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ytDlpProcess.on('close', (code) => {
        this.removeLocalFiles(runId);

        if (code !== 0) {
          console.error(`Error getting formats: ${errorOutput}`);

          reject(
            new Error(
              errorOutput || 'Failed to get available formats'
            )
          );

          return;
        }

        try {
          resolve(JSON.parse(output));
        } catch (error) {
          reject(new Error('Failed to parse yt-dlp output'));
        }
      });
    });
  }

  async downloadWithFormatCode(videoUrl, formatCode) {
    if (!formatCode) {
      throw new Error('Format code is required');
    }

    // Get the formats first to determine the extension
    const info = await this.getVideoInfo(videoUrl);
    const formats = parseFormats(info);

    // Find the selected format
    const selectedFormat = formats.find(format => format.code === formatCode);

    if (!selectedFormat) {
      throw new Error('Format code not found');
    }

    console.log('Selected format:', selectedFormat);

    const isAudioOnly = selectedFormat.resolution === 'audio only';
    const extension = isAudioOnly ? 'mp3' : 'mp4';

    // Formats that already carry audio (HLS variants, YouTube's 18) must not get "+bestaudio":
    // with no separate audio track the selector falls back to "best" and ignores the chosen quality
    const rawFormat = info.formats.find((format) => format.format_id === formatCode);
    const hasAudio = rawFormat?.acodec && rawFormat.acodec !== 'none';
    const videoSelector = hasAudio ? formatCode : `${formatCode}+bestaudio/${formatCode}`;

    const jobId = crypto.randomUUID();
    const outputPath = path.join(config.downloadsPath, `${jobId}.${extension}`);

    const cookieArgs = await this.prepareCookieArgs(jobId);

    const commandArgs = [
      ...this.buildBaseArgs(cookieArgs),
      ...(isAudioOnly
        ? ['-x', '--audio-format', 'mp3', '-f', formatCode]
        : ['--merge-output-format', 'mp4', '-f', videoSelector]
      ),
      '-o',
      outputPath,
      videoUrl
    ];

    return this.startJob(jobId, commandArgs, outputPath, {
      url: videoUrl,
      filename: info.title ? `${info.title}.${extension}` : `download.${extension}`
    });
  }

  async startDownload(videoUrl, format) {
    const isVideoFormat = config.supportedFormats.video.includes(format);
    const isAudioFormat = config.supportedFormats.audio.includes(format);

    if (!isAudioFormat && !isVideoFormat) {
      throw new Error('Unsupported format');
    }

    const jobId = crypto.randomUUID();
    const outputPath = path.join(config.downloadsPath, jobId);

    const cookieArgs = await this.prepareCookieArgs(jobId);
    const commandArgs = this.buildCommandArgs(isAudioFormat, outputPath, videoUrl, cookieArgs);

    return this.startJob(jobId, commandArgs, outputPath, { url: videoUrl });
  }

  buildBaseArgs(cookieArgs) {
    return [
      ...cookieArgs,
      '--sleep-requests',
      config.downloadOptions.sleepRequests,
      '--min-sleep-interval',
      config.downloadOptions.minSleepInterval,
      '--max-sleep-interval',
      config.downloadOptions.maxSleepInterval,
      '--retries',
      config.downloadOptions.retries,
      '--print',
      'after_move:FILEPATH:%(filepath)s',
      '--progress',
      '--newline',
      '--no-part'
    ];
  }

  buildCommandArgs(isAudioFormat, outputPath, videoUrl, cookieArgs) {
    const audioArgs = [
      '-x',
      '--audio-format', 'mp3',
      '-o',
      outputPath
    ];

    const videoArgs = [
      '-f',
      'bestvideo+bestaudio/best',
      '--merge-output-format',
      'mp4',
      '-o',
      outputPath
    ];

    return isAudioFormat
      ? [...audioArgs, ...this.buildBaseArgs(cookieArgs), videoUrl]
      : [...videoArgs, ...this.buildBaseArgs(cookieArgs), videoUrl];
  }

  async startJob(jobId, commandArgs, outputPath, fields) {
    try {
      await jobStore.create(jobId, fields);
    } catch (error) {
      await this.removeLocalFiles(jobId);
      throw error;
    }

    // On Vercel this keeps the instance alive until the job ends (no-op elsewhere)
    waitUntil(this.runJob(jobId, commandArgs, outputPath));

    return { message: 'Download started', jobId };
  }

  // Never rejects: failures are recorded on the job so /progress can report them
  async runJob(jobId, commandArgs, outputPath) {
    try {
      const finalPath = await this.runYtDlp(jobId, commandArgs, outputPath);

      // Progress stays below 100 until the file is actually downloadable
      await jobStore.update(jobId, { status: 'uploading', progress: 99 });

      const key = `downloads/${path.basename(finalPath)}`;
      await storage.uploadFile(key, finalPath);

      const job = await jobStore.get(jobId);
      await jobStore.update(jobId, {
        status: 'done',
        progress: 100,
        key,
        filename: job?.filename || path.basename(finalPath)
      });

      console.log(`[JOB ${jobId}] completed`);
    } catch (error) {
      console.error(`[JOB ${jobId}] failed:`, error.message);

      await jobStore
        .update(jobId, { status: 'error', progress: -1, error: error.message })
        .catch((err) => console.error(`[JOB ${jobId}] could not save error:`, err));
    } finally {
      await this.removeLocalFiles(jobId);
    }
  }

  runYtDlp(jobId, commandArgs, outputPath) {
    return new Promise((resolve, reject) => {
      const ytDlpProcess = spawn('yt-dlp', commandArgs);

      let finalPath = outputPath;
      let errorOutput = '';
      let lastProgress = 0;
      let lastWriteAt = 0;
      let pendingWrite = Promise.resolve();

      ytDlpProcess.stdout.on('data', (data) => {
        const text = data.toString();

        // yt-dlp may change the extension, so trust the path it prints at the end
        const filepathMatch = text.match(/FILEPATH:(.+)/);
        if (filepathMatch) {
          finalPath = filepathMatch[1].trim();
          return;
        }

        const match = text.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
        if (!match) return;

        const value = Math.min(parseFloat(match[1]), 99);
        if (value <= lastProgress) return;
        lastProgress = value;

        // Throttle Redis writes to stay within the Upstash free tier
        const now = Date.now();
        if (now - lastWriteAt < config.jobs.progressWriteIntervalMs) return;
        lastWriteAt = now;

        pendingWrite = jobStore
          .update(jobId, { progress: value })
          .catch((err) => console.error(`[JOB ${jobId}] progress write failed:`, err));
      });

      ytDlpProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      ytDlpProcess.on('error', reject);

      ytDlpProcess.on('close', async (code) => {
        // Make sure a late progress write can't overwrite the final status
        await pendingWrite;

        if (code !== 0) {
          console.error(errorOutput);
          reject(new Error(extractYtDlpError(errorOutput)));
          return;
        }

        resolve(finalPath);
      });
    });
  }

  // Every file yt-dlp writes for a job (final file and leftovers) starts with the jobId
  async removeLocalFiles(jobId) {
    try {
      const files = await readdir(config.downloadsPath);

      await Promise.all(
        files
          .filter((file) => file.startsWith(jobId))
          .map((file) => unlink(path.join(config.downloadsPath, file)))
      );
    } catch (error) {
      console.warn(`[JOB ${jobId}] could not remove local files:`, error.message);
    }
  }

  async getJob(jobId) {
    return jobStore.get(jobId);
  }

  async getDownloadUrl(job) {
    return storage.getDownloadUrl(job.key, job.filename);
  }
}

export const downloadService = new DownloadService();
