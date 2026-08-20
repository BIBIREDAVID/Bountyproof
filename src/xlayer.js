export const XLAYER = Object.freeze({
  chainShortName: 'XLAYER',
  mainnet: Object.freeze({
    chainId: 196,
    rpcUrl: 'https://rpc.xlayer.tech',
    explorerBaseUrl: 'https://www.okx.com/web3/explorer/xlayer'
  }),
  testnet: Object.freeze({
    chainId: 1952,
    rpcUrl: 'https://testrpc.xlayer.tech/terigon',
    explorerBaseUrl: 'https://www.okx.com/web3/explorer/xlayer-test'
  }),
  contract: Object.freeze({
    name: 'BountyProofTreasury',
    version: 'v1.0.0',
    abiVersion: 'abi-1.0.0',
    compilerVersion: 'v0.8.24+commit.e11b9ed9',
    optimization: '1',
    optimizationRuns: '200',
    evmVersion: 'paris',
    licenseType: 'MIT',
    viaIr: false
  })
});

export const XLAYER_TOKEN_ADDRESSES = Object.freeze({
  mainnet: Object.freeze({
    USDC: '0x74b7f16337b8972027f6196a17a631ac6de26d22',
    'USDC.E': '0xA8CE8aee21bC2A48a5EF670afCc9274C7bbbC035'
  }),
  testnet: Object.freeze({
    USDC: '',
    'USDC.E': ''
  })
});

export function getDefaultXLayerNetwork() {
  return XLAYER.testnet;
}

export function getDefaultXLayerTokenAddress(tokenSymbol = 'USDC', chainId = getDefaultXLayerNetwork().chainId) {
  const normalizedSymbol = String(tokenSymbol || 'USDC').trim().toUpperCase();
  const normalizedChainId = Number(chainId || getDefaultXLayerNetwork().chainId);
  const network = normalizedChainId === XLAYER.mainnet.chainId ? 'mainnet' : 'testnet';
  return XLAYER_TOKEN_ADDRESSES[network]?.[normalizedSymbol] || '';
}

export function buildVerifiedContractInfoUrl(contractAddress, chainShortName = XLAYER.chainShortName) {
  const params = new URLSearchParams({
    chainShortName: String(chainShortName || XLAYER.chainShortName).toLowerCase(),
    contractAddress
  });
  return `https://web3.okx.com/api/v5/xlayer/contract/verify-contract-info?${params.toString()}`;
}

export function buildVerifySourceCodeUrl() {
  return 'https://web3.okx.com/api/v5/xlayer/contract/verify-source-code';
}

export function buildContractVerificationUrl() {
  return 'https://web3.okx.com/api/v5/xlayer/contract/check-verify-result';
}

export function createXLayerDeploymentManifest(overrides = {}) {
  const network = overrides.network === 'mainnet' ? XLAYER.mainnet : XLAYER.testnet;
  return {
    chainShortName: XLAYER.chainShortName,
    network: overrides.network || 'testnet',
    chainId: network.chainId,
    rpcUrl: network.rpcUrl,
    explorerBaseUrl: network.explorerBaseUrl,
    contractName: XLAYER.contract.name,
    contractVersion: XLAYER.contract.version,
    abiVersion: XLAYER.contract.abiVersion,
    compilerVersion: XLAYER.contract.compilerVersion,
    optimization: XLAYER.contract.optimization,
    optimizationRuns: XLAYER.contract.optimizationRuns,
    evmVersion: XLAYER.contract.evmVersion,
    licenseType: XLAYER.contract.licenseType,
    viaIr: XLAYER.contract.viaIr,
    ...overrides
  };
}
