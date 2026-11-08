# yt-dlp MCP: video context for agents

Download videos, inspect timestamped frames, read captions or local speech transcripts, and work through creator profiles from an MCP-compatible agent.

Maintained fork of [kevinwatt/yt-dlp-mcp](https://github.com/kevinwatt/yt-dlp-mcp). MIT licensed; original attribution is retained in LICENSE and package.json.

## Install from this repository

Requirements:

- Node.js 22.12 or newer.
- A recent `yt-dlp` on PATH.
- `ffmpeg` and `ffprobe` for merging, clipping, audio extraction and video frames.
- This server enables its Node executable for YouTube's JavaScript challenges. Deno is another supported option.
- Optional: the local `whisper` CLI for videos without usable captions.

On Windows, the system programs can be installed with:

```powershell
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
winget install DenoLand.Deno
```

Then clone and build:

```sh
git clone https://github.com/Wesleyvdk/yt-dlp-mcp.git
cd yt-dlp-mcp
npm ci
npm run build
```

The fork's package name is `@wesleyvdk/yt-dlp-mcp`. These instructions run your checkout; they do not assume that the package has been published to npm.

## Connect an agent

Use `node` as the MCP command and the **absolute path** to `lib/index.mjs` as its argument. For clients using `mcpServers` JSON:

```json
{
  "mcpServers": {
    "yt-dlp": {
      "command": "node",
      "args": ["C:/path/to/yt-dlp-mcp/lib/index.mjs"],
      "env": {
        "YTDLP_DOWNLOADS_DIR": "C:/path/to/downloads",
        "YTDLP_TIMEOUT_MS": "300000"
      }
    }
  }
}
```

Map that command, argument and environment to your client's MCP settings. Set its tool-call timeout to at least the server timeout; profile scans and CPU transcription can take minutes. The server uses stdio. Start a fresh agent session after changing its configuration.

Call `ytdlp_diagnostics` to check the local tools. A vision-capable model/client is needed to interpret the returned images. The server extracts evidence; the agent performs the visual reasoning.

## Video inspection

Ask your agent to inspect a TikTok/YouTube URL and explain what happens. It can call:

| Tool | Parameters | Result |
|---|---|---|
| `ytdlp_analyze_video` | `url`, optional `maxFrames` (1–16, default 8), `startSeconds`, `endSeconds`, `language`, `includeTranscript` | Timestamped JPEG image content, metadata, caption/Whisper segments and warnings |
| `ytdlp_get_frame` | `url`, `timestamp` in seconds | One JPEG image at the requested moment |
| `ytdlp_diagnostics` | None | Availability of yt-dlp, FFmpeg, ffprobe, Deno and optional Whisper |

Frames are sampled uniformly within the requested range. Brief actions can fall between samples: ask for a narrower range or a specific frame. Cached media is reused for 24 hours. Defaults limit analysis to two hours and 256 MiB per video; frames fit inside 960 × 960 pixels.

The agent receives actual MCP image blocks, not just image file paths. Missing transcription does not discard the frames: analysis returns images with a warning.

For local speech recognition:

```sh
python -m pip install openai-whisper
```

Ensure `whisper` is on the PATH inherited by the agent, or set `YTDLP_WHISPER_BINARY` to its executable. The default is the `base` model on CPU. Whisper downloads its model weights on first use into `whisper-models` inside `YTDLP_CACHE_DIR`; an offline machine needs those weights cached first. No speech API key is used.

## Creator profiles and between-date filters

Both tools accept TikTok creator URLs, YouTube channels/videos tabs and other playlists supported by yt-dlp:

- `ytdlp_list_creator_videos`: discover a bounded page without downloading media.
- `ytdlp_download_creator_videos`: discover and download that page, returning completed paths and per-video failures.

Example arguments:

```json
{
  "url": "https://www.tiktok.com/@creator",
  "dateFrom": "2026-10-01",
  "dateTo": "2026-10-31",
  "limit": 10,
  "scanLimit": 50,
  "offset": 0
}
```

The download tool also accepts `resolution`: `480p`, `720p`, `1080p` or `best`.
Resolution selection supports portrait videos by considering their width as well as landscape video height.

- Date boundaries are **inclusive**. Source upload dates are used; Unix timestamps are converted to UTC calendar dates.
- `limit` counts matching videos: up to 50 for listing, 20 for downloads.
- `scanLimit` bounds inspected source entries: default 50, maximum 200 per call.
- `offset` is a raw source position, not a position in the filtered matches. Pass the returned `nextOffset` to continue.
- Continue while `hasMore` is true. A page can contain no matches and still have more source entries to scan.
- Missing dates are resolved from individual video metadata. Entries whose dates remain unknown are excluded when filtering, with warnings.
- The server does not assume chronological ordering; pinned posts can appear first.
- Each download failure is reported separately and completed files are preserved.

TikTok profile discovery can fail even when an individual video works. Cookies, extractor updates and platform restrictions affect what yt-dlp can access. Listing is a bounded scan, not a guarantee that the entire account has been searched. Source ordering can change between requests.

## Existing tools

The existing tool names and inputs remain available:

`ytdlp_search_videos`, `ytdlp_list_subtitle_languages`, `ytdlp_download_video_subtitles`, `ytdlp_download_transcript`, `ytdlp_download_video`, `ytdlp_download_audio`, `ytdlp_get_video_metadata`, `ytdlp_get_video_metadata_summary`, `ytdlp_get_video_comments`, `ytdlp_get_video_comments_summary`.

Single-video operations disable playlist expansion. Downloads return structured absolute paths, file sizes and media types. Transcripts retain their plain-text interface; the analysis tool supplies timestamped segments. Search's `total` is unknown (`null`), and its next offset is determined by looking ahead one result.

## Configuration

| Variable | Default / purpose |
|---|---|
| `YTDLP_DOWNLOADS_DIR` | `~/Downloads`; created if missing |
| `YTDLP_CACHE_DIR` | `yt-dlp-mcp-cache` under the OS temporary directory |
| `YTDLP_DEFAULT_RESOLUTION` | `720p` |
| `YTDLP_DEFAULT_AUDIO_FORMAT` | `m4a` |
| `YTDLP_DEFAULT_SUBTITLE_LANG` | `en` |
| `YTDLP_CHARACTER_LIMIT` | `25000`; text/metadata budget |
| `YTDLP_MAX_TRANSCRIPT_LENGTH` | `50000` characters |
| `YTDLP_TIMEOUT_MS` | `300000` per subprocess |
| `YTDLP_MAX_OUTPUT_BYTES` | `16777216` buffered stdout bytes; stderr keeps a bounded tail |
| `YTDLP_MAX_ANALYSIS_SECONDS` | `7200` |
| `YTDLP_MAX_ANALYSIS_BYTES` | `268435456` |
| `YTDLP_WHISPER_MODEL` | `base` |
| `YTDLP_BINARY`, `YTDLP_FFMPEG_BINARY`, `YTDLP_FFPROBE_BINARY`, `YTDLP_WHISPER_BINARY` | Optional absolute executable paths |
| `YTDLP_COOKIES_FROM_BROWSER` | Browser/profile, for example `firefox` or `chrome:Profile 1` |
| `YTDLP_COOKIES_FILE` | Netscape cookie file; takes precedence over browser extraction |

Cookie access remains local. Browser encryption/locking on Windows can prevent extraction. See [cookie configuration](docs/cookies.md). Keep a recent yt-dlp because platform extractors change frequently.

Processes are cancelled when the client cancels a request, and timed-out process trees are terminated. Clients that request progress notifications receive progress messages. Certificate verification stays enabled and user yt-dlp configuration is ignored for predictable tool behavior.

## Development and verification

```sh
npm ci
npm run build
npm test
npm run test:smoke
```

Default tests use fixtures and exercise regressions, date filtering, pagination, partial failures, transcription fallback, timeouts and cancellation. `test:smoke` additionally requires yt-dlp/FFmpeg/ffprobe: it creates a synthetic video, serves it over localhost, starts the MCP server and checks real downloads and image results. It does not depend on a public video platform.

`npm run test:integration` opts into the older live-platform tests. Public videos, captions, authentication and network availability make those checks environment-dependent. Windows/Linux CI runs the build and offline unit suite.
