import type { Config } from '../config.js';
import { getYtdlpArgs } from '../config.js';
import { _spawnPromise, executionContext, validateUrl } from './utils.js';
import { getVideoMetadata } from './metadata.js';
import { downloadMedia, type Resolution } from './media.js';

export interface ProfileOptions { limit?: number; offset?: number; scanLimit?: number; dateFrom?: string; dateTo?: string; }
export interface CreatorVideo { id: string; title: string; url: string; uploadDate: string | null; duration: number | null; }
export interface ProfilePage {
  sourceUrl: string; videos: CreatorVideo[]; count: number; scanned: number;
  hasMore: boolean; nextOffset: number | null; dateFrom?: string; dateTo?: string;
  dateBasis: string; warnings: string[];
}
export function validateDateRange(dateFrom?: string, dateTo?: string): void {
  for (const value of [dateFrom, dateTo]) {
    if (value !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) {
      throw new Error('Dates must be real calendar dates in YYYY-MM-DD format');
    }
  }
  if (dateFrom && dateTo && dateFrom > dateTo) throw new Error('dateFrom must be on or before dateTo');
}
export function uploadDate(entry: Record<string, unknown>): string | null {
  const compact = entry.upload_date;
  if (typeof compact === 'string' && /^\d{8}$/.test(compact)) {
    const value = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
    try { validateDateRange(value); return value; } catch { return null; }
  }
  if (typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp)) {
    const date = new Date(entry.timestamp * 1000);
    if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10);
  }
  return null;
}
function sourceUrl(entry: Record<string, unknown>, profileUrl: string): string | null {
  for (const value of [entry.webpage_url, entry.original_url, entry.url]) if (typeof value === 'string' && validateUrl(value)) return value;
  const profile = new URL(profileUrl);
  if (profile.hostname === 'www.tiktok.com' || profile.hostname === 'tiktok.com') {
    const username = profile.pathname.split('/').find(part => part.startsWith('@'));
    if (username && /^\d+$/.test(String(entry.id))) return `https://www.tiktok.com/${username}/video/${entry.id}`;
  }
  if (profile.hostname === 'youtube.com' || profile.hostname.endsWith('.youtube.com')) return `https://www.youtube.com/watch?v=${encodeURIComponent(String(entry.id))}`;
  return null;
}
export async function listCreatorVideos(url: string, config: Config, options: ProfileOptions = {}): Promise<ProfilePage> {
  if (!validateUrl(url)) throw new Error('A valid HTTP(S) profile/channel URL is required');
  validateDateRange(options.dateFrom, options.dateTo);
  const limit = options.limit ?? 10, offset = options.offset ?? 0, scanLimit = options.scanLimit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('limit must be between 1 and 50');
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('offset must be between 0 and 10000');
  if (!Number.isInteger(scanLimit) || scanLimit < 1 || scanLimit > 200) throw new Error('scanLimit must be between 1 and 200');
  const output = await _spawnPromise('yt-dlp', [
    '--flat-playlist', '--lazy-playlist', '--dump-json', '--skip-download',
    '--playlist-start', String(offset + 1), '--playlist-end', String(offset + scanLimit + 1),
    ...getYtdlpArgs(config), '--', url
  ]);
  const entries: Record<string, unknown>[] = output.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  const videos: CreatorVideo[] = [], sourceIndexes: number[] = [], warnings: string[] = [];
  let scanned = 0;
  for (const entry of entries.slice(0, scanLimit)) {
    executionContext.getStore()?.signal?.throwIfAborted();
    const index = offset + scanned++;
    const videoUrl = sourceUrl(entry, url);
    if (!videoUrl) { warnings.push(`Skipped entry ${index}: no usable video URL`); continue; }
    let date = uploadDate(entry);
    if (!date && (options.dateFrom || options.dateTo)) {
      try {
        const metadata = JSON.parse(await getVideoMetadata(videoUrl, ['upload_date', 'timestamp'], config));
        date = uploadDate(metadata);
      } catch (error) {
        executionContext.getStore()?.signal?.throwIfAborted();
        warnings.push(`Could not read upload date for ${String(entry.id)}: ${String(error).slice(0, 200)}`);
      }
      if (!date) { warnings.push(`Skipped ${String(entry.id)}: upload date unavailable`); continue; }
    }
    if (date && ((options.dateFrom && date < options.dateFrom) || (options.dateTo && date > options.dateTo))) continue;
    videos.push({ id: String(entry.id ?? ''), title: String(entry.title ?? 'Untitled').slice(0, 500), url: videoUrl,
      uploadDate: date, duration: typeof entry.duration === 'number' ? entry.duration : null });
    sourceIndexes.push(index);
    if (videos.length === limit) break;
  }
  let hasMore = entries.length > scanned;
  const page: ProfilePage = { sourceUrl: url, videos, count: videos.length, scanned, hasMore,
    nextOffset: hasMore ? offset + scanned : null, dateFrom: options.dateFrom, dateTo: options.dateTo,
    dateBasis: 'Inclusive source upload dates; timestamps converted to UTC dates. Entries with unknown dates are excluded when filtering.', warnings };
  while (JSON.stringify(page).length > config.limits.characterLimit && page.videos.length) {
    page.nextOffset = sourceIndexes.pop()!;
    page.videos.pop();
    page.count = page.videos.length;
    page.hasMore = hasMore = true;
  }
  if (JSON.stringify(page).length > config.limits.characterLimit) throw new Error('Character limit too small for profile results; raise YTDLP_CHARACTER_LIMIT');
  return page;
}
export async function downloadCreatorVideos(url: string, config: Config, options: ProfileOptions & { resolution?: Resolution } = {}) {
  if ((options.limit ?? 10) > 20) throw new Error('Bulk downloads are limited to 20 videos per call; use nextOffset for another batch');
  const page = await listCreatorVideos(url, config, options);
  const results: { id: string; url: string; path?: string; sizeBytes?: number; error?: string }[] = [];
  for (const video of page.videos) {
    executionContext.getStore()?.signal?.throwIfAborted();
    try {
      const file = await downloadMedia(video.url, config, { resolution: options.resolution });
      results.push({ id: video.id, url: video.url, path: file.path, sizeBytes: file.sizeBytes });
    } catch (error) {
      executionContext.getStore()?.signal?.throwIfAborted();
      results.push({ id: video.id, url: video.url, error: String(error).slice(0, 500) });
    }
  }
  return { ...page, results, downloaded: results.filter(item => item.path).length, failed: results.filter(item => item.error).length };
}
