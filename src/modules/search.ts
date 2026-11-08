import { _spawnPromise } from './utils.js';
import type { Config } from '../config.js';
import { getYtdlpArgs } from '../config.js';

export type UploadDateFilter = 'hour' | 'today' | 'week' | 'month' | 'year';
export interface SearchResult { title: string; id: string; url: string; uploader?: string; duration?: string; }
const filters: Record<UploadDateFilter, string> = { hour: 'EgIIAQ%3D%3D', today: 'EgIIAg%3D%3D', week: 'EgIIAw%3D%3D', month: 'EgIIBA%3D%3D', year: 'EgIIBQ%3D%3D' };

export async function searchVideos(query: string, maxResults = 10, offset = 0, responseFormat: 'json' | 'markdown' = 'markdown', config: Config, uploadDateFilter?: UploadDateFilter): Promise<string> {
  if (!query.trim()) throw new Error('Search query cannot be empty');
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 50) throw new Error('Number of results must be between 1 and 50');
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('Offset must be between 0 and 10000');
  const count = offset + maxResults + 1;
  const source = uploadDateFilter
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}&sp=${filters[uploadDateFilter]}`
    : `ytsearch${count}:${query.trim()}`;
  const output = await _spawnPromise('yt-dlp', [
    '--flat-playlist', '--dump-json', '--skip-download',
    '--playlist-start', String(offset + 1), '--playlist-end', String(count),
    ...getYtdlpArgs(config), '--', source
  ]);
  const entries = output.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  let videos: SearchResult[] = entries.slice(0, maxResults).map(item => ({
    id: String(item.id), title: String(item.title || 'Untitled'),
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(item.id)}`,
    uploader: item.uploader || item.channel || 'Unknown', duration: String(item.duration ?? 'Unknown')
  }));
  if (!videos.length) return responseFormat === 'json' ? JSON.stringify({ count: 0, offset, videos: [], has_more: false }) : 'No videos found';
  while (videos.length) {
    const hasMore = entries.length > videos.length;
    const result = { total: null, count: videos.length, offset, videos, has_more: hasMore,
      ...(hasMore ? { next_offset: offset + videos.length } : {}),
      ...(uploadDateFilter ? { upload_date_filter: uploadDateFilter } : {}) };
    const text = responseFormat === 'json' ? JSON.stringify(result, null, 2) :
      `Found ${videos.length} videos (showing ${videos.length}):\n\n` + videos.map((video, index) =>
        `${offset + index + 1}. **${video.title}**\n   📺 Channel: ${video.uploader}\n   ⏱️  Duration: ${video.duration}\n   🔗 URL: ${video.url}\n   🆔 ID: ${video.id}`).join('\n\n') +
      (hasMore ? `\n\nMore results available; next offset: ${offset + videos.length}` : '') + '\n\n💡 You can use any URL to download videos, audio, or subtitles!';
    if (text.length <= config.limits.characterLimit) return text;
    videos = videos.slice(0, -1);
  }
  throw new Error('Character limit is too small for one search result');
}
export async function searchByPlatform(query: string, platform = 'youtube', maxResults = 10, offset = 0, responseFormat: 'json' | 'markdown' = 'markdown', config: Config): Promise<string> {
  if (platform.toLowerCase() !== 'youtube') throw new Error(`Currently only supports YouTube search, ${platform} is not supported yet`);
  return searchVideos(query, maxResults, offset, responseFormat, config);
}
