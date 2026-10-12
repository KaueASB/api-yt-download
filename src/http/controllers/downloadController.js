import { downloadService } from '../services/downloadService.js';
import { parseFormats } from '../../utils/formatParser.js';

export const downloadController = {
  async getFormats(req, res) {
    try {
      const { url: videoUrl } = req.query;
      console.log('videoUrl', videoUrl);

      if (!videoUrl) {
        return res.status(400).json({ error: 'Video URL is required' });
      }

      const info = await downloadService.getVideoInfo(videoUrl);
      const formats = parseFormats(info);
      res.json({
        title: info.title ?? null,
        thumbnail: info.thumbnail ?? null,
        formats
      });
    } catch (error) {
      console.error('Error getting formats:', error);
      res.status(500).json({ error: 'Failed to get available formats' });
    }
  },

  async startDownload(req, res) {
    try {
      const { url: videoUrl, format } = req.query;

      if (!videoUrl || !format) {
        return res.status(400).json({ error: 'Video URL and format are required' });
      }

      if (!videoUrl.startsWith('http')) {
        return res.status(400).json({ error: 'Invalid URL' });
      }

      const result = await downloadService.startDownload(videoUrl, format);
      return res.json(result);
    } catch (error) {
      console.error('Error starting download:', error);
      return res.status(400).json({ error: error.message });
    }
  },

  async startDownloadWithFormatCode(req, res) {
    try {
      const { url: videoUrl, code: formatCode } = req.query;

      if (!videoUrl || !formatCode) {
        return res.status(400).json({ error: 'Video URL and format code are required' });
      }

      if (!videoUrl.startsWith('http')) {
        return res.status(400).json({ error: 'Invalid URL' });
      }

      const result = await downloadService.downloadWithFormatCode(videoUrl, formatCode);
      return res.json(result);
    } catch (error) {
      console.error('Error starting download with format code:', error);
      return res.status(400).json({ error: error.message });
    }
  },

  async getProgress(req, res) {
    try {
      const { jobId } = req.query;

      if (!jobId) {
        return res.status(400).json({
          error: 'Job ID is required'
        });
      }

      const job = await downloadService.getJob(jobId);

      if (!job) {
        return res.status(404).json({ error: 'Download not found' });
      }

      if (job.status === 'error') {
        return res.status(500).json({ progress: -1, error: job.error });
      }

      return res.json({
        progress: job.progress,
        status: job.status
      });
    } catch (error) {
      console.error('Error getting progress:', error);
      return res.status(500).json({ error: 'Failed to get download progress' });
    }
  },

  async getFile(req, res) {
    try {
      const { jobId } = req.query;

      if (!jobId) {
        return res.status(400).json({ error: 'Job ID is required' });
      }

      const job = await downloadService.getJob(jobId);

      if (!job) {
        return res.status(404).json({ error: 'File not found' });
      }

      if (job.status !== 'done') {
        return res.status(409).json({ error: 'File is not ready yet' });
      }

      // The browser downloads straight from R2; the file expires via the bucket lifecycle rule
      const downloadUrl = await downloadService.getDownloadUrl(job);
      return res.redirect(downloadUrl);
    } catch (error) {
      console.error('Error getting file:', error);
      return res.status(500).json({ error: 'Failed to get file' });
    }
  }
};
