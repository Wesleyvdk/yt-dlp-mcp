// @ts-nocheck
// @jest-environment node
import { describe, test, expect } from '@jest/globals';
import * as os from 'os';
import * as path from 'path';
import { listSubtitles, downloadSubtitles, downloadTranscript } from '../modules/subtitle.js';
import { cleanSubtitleToTranscript } from '../modules/utils.js';
import { CONFIG } from '../config.js';
import * as fs from 'fs';

describe('Subtitle Functions', () => {
  const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  const testConfig = {
    ...CONFIG,
    file: {
      ...CONFIG.file,
      downloadsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'yt-dlp-test-downloads-')),
      tempDirPrefix: 'yt-dlp-test-'
    }
  };

  beforeEach(async () => {
    await fs.promises.mkdir(testConfig.file.downloadsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(testConfig.file.downloadsDir, { recursive: true, force: true });
  });

  describe('listSubtitles', () => {
    test('lists available subtitles', async () => {
      const result = await listSubtitles(testUrl);
      expect(result).toContain('Language');
    }, 30000);

    test('handles invalid URL', async () => {
      await expect(listSubtitles('invalid-url'))
        .rejects
        .toThrow();
    });
  });

  describe('downloadSubtitles', () => {
    test('downloads auto-generated subtitles successfully', async () => {
      const result = await downloadSubtitles(testUrl, 'en', testConfig);
      expect(result).toContain('WEBVTT');
    }, 30000);

    test('handles missing language', async () => {
      await expect(downloadSubtitles(testUrl, 'xx', testConfig))
        .rejects
        .toThrow();
    });
  });

  describe('downloadTranscript', () => {
    test('downloads and cleans transcript successfully', async () => {
      const result = await downloadTranscript(testUrl, 'en', testConfig);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toContain('WEBVTT');
      expect(result).not.toContain('-->');
      expect(result).not.toMatch(/^\d+$/m);
    }, 30000);

    test('handles invalid URL', async () => {
      await expect(downloadTranscript('invalid-url', 'en', testConfig))
        .rejects
        .toThrow();
    });
  });

  describe('cleanSubtitleToTranscript', () => {
    test('cleans SRT content correctly', () => {
      const srtContent = `1
00:00:01,000 --> 00:00:03,000
Hello <i>world</i>

2
00:00:04,000 --> 00:00:06,000
This is a test

3
00:00:07,000 --> 00:00:09,000
<b>Bold text</b> here`;

      const result = cleanSubtitleToTranscript(srtContent);
      expect(result).toBe('Hello world This is a test Bold text here');
    });

    test('handles empty content', () => {
      const result = cleanSubtitleToTranscript('');
      expect(result).toBe('');
    });

    test('removes timestamps and sequence numbers', () => {
      const srtContent = `1
00:00:01,000 --> 00:00:03,000
First line

2
00:00:04,000 --> 00:00:06,000
Second line`;

      const result = cleanSubtitleToTranscript(srtContent);
      expect(result).not.toContain('00:00');
      expect(result).not.toMatch(/^\d+$/);
      expect(result).toBe('First line Second line');
    });
  });
}); 