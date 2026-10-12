import { parseFormats } from './formatParser.js';

const isVideo = (format) => format.vcodec && format.vcodec !== 'none';
const isAudioOnly = (format) => !isVideo(format) && format.acodec && format.acodec !== 'none';
const isH264 = (format) => /^(avc[13]|h264)/i.test(format.vcodec);
const audioBitrate = (format) => format.abr ?? format.tbr ?? 0;

function sizeOf(format, duration) {
  const size = format.filesize ?? format.filesize_approx;
  if (size) return size;

  // HLS/DASH manifests don't report a size; estimate it from bitrate (kbit/s) × duration
  return format.tbr && duration ? (format.tbr * 1000 / 8) * duration : null;
}

// Same resolution: h264 first (plays everywhere, including Telegram on iOS), then higher fps, then bigger
function isBetter(candidate, current, duration) {
  if (isH264(candidate) !== isH264(current)) return isH264(candidate);
  if ((candidate.fps ?? 0) !== (current.fps ?? 0)) return (candidate.fps ?? 0) > (current.fps ?? 0);
  return (sizeOf(candidate, duration) ?? 0) > (sizeOf(current, duration) ?? 0);
}

export function formatSize(bytes) {
  if (!bytes) return '?';

  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

// One option per resolution (best format of each) plus MP3, for the bot's buttons.
// `bytes` is the expected final size: video + the audio track that gets merged into it
export function buildQualityOptions(info) {
  const available = new Set(parseFormats(info).map((format) => format.code));
  const formats = (info.formats ?? []).filter((format) => available.has(format.format_id));
  const audio = formats.filter(isAudioOnly).sort((a, b) => audioBitrate(b) - audioBitrate(a));

  // Mirrors the merge selector in downloadWithFormatCode: bestaudio[ext=m4a], else bestaudio
  const mergeAudio = audio.find((format) => format.ext === 'm4a') ?? audio[0];
  const mergeAudioSize = mergeAudio ? sizeOf(mergeAudio, info.duration) ?? 0 : 0;

  const byHeight = new Map();

  for (const format of formats.filter(isVideo)) {
    if (!format.height) continue;

    const current = byHeight.get(format.height);
    if (!current || isBetter(format, current, info.duration)) {
      byHeight.set(format.height, format);
    }
  }

  const options = [...byHeight.values()]
    .sort((a, b) => b.height - a.height)
    .map((format) => {
      const size = sizeOf(format, info.duration);
      const hasAudio = format.acodec && format.acodec !== 'none';

      return {
        code: format.format_id,
        kind: 'video',
        label: `${format.height}p${format.fps > 30 ? Math.round(format.fps) : ''}`,
        bytes: size ? size + (hasAudio ? 0 : mergeAudioSize) : null,
        width: format.width ?? null,
        height: format.height
      };
    });

  // Highest-bitrate source gives the best MP3; the real size depends on the mp3 encode
  if (audio[0]) {
    options.push({
      code: audio[0].format_id,
      kind: 'audio',
      label: 'MP3',
      bytes: sizeOf(audio[0], info.duration)
    });
  }

  return options;
}
