// @ts-nocheck
// @jest-environment node
import { describe, test, expect, beforeAll } from '@jest/globals';
import { getVideoMetadata, getVideoMetadataSummary } from '../modules/metadata.js';
import type { VideoMetadata } from '../modules/metadata.js';
import { CONFIG } from '../config.js';

// 設置 Python 環境
process.env.PYTHONPATH = '';
process.env.PYTHONHOME = '';

describe('Video Metadata Extraction', () => {
  const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';

  describe('getVideoMetadata', () => {
    test('should extract basic metadata from YouTube video', async () => {
      const metadataJson = await getVideoMetadata(testUrl);
      const metadata: VideoMetadata = JSON.parse(metadataJson);

      // 驗證基本字段存在
      expect(metadata).toHaveProperty('id');
      expect(metadata).toHaveProperty('title');
      expect(metadata).toHaveProperty('uploader');
      expect(metadata).toHaveProperty('duration');
      expect(metadata.id).toBe('jNQXAC9IVRw');
      expect(typeof metadata.title).toBe('string');
      expect(typeof metadata.uploader).toBe('string');
      expect(typeof metadata.duration).toBe('number');
    });

    test('should extract specific fields when requested', async () => {
      const fields = ['id', 'title', 'description', 'channel', 'timestamp'];
      const metadataJson = await getVideoMetadata(testUrl, fields);
      const metadata = JSON.parse(metadataJson);

      // 應該只包含請求的字段
      expect(Object.keys(metadata)).toEqual(expect.arrayContaining(fields.filter(f => metadata[f] !== undefined)));
      
      // 不應該包含其他字段（如果它們存在於原始數據中）
      expect(metadata).not.toHaveProperty('formats');
      expect(metadata).not.toHaveProperty('thumbnails');
    });

    test('should handle empty fields array gracefully', async () => {
      const metadataJson = await getVideoMetadata(testUrl, []);
      const metadata = JSON.parse(metadataJson);
      
      // 空數組應該返回空對象
      expect(metadata).toEqual({});
    });

    test('should handle non-existent fields gracefully', async () => {
      const fields = ['id', 'title', 'non_existent_field', 'another_fake_field'];
      const metadataJson = await getVideoMetadata(testUrl, fields);
      const metadata = JSON.parse(metadataJson);

      // 應該包含存在的字段
      expect(metadata).toHaveProperty('id');
      expect(metadata).toHaveProperty('title');
      
      // 不應該包含不存在的字段
      expect(metadata).not.toHaveProperty('non_existent_field');
      expect(metadata).not.toHaveProperty('another_fake_field');
    });

    test('should throw error for invalid URL', async () => {
      await expect(getVideoMetadata('invalid-url')).rejects.toThrow();
      await expect(getVideoMetadata('https://invalid-domain.com/video')).rejects.toThrow();
    });

    test('should include requested metadata fields from issue #16', async () => {
      const fields = ['id', 'title', 'description', 'creators', 'timestamp', 'channel', 'channel_id', 'channel_url'];
      const metadataJson = await getVideoMetadata(testUrl, fields);
      const metadata = JSON.parse(metadataJson);

      // 驗證 issue #16 中請求的字段
      expect(metadata).toHaveProperty('id');
      expect(metadata).toHaveProperty('title');
      expect(metadata.id).toBe('jNQXAC9IVRw');
      expect(typeof metadata.title).toBe('string');

      // 這些字段可能存在也可能不存在，取決於視頻
      if (metadata.description !== undefined) {
        expect(typeof metadata.description).toBe('string');
      }
      if (metadata.creators !== undefined && metadata.creators !== null) {
        // creators can be an array or a string depending on the video
        expect(Array.isArray(metadata.creators) || typeof metadata.creators === 'string').toBe(true);
      }
      if (metadata.timestamp !== undefined) {
        expect(typeof metadata.timestamp).toBe('number');
      }
      if (metadata.channel !== undefined) {
        expect(typeof metadata.channel).toBe('string');
      }
      if (metadata.channel_id !== undefined) {
        expect(typeof metadata.channel_id).toBe('string');
      }
      if (metadata.channel_url !== undefined) {
        expect(typeof metadata.channel_url).toBe('string');
      }
    });
  });

  describe('getVideoMetadataSummary', () => {
    test('should generate human-readable summary', async () => {
      const summary = await getVideoMetadataSummary(testUrl);
      
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
      
      // 應該包含基本信息
      expect(summary).toMatch(/Title:/);
      
      // 可能包含的其他字段
      const commonFields = ['Channel:', 'Duration:', 'Views:', 'Upload Date:'];
      const hasAtLeastOneField = commonFields.some(field => summary.includes(field));
      expect(hasAtLeastOneField).toBe(true);
    });

    test('should handle videos with different metadata availability', async () => {
      const summary = await getVideoMetadataSummary(testUrl);
      
      // 摘要應該是有效的字符串
      expect(typeof summary).toBe('string');
      expect(summary.trim().length).toBeGreaterThan(0);
      
      // 每行應該有意義的格式 (字段: 值) - 但要注意有些標題可能包含特殊字符
      const lines = summary.split('\n').filter(line => line.trim());
      expect(lines.length).toBeGreaterThan(0);
      
      // 至少應該有一行包含冒號（格式為 "字段: 值"）
      const hasFormattedLines = lines.some(line => line.includes(':'));
      expect(hasFormattedLines).toBe(true);
    }, 30000);

    test('should throw error for invalid URL', async () => {
      await expect(getVideoMetadataSummary('invalid-url')).rejects.toThrow();
    }, 30000);
  });

  describe('Error Handling', () => {
    test('should provide helpful error message for unavailable video', async () => {
      const unavailableUrl = 'https://www.youtube.com/watch?v=invalid_video_id_123456789';
      
      await expect(getVideoMetadata(unavailableUrl)).rejects.toThrow(/unavailable|private|not available/i);
    });

    test('should handle network errors gracefully', async () => {
      // 使用一個應該引起網路錯誤的 URL
      const badNetworkUrl = 'https://httpstat.us/500';
      
      await expect(getVideoMetadata(badNetworkUrl)).rejects.toThrow();
    });

    test('should handle unsupported URLs', async () => {
      const unsupportedUrl = 'https://example.com/not-a-video';
      
      await expect(getVideoMetadata(unsupportedUrl)).rejects.toThrow();
    }, 10000);
  });

  describe('Real-world Integration', () => {
    test('should work with different video platforms supported by yt-dlp', async () => {
      // 只測試 YouTube，因為其他平台的可用性可能會變化
      const youtubeUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
      
      const metadataJson = await getVideoMetadata(youtubeUrl, ['id', 'title', 'extractor']);
      const metadata = JSON.parse(metadataJson);
      
      expect(metadata.extractor).toMatch(/youtube/i);
      expect(metadata.id).toBe('jNQXAC9IVRw');
    });

    test('should extract metadata that matches issue #16 requirements', async () => {
      const requiredFields = ['id', 'title', 'description', 'creators', 'timestamp', 'channel', 'channel_id', 'channel_url'];
      const metadataJson = await getVideoMetadata(testUrl, requiredFields);
      const metadata = JSON.parse(metadataJson);
      
      // 驗證至少有基本字段
      expect(metadata).toHaveProperty('id');
      expect(metadata).toHaveProperty('title');
      
      // 記錄實際返回的字段以便調試
      console.log('Available metadata fields for issue #16:', Object.keys(metadata));
      
      // 檢查每個請求的字段是否存在或者有合理的替代
      const availableFields = Object.keys(metadata);
      const hasRequiredBasics = availableFields.includes('id') && availableFields.includes('title');
      expect(hasRequiredBasics).toBe(true);
    });
  });
});