# BountyProof

Batch 1 of the BountyProof MVP.

## What is in this batch

- A polished static prototype for the main bounty workflow
- A typed requirement schema and deterministic evaluator
- A tiny Node static server for local preview
- Minimal tests for the verifier logic

## X Layer contract scaffold

This repo now includes a minimal single-file Solidity contract and X Layer verification helpers:

- `contracts/BountyProofTreasury.sol`
- `contracts/BountyProofTreasury.abi.json`
- `deploy/xlayer/BountyProofTreasury.manifest.example.json`
- `deploy/xlayer/BountyProofTreasury.verify-request.example.json`
- `scripts/verify-xlayer-contract.mjs`
- `scripts/fetch-xlayer-verified-contract.mjs`
- `scripts/deploy-and-verify-xlayer.mjs`
- `.env.example`

The contract is pinned to X Layer testnet defaults:

- Chain ID `1952`
- RPC `https://testrpc.xlayer.tech/terigon`
- Explorer `https://www.okx.com/web3/explorer/xlayer-test`

### Suggested workflow

1. Create a local `.env` file from `.env.example`.
2. Fund your test wallet with X Layer testnet OKB from the faucet.
3. Deploy with `npm run xlayer:testnet:deploy`.
4. Run `npm run xlayer:verify -- --contract-address <address>` after setting `OK_ACCESS_KEY`, `OK_ACCESS_SECRET`, and `OK_ACCESS_PASSPHRASE`.
5. Run `npm run xlayer:fetch -- --contract-address <address>` to retrieve the verified ABI and source.
6. Point the app state at the deployed contract metadata.

### One-command flow

If you already have your environment variables set, run:

```bash
npm run xlayer:testnet:deploy
```

For testnet, the fastest way to get gas is the official faucet:

- [X Layer testnet faucet](https://web3.okx.com/en/xlayer/faucet)

If you want the full deploy-and-verify flow later, you can still run:

```bash
npm run xlayer:deploy-and-verify -- --network testnet
```

That will:

- deploy the contract
- write the manifest
- verify the source
- fetch the verified ABI/source snapshot into `deploy/xlayer/BountyProofTreasury.verified.json`

## Run it

Create a local `.env` file from `.env.example` if you need secrets or deploy settings. The app and deploy scripts load `.env` automatically when they start.

```bash
npm run start
```

Open `http://127.0.0.1:3000`.

## Test it

```bash
npm test
```
