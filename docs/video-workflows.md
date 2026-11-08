# Video and profile workflows

The [README](../README.md) is the current setup and configuration reference.

## Inspect one video

Call `ytdlp_analyze_video` with `url`. Inspect the returned image blocks and timestamped transcript. If a mechanism changes quickly, call `ytdlp_get_frame` at a relevant timestamp or analyze a narrower range with additional frames. `includeTranscript: false` skips caption fetching and speech recognition.

## Inspect several videos from a creator

1. Call `ytdlp_list_creator_videos` with a creator profile, optional inclusive `dateFrom`/`dateTo`, and a small `limit`.
2. Check `warnings`, `scanned` and `hasMore`. An empty match list does not mean the profile is exhausted.
3. Analyze each selected video's URL with `ytdlp_analyze_video`.
4. If needed, request another page using the exact `nextOffset` from the response.

## Download several videos

Call `ytdlp_download_creator_videos` with the same filters. Read `results`: each item contains either its actual `path` and `sizeBytes`, or an `error`. `downloaded` and `failed` count outcomes; successful files remain available if another source fails.

The tool handles one page per request, with a maximum of 20 selected downloads. Continuing the account scan is an explicit subsequent call. This makes broad accounts and sparse date ranges bounded and cancellable.
