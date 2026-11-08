import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Config } from '../config.js';
import { getYtdlpArgs } from '../config.js';
import { _spawnPromise, validateUrl } from './utils.js';

export type Resolution = '480p' | '720p' | '1080p' | 'best';
export interface MediaFile { path: string; sizeBytes: number; mimeType: string; }
export interface MediaOptions {
  resolution?: Resolution;
  startTime?: string;
  endTime?: string;
  directory?: string;
  audio?: boolean;
  maxBytes?: number;
}

export function formatSelector(resolution: Resolution, preferCombined = false): string {
  // TikTok's separate audio format can be the full music track, without the creator's speech.
  if (preferCombined) {
    if (resolution === 'best') return 'best';
    const height = parseInt(resolution, 10);
    return `best[height<=?${height}]/best[width<=?${height}]`;
  }
  if (resolution === 'best') return 'bestvideo+bestaudio/best';
  const height = parseInt(resolution, 10);
  return `bestvideo[height<=?${height}]+bestaudio/bestvideo[width<=?${height}]+bestaudio/best[height<=?${height}]/best[width<=?${height}]`;
}
export function timestampSeconds(value: string): number {
  if (!/^\d{2,}:\d{2}:\d{2}(\.\d{1,3})?$/.test(value)) throw new Error('Time must be HH:MM:SS[.ms]');
  const [hours, minutes, seconds] = value.split(':').map(Number);
  if (minutes >= 60 || seconds >= 60) throw new Error('Minutes and seconds must be below 60');
  return hours * 3600 + minutes * 60 + seconds;
}
export async function downloadMedia(url: string, config: Config, options: MediaOptions = {}): Promise<MediaFile> {
  if (!validateUrl(url)) throw new Error('A valid HTTP(S) video URL is required');
  if (options.startTime && options.endTime && timestampSeconds(options.endTime) <= timestampSeconds(options.startTime)) {
    throw new Error('endTime must be after startTime');
  }
  if (options.startTime) timestampSeconds(options.startTime);
  if (options.endTime) timestampSeconds(options.endTime);
  const directory = path.resolve(options.directory || config.file.downloadsDir);
  const host = new URL(url).hostname.toLowerCase();
  const tiktok = host === 'tiktok.com' || host.endsWith('.tiktok.com');
  await fs.mkdir(directory, { recursive: true });
  const args = [
    '--no-playlist', '--no-mtime', '--windows-filenames',
    '--trim-filenames', String(config.file.maxFilenameLength),
    '--paths', directory,
    '--output', '%(extractor_key)s-%(id)s - %(title)s.%(ext)s',
    '--format', options.audio ? (tiktok ? 'best' : 'bestaudio/best') : formatSelector(options.resolution || config.download.defaultResolution, tiktok),
    '--print', 'after_move:__YTDLP_FILE__%(filepath)j',
    '--progress', '--newline', '--progress-template', 'download:__YTDLP_PROGRESS__%(progress._percent_str)s',
    ...getYtdlpArgs(config)
  ];
  if (options.audio) args.push('--extract-audio', '--audio-format', config.download.defaultAudioFormat);
  if (options.maxBytes) args.push('--max-filesize', String(options.maxBytes));
  if (options.startTime || options.endTime) {
    args.push('--download-sections', `*${options.startTime || '0'}-${options.endTime || 'inf'}`, '--force-keyframes-at-cuts');
  }
  const output = await _spawnPromise('yt-dlp', [...args, '--', url]);
  const line = output.split(/\r?\n/).findLast(value => value.startsWith('__YTDLP_FILE__'));
  if (!line) throw new Error('yt-dlp did not report a completed file; the source may have exceeded the size limit or contained no video');
  const filename: unknown = JSON.parse(line.slice('__YTDLP_FILE__'.length));
  if (typeof filename !== 'string') throw new Error('yt-dlp returned an invalid filepath');
  const finalPath = await fs.realpath(filename);
  const relative = path.relative(path.toNamespacedPath(await fs.realpath(directory)), path.toNamespacedPath(finalPath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Downloaded file is outside the destination directory: ${finalPath}; expected ${await fs.realpath(directory)}`);
  const stat = await fs.stat(finalPath);
  if (!stat.isFile() || stat.size === 0) throw new Error('Downloaded media file is empty or missing');
  if (options.maxBytes && stat.size > options.maxBytes) {
    await fs.unlink(finalPath);
    throw new Error('Downloaded media exceeded the configured analysis size limit');
  }
  const extension = path.extname(finalPath).toLowerCase();
  const mime: Record<string, string> = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.opus': 'audio/ogg' };
  return { path: finalPath, sizeBytes: stat.size, mimeType: mime[extension] || 'application/octet-stream' };
}
