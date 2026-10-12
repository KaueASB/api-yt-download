import cors from "cors";
import express from "express";

import { mkdir } from "node:fs/promises";

import { config } from "./config/config.js";
import downloadRoutes from "./http/routes/downloadRoutes.js";
import telegramRoutes from "./http/routes/telegramRoutes.js";

async function initializeServer() {
  const app = express();
  app.use(cors());

  // Create downloads directory
  await mkdir(config.downloadsPath, { recursive: true });

  // Routes
  app.use('/api', downloadRoutes);

  if (config.telegram) {
    app.use('/telegram', telegramRoutes);
  }

  // Health check endpoint
  app.get('/health', (_req, res) => {
    return res.send('ok');
  });

  // Start server
  app.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
  });
}

// Initialize server
initializeServer().catch((err) => {
  console.error("Error initializing server:", err);
  process.exit(1);
});