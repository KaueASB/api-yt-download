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

// HLS/DASH manifests don't report a size; estimate it from bitrate (kbit/s) × duration
function estimateBytes(format, duration) {
  if (!format.tbr || !duration) return null;

  return (format.tbr * 1000 / 8) * duration;
}

// Turns the `yt-dlp -J` info JSON into the list sent to the frontend
export function parseFormats(info) {
  const candidates = [];

  for (const format of info.formats ?? []) {
    const isAudioOnly = format.vcodec === 'none' && format.acodec !== 'none';
    const isVideo = format.vcodec && format.vcodec !== 'none';

    // Skip storyboards (images) and anything without audio or video
    if (!isAudioOnly && !isVideo) continue;

    // Skip DRC (dynamic range compressed) audio duplicates
    if (format.format_id.endsWith('-drc')) continue;

    const filesize = format.filesize ?? format.filesize_approx;
    const estimated = filesize ? null : estimateBytes(format, info.duration);

    candidates.push({
      hasSize: Boolean(filesize),
      format: {
        code: format.format_id,
        extension: format.ext,
        resolution: isAudioOnly ? 'audio only' : (format.resolution ?? 'N/A'),
        ...(isVideo && format.fps && { fps: Math.round(format.fps) }),
        // "~" marks an estimate, same convention as yt-dlp's -F table
        filesize: filesize
          ? formatBytes(filesize)
          : estimated ? `~${formatBytes(estimated)}` : 'N/A'
      }
    });
  }

  // Sites like YouTube list sized https formats plus unsized HLS duplicates: keep only the sized ones.
  // Pure HLS sources (.m3u8 links) have no sized formats at all, so keep everything.
  const sized = candidates.filter((candidate) => candidate.hasSize);
  const selected = sized.length > 0 ? sized : candidates;

  return selected.map((candidate) => candidate.format);
}
