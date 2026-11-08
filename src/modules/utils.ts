import * as fs from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { CONFIG } from '../config.js';

export interface ExecutionContext { signal?: AbortSignal; progress?: (message: string) => void; }
export const executionContext = new AsyncLocalStorage<ExecutionContext>();

export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { return false; }
}
export function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
  } catch { return false; }
}
export async function safeCleanup(directory: string): Promise<void> {
  await fs.promises.rm(directory, { recursive: true, force: true });
}
export interface SpawnOptions extends ExecutionContext { timeoutMs?: number; maxOutputBytes?: number; }
export function _spawnPromise(command: string, args: string[], options: SpawnOptions = {}): Promise<string> {
  const context = executionContext.getStore();
  const signal = options.signal ?? context?.signal;
  const progress = options.progress ?? context?.progress;
  const timeoutMs = options.timeoutMs ?? CONFIG.process.timeoutMs;
  const maxOutputBytes = options.maxOutputBytes ?? CONFIG.process.maxOutputBytes;
  const binaries: Record<string, string | undefined> = {
    'yt-dlp': process.env.YTDLP_BINARY, ffmpeg: process.env.YTDLP_FFMPEG_BINARY,
    ffprobe: process.env.YTDLP_FFPROBE_BINARY, whisper: process.env.YTDLP_WHISPER_BINARY
  };
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Operation cancelled')); return; }
    const child = spawn(binaries[command] || command, args, { windowsHide: true, detached: process.platform !== 'win32' });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '', stderr = '', bytes = 0, settled = false, lastProgress = 0;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(stdout);
    };
    const terminate = (error: Error) => {
      if (child.pid) {
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => child.kill());
          killer.on('close', code => { if (code !== 0) child.kill(); });
          killer.unref();
        } else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }
      }
      finish(error);
    };
    const abort = () => terminate(new Error('Operation cancelled'));
    const timer = setTimeout(() => terminate(new Error(`${command} timed out after ${timeoutMs}ms`)), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', error => finish(new Error(`Failed to spawn ${command}: ${error.message}`)));
    child.stdout.on('data', (data: string) => {
      if (settled) return;
      bytes += Buffer.byteLength(data);
      if (bytes > maxOutputBytes) { terminate(new Error(`${command} output exceeded ${maxOutputBytes} bytes`)); return; }
      stdout += data;
      if (Date.now() - lastProgress > 500) {
        const match = data.match(/__YTDLP_PROGRESS__(.*)/);
        if (match) { lastProgress = Date.now(); progress?.(`${command}: ${match[1].trim()}`); }
      }
    });
    child.stderr.on('data', (data: string) => { if (!settled) stderr = (stderr + data).slice(-65536); });
    child.on('close', code => finish(code === 0 ? undefined : new Error(`${command} exited with code ${code}: ${stderr.slice(-8000)}`)));
    progress?.(`Running ${command}`);
  });
}
export function getFormattedTimestamp(): string { return new Date().toISOString().replace(/[:.]/g, '-'); }
export function generateRandomFilename(extension = 'mp4'): string { return `${getFormattedTimestamp()}_${randomBytes(4).toString('hex')}.${extension}`; }
export function cleanSubtitleToTranscript(srtContent: string): string {
  return srtContent.split('\n').filter(line => {
    const text = line.trim();
    return text && !/^\d+$/.test(text) && !/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->/.test(text);
  }).map(line => line.replace(/<[^>]*>/g, '')).join(' ').replace(/\s+/g, ' ').trim();
}
export function boundedJson(value: Record<string, unknown>, limit: number): string {
  if (limit < 2) throw new Error('JSON character limit must be at least 2');
  const result = { ...value };
  if (JSON.stringify(result, null, 2).length <= limit) return JSON.stringify(result, null, 2);
  result._truncated = true;
  while (JSON.stringify(result, null, 2).length > limit) {
    const keys = Object.keys(result).filter(key => key !== '_truncated');
    if (!keys.length) return limit >= 19 ? '{"_truncated":true}' : '{}';
    const largest = keys.sort((a, b) => JSON.stringify(result[b]).length - JSON.stringify(result[a]).length)[0];
    const content = result[largest];
    if (typeof content === 'string' && content.length > 32) result[largest] = content.slice(0, Math.floor(content.length / 2)) + '…';
    else if (Array.isArray(content) && content.length > 1) result[largest] = content.slice(0, Math.floor(content.length / 2));
    else delete result[largest];
  }
  return JSON.stringify(result, null, 2);
}
