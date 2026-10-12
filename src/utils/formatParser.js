// Same units/precision yt-dlp uses in its `-F` table (e.g. "5.16MiB")
function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(2)}${units[unit]}`;
}

// Turns the `yt-dlp -J` info JSON into the list sent to the frontend
export function parseFormats(info) {
  const formats = [];

  for (const format of info.formats ?? []) {
    const isAudioOnly = format.vcodec === 'none' && format.acodec !== 'none';
    const isVideo = format.vcodec && format.vcodec !== 'none';

    // Skip storyboards (images) and anything without audio or video
    if (!isAudioOnly && !isVideo) continue;

    // Skip DRC (dynamic range compressed) audio duplicates
    if (format.format_id.endsWith('-drc')) continue;

    // Skip formats without a known size (mostly m3u8/HLS streams)
    const filesize = format.filesize ?? format.filesize_approx;
    if (!filesize) continue;

    formats.push({
      code: format.format_id,
      extension: format.ext,
      resolution: isAudioOnly ? 'audio only' : (format.resolution ?? 'N/A'),
      ...(isVideo && format.fps && { fps: Math.round(format.fps) }),
      filesize: formatBytes(filesize)
    });
  }

  return formats;
}
