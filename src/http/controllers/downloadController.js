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
      res.json(result);
    } catch (error) {
      console.error('Error starting download:', error);
      res.status(400).json({ error: error.message });
    }
  },

  getProgress(req, res) {
    try {
      const { url } = req.query;

      if (!url) {
        return res.status(400).json({ error: 'URL is required' });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const sendProgress = () => {
        try {
          const progress = downloadService.getDownloadProgress(url);
          res.write(`data: ${JSON.stringify({ progress })}\n\n`);

          if (progress === 100) {
            clearInterval(interval);
            res.end();
          }
        } catch (error) {
          res.write(`data: ${JSON.stringify({ error: 'Download not found' })}\n\n`);
          clearInterval(interval);
          res.end();
        }
      };

      const interval = setInterval(sendProgress, 1000);

      req.on('close', () => {
        clearInterval(interval);
        res.end();
      });
    } catch (error) {
      console.error('Error getting progress:', error);
      res.status(500).json({ error: 'Failed to get download progress' });
    }
  },

  async getFile(req, res) {
    try {
      const { url } = req.query;

      if (!url) {
        return res.status(404).json({ error: 'File not found' });
      }

      const filePath = downloadService.getDownloadFile(url);

      return res.download(filePath, (err) => {
        if (err) {
          console.error('Error sending file:', err);
          return res.status(500).send();
        }

        downloadService.removeDownload(url);
      });
    } catch (error) {
      console.error('Error getting file:', error);
      res.status(404).json({ error: 'File not found' });
    }
  }
}; 