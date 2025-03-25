import cors from "cors";
import express from "express";

import { exec } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";

import { config } from "./config/config.js";
import downloadRoutes from "./http/routes/downloadRoutes.js";

const execAsync = promisify(exec);

async function setupBinaries() {
  if (config.isLocal) return;

  try {
    // Create bin directory
    await mkdir("bin", { recursive: true });

    // Install ffmpeg
    console.log("Installing ffmpeg...");
    await execAsync("curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz -o ffmpeg.tar.xz");
    await execAsync("tar -xf ffmpeg.tar.xz");
    await execAsync("mv ffmpeg*/ffmpeg ./bin/ffmpeg");
    await execAsync("mv ffmpeg*/ffprobe ./bin/ffprobe");
    await execAsync("chmod +x ./bin/ffmpeg ./bin/ffprobe");
    await execAsync("rm ffmpeg.tar.xz && rm -rf ffmpeg-*/");

    // Install yt-dlp
    console.log("Installing yt-dlp...");
    await execAsync("curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ./bin/yt-dlp");
    await execAsync("chmod +x ./bin/yt-dlp");

    // Verify installations
    const ffmpegVersion = await execAsync("./bin/ffmpeg -version");
    const ytdlpVersion = await execAsync("./bin/yt-dlp --version");
    console.log("FFmpeg version:", ffmpegVersion.stdout.split('\n')[0]);
    console.log("yt-dlp version:", ytdlpVersion.stdout.trim());
  } catch (error) {
    console.error("Error setting up binaries:", error);
    throw error;
  }
}

async function initializeServer() {
  const app = express();
  app.use(cors());

  // Setup binaries in production
  await setupBinaries();

  // Create downloads directory
  await mkdir(config.downloadsPath, { recursive: true });

  // Set permissions for yt-dlp and cookies.txt in production
  if (!config.isLocal) {
    exec(`chmod +x ${config.ytdlpPath}`, (err) => {
      if (err) console.error("Error setting yt-dlp permissions:", err);
    });
    exec(`chmod 644 ${config.cookiesPath}`, (err) => {
      if (err) console.error("Error setting cookies.txt permissions:", err);
    });
  }

  // Routes
  app.use('/api', downloadRoutes);

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