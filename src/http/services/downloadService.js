import { spawn } from 'node:child_process';
import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { config } from '../../config/config.js';

class DownloadService {
  constructor() {
    this.downloads = new Map();
  }

  async getFormats(videoUrl) {
    return new Promise((resolve, reject) => {
      const ytDlpProcess = spawn(config.ytdlpPath, ['-F', videoUrl]);
      let output = '';

      ytDlpProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      ytDlpProcess.stderr.on('data', (data) => {
        console.error(`Error getting formats: ${data}`);
        reject(new Error('Failed to get available formats'));
      });

      ytDlpProcess.on('close', (code) => {
        if (code !== 0) {
          reject(new Error('Failed to get available formats'));
          return;
        }
        resolve(output);
      });
    });
  }

  startDownload(videoUrl, format) {
    const isVideoFormat = config.supportedFormats.video.includes(format);
    const isAudioFormat = config.supportedFormats.audio.includes(format);

    if (!isAudioFormat && !isVideoFormat) {
      throw new Error('Unsupported format');
    }

    const newFormat = isVideoFormat && videoUrl.includes('m3u8') ? 'mp4' : format;
    const outputPath = path.join(
      config.downloadsPath,
      `${isAudioFormat ? 'audio' : 'video'}-${Date.now()}.${newFormat}`
    );

    const commandArgs = this.buildCommandArgs(isAudioFormat, newFormat, outputPath, videoUrl);
    const downloadProcess = spawn(config.ytdlpPath, commandArgs);

    this.setupDownloadProcess(downloadProcess, videoUrl, outputPath);
    this.downloads.set(videoUrl, { progress: 0, outputPath, process: downloadProcess });

    return { message: 'Download started', url: videoUrl };
  }

  buildCommandArgs(isAudioFormat, format, outputPath, videoUrl) {
    const baseArgs = [
      '--cookies',
      config.cookiesPath,
      '--sleep-requests',
      config.downloadOptions.sleepRequests,
      '--min-sleep-interval',
      config.downloadOptions.minSleepInterval,
      '--max-sleep-interval',
      config.downloadOptions.maxSleepInterval,
      '--retries',
      config.downloadOptions.retries,
      '-o',
      outputPath,
      videoUrl
    ];

    return isAudioFormat
      ? ['-x', '--audio-format', format, ...baseArgs]
      : ['-f', `bestvideo[ext=${format}]+bestaudio`, ...baseArgs];
  }

  setupDownloadProcess(process, videoUrl, outputPath) {
    process.stderr.on('data', (data) => {
      console.error('Download error:', data.toString());
    });

    process.stdout.on('data', (data) => {
      const progressMatch = data.toString().match(/(\d+\.\d+)%/);
      if (progressMatch) {
        const progress = parseFloat(progressMatch[1]);
        this.downloads.set(videoUrl, { progress, outputPath, process });
      }
    });

    process.on('close', (code) => {
      if (code !== 0) {
        this.downloads.delete(videoUrl);
        console.error('Download failed with yt-dlp');
      } else {
        console.log('Download completed');
        this.downloads.set(videoUrl, { progress: 100, outputPath, process: null });
      }
    });
  }

  getDownloadProgress(videoUrl) {
    const download = this.downloads.get(videoUrl);
    if (!download) {
      throw new Error('Download not found');
    }
    return download.progress;
  }

  async getDownloadFile(videoUrl) {
    const download = this.downloads.get(videoUrl);
    if (!download) {
      throw new Error('File not found');
    }
    return download.outputPath;
  }

  async removeDownload(videoUrl) {
    try {
      const download = this.downloads.get(videoUrl);
      if (download) {
        await unlink(download.outputPath);
        this.downloads.delete(videoUrl);
      }
    } catch (error) {
      console.error('Error removing download file:', error);
      this.downloads.delete(videoUrl);
    }
  }
}

export const downloadService = new DownloadService(); 