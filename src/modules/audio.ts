import type { Config } from '../config.js';
import { downloadMedia } from './media.js';
export async function downloadAudio(url: string, config: Config): Promise<string> {
  const file = await downloadMedia(url, config, { audio: true });
  return `Audio successfully downloaded to ${file.path}`;
}
