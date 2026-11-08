import { spawnSync } from 'node:child_process';
const integration = process.argv.includes('--integration');
const args = process.argv.slice(2).filter(arg => arg !== '--integration');
const result = spawnSync(process.execPath, ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--detectOpenHandles', '--runInBand', ...args], {
  stdio: 'inherit',
  env: { ...process.env, PYTHONPATH: '', PYTHONHOME: '', RUN_INTEGRATION_TESTS: integration ? '1' : '0' }
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
