import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ytdlp-mcp-smoke-'));
const source = path.join(directory, 'clip.mp4');
const client = new Client({ name: 'video-tools-smoke', version: '1.0.0' });
let server, transport;
try {
  execFileSync(process.env.YTDLP_FFMPEG_BINARY || 'ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
    'testsrc=duration=2:size=320x240:rate=10', '-an', '-c:v', 'mpeg4', '-y', source], { windowsHide: true });
  const bytes = await fs.readFile(source);
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}/clip.mp4`;
  transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../lib/index.mjs', import.meta.url))],
    env: { ...process.env, YTDLP_DOWNLOADS_DIR: path.join(directory, 'downloads'), YTDLP_CACHE_DIR: path.join(directory, 'cache'), YTDLP_TIMEOUT_MS: '30000' },
    stderr: 'pipe'
  });
  let stderr = '';
  if (transport.stderr) transport.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 15);
  const metadata = await client.callTool({ name: 'ytdlp_get_video_metadata', arguments: { url, fields: ['id', 'title'] } });
  assert.ok(!metadata.isError, JSON.stringify(metadata));
  assert.ok(metadata.structuredContent.id);
  const progress = [];
  const download = await client.callTool({ name: 'ytdlp_download_video', arguments: { url } }, undefined,
    { onprogress: notification => progress.push(notification.progress) });
  assert.ok(!download.isError, JSON.stringify(download));
  assert.ok((await fs.stat(download.structuredContent.path)).size > 0);
  assert.ok(progress.length > 0, 'Expected MCP progress notifications');
  assert.ok(progress.every((value, index) => index === 0 || value > progress[index - 1]));
  const frame = await client.callTool({ name: 'ytdlp_get_frame', arguments: { url, timestamp: 0.5 } });
  assert.ok(!frame.isError, JSON.stringify(frame));
  assert.equal(frame.content.filter(item => item.type === 'image').length, 1);
  const analysis = await client.callTool({ name: 'ytdlp_analyze_video', arguments: { url, maxFrames: 3, includeTranscript: false } });
  assert.ok(!analysis.isError, JSON.stringify(analysis));
  assert.equal(analysis.content.filter(item => item.type === 'image').length, 3);
  assert.ok(analysis.structuredContent.frames[0].timestamp > 0);
  const invalid = await client.callTool({ name: 'ytdlp_list_creator_videos', arguments: { url, dateFrom: '2026-02-30' } });
  assert.equal(invalid.isError, true);
  console.log(JSON.stringify({ tools: tools.tools.length, metadata: true, download: true, progressNotifications: progress.length, frame: true, analysisFrames: 3, invalidDateRejected: true, stderr }, null, 2));
} finally {
  await client.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
}
