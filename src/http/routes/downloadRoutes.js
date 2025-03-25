import express from 'express';
import { downloadController } from '../controllers/downloadController.js';

const router = express.Router();

router.get('/formats', downloadController.getFormats);
router.get('/download', downloadController.startDownload);
router.get('/progress', downloadController.getProgress);
router.get('/file', downloadController.getFile);

export default router; 