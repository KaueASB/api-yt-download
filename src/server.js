import cors from "cors";
import express from "express";

import { spawn } from "node:child_process";
import fs from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkFiles, listFilesRecursively } from "./checkFiles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());

await mkdir(path.join(__dirname, 'downloads'), { recursive: true });

const { IS_LOCAL } = process.env;

const videoFormats = ['webm', 'mp4', 'mkv'];
const audioFormats = ['opus', 'aac', 'mp3', 'm4a', 'wav'];

const downloads = new Map();

app.get("/", (_req, res) => {
  checkFiles();
  listFilesRecursively()
  return res.send("Servidor rodando");
});

app.get("/download", async (req, res) => {
  const { url: videoUrl, format } = req.query;

  if (!videoUrl || !format) {
    return res.status(400).json({ error: "URL do vídeo e formato são obrigatórios" });
  }

  const ytdlpPath = IS_LOCAL ? 'yt-dlp' : '/opt/render/project/src/bin/yt-dlp';

  const isVideoFormat = videoFormats.includes(format);
  const isAudioFormat = audioFormats.includes(format);

  if (!isAudioFormat && !isVideoFormat) {
    return res.status(400).json({ error: "Formato não suportado" });
  }

  const newFormat = isVideoFormat && videoUrl.includes("m3u8") ? "mp4" : format

  const outputPath = path.join(__dirname, 'downloads', `${isAudioFormat ? 'audio' : 'video'}-${Date.now()}.${newFormat}`);
  const commandArgs = isAudioFormat
    ? ['-x', '--audio-format', newFormat, '-o', outputPath, videoUrl]
    : ['-f', `bestvideo[ext=${newFormat}]+bestaudio`, '-o', outputPath, videoUrl];

  const process = spawn(ytdlpPath, commandArgs);
  downloads.set(videoUrl, { progress: 0, outputPath });

  process.stdout.on("data", (data) => {
    const progressMatch = data.toString().match(/(\d+\.\d+)%/);

    if (progressMatch) {
      const progress = parseFloat(progressMatch[1]);
      console.log("progress", progress)

      downloads.set(videoUrl, { progress, outputPath });
    }
  });

  process.on("close", (code) => {
    if (code !== 0) {
      downloads.delete(videoUrl);
      console.error("Erro no download com yt-dlp");
      return;
    }

    console.log("Download concluído");
    downloads.set(videoUrl, { progress: 100, outputPath });

  });

  res.json({ message: "Download iniciado", url: videoUrl });
});

app.get("/progress", (req, res) => {
  const { url } = req.query;

  if (!url || !downloads.has(url)) {
    return res.status(404).json({ error: "Download não encontrado" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendProgress = () => {
    if (!downloads.has(url)) {
      res.write("data: {\"error\": \"Download não encontrado\"}\n\n");
      return res.end();
    }

    const { progress } = downloads.get(url);

    res.write(`data: progress ${progress}%\n\n`);

    if (progress === 100) {
      clearInterval(interval);
      res.end();
    }
  };

  const interval = setInterval(sendProgress, 1000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

app.get("/file", (req, res) => {
  const { url } = req.query;

  if (!url || !downloads.has(url)) {
    return res.status(404).json({ error: "Arquivo não encontrado" });
  }

  const { outputPath } = downloads.get(url);

  return res.download(outputPath, (err) => {
    if (err) {
      console.error("Erro ao enviar o arquivo:", err);
      return res.status(500).send();
    }

    fs.unlink(outputPath, (unlinkErr) => {
      if (unlinkErr) {
        console.error("Erro ao excluir arquivo temporário:", unlinkErr);
      }

      downloads.delete(url);
    });
  });
});

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
