import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { Config } from '../config.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { _spawnPromise, executionContext, validateUrl } from './utils.js';
import { getVideoMetadata } from './metadata.js';
import { downloadMedia } from './media.js';
import { getTranscriptData, type TranscriptData } from './subtitle.js';

interface CachedVideo { version: 2; path: string; duration: number; metadata: Record<string, unknown>; }
const pending = new Map<string, Promise<CachedVideo>>();
export async function probeVideo(filename: string): Promise<number> {
  const result = JSON.parse(await _spawnPromise('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration:format=duration', '-of', 'json', filename]));
  // Some TikToks carry an audio track much longer than their video.
  const videoDuration = Number(result.streams?.[0]?.duration);
  const duration = videoDuration > 0 ? videoDuration : Number(result.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Media has no finite video duration');
  return duration;
}
export async function prepareVideo(url: string, config: Config): Promise<CachedVideo> {
  if (!validateUrl(url)) throw new Error('A valid HTTP(S) video URL is required');
  const key = createHash('sha256').update(url).digest('hex');
  const directory = path.join(config.analysis.cacheDir, `v2-${key}`);
  const existing = pending.get(directory);
  if (existing) return existing;
  const task = (async () => {
    const manifest = path.join(directory, 'media.json');
    try {
      const stat = await fs.stat(manifest);
      const cached: CachedVideo = JSON.parse(await fs.readFile(manifest, 'utf8'));
      const relative = path.relative(path.toNamespacedPath(await fs.realpath(directory)), path.toNamespacedPath(await fs.realpath(cached.path)));
      const mediaStat = await fs.stat(cached.path);
      if (cached.version === 2 && Date.now() - stat.mtimeMs < 86400000 && relative && !relative.startsWith('..') && !path.isAbsolute(relative)
          && mediaStat.isFile() && mediaStat.size > 0 && mediaStat.size <= config.analysis.maxFileBytes
          && cached.duration > 0 && cached.duration <= config.analysis.maxDurationSeconds) {
        const duration = await probeVideo(cached.path);
        if (duration <= config.analysis.maxDurationSeconds) return { ...cached, duration };
      }
    } catch { /* A missing or incomplete cache entry is downloaded again. */ }
    const metadata = JSON.parse(await getVideoMetadata(url, ['id', 'title', 'duration', 'uploader', 'upload_date', 'webpage_url', 'is_live'], config));
    if (metadata.is_live) throw new Error('Live streams must finish before they can be analyzed');
    if (typeof metadata.duration === 'number' && metadata.duration > config.analysis.maxDurationSeconds) throw new Error('Video exceeds YTDLP_MAX_ANALYSIS_SECONDS');
    await fs.mkdir(directory, { recursive: true });
    const media = await downloadMedia(url, config, { resolution: '720p', directory, maxBytes: config.analysis.maxFileBytes });
    const duration = await probeVideo(media.path);
    if (duration > config.analysis.maxDurationSeconds) throw new Error('Video exceeds YTDLP_MAX_ANALYSIS_SECONDS');
    const cached: CachedVideo = { version: 2, path: media.path, duration, metadata };
    await fs.writeFile(manifest, JSON.stringify(cached));
    return cached;
  })();
  pending.set(directory, task);
  try { return await task; } finally { pending.delete(directory); }
}
export function sampleTimes(duration: number, maxFrames: number, startSeconds = 0, endSeconds = duration): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > 16) throw new Error('Invalid duration or frame count (1-16)');
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds || endSeconds > duration) throw new Error('Frame range must lie inside the video duration');
  return Array.from({ length: maxFrames }, (_, index) => startSeconds + (endSeconds - startSeconds) * (index + 0.5) / maxFrames);
}
export async function extractFrames(filename: string, timestamps: number[], config: Config): Promise<{ timestamp: number; mimeType: 'image/jpeg'; data: string }[]> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), config.file.tempDirPrefix));
  try {
    const frames: { timestamp: number; mimeType: 'image/jpeg'; data: string }[] = [];
    for (let index = 0; index < timestamps.length; index++) {
      const target = path.join(directory, `${index}.jpg`);
      await _spawnPromise('ffmpeg', ['-nostdin', '-v', 'error', '-ss', String(timestamps[index]), '-i', filename,
        '-frames:v', '1', '-vf', 'scale=960:960:force_original_aspect_ratio=decrease:out_range=full', '-pix_fmt', 'yuvj420p', '-q:v', '5', target]);
      const bytes = await fs.readFile(target);
      if (bytes.length > 1048576) throw new Error('Extracted frame exceeds the 1 MiB image limit');
      frames.push({ timestamp: timestamps[index], mimeType: 'image/jpeg', data: bytes.toString('base64') });
    }
    return frames;
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
export async function analyzeVideo(url: string, config: Config, options: { maxFrames?: number; startSeconds?: number; endSeconds?: number; language?: string; includeTranscript?: boolean } = {}): Promise<CallToolResult> {
  const media = await prepareVideo(url, config);
  const start = options.startSeconds ?? 0, end = options.endSeconds ?? media.duration;
  const times = sampleTimes(media.duration, options.maxFrames ?? 8, start, end);
  const frames = await extractFrames(media.path, times, config);
  const warnings: string[] = ['Frames are uniformly sampled; request a narrower time range or a specific frame to inspect brief actions.'];
  let transcript: TranscriptData | null = null;
  if (options.includeTranscript !== false) {
    try {
      transcript = await getTranscriptData(url, options.language || config.download.defaultSubtitleLanguage, config, media.path, media.duration);
      transcript = { ...transcript, segments: transcript.segments.filter(segment => segment.end >= start && segment.start <= end) };
      transcript.text = transcript.segments.map(segment => segment.text).join(' ');
    } catch (error) {
      executionContext.getStore()?.signal?.throwIfAborted();
      warnings.push(String(error).slice(0, 1000));
    }
  }
  const structuredContent = { sourceUrl: url, path: media.path, duration: media.duration, metadata: media.metadata,
    range: { startSeconds: start, endSeconds: end }, transcript,
    frames: frames.map(frame => ({ timestamp: frame.timestamp, mimeType: frame.mimeType })), warnings };
  while (JSON.stringify(structuredContent).length > config.limits.characterLimit && transcript?.segments.length) {
    transcript.segments.pop();
    transcript.text = transcript.segments.map(segment => segment.text).join(' ');
    transcript.truncated = true;
  }
  if (JSON.stringify(structuredContent).length > config.limits.characterLimit) throw new Error('Character limit is too small for video analysis metadata');
  return { structuredContent, content: [
    { type: 'text', text: JSON.stringify(structuredContent) },
    ...frames.flatMap(frame => [
      { type: 'text' as const, text: `Frame at ${frame.timestamp.toFixed(3)} seconds` },
      { type: 'image' as const, data: frame.data, mimeType: frame.mimeType }
    ])
  ] };
}
export async function getFrame(url: string, timestamp: number, config: Config): Promise<CallToolResult> {
  const media = await prepareVideo(url, config);
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp >= media.duration) throw new Error('Timestamp must be inside the video duration');
  const [frame] = await extractFrames(media.path, [timestamp], config);
  const structuredContent = { sourceUrl: url, timestamp, duration: media.duration, path: media.path };
  return { structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }, { type: 'image', data: frame.data, mimeType: frame.mimeType }] };
}
export async function diagnostics() {
  const results: Record<string, { available: boolean; detail: string }> = {};
  for (const [name, args] of [['yt-dlp', ['--version']], ['ffmpeg', ['-version']], ['ffprobe', ['-version']], ['deno', ['--version']], ['whisper', ['--help']]] as const) {
    try { results[name] = { available: true, detail: (await _spawnPromise(name, [...args], { timeoutMs: 15000 })).split(/\r?\n/)[0] }; }
    catch (error) { results[name] = { available: false, detail: String(error).slice(0, 500) }; }
  }
  return { node: process.version, tools: results, notes: ['Whisper is optional; missing captions can still be analyzed visually.', 'The server enables its Node executable for yt-dlp JavaScript challenges; Deno is optional.'] };
}
