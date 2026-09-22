import { DeepSeekHarness } from './deepseek-harness/packages/sdk/client/lib/index.js';
import { resolve } from 'node:path';

const harness = new DeepSeekHarness({
  cwd: process.cwd(),
  processCwd: process.cwd(),
  provider: 'deepseek-official',
  model: 'deepseek-chat',
  profile: 'sdk',
  dshBin: resolve('./deepseek-harness/apps/cli/lib/bin.js'),
  env: {
    ...process.env,
    DEEPSEEK_API_KEY: 'test',
  }
});

console.log('Testing harness...');
