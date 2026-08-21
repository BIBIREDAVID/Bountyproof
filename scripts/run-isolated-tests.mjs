import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const tests = [
  'tests/requirements.test.js',
  'tests/auth.test.js',
  'tests/ai-verifier.test.js',
  'tests/integration.test.js'
];

async function run() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const testFile of tests) {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), 'bountyproof-state-'));
    const stateFile = path.join(stateDir, 'state.json');
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [testFile], {
        cwd: root,
        stdio: 'inherit',
        env: {
          ...process.env,
          BOUNTYPROOF_STATE_FILE: stateFile
        }
      });
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${testFile} exited with code ${code}`));
        }
      });
      child.on('error', reject);
    });
    await rm(stateDir, { recursive: true, force: true });
  }
}

await run();
