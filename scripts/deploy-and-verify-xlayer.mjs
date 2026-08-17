import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const manifestPath = readArg('--manifest') || path.join(repoRoot, 'deploy', 'xlayer', 'BountyProofTreasury.manifest.json');
const verifiedOutPath = readArg('--verified-out') || path.join(repoRoot, 'deploy', 'xlayer', 'BountyProofTreasury.verified.json');

const deployResult = runStep('deploy', 'scripts/deploy-xlayer-contract.mjs', [
  '--manifest',
  manifestPath,
  ...forwardArgs(['--source', '--network'])
]);
if (deployResult.status !== 0) {
  process.exit(deployResult.status || 1);
}

const manifest = await readJson(manifestPath);
const contractAddress = String(manifest.contractAddress || '').trim();
if (!contractAddress) {
  fail(`Deployment completed, but no contractAddress was found in ${manifestPath}.`);
}

const verifyResult = runStep('verify', 'scripts/verify-xlayer-contract.mjs', [
  '--manifest',
  manifestPath,
  '--contract-address',
  contractAddress,
  ...forwardArgs(['--source', '--abi'])
]);
if (verifyResult.status !== 0) {
  process.exit(verifyResult.status || 1);
}

const fetchResult = runStep('fetch ABI/source', 'scripts/fetch-xlayer-verified-contract.mjs', [
  '--manifest',
  manifestPath,
  '--contract-address',
  contractAddress,
  '--out',
  verifiedOutPath
]);
if (fetchResult.status !== 0) {
  process.exit(fetchResult.status || 1);
}

console.log([
  `Verified ABI/source saved: ${path.relative(repoRoot, verifiedOutPath).replaceAll('\\', '/')}`,
  `Contract ready in manifest: ${path.relative(repoRoot, manifestPath).replaceAll('\\', '/')}`
].join('\n'));

function runStep(label, scriptPath, extraArgs = []) {
  console.log(`\n==> ${label}`);
  return spawnSync(process.execPath, [path.join(repoRoot, scriptPath), ...extraArgs], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env
  });
}

function forwardArgs(allowedFlags) {
  const forwarded = [];
  for (let i = 2; i < process.argv.length; i += 1) {
    const token = process.argv[i];
    if (!allowedFlags.includes(token)) {
      continue;
    }
    forwarded.push(token);
    const next = process.argv[i + 1];
    if (next && !next.startsWith('--')) {
      forwarded.push(next);
      i += 1;
    }
  }
  return forwarded;
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return '';
  }
  return process.argv[index + 1] || '';
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
