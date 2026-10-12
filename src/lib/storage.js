import { createReadStream } from 'node:fs';
import path from 'node:path';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { config } from '../config/config.js';

// Cloudflare R2 speaks the S3 API
const s3 = new S3Client({
  region: 'auto',
  endpoint: config.r2.endpoint ?? `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
  // Local S3-compatible servers (e.g. MinIO) need path-style URLs
  forcePathStyle: Boolean(config.r2.endpoint),
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey
  }
});

const contentTypes = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac'
};

export const storage = {
  // Multipart upload streamed from disk, so large videos are never fully in memory
  async uploadFile(key, filePath) {
    const upload = new Upload({
      client: s3,
      params: {
        Bucket: config.r2.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: contentTypes[path.extname(filePath)] ?? 'application/octet-stream'
      }
    });

    await upload.done();
  },

  async getDownloadUrl(key, filename) {
    // Video titles can have accents/emoji: ASCII fallback + RFC 5987 UTF-8 name
    const safeName = filename.replace(/[\\/:*?"<>|\r\n]/g, '_');
    const asciiName = safeName.replace(/[^\x20-\x7E]/g, '_');

    const command = new GetObjectCommand({
      Bucket: config.r2.bucket,
      Key: key,
      ResponseContentDisposition:
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
    });

    return getSignedUrl(s3, command, {
      expiresIn: config.jobs.downloadUrlExpiresSeconds
    });
  }
};
