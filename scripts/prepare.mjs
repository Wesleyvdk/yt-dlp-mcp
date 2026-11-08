import { chmodSync } from 'node:fs';
chmodSync(new URL('../lib/index.mjs', import.meta.url), 0o755);
