# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Express API (ESM, plain JavaScript) that wraps the `yt-dlp` CLI to list formats and download videos/audio. It is the backend for the Next.js frontend in `../web`. It is deployed to Vercel's container runtime via `Dockerfile.vercel`. `fluxo.md` (Portuguese) walks through the full request flow step by step.

## Commands

Package manager is pnpm (`pnpm-lock.yaml`).

```bash
pnpm install
pnpm dev     # node --watch with .env loaded
pnpm start   # production entry: node src/server.js
```

There are no tests, linter, or build step.

Runtime requirements: `yt-dlp` must be on `PATH` (no self-install logic), and `ffmpeg` for merging video+audio and mp3 extraction. `Dockerfile.vercel` installs both on `node:24-slim`.

Required env vars are listed in `.env.example` (Upstash Redis + Cloudflare R2). `config.js` throws at startup if any is missing. To run locally without real accounts, use any S3-compatible server via `R2_ENDPOINT` (Adobe S3Mock works; the `minio/minio` Docker Hub image is gone) and `hiett/serverless-redis-http` in front of a Redis container to emulate Upstash's REST API.

## Architecture

`src/server.js` → `http/routes/downloadRoutes.js` (mounted under `/api`) → `http/controllers/downloadController.js` (query-param validation, HTTP status codes) → `http/services/downloadService.js` (spawns `yt-dlp`, runs jobs). Shared clients live in `src/lib/`: `jobStore.js` (Upstash Redis) and `storage.js` (R2 via the S3 SDK). All endpoints are `GET` with query params. `/health` is outside `/api`.

The API is stateless so any Vercel instance can serve any request. Job state is in Redis and files are in R2; nothing is kept in process memory.

Job-based download flow:
1. `GET /api/formats?url=` runs `yt-dlp -J --no-playlist`. The response is `{ title, thumbnail, formats }`, and `utils/formatParser.js` maps the yt-dlp JSON to `{ code, extension, resolution, fps?, filesize, vcodec?, acodec?, abr? }`. The frontend depends on this shape.
   - Codecs are normalized (`avc1.*` → `h264`, `mp4a.*` → `aac`, …).
   - `abr` (kbps) is set only on audio-only formats, `vcodec` only on video, and `acodec` only on formats that carry audio.
   - The parser skips storyboards and `-drc` audio duplicates. Formats without a size are dropped too, unless the source has no sized formats at all (HLS); then they're kept with a `~` size estimated from bitrate × duration.
2. `GET /api/download-with-code?url=&code=` validates the code against the formats, writes a `job:<uuid>` hash to Redis (24h TTL), and returns `{ jobId }`. The job runs in the background, wrapped in `waitUntil` from `@vercel/functions` (a no-op outside Vercel). Audio-only codes become mp3 (`-x`); video codes use `<code>+bestaudio/best` merged to mp4. `GET /api/download?url=&format=` is an older path that takes an extension from `config.supportedFormats`.
3. Job lifecycle (`status`): `downloading` → `uploading` → `done`, or `error`.
   - Progress is scraped from yt-dlp stdout. It is capped at 99 until the R2 upload finishes, and Redis writes are throttled (`config.jobs.progressWriteIntervalMs`) to stay within Upstash's free tier.
   - `GET /api/progress?jobId=` returns `{ progress, status }`, a 404 for unknown jobs, or a 500 `{ progress: -1, error }` with the yt-dlp `ERROR:` lines for failed jobs.
4. `GET /api/file?jobId=` returns a 409 until the job is `done`, then 302-redirects to a presigned R2 URL that sets `Content-Disposition` to the video title. The frontend opens it in a hidden iframe, so no bucket CORS is needed.

Key points:
- Local files exist only during a job, in `os.tmpdir()/downloads`. They are named `<jobId>.*` and deleted (including leftovers) when the job ends. The final path comes from yt-dlp's `--print after_move:FILEPATH:%(filepath)s`, because yt-dlp can change the extension.
- Nothing deletes R2 objects in code. The bucket needs a lifecycle rule (prefix `downloads/`, 1 day).
- Vercel limits apply to the whole job: max duration is 300s on Hobby and 800s on Pro. Responses over 4.5 MB fail, which is why files are served from R2. The container listens on `PORT`, and Vercel defaults it to 80.
- Cookies are opt-in (`YTDLP_USE_COOKIES=true`). Expired or rotated cookies make YouTube return 403 on larger formats, while no cookies works locally.
  - The source is `YTDLP_COOKIES_BASE64` (used on Vercel) or else `src/cookies.txt`. The file is resolved from `process.cwd()` and is git- and docker-ignored because it holds a live YouTube session. `config.js` fails at startup if the chosen source is missing or doesn't decode to a Netscape cookie file.
  - yt-dlp rewrites any cookie file it is given, so each run writes its own `<id>.cookies.txt` in the temp dir. Never pass `config.cookiesPath` to yt-dlp directly.
  - Throttling and retry flags come from `config.downloadOptions`.
