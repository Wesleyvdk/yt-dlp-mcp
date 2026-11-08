# Error Handling Guide

For the current source-checkout setup, all 15 MCP tools and profile/date workflows, see [README](../README.md) and [Video workflows](video-workflows.md). Registry installation examples apply only after publishing this fork.

## Common Errors

### Invalid URL

When providing an invalid or unsupported URL:

```javascript
try {
  await downloadVideo('invalid-url');
} catch (error) {
  if (error.message.includes('Invalid or unsupported URL')) {
    console.error('Please provide a valid YouTube or supported platform URL');
  }
}
```

### Missing Subtitles

When trying to download unavailable subtitles:

```javascript
try {
  await downloadSubtitles(url, 'en');
} catch (error) {
  if (error.message.includes('No subtitle files found')) {
    console.warn('No subtitles available in the requested language');
  }
}
```

### yt-dlp Command Failures

When yt-dlp command execution fails:

```javascript
try {
  await downloadVideo(url);
} catch (error) {
  if (error.message.includes('Failed with exit code')) {
    console.error('yt-dlp command failed:', error.message);
    // Check if yt-dlp is installed and up to date
  }
}
```

### File System Errors

When encountering file system issues:

```javascript
try {
  await downloadVideo(url);
} catch (error) {
  if (error.message.includes('No write permission')) {
    console.error('Cannot write to downloads directory. Check permissions.');
  } else if (error.message.includes('Cannot create temporary directory')) {
    console.error('Cannot create temporary directory. Check system temp directory permissions.');
  }
}
```

## Comprehensive Error Handler

Here's a comprehensive error handler that covers most common scenarios:

```javascript
async function handleDownload(url, options = {}) {
  try {
    // Attempt the download
    const result = await downloadVideo(url, options);
    return result;
  } catch (error) {
    // URL validation errors
    if (error.message.includes('Invalid or unsupported URL')) {
      throw new Error(`Invalid URL: ${url}. Please provide a valid video URL.`);
    }

    // File system errors
    if (error.message.includes('No write permission')) {
      throw new Error(`Permission denied: Cannot write to ${options.file?.downloadsDir || '~/Downloads'}`);
    }
    if (error.message.includes('Cannot create temporary directory')) {
      throw new Error('Cannot create temporary directory. Check system permissions.');
    }

    // yt-dlp related errors
    if (error.message.includes('Failed with exit code')) {
      if (error.message.includes('This video is unavailable')) {
        throw new Error('Video is unavailable or has been removed.');
      }
      if (error.message.includes('Video is private')) {
        throw new Error('This video is private and cannot be accessed.');
      }
      throw new Error('Download failed. Please check if yt-dlp is installed and up to date.');
    }

    // Subtitle related errors
    if (error.message.includes('No subtitle files found')) {
      throw new Error(`No subtitles available in ${options.language || 'the requested language'}.`);
    }

    // Unknown errors
    throw new Error(`Unexpected error: ${error.message}`);
  }
}
```

## Error Prevention

### URL Validation

Always validate URLs before processing:

```javascript
import { validateUrl, isYouTubeUrl } from '@wesleyvdk/yt-dlp-mcp';

function validateVideoUrl(url) {
  if (!validateUrl(url)) {
    throw new Error('Invalid URL format');
  }
  
  if (!isYouTubeUrl(url)) {
    console.warn('URL is not from YouTube, some features might not work');
  }
}
```

### Configuration Validation

Validate configuration before use:

```javascript
function validateConfig(config) {
  if (!config.file.downloadsDir) {
    throw new Error('Downloads directory must be specified');
  }

  if (config.file.maxFilenameLength < 5) {
    throw new Error('Filename length must be at least 5 characters');
  }

  if (!['480p', '720p', '1080p', 'best'].includes(config.download.defaultResolution)) {
    throw new Error('Invalid resolution specified');
  }
}
```

### Safe Cleanup

Always use safe cleanup for temporary files:

```javascript
import { safeCleanup } from '@wesleyvdk/yt-dlp-mcp';

try {
  // Your download code here
} catch (error) {
  console.error('Download failed:', error);
} finally {
  await safeCleanup(tempDir);
}
```

## Best Practices

1. Always wrap async operations in try-catch blocks
2. Validate inputs before processing
3. Use specific error types for different scenarios
4. Clean up temporary files in finally blocks
5. Log errors appropriately for debugging
6. Provide meaningful error messages to users

For more information about specific errors and their solutions, see the [API Reference](./api.md). 