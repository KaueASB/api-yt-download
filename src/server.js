import cors from "cors";
import express from "express";
import { spawn, exec } from "node:child_process"; // Substituí execSync por exec
import fs from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkFiles, listFilesRecursively } from "./checkFiles.js";

// Função para inicializar o servidor de forma assíncrona
async function initializeServer() {
  let basePath = "";

  if (process.env.IS_LOCAL) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    basePath = path.join(__dirname, "..");
  } else {
    basePath = "/opt/render/project/src";
  }

  const app = express();
  app.use(cors());

  // Cria o diretório de downloads de forma assíncrona
  const downloadsPath = await mkdir(path.join(basePath, 'src', "downloads"), { recursive: true });
  console.log("Caminho do diretório de downloads:", downloadsPath);

  console.log("Base Path no server", basePath);

  const { IS_LOCAL } = process.env;

  const videoFormats = ["webm", "mp4", "mkv"];
  const audioFormats = ["opus", "aac", "mp3", "m4a", "wav"];

  const downloads = new Map();

  // Configura permissões em produção de forma assíncrona
  const ytdlpPath = IS_LOCAL ? "yt-dlp" : path.join(basePath, "bin", "yt-dlp");
  const cookiesPath = path.join(basePath, 'src', "cookies.txt");

  if (!IS_LOCAL) {
    exec(`chmod +x ${ytdlpPath}`, (err) => {
      if (err) console.error("Erro ao dar permissão ao yt-dlp:", err);
    });
    exec(`chmod 644 ${cookiesPath}`, (err) => {
      if (err) console.error("Erro ao dar permissão ao cookies.txt:", err);
    });
  }

  app.get("/check", (_req, res) => {
    checkFiles();
    listFilesRecursively();
    return res.send("Servidor rodando");
  });

  app.get("/health", (_req, res) => {
    return res.send("ok");
  });

  app.get("/download", async (req, res) => {
    const { url: videoUrl, format } = req.query;

    if (!videoUrl || !format) {
      return res.status(400).json({ error: "URL do vídeo e formato são obrigatórios" });
    }

    // Validação básica da URL (exemplo simples, pode ser expandido)
    if (!videoUrl.startsWith("http")) {
      return res.status(400).json({ error: "URL inválida" });
    }

    const isVideoFormat = videoFormats.includes(format);
    const isAudioFormat = audioFormats.includes(format);

    if (!isAudioFormat && !isVideoFormat) {
      return res.status(400).json({ error: "Formato não suportado" });
    }

    const newFormat = isVideoFormat && videoUrl.includes("m3u8") ? "mp4" : format;
    const outputPath = path.join(basePath, 'src', "downloads", `${isAudioFormat ? "audio" : "video"}-${Date.now()}.${newFormat}`);

    const commandArgs = isAudioFormat
      ? [
        "-x",
        "--audio-format",
        newFormat,
        "--cookies",
        cookiesPath,
        "--sleep-requests",
        "1",
        "--min-sleep-interval",
        "3",
        "--max-sleep-interval",
        "5",
        "--retries",
        "infinite",
        "-o",
        outputPath,
        videoUrl,
      ]
      : [
        "-f",
        `bestvideo[ext=${newFormat}]+bestaudio`,
        "--cookies",
        cookiesPath,
        "--sleep-requests",
        "1",
        "--min-sleep-interval",
        "3",
        "--max-sleep-interval",
        "5",
        "--retries",
        "infinite",
        "-o",
        outputPath,
        videoUrl,
      ];

    const downloadProcess = spawn(ytdlpPath, commandArgs);
    downloads.set(videoUrl, { progress: 0, outputPath, process: downloadProcess });

    downloadProcess.stderr.on("data", (data) => {
      console.error("Erro no download:", data.toString());
    });

    downloadProcess.stdout.on("data", (data) => {
      const progressMatch = data.toString().match(/(\d+\.\d+)%/);
      if (progressMatch) {
        const progress = parseFloat(progressMatch[1]);
        downloads.set(videoUrl, { progress, outputPath, process: downloadProcess });
      }
    });

    downloadProcess.on("close", (code) => {
      if (code !== 0) {
        downloads.delete(videoUrl);
        console.error("Erro no download com yt-dlp");
      } else {
        console.log("Download concluído");
        downloads.set(videoUrl, { progress: 100, outputPath, process: null });
      }
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
        res.write(`data: ${JSON.stringify({ error: "Download não encontrado" })}\n\n`);
        return res.end();
      }

      const { progress } = downloads.get(url);
      res.write(`data: ${JSON.stringify({ progress })}\n\n`);

      if (progress === 100) {
        clearInterval(interval);
        res.end();
      }
    };

    const interval = setInterval(sendProgress, 1000);

    req.on("close", () => {
      clearInterval(interval);
      res.end();
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

        fs.unlink(outputPath, (unlinkErr) => {
          if (unlinkErr) {
            console.error("Erro ao excluir arquivo temporário:", unlinkErr);
          }
          downloads.delete(url);
        });

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

  // Limpeza automática de arquivos após 1 hora
  // setInterval(() => {
  //   const now = Date.now();
  //   downloads.forEach(({ outputPath, progress }, url) => {
  //     if (progress === 100 && now - fs.statSync(outputPath).mtimeMs > 3600000) { // 1 hora
  //       fs.unlink(outputPath, (err) => {
  //         if (err) console.error("Erro ao excluir arquivo antigo:", err);
  //         downloads.delete(url);
  //       });
  //     }
  //   });
  // }, 60000); // Verifica a cada minuto

  const PORT = process.env.PORT || 3333;
  app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
}

// Inicializa o servidor
initializeServer().catch((err) => console.error("Erro ao inicializar o servidor:", err));