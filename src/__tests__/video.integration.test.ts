// @ts-nocheck
// @jest-environment node
import { describe, test, expect } from '@jest/globals';
import * as os from 'os';
import * as path from 'path';
import { downloadVideo } from '../modules/video.js';
import { CONFIG } from '../config.js';
import * as fs from 'fs';

// 設置 Python 環境
process.env.PYTHONPATH = '';
process.env.PYTHONHOME = '';

describe('downloadVideo with trimming', () => {
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

  test('downloads video with start time trimming', async () => {
    const result = await downloadVideo(testUrl, testConfig, '720p', '00:00:10');
    expect(result).toContain('Video successfully downloaded');
    
    const files = await fs.promises.readdir(testConfig.file.downloadsDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toMatch(/\.(mp4|webm|mkv)$/);
  }, 30000);

  test('downloads video with end time trimming', async () => {
    const result = await downloadVideo(testUrl, testConfig, '720p', undefined, '00:00:20');
    expect(result).toContain('Video successfully downloaded');
    
    const files = await fs.promises.readdir(testConfig.file.downloadsDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toMatch(/\.(mp4|webm|mkv)$/);
  }, 30000);

  test('downloads video with both start and end time trimming', async () => {
    const result = await downloadVideo(testUrl, testConfig, '720p', '00:00:10', '00:00:20');
    expect(result).toContain('Video successfully downloaded');
    
    const files = await fs.promises.readdir(testConfig.file.downloadsDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toMatch(/\.(mp4|webm|mkv)$/);
  }, 30000);

  test('downloads video without trimming when no times provided', async () => {
    const result = await downloadVideo(testUrl, testConfig, '720p');
    expect(result).toContain('Video successfully downloaded');
    
    const files = await fs.promises.readdir(testConfig.file.downloadsDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toMatch(/\.(mp4|webm|mkv)$/);
  }, 30000);
});