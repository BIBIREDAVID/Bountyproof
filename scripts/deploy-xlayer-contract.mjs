import '../src/load-env.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import { ContractFactory, JsonRpcProvider, Wallet, formatEther } from 'ethers';
import { createXLayerDeploymentManifest, XLAYER } from '../src/xlayer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const sourcePath = readArg('--source') || path.join(repoRoot, 'contracts', 'BountyProofTreasury.sol');
const manifestPath = readArg('--manifest') || path.join(repoRoot, 'deploy', 'xlayer', 'BountyProofTreasury.manifest.json');
const privateKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '';

if (!privateKey) {
  fail('Missing PRIVATE_KEY or DEPLOYER_PRIVATE_KEY.');
}

const manifest = await loadManifest();
const network = (readArg('--network') || process.env.XLAYER_NETWORK || manifest.network || 'testnet').toLowerCase();
const rpcUrl = manifest.rpcUrl || process.env.XLAYER_RPC_URL || process.env.RPC_URL || (network === 'mainnet' ? XLAYER.mainnet.rpcUrl : XLAYER.testnet.rpcUrl);
const sourceCode = await readFile(sourcePath, 'utf8');
const contractName = manifest.contractName || XLAYER.contract.name;
const compiled = compileSolidity(sourceCode, path.basename(sourcePath), manifest);
const artifact = compiled.contracts[path.basename(sourcePath)]?.[contractName];

if (!artifact) {
  fail(`Compiled artifact not found for ${contractName}.`);
}

const bytecode = artifact.evm?.bytecode?.object || '';
if (!bytecode) {
  fail(`Missing bytecode for ${contractName}.`);
}

assertValidPrivateKey(privateKey);

const provider = new JsonRpcProvider(rpcUrl);
const wallet = new Wallet(privateKey, provider);
const chainInfo = await provider.getNetwork();
const deployerBalance = await provider.getBalance(wallet.address);
const factory = new ContractFactory(artifact.abi, bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`, wallet);
const targetChainId = Number(manifest.constructorArgs?.chainId || manifest.chainId || process.env.CHAIN_ID || (network === 'mainnet' ? XLAYER.mainnet.chainId : XLAYER.testnet.chainId));
const constructorArgs = [
  manifest.constructorArgs?.admin || wallet.address,
  targetChainId,
  manifest.constructorArgs?.contractVersion || manifest.contractVersion || XLAYER.contract.version
];

console.log([
  `RPC URL: ${rpcUrl}`,
  `RPC chainId: ${chainInfo.chainId.toString()}`,
  `Target chainId: ${targetChainId}`,
  `Deployer address: ${wallet.address}`,
  `Deployer balance: ${deployerBalance.toString()} wei (${formatEther(deployerBalance)} ETH)`
].join('\n'));

if (Number(chainInfo.chainId) !== targetChainId) {
  console.warn(`Warning: RPC chainId ${chainInfo.chainId.toString()} does not match target chainId ${targetChainId}.`);
}

const contract = await factory.deploy(...constructorArgs);
await contract.waitForDeployment();

const deployedAddress = await contract.getAddress();
const deploymentTx = contract.deploymentTransaction();
const deploymentTxHash = deploymentTx?.hash || '';
const receipt = deploymentTx ? await deploymentTx.wait() : null;
const manifestUpdate = createXLayerDeploymentManifest({
  ...manifest,
  network,
  chainId: constructorArgs[1],
  rpcUrl,
  compilerVersion: solc.version(),
  contractAddress: deployedAddress,
  deploymentTxHash,
  contractVerified: false,
  constructorArgs: {
    admin: constructorArgs[0],
    chainId: constructorArgs[1],
    contractVersion: constructorArgs[2]
  },
  sourceFile: path.relative(repoRoot, sourcePath).replaceAll('\\', '/'),
  abiFile: path.relative(repoRoot, path.join(repoRoot, 'contracts', `${contractName}.abi.json`)).replaceAll('\\', '/'),
  lastDeploymentStatus: receipt?.status === 1 ? 'confirmed' : 'submitted',
  lastDeploymentBlockNumber: receipt?.blockNumber || null,
  lastDeploymentGasUsed: receipt?.gasUsed ? receipt.gasUsed.toString() : null,
  lastDeployer: wallet.address,
  lastDeployedAt: new Date().toISOString(),
  lastDeploymentNetwork: network
});

await mkdir(path.dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, JSON.stringify(manifestUpdate, null, 2) + '\n', 'utf8');

console.log([
  `Deployed address: ${deployedAddress}`,
  `Tx hash: ${deploymentTxHash || 'n/a'}`,
  `Manifest updated: ${path.relative(repoRoot, manifestPath).replaceAll('\\', '/')}`,
  manifest.chainShortName && manifest.chainShortName !== XLAYER.chainShortName
    ? `Verify next: use your chain's explorer verifier for ${deployedAddress}`
    : `Verify next: npm run xlayer:verify -- --contract-address ${deployedAddress}`
].join('\n'));

async function loadManifest() {
  const fallbackManifestPath = path.join(repoRoot, 'deploy', 'xlayer', 'BountyProofTreasury.manifest.example.json');
  const manifestExamplePath = manifestPath.replace(/\.json$/i, '.example.json');
  const candidates = [manifestPath];
  if (manifestExamplePath !== manifestPath) {
    candidates.push(manifestExamplePath);
  }
  if (fallbackManifestPath !== manifestPath && fallbackManifestPath !== manifestExamplePath) {
    candidates.push(fallbackManifestPath);
  }

  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, 'utf8');
      return JSON.parse(raw);
    } catch {
      // Try the next candidate.
    }
  }
  return createXLayerDeploymentManifest({ network });
}

function compileSolidity(source, fileName, manifestData) {
  const input = {
    language: 'Solidity',
    sources: {
      [fileName]: { content: source }
    },
    settings: {
      optimizer: {
        enabled: String(manifestData.optimization ?? XLAYER.contract.optimization) === '1',
        runs: Number(manifestData.optimizationRuns || XLAYER.contract.optimizationRuns)
      },
      viaIR: Boolean(manifestData.viaIr ?? XLAYER.contract.viaIr),
      evmVersion: manifestData.evmVersion || XLAYER.contract.evmVersion,
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'metadata']
        }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((entry) => entry.severity === 'error' || entry.severity === 'fatal');
  const warnings = (output.errors || []).filter((entry) => entry.severity === 'warning');
  warnings.forEach((warning) => console.warn(warning.formattedMessage || warning.message));
  if (errors.length) {
    fail(errors.map((error) => error.formattedMessage || error.message).join('\n'));
  }
  return output;
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return '';
  }
  return process.argv[index + 1] || '';
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function assertValidPrivateKey(value) {
  const key = String(value || '').trim();
  if (!key) {
    fail('Missing PRIVATE_KEY or DEPLOYER_PRIVATE_KEY.');
  }
  if (/^0x?your/i.test(key) || /^0x?placeholder/i.test(key)) {
    fail('PRIVATE_KEY is still a placeholder. Replace it with your real deployer private key in .env.');
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    fail('PRIVATE_KEY must be a 32-byte hex string that starts with 0x.');
  }
}
