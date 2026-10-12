import express from 'express';
import { telegramController } from '../controllers/telegramController.js';

const router = express.Router();

router.post('/webhook', express.json(), telegramController.handleWebhook);

export default router;
