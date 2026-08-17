import '../src/load-env.js';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContractVerificationUrl, buildVerifySourceCodeUrl, XLAYER } from '../src/xlayer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const manifestPath = readArg('--manifest') || path.join(repoRoot, 'deploy', 'xlayer', 'BountyProofTreasury.manifest.json');
const sourcePath = readArg('--source') || path.join(repoRoot, 'contracts', 'BountyProofTreasury.sol');
const abiPath = readArg('--abi') || path.join(repoRoot, 'contracts', 'BountyProofTreasury.abi.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const contractAddress = readArg('--contract-address') || process.env.CONTRACT_ADDRESS || String(manifest.contractAddress || '').trim();

if (!contractAddress) {
  fail(`Missing contract address. Pass --contract-address, set CONTRACT_ADDRESS, or provide it in ${manifestPath}.`);
}

const sourceCode = await readFile(sourcePath, 'utf8');
const contractAbi = await readFile(abiPath, 'utf8');

const payload = {
  chainShortName: manifest.chainShortName || XLAYER.chainShortName,
  contractAddress,
  contractName: manifest.contractName || XLAYER.contract.name,
  sourceCode,
  codeFormat: 'solidity-single-file',
  compilerVersion: manifest.compilerVersion || XLAYER.contract.compilerVersion,
  optimization: String(manifest.optimization ?? XLAYER.contract.optimization),
  optimizationRuns: String(manifest.optimizationRuns ?? XLAYER.contract.optimizationRuns),
  contractAbi,
  evmVersion: manifest.evmVersion || XLAYER.contract.evmVersion,
  licenseType: manifest.licenseType || XLAYER.contract.licenseType,
  viaIr: Boolean(manifest.viaIr ?? XLAYER.contract.viaIr),
  libraryInfo: []
};

const response = await postWithOkxAuth(buildVerifySourceCodeUrl(), payload, '/api/v5/xlayer/contract/verify-source-code');
const result = await response.json();

if (!response.ok || result.code !== '0') {
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
  process.exit();
}

const guid = result.data?.[0] || '';
if (!guid) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

const checkResult = await pollVerificationResult(guid, manifest.chainShortName || XLAYER.chainShortName);

console.log(JSON.stringify({
  submittedAt: new Date().toISOString(),
  contractAddress,
  guid,
  submissionResponse: result,
  verificationResult: checkResult
}, null, 2));

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return '';
  }
  return process.argv[index + 1] || '';
}

async function postWithOkxAuth(url, body, requestPath) {
  const apiKey = process.env.OK_ACCESS_KEY || process.env.OKX_API_KEY || '';
  const secret = process.env.OK_ACCESS_SECRET || process.env.OKX_SECRET_KEY || '';
  const passphrase = process.env.OK_ACCESS_PASSPHRASE || process.env.OKX_API_PASSPHRASE || '';
  const timestamp = process.env.OK_ACCESS_TIMESTAMP || new Date().toISOString();

  if (!apiKey || !secret || !passphrase) {
    fail('Missing OKX credentials. Set OK_ACCESS_KEY, OK_ACCESS_SECRET, and OK_ACCESS_PASSPHRASE.');
  }

  const bodyText = JSON.stringify(body);
  const stringToSign = `${timestamp}POST${requestPath}${bodyText}`;
  const sign = crypto.createHmac('sha256', secret).update(stringToSign).digest('base64');

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'OK-ACCESS-KEY': apiKey,
      'OK-ACCESS-SIGN': sign,
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': passphrase
    },
    body: bodyText
  });
}

async function pollVerificationResult(guid, chainShortName) {
  const requestPath = '/api/v5/xlayer/contract/check-verify-result';
  const body = {
    chainShortName: String(chainShortName || XLAYER.chainShortName).toUpperCase(),
    guid
  };

  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const response = await postWithOkxAuth(buildContractVerificationUrl(), body, requestPath);
    const result = await response.json();
    if (!response.ok || result.code !== '0') {
      return { attempt, response: result };
    }

    const status = String(result.data?.[0] || '').trim();
    if (status === 'Success' || status === 'Fail') {
      return { attempt, response: result };
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return { attempt: 30, response: { code: 'timeout', msg: 'Verification still pending after 30 attempts' } };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
