import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

const basePath = '/opt/render/project/src'; // Caminho padrão no Render

export const checkFiles = () => {
  console.log('Verificando estrutura de arquivos no Render:');

  const directories = ['bin', 'ffmpeg-7.0.2-i686-static', 'src/downloads'];

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

  binaries.forEach(bin => {
    const fullPath = path.join(basePath, bin);

    if (fs.existsSync(fullPath)) {
      console.log(`✅ Binário encontrado: ${fullPath}`);

      exec('./bin/yt-dlp --version', (error, stdout, stderr) => {
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

export const listFilesRecursively = (depth = 0) => {
  try {
    const files = fs.readdirSync(basePath);

    files.forEach(file => {
      const fullPath = path.join(basePath, file);
      const stats = fs.statSync(fullPath);
      const prefix = '  '.repeat(depth); // Indenta para melhor visualização

      if (stats.isDirectory()) {
        console.log(`${prefix}📂 ${file}/`); // Indica que é um diretório
        listFilesRecursively(fullPath, depth + 1); // Chama recursivamente para subdiretórios
      } else {
        console.log(`${prefix}📄 ${file}`); // Indica que é um arquivo
      }
    });
  } catch (err) {
    console.error(`Erro ao listar arquivos em ${basePath}: ${err.message}`);
  }
};

console.log('📁 Estrutura de diretórios e arquivos:');