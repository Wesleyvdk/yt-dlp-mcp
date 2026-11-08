// @ts-nocheck
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { CONFIG, loadConfig } from '../config.js';

const actualUtils = await import('../modules/utils.js');
const run = jest.fn();
jest.unstable_mockModule('../modules/utils.js', () => ({ ...actualUtils, _spawnPromise: run }));
const { downloadMedia, formatSelector, timestampSeconds } = await import('../modules/media.js');
const { getVideoMetadata } = await import('../modules/metadata.js');
const { searchVideos } = await import('../modules/search.js');
const { listCreatorVideos, downloadCreatorVideos, validateDateRange } = await import('../modules/profile.js');
const { getTranscriptData, parseSrt } = await import('../modules/subtitle.js');
const { sampleTimes, probeVideo } = await import('../modules/analysis.js');
let directory, config;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ytdlp-unit-'));
  config = { ...CONFIG, file: { ...CONFIG.file, downloadsDir: directory }, analysis: { ...CONFIG.analysis, cacheDir: directory } };
  run.mockReset();
  run.mockImplementation(async () => { throw new Error('Unexpected subprocess'); });
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

describe('configuration and validation', () => {
  test('loads advertised environment limits and rejects invalid numbers', () => {
    const saved = { ...process.env };
    try {
      process.env.YTDLP_CHARACTER_LIMIT = '321'; process.env.YTDLP_MAX_TRANSCRIPT_LENGTH = '654';
      expect(loadConfig().limits).toEqual({ characterLimit: 321, maxTranscriptLength: 654 });
      process.env.YTDLP_TIMEOUT_MS = 'NaN';
      expect(() => loadConfig()).toThrow('positive integer');
    } finally { process.env = saved; }
  });
  test('only accepts HTTP(S) and exact YouTube domains', () => {
    expect(actualUtils.validateUrl('ftp://example.org/file')).toBe(false);
    expect(actualUtils.validateUrl('https://user:password@example.org')).toBe(false);
    expect(actualUtils.isYouTubeUrl('https://youtube.com.evil.org')).toBe(false);
    expect(actualUtils.isYouTubeUrl('https://www.youtube.com/watch?v=x')).toBe(true);
  });
  test('validates calendar dates and time ranges', () => {
    expect(() => validateDateRange('2026-02-30')).toThrow();
    expect(() => validateDateRange('2026-05-02', '2026-05-01')).toThrow();
    expect(() => timestampSeconds('00:61:00')).toThrow();
    expect(timestampSeconds('00:01:30.5')).toBe(90.5);
  });
});
describe('download and response regressions', () => {
  test('honors default resolution, disables playlists and returns the actual completed file', async () => {
    config.download = { ...config.download, defaultResolution: '1080p' };
    const target = path.join(directory, 'actual-merged.webm');
    run.mockImplementation(async (_command, args) => {
      expect(args).toContain('--no-playlist'); expect(args).toContain('--ignore-config');
      expect(args[args.indexOf('--paths') + 1]).toBe(directory);
      expect(path.isAbsolute(args[args.indexOf('--output') + 1])).toBe(false);
      expect(args[args.indexOf('--format') + 1]).toBe(formatSelector('1080p'));
      expect(args).not.toContain('--no-check-certificate');
      await fs.writeFile(target, 'media');
      return `__YTDLP_FILE__${JSON.stringify(target)}\n`;
    });
    const result = await downloadMedia('https://www.youtube.com/watch?v=123', config);
    expect(result.path).toBe(await fs.realpath(target)); expect(result.sizeBytes).toBe(5);
    expect(formatSelector('720p')).not.toBe(formatSelector('1080p'));
    expect(formatSelector('720p')).toContain('[width<=?720]');
  });
  test.each([false, true])('keeps TikTok video audio instead of its standalone music track (audio=%s)', async (audio) => {
    const target = path.join(directory, audio ? 'speech.mp3' : 'clip.mp4');
    run.mockImplementation(async (_command, args) => {
      const selector = args[args.indexOf('--format') + 1];
      expect(selector).not.toContain('bestaudio');
      expect(selector).not.toContain('bestvideo');
      if (audio) expect(args).toContain('--extract-audio');
      await fs.writeFile(target, 'media');
      return `__YTDLP_FILE__${JSON.stringify(target)}\n`;
    });
    expect((await downloadMedia('https://www.tiktok.com/@u/video/123', config, { audio })).sizeBytes).toBe(5);
  });
  test('rejects reversed trim ranges before launching yt-dlp', async () => {
    await expect(downloadMedia('https://example.org/video', config, { startTime: '00:02:00', endTime: '00:01:00' })).rejects.toThrow('after');
    expect(run).not.toHaveBeenCalled();
  });
  test('truncates metadata without breaking JSON or exceeding its limit', async () => {
    run.mockResolvedValue(JSON.stringify({ id: '123', description: 'x'.repeat(2000), formats: [{ a: 'y'.repeat(1000) }] }));
    config.limits = { ...config.limits, characterLimit: 200 };
    for (const fields of [undefined, ['description']]) {
      const result = await getVideoMetadata('https://example.org/video', fields, config);
      expect(result.length).toBeLessThanOrEqual(200); expect(JSON.parse(result)._truncated).toBe(true);
    }
  });
  test('search reads JSON records and uses lookahead for pagination', async () => {
    run.mockResolvedValue(Array.from({ length: 4 }, (_, i) => JSON.stringify({ id: `id${i}`, title: `Line\n${i}`, duration: 10 })).join('\n'));
    const result = JSON.parse(await searchVideos('query', 3, 0, 'json', config));
    expect(result.count).toBe(3); expect(result.has_more).toBe(true); expect(result.next_offset).toBe(3);
    expect(result.videos[0].title).toBe('Line\n0');
  });
});
describe('profile date filtering and bulk downloads', () => {
  test('includes both boundaries and resolves missing dates without downloading', async () => {
    const items = [
      { id: '1', upload_date: '20260501' }, { id: '2', upload_date: '20260531' },
      { id: '3', upload_date: '20260430' }, { id: '4' }
    ];
    run.mockImplementation(async (_command, args) => args.includes('--flat-playlist')
      ? items.map(item => JSON.stringify({ ...item, url: `https://www.tiktok.com/@u/video/${item.id}` })).join('\n')
      : JSON.stringify({ upload_date: '20260515' }));
    const result = await listCreatorVideos('https://www.tiktok.com/@u', config, { dateFrom: '2026-05-01', dateTo: '2026-05-31' });
    expect(result.videos.map(video => video.id)).toEqual(['1', '2', '4']);
    expect(result.hasMore).toBe(false); expect(result.scanned).toBe(4);
    expect(run.mock.calls.every(([, args]) => args.includes('--skip-download') || args.includes('--dump-json'))).toBe(true);
  });
  test('empty matching pages retain the raw cursor and exclude undated videos', async () => {
    run.mockImplementation(async (_command, args) => args.includes('--flat-playlist')
      ? [1, 2, 3].map(id => JSON.stringify({ id, url: `https://example.org/${id}` })).join('\n') : '{}');
    const result = await listCreatorVideos('https://www.tiktok.com/@u', config, { dateFrom: '2026-05-01', scanLimit: 2 });
    expect(result.videos).toEqual([]); expect(result.nextOffset).toBe(2); expect(result.hasMore).toBe(true);
  });
  test('bulk download reports partial failures and keeps completed paths', async () => {
    run.mockImplementation(async (_command, args) => {
      if (args.includes('--flat-playlist')) return [1, 2].map(id => JSON.stringify({ id, url: `https://example.org/${id}` })).join('\n');
      if (args.at(-1).endsWith('/2')) throw new Error('Source unavailable');
      const filename = path.join(directory, 'first.mp4'); await fs.writeFile(filename, 'media');
      return `__YTDLP_FILE__${JSON.stringify(filename)}\n`;
    });
    const result = await downloadCreatorVideos('https://www.tiktok.com/@u', config);
    expect(result.downloaded).toBe(1); expect(result.failed).toBe(1);
    expect(result.results[0].path).toContain('first.mp4'); expect(result.results[1].error).toContain('unavailable');
    await expect(downloadCreatorVideos('https://www.tiktok.com/@u', config, { limit: 21 })).rejects.toThrow('20');
  });
});
describe('timestamped video context', () => {
  test('samples the video duration when the audio track is longer', async () => {
    run.mockResolvedValueOnce(JSON.stringify({ streams: [{ duration: '66.2' }], format: { duration: '256.6' } }));
    expect(await probeVideo('clip.mp4')).toBe(66.2);
    run.mockResolvedValueOnce(JSON.stringify({ streams: [{}], format: { duration: '12' } }));
    expect(await probeVideo('clip.webm')).toBe(12);
  });
  test('parses caption timestamps and samples inside the requested range', () => {
    expect(parseSrt('1\n00:00:01,000 --> 00:00:02,500\nHello <b>world</b>\n')).toEqual([{ start: 1, end: 2.5, text: 'Hello world' }]);
    expect(sampleTimes(100, 2, 10, 20)).toEqual([12.5, 17.5]);
    expect(() => sampleTimes(100, 2, 30, 20)).toThrow();
  });
  test('falls back to local Whisper when there are no captions', async () => {
    run.mockImplementation(async (command, args) => {
      if (command === 'ffmpeg') expect(args.slice(args.indexOf('-t'), args.indexOf('-t') + 2)).toEqual(['-t', '66.2']);
      if (command === 'whisper') {
        await fs.writeFile(path.join(args[args.indexOf('--output_dir') + 1], 'speech.json'), JSON.stringify({ language: 'en', segments: [{ start: 0, end: 1, text: 'Spoken text' }] }));
      }
      return '';
    });
    const transcript = await getTranscriptData('https://example.org/video', 'en', config, path.join(directory, 'clip.mp4'), 66.2);
    expect(transcript.source).toBe('whisper'); expect(transcript.text).toBe('Spoken text');
  });
});
describe('actual subprocess lifecycle', () => {
  test('terminates a timed-out process', async () => {
    await expect(actualUtils._spawnPromise(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 150 })).rejects.toThrow('timed out');
  });
  test('bounds output and supports cancellation', async () => {
    await expect(actualUtils._spawnPromise(process.execPath, ['-e', 'console.log("x".repeat(10000))'], { maxOutputBytes: 100 })).rejects.toThrow('exceeded');
    const abort = new AbortController();
    const work = actualUtils._spawnPromise(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: abort.signal });
    setTimeout(() => abort.abort(), 100);
    await expect(work).rejects.toThrow('cancelled');
  });
});
