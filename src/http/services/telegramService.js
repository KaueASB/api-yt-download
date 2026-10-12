import crypto from 'node:crypto';
import { stat } from 'node:fs/promises';

import { config } from '../../config/config.js';
import { redis } from '../../lib/redis.js';
import { storage } from '../../lib/storage.js';
import { telegram } from '../../lib/telegram.js';
import { buildQualityOptions, formatSize } from '../../utils/qualityOptions.js';
import { downloadService } from './downloadService.js';

const URL_PATTERN = /https?:\/\/\S+/i;

const HELP_TEXT = 'Me mande o link de um vídeo (YouTube ou qualquer site que o yt-dlp suporte) que eu baixo pra você.';

// callback_data is limited to 64 bytes, so buttons carry a short session id and the
// URL + options stay in Redis
const sessionKey = (sessionId) => `tg:session:${sessionId}`;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function truncate(text, max = 500) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function progressBar(progress) {
  const filled = Math.round(progress / 10);
  return `${'▓'.repeat(filled)}${'░'.repeat(10 - filled)} ${Math.floor(progress)}%`;
}

// Keeps the thumbnail above the text on every edit (an edit without it drops the preview)
function previewOptions(thumbnail) {
  return thumbnail
    ? { url: thumbnail, prefer_large_media: true, show_above_text: true }
    : { is_disabled: true };
}

class TelegramService {
  isAllowed(userId) {
    return config.telegram.allowedUserIds.includes(String(userId));
  }

  async handleUpdate(update) {
    if (update.message) return this.handleMessage(update.message);
    if (update.callback_query) return this.handleCallback(update.callback_query);
  }

  // A link → the video title and one button per quality
  async handleMessage(message) {
    const chatId = message.chat.id;
    const text = message.text ?? message.caption ?? '';

    if (!this.isAllowed(message.from?.id)) {
      // Only /start gets an answer, so the owner can find the id for TELEGRAM_ALLOWED_USER_IDS
      if (text.startsWith('/start')) {
        await telegram.sendMessage(
          chatId,
          `Acesso não autorizado. Seu ID do Telegram é <code>${message.from?.id}</code>.`
        );
      }

      return;
    }

    const url = text.match(URL_PATTERN)?.[0];

    if (!url) {
      await telegram.sendMessage(chatId, HELP_TEXT);
      return;
    }

    const status = await telegram.sendMessage(chatId, '🔎 Buscando formatos…', {
      reply_parameters: { message_id: message.message_id }
    });

    try {
      const info = await downloadService.getVideoInfo(url);
      const options = buildQualityOptions(info);

      if (options.length === 0) {
        await telegram.editMessageText(chatId, status.message_id, '❌ Nenhum formato disponível para esse link.');
        return;
      }

      const sessionId = crypto.randomBytes(6).toString('base64url');
      const session = {
        url,
        title: info.title ?? 'Vídeo',
        // Same fallbacks as the ID3 tags written by yt-dlp (see MP3_ARGS in downloadService)
        track: info.track ?? info.title ?? 'Vídeo',
        artist: (info.artist ?? info.creator ?? info.channel ?? info.uploader ?? '')
          .replace(/ - Topic$/, '') || null,
        duration: info.duration ? Math.round(info.duration) : null,
        thumbnail: info.thumbnail ?? null,
        options
      };

      await redis.set(sessionKey(sessionId), session, { ex: config.telegram.sessionTtlSeconds });

      await telegram.editMessageText(
        chatId,
        status.message_id,
        `<b>${escapeHtml(session.title)}</b>\n\nEscolha a qualidade (🔗 = maior que 50 MB, chega como link):`,
        {
          reply_markup: { inline_keyboard: this.buildKeyboard(sessionId, options) },
          link_preview_options: previewOptions(session.thumbnail)
        }
      );
    } catch (error) {
      console.error('[BOT] could not get formats:', error.message);

      await telegram.editMessageText(
        chatId,
        status.message_id,
        `❌ Não consegui ler esse link.\n<code>${escapeHtml(truncate(error.message))}</code>`
      );
    }
  }

  buildKeyboard(sessionId, options) {
    const buttons = options.map((option, index) => {
      const tooBig = option.bytes && option.bytes > config.telegram.maxUploadBytes;
      const icon = option.kind === 'audio' ? '🎵 ' : '';

      return {
        text: `${icon}${option.label} · ${option.bytes ? '' : '~'}${formatSize(option.bytes)}${tooBig ? ' 🔗' : ''}`,
        callback_data: `dl:${sessionId}:${index}`
      };
    });

    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
      rows.push(buttons.slice(i, i + 2));
    }

    return rows;
  }

  // A quality button → download job, with progress edited into the same message
  async handleCallback(query) {
    const [action, sessionId, index] = (query.data ?? '').split(':');

    if (!this.isAllowed(query.from.id) || action !== 'dl' || !query.message) {
      await telegram.call('answerCallbackQuery', { callback_query_id: query.id });
      return;
    }

    // GETDEL: one tap = one job, even if the button is double-tapped
    const session = await redis.getdel(sessionKey(sessionId));
    const option = session?.options[Number(index)];

    if (!option) {
      await telegram.call('answerCallbackQuery', {
        callback_query_id: query.id,
        text: 'Essa escolha expirou. Mande o link de novo.',
        show_alert: true
      });
      return;
    }

    await telegram.call('answerCallbackQuery', { callback_query_id: query.id });

    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const header = `<b>${escapeHtml(session.title)}</b> · ${option.label}`;

    const edit = (line, extra = {}) =>
      telegram.editMessageText(chatId, messageId, `${header}\n\n${line}`, {
        link_preview_options: previewOptions(session.thumbnail),
        ...extra
      });

    // Edits run one after another so a slow request can't overwrite a newer status
    let edits = Promise.resolve();
    const queue = (task) => {
      edits = edits
        .then(task)
        .catch((error) => console.warn('[BOT] could not edit message:', error.message));

      return edits;
    };
    const show = (line, extra) => queue(() => edit(line, extra));

    const showError = (error) =>
      show(`❌ Falhou.\n<code>${escapeHtml(truncate(error.message))}</code>`);

    show('⏳ Preparando…');

    try {
      await downloadService.downloadWithFormatCode(session.url, option.code, {
        onUpdate: ({ status, progress }) =>
          show(status === 'uploading' ? '☁️ Salvando…' : `⏳ Baixando\n${progressBar(progress)}`),
        onDone: (result) => this.deliver({ chatId, messageId, session, option, edit, queue, show }, result),
        onError: showError
      });
    } catch (error) {
      // Fails before the job starts (e.g. the format disappeared)
      await showError(error);
    }
  }

  // Up to 50 MB the file goes straight into the chat; bigger (or a failed upload) gets the R2 link
  async deliver({ chatId, messageId, session, option, edit, queue, show }, { filePath, key, filename }) {
    const { size } = await stat(filePath);

    if (size <= config.telegram.maxUploadBytes) {
      await show(`📤 Enviando para o Telegram… (${formatSize(size)})`);

      try {
        await this.sendFile(chatId, session, option, filePath, filename);
        await telegram.call('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {});
        return;
      } catch (error) {
        console.warn('[BOT] upload to Telegram failed, sending the link instead:', error.message);
      }
    }

    const url = await storage.getDownloadUrl(key, filename);
    const hours = Math.round(config.jobs.downloadUrlExpiresSeconds / 3600);
    const line = `✅ Pronto (${formatSize(size)}). O link vale por ${hours}h.`;

    // Telegram rejects non-public URLs in buttons (e.g. a local S3 server), so fall back to a text link
    await queue(() =>
      edit(line, { reply_markup: { inline_keyboard: [[{ text: '⬇️ Baixar', url }]] } })
        .catch(() => edit(`${line}\n\n<a href="${escapeHtml(url)}">⬇️ Baixar</a>`))
    );
  }

  sendFile(chatId, session, option, filePath, filename) {
    const common = {
      chat_id: chatId,
      caption: `<b>${escapeHtml(session.title)}</b>`,
      parse_mode: 'HTML',
      duration: session.duration
    };

    if (option.kind === 'audio') {
      return telegram.upload('sendAudio', {
        ...common,
        title: session.track,
        performer: session.artist
      }, 'audio', filePath, filename);
    }

    return telegram.upload('sendVideo', {
      ...common,
      width: option.width,
      height: option.height,
      supports_streaming: true
    }, 'video', filePath, filename);
  }
}

export const telegramService = new TelegramService();
