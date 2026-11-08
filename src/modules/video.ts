import type { Config } from '../config.js';
import { downloadMedia, type Resolution } from './media.js';
export async function downloadVideo(url: string, config: Config, resolution?: Resolution, startTime?: string, endTime?: string): Promise<string> {
  const file = await downloadMedia(url, config, { resolution, startTime, endTime });
  return `Video successfully downloaded to ${file.path}`;
}
