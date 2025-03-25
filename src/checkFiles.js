import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

let basePath = ''

if (process.env.IS_LOCAL) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  basePath = path.join(__dirname, '..');
} else {
  basePath = '/opt/render/project/src';
}

console.log('Base Path no checkFiles:', basePath);

export const checkFiles = () => {
  console.log('Verificando estrutura de arquivos no Render:');

  const directories = ['bin', 'ffmpeg-7.0.2-i686-static'];

  directories.forEach(dir => {
    const fullPath = path.join(basePath, dir);
    if (fs.existsSync(fullPath)) {
      console.log(`✅ Diretório encontrado: ${fullPath}`);
      console.log(`📂 Conteúdo:`, fs.readdirSync(fullPath));
    } else {
      console.log(`❌ Diretório não encontrado: ${fullPath}`);
    }
  });

  // Verificar se os binários do ffmpeg e yt-dlp estão no lugar certo
  const binaries = ['bin/ffmpeg', 'bin/ffprobe', 'bin/yt-dlp'];

  const execBinaries = {
    'bin/ffmpeg': 'ffmpeg -version',
    'bin/ffprobe': 'ffprobe -version',
    'bin/yt-dlp': './bin/yt-dlp --version'
  };

  binaries.forEach(bin => {
    const fullPath = path.join(basePath, bin);

    if (fs.existsSync(fullPath)) {
      console.log(`✅ Binário encontrado: ${fullPath}`);

      exec(execBinaries[bin], (error, stdout, stderr) => {
        if (error) {
          console.error(`Erro ao executar ${execBinaries[bin]}: ${error.message}`);
          return;
        }

        if (stderr) {
          console.error(`${execBinaries[bin]} stderr: ${stderr}`);
          return;
        }

        console.log(`${execBinaries[bin]}: ${stdout}`);
      })
    } else {
      console.log(`❌ Binário não encontrado: ${fullPath}`);
    }
  });
};

export function listFilesRecursively(dir = basePath, ignoreDirs = new Set([".git", "node_modules"])) {
  try {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (!ignoreDirs.has(file)) {
          console.log(`📂 ${fullPath}`);
          listFilesRecursively(fullPath, ignoreDirs); // Recursão segura
        }
      } else {
        console.log(`📄 ${fullPath}`);
      }
    }
  } catch (error) {
    console.error(`Erro ao listar arquivos em ${dir}: ${error.message}`);
  }
}

export function parseFormats(output) {
  const lines = output.split('\n').slice(4);

  const formats = [];
  const regex = /^(\S+)\s+(\S+)\s+(\d+x\d+|audio only)\s*(\d+)?\s*(\S+(?:KiB|MiB|k))?\s*(\S+)?\s*(\S+)?\s*\|\s*(\S+)?\s*(\S+)?\s*(\S+)?\s*(\S+)?\s*\|\s*(\S+?)\s+(\d+k)?\s*(\d+k)?\s*(.*)?$/;

  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      formats.push({
        id: match[1],
        ext: match[2],
        resolution: match[3] || null,
        fps: match[4] || null,
        ch: match[5] || null,
        filesize: match[6] || null,
        tbr: match[7] || null,
        protocol: match[8] || null,
        vcodec: match[9] || null,
        vbr: match[10] || null,
        acodec: match[11] || null,
        abr: match[12] || null,
        asr: match[13] || null,
        more_info: match[14] || null,
      });
    }
  }

  return formats;
}
