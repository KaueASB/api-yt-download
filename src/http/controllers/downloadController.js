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

      const output = await downloadService.getFormats(videoUrl);
      const formats = parseFormats(output);
      res.json({ formats });
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

      const result = downloadService.startDownload(videoUrl, format);
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

  getProgress(req, res) {
    try {
      const { jobId } = req.query;

      if (!jobId) {
        return res.status(400).json({
          error: 'Job ID is required'
        });
      }

      const progress = downloadService.getDownloadProgress(jobId);

      return res.json({
        progress
      });
    } catch (error) {
      console.error('Error getting progress:', error);

      return res.status(404).json({
        error: 'Download not found'
      });
    }
  },

  async getFile(req, res) {
    try {
      const { jobId } = req.query;

      if (!jobId) {
        return res.status(400).json({ error: 'Job ID is required' });
      }

      const filePath = await downloadService.getDownloadFile(jobId);

      return res.download(filePath, async (err) => {
        if (err) {
          console.error('Error sending file:', err);
          return res.status(500).send();
        }

        await downloadService.removeDownload(jobId);
      });
    } catch (error) {
      console.error('Error getting file:', error);
      return res.status(404).json({ error: 'File not found' });
    }
  }
};