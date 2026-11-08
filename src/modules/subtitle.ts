import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Config } from '../config.js';
import { getYtdlpArgs } from '../config.js';
import { _spawnPromise, executionContext, validateUrl } from './utils.js';
import { downloadMedia } from './media.js';

export interface TranscriptSegment { start: number; end: number; text: string; }
export interface TranscriptData { source: 'captions' | 'whisper'; language: string; text: string; segments: TranscriptSegment[]; truncated: boolean; }
export function parseSrt(content: string): TranscriptSegment[] {
  const seconds = (stamp: string) => stamp.replace(',', '.').split(':').map(Number).reduce((total, value) => total * 60 + value, 0);
  const result: TranscriptSegment[] = [];
  for (const block of content.replace(/\r/g, '').split(/\n\s*\n/)) {
    const match = block.match(/(\d{2,}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2,}:\d{2}:\d{2}[,.]\d{3})[^\n]*\n([\s\S]*)/);
    if (!match) continue;
    const text = match[3].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (text) result.push({ start: seconds(match[1]), end: seconds(match[2]), text });
  }
  return result;
}
function limitTranscript(segments: TranscriptSegment[], source: TranscriptData['source'], language: string, config: Config): TranscriptData {
  const included: TranscriptSegment[] = [];
  let length = 0;
  for (const segment of segments) {
    const remaining = config.limits.maxTranscriptLength - length;
    if (remaining <= 0) break;
    const text = segment.text.slice(0, remaining);
    included.push({ ...segment, text });
    length += text.length + 1;
    if (text.length < segment.text.length) break;
  }
  return { source, language, text: included.map(segment => segment.text).join(' '), segments: included,
    truncated: included.length < segments.length || included.some((segment, index) => segment.text !== segments[index].text) };
}
export async function listSubtitles(url: string, config?: Config): Promise<string> {
  if (!validateUrl(url)) throw new Error('Invalid HTTP(S) video URL');
  return _spawnPromise('yt-dlp', ['--no-playlist', '--list-subs', '--skip-download', ...(config ? getYtdlpArgs(config) : []), '--', url]);
}
async function fetchSubtitles(url: string, language: string, config: Config, directory: string, format: 'srt' | 'vtt'): Promise<string[]> {
  if (!validateUrl(url)) throw new Error('Invalid HTTP(S) video URL');
  await _spawnPromise('yt-dlp', [
    '--no-playlist', '--skip-download', '--write-subs', '--write-auto-subs',
    '--sub-langs', language, '--sub-format', `${format}/best`, '--convert-subs', format,
    '--output', path.join(directory, 'captions.%(ext)s'), ...getYtdlpArgs(config), '--', url
  ]);
  return (await fs.readdir(directory)).filter(file => file.endsWith(`.${format}`)).map(file => path.join(directory, file));
}
export async function downloadSubtitles(url: string, language: string, config: Config): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), config.file.tempDirPrefix));
  try {
    const files = await fetchSubtitles(url, language, config, directory, 'vtt');
    if (!files.length) throw new Error(`No subtitle files found for language '${language}'`);
    const content = (await Promise.all(files.map(file => fs.readFile(file, 'utf8')))).join('\n');
    return content.length > config.limits.characterLimit ? content.slice(0, config.limits.characterLimit) + '\n[Subtitles truncated]' : content;
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
export async function transcribeMediaFile(filename: string, language: string, config: Config, duration?: number): Promise<TranscriptData> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), config.file.tempDirPrefix));
  try {
    const audio = path.join(directory, 'speech.wav');
    await _spawnPromise('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', filename,
      ...(duration === undefined ? [] : ['-t', String(duration)]), '-vn', '-ac', '1', '-ar', '16000', audio]);
    await _spawnPromise('whisper', [audio, '--model', config.analysis.whisperModel, '--device', 'cpu', '--fp16', 'False',
      '--model_dir', path.join(config.analysis.cacheDir, 'whisper-models'),
      '--language', language.split('-')[0], '--output_format', 'json', '--output_dir', directory, '--verbose', 'False']);
    const data = JSON.parse(await fs.readFile(path.join(directory, 'speech.json'), 'utf8'));
    if (!Array.isArray(data.segments)) throw new Error('Whisper returned no timestamped segments');
    const segments = data.segments.filter((segment: Record<string, unknown>) =>
      typeof segment.start === 'number' && typeof segment.end === 'number' && typeof segment.text === 'string'
    ).map((segment: { start: number; end: number; text: string }) => ({ start: segment.start, end: segment.end, text: segment.text.trim() }));
    return limitTranscript(segments, 'whisper', data.language || language, config);
  } catch (error) {
    executionContext.getStore()?.signal?.throwIfAborted();
    throw new Error(`Local speech recognition failed. Install openai-whisper and its model, or set YTDLP_WHISPER_BINARY. ${String(error)}`);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
export async function getTranscriptData(url: string, language: string, config: Config, mediaPath?: string, duration?: number): Promise<TranscriptData> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), config.file.tempDirPrefix));
  try {
    const files = await fetchSubtitles(url, language, config, directory, 'srt');
    if (files.length) {
      const segments = parseSrt((await Promise.all(files.map(file => fs.readFile(file, 'utf8')))).join('\n\n'));
      if (segments.length) return limitTranscript(segments, 'captions', language, config);
    }
    if (!mediaPath) mediaPath = (await downloadMedia(url, config, { audio: true, directory, maxBytes: config.analysis.maxFileBytes })).path;
    return await transcribeMediaFile(mediaPath, language, config, duration);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
export async function downloadTranscript(url: string, language: string, config: Config): Promise<string> {
  const transcript = await getTranscriptData(url, language, config);
  return transcript.text + (transcript.truncated ? '\n[Partial transcript: character limit reached]' : '');
}
