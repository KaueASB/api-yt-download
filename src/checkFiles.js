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
    'bin/yt-dlp': 'yt-dlp --version'
  };

  binaries.forEach(bin => {
    const fullPath = path.join(basePath, bin);

    if (fs.existsSync(fullPath)) {
      console.log(`✅ Binário encontrado: ${fullPath}`);

      exec(execBinaries[bin], (error, stdout, stderr) => {
        if (error) {
          console.error(`Erro ao executar yt-dlp: ${error.message}`);
          return;
        }

        if (stderr) {
          console.error(`yt-dlp stderr: ${stderr}`);
          return;
        }

        console.log(`yt-dlp versão: ${stdout}`);
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

// Executando a função no diretório do projeto
// checkFiles();
// listFilesRecursively(basePath);