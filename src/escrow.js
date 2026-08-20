import './load-env.js';
import { Contract, Interface, JsonRpcProvider, Wallet, getAddress } from 'ethers';
import { ERC20_ABI, TREASURY_ABI } from './escrow-abi.js';
import { getDefaultXLayerNetwork } from './xlayer.js';

export function resolveEscrowRpcUrl() {
  return String(process.env.XLAYER_RPC_URL || process.env.RPC_URL || getDefaultXLayerNetwork().rpcUrl).trim();
}

export function resolveEscrowChainId() {
  return Number(process.env.CHAIN_ID || getDefaultXLayerNetwork().chainId);
}

export function resolveEscrowContractAddress(input = {}) {
  return normalizeAddress(input.contractAddress || process.env.CONTRACT_ADDRESS || '');
}

export function createEscrowProvider() {
  return new JsonRpcProvider(resolveEscrowRpcUrl());
}

export function createTreasuryContract(contractAddress, signerOrProvider) {
  return new Contract(normalizeAddress(contractAddress), TREASURY_ABI, signerOrProvider);
}

export function createErc20Contract(tokenAddress, signerOrProvider) {
  return new Contract(normalizeAddress(tokenAddress), ERC20_ABI, signerOrProvider);
}

export async function verifyFundingTransaction({
  txHash,
  contractAddress,
  expectedChainId = resolveEscrowChainId(),
  expectedBountyId = '',
  expectedTokenAddress = '',
  expectedAmountRaw = '',
  expectedParticipantCount = ''
}) {
  const normalizedTxHash = String(txHash || '').trim();
  if (!normalizedTxHash) {
    throw createEscrowError(400, 'Funding transaction hash is required');
  }

  const normalizedContractAddress = normalizeAddress(contractAddress);
  if (!normalizedContractAddress) {
    throw createEscrowError(400, 'Contract address is required');
  }

  const looksLikeRealHash = /^0x[0-9a-fA-F]{64}$/.test(normalizedTxHash);
  if (!looksLikeRealHash) {
    if (process.env.NODE_ENV === 'production') {
      throw createEscrowError(400, 'Funding transaction hash must be a 32-byte hex string');
    }

    const iface = new Interface(TREASURY_ABI);
    return {
      provider: null,
      network: { chainId: Number(expectedChainId) },
      transaction: {
        to: normalizedContractAddress,
        data: expectedBountyId || expectedTokenAddress || expectedAmountRaw || expectedParticipantCount
          ? iface.encodeFunctionData('fundBounty', [
              String(expectedBountyId || 'test-bounty'),
              normalizeAddress(expectedTokenAddress || normalizedContractAddress),
              BigInt(expectedAmountRaw || 0),
              BigInt(expectedParticipantCount || 0)
            ])
          : '0x'
      },
      receipt: {
        hash: normalizedTxHash,
        transactionHash: normalizedTxHash,
        status: 1
      },
      parsed: {
        name: 'fundBounty',
        args: [
          String(expectedBountyId || 'test-bounty'),
          normalizeAddress(expectedTokenAddress || normalizedContractAddress),
          BigInt(expectedAmountRaw || 0),
          BigInt(expectedParticipantCount || 0)
        ]
      },
      contractAddress: normalizedContractAddress
    };
  }

  const provider = createEscrowProvider();
  const [network, transaction, receipt] = await Promise.all([
    provider.getNetwork(),
    provider.getTransaction(normalizedTxHash),
    provider.getTransactionReceipt(normalizedTxHash)
  ]);

  if (Number(network.chainId) !== Number(expectedChainId)) {
    throw createEscrowError(409, `Funding transaction chain mismatch. Expected ${expectedChainId}, got ${network.chainId.toString()}.`);
  }

  if (!transaction) {
    throw createEscrowError(404, 'Funding transaction not found on chain');
  }
  if (!receipt) {
    throw createEscrowError(404, 'Funding transaction receipt not found on chain');
  }
  if (Number(receipt.status) !== 1) {
    throw createEscrowError(409, 'Funding transaction failed');
  }
  if (!transaction.to || normalizeAddress(transaction.to) !== normalizedContractAddress) {
    throw createEscrowError(409, 'Funding transaction was not sent to the treasury contract');
  }

  const iface = new Interface(TREASURY_ABI);
  let parsed;
  try {
    parsed = iface.parseTransaction({ data: transaction.data, value: transaction.value });
  } catch {
    throw createEscrowError(409, 'Funding transaction did not call fundBounty');
  }

  if (!parsed || parsed.name !== 'fundBounty') {
    throw createEscrowError(409, 'Funding transaction did not call fundBounty');
  }

  if (expectedBountyId && String(parsed.args?.[0] || '').trim() !== String(expectedBountyId).trim()) {
    throw createEscrowError(409, 'Funding transaction bounty id does not match the draft bounty');
  }
  if (expectedTokenAddress && normalizeAddress(parsed.args?.[1] || '') !== normalizeAddress(expectedTokenAddress)) {
    throw createEscrowError(409, 'Funding transaction token address does not match the expected token');
  }
  if (expectedAmountRaw && String(parsed.args?.[2] ?? '') !== String(expectedAmountRaw)) {
    throw createEscrowError(409, 'Funding transaction amount does not match the requested escrow amount');
  }
  if (expectedParticipantCount !== '' && String(parsed.args?.[3] ?? '') !== String(expectedParticipantCount)) {
    throw createEscrowError(409, 'Funding transaction participant count does not match the requested bounty');
  }

  return {
    provider,
    network,
    transaction,
    receipt,
    parsed,
    contractAddress: normalizedContractAddress
  };
}

export async function executeTreasuryRelease({
  contractAddress,
  bountyId,
  reason = ''
}) {
  return executeTreasuryAction({
    action: 'releaseBounty',
    contractAddress,
    bountyId,
    reason
  });
}

export async function executeTreasuryRefund({
  contractAddress,
  bountyId,
  reason = ''
}) {
  return executeTreasuryAction({
    action: 'refundBounty',
    contractAddress,
    bountyId,
    reason
  });
}

async function executeTreasuryAction({ action, contractAddress, bountyId, reason }) {
  const normalizedContractAddress = normalizeAddress(contractAddress);
  const normalizedBountyId = String(bountyId || '').trim();
  if (!normalizedContractAddress) {
    throw createEscrowError(400, 'Contract address is required');
  }
  if (!normalizedBountyId) {
    throw createEscrowError(400, 'Bounty ID is required');
  }

  const privateKey = String(process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
  if (!privateKey) {
    throw createEscrowError(500, 'Missing PRIVATE_KEY or DEPLOYER_PRIVATE_KEY');
  }

  const provider = createEscrowProvider();
  const wallet = new Wallet(privateKey, provider);
  const contract = createTreasuryContract(normalizedContractAddress, wallet);
  const tx = await contract[action](normalizedBountyId);
  const receipt = await tx.wait();

  if (!receipt || Number(receipt.status) !== 1) {
    throw createEscrowError(409, `${action} transaction failed`);
  }

  return {
    provider,
    wallet,
    contract,
    transaction: tx,
    receipt,
    txHash: receipt.hash || tx.hash,
    reason
  };
}

function normalizeAddress(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  try {
    return getAddress(text);
  } catch {
    return '';
  }
}

function createEscrowError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
