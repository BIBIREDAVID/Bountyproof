import '../src/load-env.js';
import { readFile, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVerifiedContractInfoUrl, XLAYER } from '../src/xlayer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const chainShortName = (readArg('--chain-short-name') || process.env.CHAIN_SHORT_NAME || XLAYER.chainShortName).toUpperCase();
const outPath = readArg('--out') || '';
const manifestPath = readArg('--manifest') || path.join(repoRoot, 'deploy', 'xlayer', 'BountyProofTreasury.manifest.example.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const contractAddress = readArg('--contract-address') || process.env.CONTRACT_ADDRESS || String(manifest.contractAddress || '').trim();
const maxAttempts = Number(readArg('--attempts') || process.env.XLAYER_FETCH_ATTEMPTS || 12);
const delayMs = Number(readArg('--delay-ms') || process.env.XLAYER_FETCH_DELAY_MS || 5000);

if (!contractAddress) {
  fail(`Missing contract address. Pass --contract-address, set CONTRACT_ADDRESS, or provide it in ${manifestPath}.`);
}

const requestPath = '/api/v5/xlayer/contract/verify-contract-info';
const query = new URLSearchParams({
  chainShortName,
  contractAddress
}).toString();

const payload = await pollVerifiedContractInfo({
  url: buildVerifiedContractInfoUrl(contractAddress, chainShortName),
  requestPath,
  query,
  maxAttempts,
  delayMs
});

if (!payload || payload.code !== '0') {
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
  process.exit();
}

const result = {
  fetchedAt: new Date().toISOString(),
  request: {
    chainShortName,
    contractAddress
  },
  response: payload
};

if (outPath) {
  const resolved = path.isAbsolute(outPath) ? outPath : path.join(repoRoot, outPath);
  await writeFile(resolved, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(resolved);
} else {
  console.log(JSON.stringify(result, null, 2));
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return '';
  }
  return process.argv[index + 1] || '';
}

async function pollVerifiedContractInfo({ url, requestPath, query, maxAttempts, delayMs }) {
  let lastPayload = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchWithOkxAuth(url, {
      method: 'GET',
      requestPath,
      queryString: query
    });

    const payload = await response.json();
    lastPayload = payload;

    if (!response.ok || payload.code !== '0') {
      return payload;
    }

    if (Array.isArray(payload.data) && payload.data.length > 0) {
      return payload;
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return lastPayload;
}

async function fetchWithOkxAuth(url, { method = 'GET', requestPath, queryString = '', body = '' } = {}) {
  const apiKey = process.env.OK_ACCESS_KEY || process.env.OKX_API_KEY || '';
  const secret = process.env.OK_ACCESS_SECRET || process.env.OKX_SECRET_KEY || '';
  const passphrase = process.env.OK_ACCESS_PASSPHRASE || process.env.OKX_API_PASSPHRASE || '';
  const timestamp = process.env.OK_ACCESS_TIMESTAMP || new Date().toISOString();

  if (!apiKey || !secret || !passphrase) {
    fail('Missing OKX credentials. Set OK_ACCESS_KEY, OK_ACCESS_SECRET, and OK_ACCESS_PASSPHRASE.');
  }

  const stringToSign = `${timestamp}${method.toUpperCase()}${requestPath}${queryString || body}`;
  const sign = crypto.createHmac('sha256', secret).update(stringToSign).digest('base64');

  return fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'OK-ACCESS-KEY': apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': passphrase
    }
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
