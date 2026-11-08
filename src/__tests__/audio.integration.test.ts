// @ts-nocheck
// @jest-environment node
import { describe, test, expect } from '@jest/globals';
import * as os from 'os';
import * as path from 'path';
import { downloadAudio } from '../modules/audio.js';
import { CONFIG } from '../config.js';
import * as fs from 'fs';

describe('downloadAudio', () => {
  const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
  const testConfig = {
    ...CONFIG,
    file: {
      ...CONFIG.file,
      downloadsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'yt-dlp-test-downloads-')),
      tempDirPrefix: 'yt-dlp-test-'
    }
  };

  beforeAll(async () => {
    await fs.promises.mkdir(testConfig.file.downloadsDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.promises.rm(testConfig.file.downloadsDir, { recursive: true, force: true });
  });

  test('downloads audio successfully from YouTube', async () => {
    const result = await downloadAudio(testUrl, testConfig);
    expect(result).toContain('Audio successfully downloaded');
    
    const files = await fs.promises.readdir(testConfig.file.downloadsDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]).toMatch(/\.m4a$/);
  }, 30000);

  test('handles invalid URL', async () => {
    await expect(downloadAudio('invalid-url', testConfig))
      .rejects
      .toThrow();
  });
}); 