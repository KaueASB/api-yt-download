export function parseFormats(output) {
  const lines = output.split('\n');
  const formats = [];

  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;

    // Try to parse format line by checking if it starts with a format ID
    // Format IDs are numbers or combinations of numbers+letters (like 251, 140, etc)
    const formatMatch = line.match(/^([0-9a-z]+)\s+/i);

    if (formatMatch) {
      // Skip storyboard formats
      if (formatMatch[1].startsWith('sb')) continue;

      // Get the format ID from the match
      const id = formatMatch[1];
      if (id === "ID") continue

      // Remove the ID from the start of the line and split the remaining content
      const remainingLine = line.slice(id.length).trim();

      // Extract extension (it's always the first part after ID)
      const [ext, ...restParts] = remainingLine.split(/\s+/);

      // Join the rest back together to handle "audio only" as a single unit
      const rest = restParts.join(' ');

      // Try to find filesize first - if not found, skip this format
      const filesizeMatch = rest.match(/(\d+(\.\d+)?)(Ki|Mi|Gi)?B/);
      if (!filesizeMatch) continue; // Skip formats without filesize

      // Extract resolution and fps
      let resolution = 'N/A';
      let fps = null;

      // Check for audio only format
      if (rest.toLowerCase().includes('audio only')) {
        resolution = 'audio only';
      } else {
        // Try to find resolution pattern (e.g., 1920x1080, 1280x720)
        const resMatch = rest.match(/(\d+x\d+)\s+(\d+)/);
        if (resMatch) {
          resolution = resMatch[1];
          fps = parseInt(resMatch[2]); // FPS é o número que vem logo após a resolução
        }
      }

      // Build format object with only the requested information
      const format = {
        code: id,
        extension: ext,
        resolution,
        ...(fps !== null && { fps }), // Only include fps if it exists
        filesize: filesizeMatch[0]
      };

      formats.push(format);
    }
  }

  return formats;
} 