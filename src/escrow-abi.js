export const TREASURY_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'admin_', type: 'address' },
      { internalType: 'uint256', name: 'chainId_', type: 'uint256' },
      { internalType: 'string', name: 'contractVersion_', type: 'string' }
    ],
    stateMutability: 'nonpayable',
    type: 'constructor'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'bountyIdHash', type: 'bytes32' },
      { indexed: true, internalType: 'bytes32', name: 'submissionIdHash', type: 'bytes32' },
      { indexed: true, internalType: 'bytes32', name: 'verificationIdHash', type: 'bytes32' },
      { indexed: false, internalType: 'bytes32', name: 'proofHash', type: 'bytes32' },
      { indexed: false, internalType: 'bool', name: 'approved', type: 'bool' },
      { indexed: false, internalType: 'address', name: 'signer', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'recordedAt', type: 'uint256' }
    ],
    name: 'ProofRecorded',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'bytes32', name: 'bountyIdHash', type: 'bytes32' },
      { indexed: false, internalType: 'bool', name: 'eligible', type: 'bool' },
      { indexed: false, internalType: 'address', name: 'signer', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'recordedAt', type: 'uint256' }
    ],
    name: 'PayoutEligibilityUpdated',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'string', name: 'bountyId', type: 'string' },
      { indexed: true, internalType: 'address', name: 'token', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'participantCount', type: 'uint256' }
    ],
    name: 'BountyFunded',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'string', name: 'bountyId', type: 'string' },
      { indexed: true, internalType: 'address', name: 'recipient', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }
    ],
    name: 'BountyReleased',
    type: 'event'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'string', name: 'bountyId', type: 'string' },
      { indexed: true, internalType: 'address', name: 'recipient', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }
    ],
    name: 'BountyRefunded',
    type: 'event'
  },
  {
    inputs: [],
    name: 'admin',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'chainIdPinned',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'contractVersion',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'string', name: 'value', type: 'string' }
    ],
    name: 'hashId',
    outputs: [{ internalType: 'bytes32', name: '', type: 'bytes32' }],
    stateMutability: 'pure',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'bytes32', name: 'bountyIdHash', type: 'bytes32' }
    ],
    name: 'getProofRecord',
    outputs: [
      {
        components: [
          { internalType: 'bytes32', name: 'bountyIdHash', type: 'bytes32' },
          { internalType: 'bytes32', name: 'submissionIdHash', type: 'bytes32' },
          { internalType: 'bytes32', name: 'verificationIdHash', type: 'bytes32' },
          { internalType: 'bytes32', name: 'proofHash', type: 'bytes32' },
          { internalType: 'bool', name: 'approved', type: 'bool' },
          { internalType: 'address', name: 'signer', type: 'address' },
          { internalType: 'uint256', name: 'recordedAt', type: 'uint256' }
        ],
        internalType: 'struct BountyProofTreasury.ProofRecord',
        name: '',
        type: 'tuple'
      }
    ],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'bytes32', name: '', type: 'bytes32' }
    ],
    name: 'payoutEligible',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'string', name: 'bountyId', type: 'string' },
      { internalType: 'string', name: 'submissionId', type: 'string' },
      { internalType: 'string', name: 'verificationId', type: 'string' },
      { internalType: 'bytes32', name: 'proofHash', type: 'bytes32' },
      { internalType: 'bool', name: 'approved', type: 'bool' }
    ],
    name: 'recordProof',
    outputs: [
      { internalType: 'bytes32', name: 'bountyIdHash', type: 'bytes32' },
      { internalType: 'bytes32', name: 'submissionIdHash', type: 'bytes32' },
      { internalType: 'bytes32', name: 'verificationIdHash', type: 'bytes32' }
    ],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'string', name: 'bountyId', type: 'string' },
      { internalType: 'bool', name: 'eligible', type: 'bool' }
    ],
    name: 'setPayoutEligible',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'string', name: 'bountyId', type: 'string' },
      { internalType: 'address', name: 'token', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
      { internalType: 'uint256', name: 'participantCount', type: 'uint256' }
    ],
    name: 'fundBounty',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'string', name: 'bountyId', type: 'string' }
    ],
    name: 'releaseBounty',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'string', name: 'bountyId', type: 'string' }
    ],
    name: 'refundBounty',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
];

export const ERC20_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'spender', type: 'address' }, { internalType: 'uint256', name: 'value', type: 'uint256' }],
    name: 'approve',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  }
];
