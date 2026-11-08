# Search Feature Demo

For the current source-checkout setup, all 15 MCP tools and profile/date workflows, see [README](../README.md) and [Video workflows](video-workflows.md). Registry installation examples apply only after publishing this fork.

The search functionality has been successfully added to yt-dlp-mcp! This feature allows you to search for videos on YouTube using keywords and get formatted results with video information.

## New Tool: `search_videos`

### Description
Search for videos on YouTube using keywords. Returns title, uploader, duration, and URL for each result.

### Parameters
- `query` (string, required): Search keywords or phrase
- `maxResults` (number, optional): Maximum number of results to return (1-50, default: 10)

### Example Usage

Ask your LLM to:
```
"Search for Python tutorial videos"
"Find JavaScript courses and show me the top 5 results"
"Search for machine learning tutorials with 15 results"
```

### Example Output

When searching for "javascript tutorial" with 3 results, you'll get:

```
Found 3 videos:

1. **JavaScript Tutorial Full Course - Beginner to Pro**
   📺 Channel: Traversy Media
   ⏱️  Duration: 15663
   🔗 URL: https://www.youtube.com/watch?v=EerdGm-ehJQ
   🆔 ID: EerdGm-ehJQ

2. **JavaScript Course for Beginners**
   📺 Channel: FreeCodeCamp.org
   ⏱️  Duration: 12402
   🔗 URL: https://www.youtube.com/watch?v=W6NZfCO5SIk
   🆔 ID: W6NZfCO5SIk

3. **JavaScript Full Course for free 🌐 (2024)**
   📺 Channel: Bro Code
   ⏱️  Duration: 43200
   🔗 URL: https://www.youtube.com/watch?v=lfmg-EJ8gm4
   🆔 ID: lfmg-EJ8gm4

💡 You can use any URL to download videos, audio, or subtitles!
```

## Integration with Existing Features

After searching for videos, you can directly use the returned URLs with other tools:

1. **Download video**: Use the URL with `download_video`
2. **Download audio**: Use the URL with `download_audio`
3. **Get subtitles**: Use the URL with `list_subtitle_languages` or `download_video_subtitles`
4. **Get transcript**: Use the URL with `download_transcript`

## Test Results

All search functionality tests pass:
- ✅ Successfully search and format results
- ✅ Reject empty search queries
- ✅ Validate maxResults parameter range
- ✅ Handle search with different result counts
- ✅ Return properly formatted results
- ✅ Handle obscure search terms gracefully

## Implementation Details

The search feature uses yt-dlp's built-in search capability with the syntax:
- `ytsearch[N]:[query]` where N is the number of results
- Uses `--print` options to extract: title, id, uploader, duration
- Results are formatted in a user-friendly way with emojis and clear structure

This addresses the feature request from [Issue #14](https://github.com/kevinwatt/yt-dlp-mcp/issues/14) and provides a seamless search experience for users. 