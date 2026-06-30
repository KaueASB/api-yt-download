import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { config } from '../../config/config.js';
import { parseFormats } from '../../utils/formatParser.js';

class DownloadService {
  constructor() {
    this.downloads = new Map();
  }

  async getFormats(videoUrl) {
    return new Promise((resolve, reject) => {
      const ytDlpProcess = spawn('yt-dlp', [
        '--cookies',
        config.cookiesPath,
        '-F',
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
        if (code !== 0) {
          console.error(`Error getting formats: ${errorOutput}`);

          reject(
            new Error(
              errorOutput || 'Failed to get available formats'
            )
          );

          return;
        }

        resolve(output);
      });
    });
  }

  async downloadWithFormatCode(videoUrl, formatCode) {
    if (!formatCode) {
      throw new Error('Format code is required');
    }

    // Get the formats first to determine the extension
    return this.getFormats(videoUrl)
      .then(output => {
        const formats = parseFormats(output);

        // Find the selected format
        const selectedFormat = formats.find(format => format.code === formatCode);

        if (!selectedFormat) {
          throw new Error('Format code not found');
        }

        const extension = selectedFormat.resolution === 'audio only'
          ? selectedFormat.extension
          : 'mp4';

        const outputPath = path.join(
          config.downloadsPath,
          `download-${Date.now()}`
        );

        const isAudioOnly = selectedFormat.resolution === 'audio only';

        const selectedFormatCode = isAudioOnly
          ? formatCode
          : `${formatCode}+bestaudio/best`;

        const commandArgs = [
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
          '--print',
          'after_move:FILEPATH:%(filepath)s',
          '--progress',
          '--newline',
          '--no-part',
          '--merge-output-format',
          'mp4',
          '-f',
          selectedFormatCode,
          '-o',
          outputPath,
          videoUrl
        ];

        const downloadProcess = spawn('yt-dlp', commandArgs);
        const jobId = crypto.randomUUID();

        this.setupDownloadProcess(downloadProcess, jobId, outputPath);
        this.downloads.set(jobId, {
          progress: 0,
          outputPath,
          process: downloadProcess,
          url: videoUrl
        });

        return { message: 'Download started', jobId };
      });
  }

  startDownload(videoUrl, format) {
    const isVideoFormat = config.supportedFormats.video.includes(format);
    const isAudioFormat = config.supportedFormats.audio.includes(format);

    if (!isAudioFormat && !isVideoFormat) {
      throw new Error('Unsupported format');
    }

    const newFormat = isVideoFormat
      ? 'mp4'
      : format;
    const outputPath = path.join(
      config.downloadsPath,
      `${isAudioFormat ? 'audio' : 'video'}-${Date.now()}`
    );

    const commandArgs = this.buildCommandArgs(isAudioFormat, newFormat, outputPath, videoUrl);
    const downloadProcess = spawn('yt-dlp', commandArgs);
    const jobId = crypto.randomUUID();

    this.setupDownloadProcess(downloadProcess, jobId, outputPath);
    this.downloads.set(jobId, {
      progress: 0,
      outputPath,
      process: downloadProcess,
      url: videoUrl
    });

    return { message: 'Download started', jobId };
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
      '--print',
      'after_move:FILEPATH:%(filepath)s',
      '-o',
      outputPath,
      videoUrl
    ];

    return isAudioFormat
      ? ['-x', '--audio-format', format, '--progress', '--newline', '--no-part', ...baseArgs]
      : [
        '-f',
        'bestvideo+bestaudio/best',
        '--merge-output-format',
        'mp4',
        '--progress',
        '--newline',
        '--no-part',
        ...baseArgs
      ];
  }

  setupDownloadProcess(process, jobId, outputPath) {
    let buffer = '';
    let errorBuffer = '';

    const handleProgress = (data) => {
      const text = data.toString();

      const filepathMatch = text.match(/FILEPATH:(.+)/);

      if (filepathMatch) {
        const finalPath = filepathMatch[1].trim();

        const download = this.downloads.get(jobId);

        if (download) {
          this.downloads.set(jobId, {
            ...download,
            outputPath: finalPath
          });
        }
      }

      const progressMatch = text.match(/(\d+(?:\.\d+)?)%/);

      if (progressMatch) {
        const value = parseFloat(progressMatch[1]);

        const download = this.downloads.get(jobId);

        if (download) {
          this.downloads.set(jobId, {
            ...download,
            progress: value
          });
        }
      }
    };

    process.stdout.on('data', handleProgress);
    process.stderr.on('data', (data) => {
      errorBuffer += data.toString();
      handleProgress(data);
    });

    process.on('close', (code) => {
      const download = this.downloads.get(jobId);
      if (!download) return;

      if (code !== 0) {
        console.error('Download failed with yt-dlp');
        console.error(errorBuffer);

        this.downloads.set(jobId, {
          ...download,
          process: null,
          error: errorBuffer || 'Unknown yt-dlp error',
          progress: -1
        });

        return;
      }

      this.downloads.set(jobId, {
        ...download,
        progress: 100,
        process: null
      });

      console.log('Download completed');
    });
  }

  getDownloadProgress(jobId) {
    const download = this.downloads.get(jobId);
    if (!download) {
      throw new Error('Download not found');
    }
    if (download.error) {
      throw new Error(download.error);
    }

    return download.progress;
  }

  async getDownloadFile(jobId) {
    const download = this.downloads.get(jobId);
    if (!download) {
      throw new Error('File not found');
    }
    return download.outputPath;
  }

  async removeDownload(jobId) {
    const download = this.downloads.get(jobId);

    if (!download) return;

    try {
      await unlink(download.outputPath);
    } catch (error) {
      console.warn(
        'Could not remove file:',
        download.outputPath
      );
    }

    this.downloads.delete(jobId);
  }
}

export const downloadService = new DownloadService();