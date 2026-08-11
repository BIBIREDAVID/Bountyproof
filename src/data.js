export const seedState = {
  currentPosterHandle: '@okx',
  currentContributorHandle: '@submitter_handle',
  currentUserId: 'usr_0001',
  currentOrgId: 'org_0001',
  auditLogs: [],
  bountyVersions: [],
  chainEvents: [],
  notifications: [],
  walletChallenges: [],
  disputes: [],
  idempotencyRecords: [],
  users: [
    {
      userId: 'usr_0001',
      handle: '@okx',
      displayName: 'OKX Ops',
      email: 'ops@okx.local',
      walletAddress: '0xokx000000000001',
      authMethod: 'email',
      createdAt: '2026-08-01T08:00:00Z'
    },
    {
      userId: 'usr_0002',
      handle: '@bounty_lead',
      displayName: 'Bounty Lead',
      email: 'lead@bounties.local',
      walletAddress: '0xokx000000000002',
      authMethod: 'email',
      createdAt: '2026-08-01T08:10:00Z'
    },
    {
      userId: 'usr_0003',
      handle: '@docs_team',
      displayName: 'Docs Team',
      email: 'docs@bounties.local',
      walletAddress: '0xokx000000000003',
      authMethod: 'email',
      createdAt: '2026-08-01T08:20:00Z'
    },
    {
      userId: 'usr_0004',
      handle: '@submitter_handle',
      displayName: 'Submitter',
      email: 'submitter@demo.local',
      walletAddress: '0xokx000000000004',
      authMethod: 'wallet',
      createdAt: '2026-08-01T08:30:00Z'
    },
    {
      userId: 'usr_0005',
      handle: '@another_handle',
      displayName: 'Another Creator',
      email: 'another@demo.local',
      walletAddress: '0xokx000000000005',
      authMethod: 'wallet',
      createdAt: '2026-08-01T08:40:00Z'
    },
    {
      userId: 'usr_0006',
      handle: '@video_creator',
      displayName: 'Video Creator',
      email: 'video@demo.local',
      walletAddress: '0xokx000000000006',
      authMethod: 'wallet',
      createdAt: '2026-08-01T08:50:00Z'
    },
    {
      userId: 'usr_0007',
      handle: '@docs_writer',
      displayName: 'Docs Writer',
      email: 'writer@demo.local',
      walletAddress: '0xokx000000000007',
      authMethod: 'wallet',
      createdAt: '2026-08-01T09:00:00Z'
    }
  ],
  orgs: [
    {
      orgId: 'org_0001',
      name: 'OKX Bounty Ops',
      slug: 'okx-bounty-ops',
      ownerUserId: 'usr_0001',
      createdAt: '2026-08-01T09:05:00Z',
      updatedAt: '2026-08-10T09:00:00Z'
    },
    {
      orgId: 'org_0002',
      name: 'Bounty Lead Studio',
      slug: 'bounty-lead-studio',
      ownerUserId: 'usr_0002',
      createdAt: '2026-08-01T09:15:00Z',
      updatedAt: '2026-08-09T18:30:00Z'
    },
    {
      orgId: 'org_0003',
      name: 'Docs Team',
      slug: 'docs-team',
      ownerUserId: 'usr_0003',
      createdAt: '2026-08-01T09:25:00Z',
      updatedAt: '2026-08-07T15:10:00Z'
    }
  ],
  memberships: [
    { membershipId: 'mbr_0001', orgId: 'org_0001', userId: 'usr_0001', role: 'owner', createdAt: '2026-08-01T09:05:00Z' },
    { membershipId: 'mbr_0002', orgId: 'org_0002', userId: 'usr_0002', role: 'owner', createdAt: '2026-08-01T09:15:00Z' },
    { membershipId: 'mbr_0003', orgId: 'org_0003', userId: 'usr_0003', role: 'owner', createdAt: '2026-08-01T09:25:00Z' },
    { membershipId: 'mbr_0004', orgId: 'org_0001', userId: 'usr_0002', role: 'poster', createdAt: '2026-08-02T10:00:00Z' },
    { membershipId: 'mbr_0005', orgId: 'org_0001', userId: 'usr_0004', role: 'reviewer', createdAt: '2026-08-02T10:10:00Z' },
    { membershipId: 'mbr_0006', orgId: 'org_0002', userId: 'usr_0006', role: 'contributor', createdAt: '2026-08-02T10:20:00Z' },
    { membershipId: 'mbr_0007', orgId: 'org_0003', userId: 'usr_0007', role: 'contributor', createdAt: '2026-08-02T10:30:00Z' }
  ],
  invites: [
    {
      inviteId: 'inv_0001',
      code: 'invite_okx_reviewer',
      orgId: 'org_0001',
      email: 'reviewer@okx.local',
      walletAddress: '',
      handle: '@reviewer',
      role: 'reviewer',
      invitedByUserId: 'usr_0001',
      status: 'pending',
      createdAt: '2026-08-10T10:00:00Z',
      expiresAt: '2026-09-10T10:00:00Z'
    }
  ],
  sessions: [
    {
      sessionId: 'ses_0001',
      userId: 'usr_0001',
      activeOrgId: 'org_0001',
      createdAt: '2026-08-10T09:00:00Z',
      lastSeenAt: '2026-08-10T09:00:00Z',
      csrfToken: 'csrf_seed_0001'
    }
  ],
  bounties: [
    {
      bountyId: 'bnty_0001',
      orgId: 'org_0001',
      createdByUserId: 'usr_0001',
      title: 'Write a Twitter thread about X Layer',
      rewardAmount: 50,
      rewardToken: 'USDC',
      deadline: '2026-08-20T23:59:00Z',
      status: 'Funded',
      ownerHandle: '@okx',
      requirementSummary: 'URL, hashtags, deadline, length, account',
      escrowTxHash: '0x7d9b8e2f4a91b4e9',
      chainId: 80001,
      contractAddress: '0x1111111111111111111111111111111111111111',
      contractVersion: 'v1.3.0',
      abiVersion: 'abi-2026-08',
      contractVerified: true,
      explorerBaseUrl: 'https://explorer.xlayer.tech',
      treasuryType: 'multisig',
      treasuryAddress: '0x2222222222222222222222222222222222222222',
      treasuryThreshold: 2,
      treasurySigners: [
        '0x3333333333333333333333333333333333333333',
        '0x4444444444444444444444444444444444444444',
        '0x5555555555555555555555555555555555555555'
      ],
      fundingTxHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      payoutTxHash: '',
      refundTxHash: '',
      onChainStatus: 'funded',
      chainSyncStatus: 'synced',
      lastChainSyncedAt: '2026-08-10T09:21:00Z',
      createdAt: '2026-08-08T09:00:00Z',
      updatedAt: '2026-08-10T09:20:00Z',
      requirements: [
        {
          id: 'req_1',
          type: 'url_exists',
          description: 'Submission includes a publicly accessible URL',
          params: { domain_allowlist: ['twitter.com', 'x.com'] }
        },
        {
          id: 'req_2',
          type: 'text_contains',
          description: 'Post includes required hashtag and mention',
          params: { must_include: ['#XLayer', '@okx'] }
        },
        {
          id: 'req_3',
          type: 'before_deadline',
          description: 'Submitted before bounty deadline',
          params: { deadline: '2026-08-20T23:59:00Z' }
        },
        {
          id: 'req_4',
          type: 'min_length',
          description: 'Content meets minimum thread size',
          params: { unit: 'tweets', min: 5 }
        },
        {
          id: 'req_5',
          type: 'account_match',
          description: 'Posted from the verified account',
          params: { verified_account_handle: '@submitter_handle' }
        }
      ]
    },
    {
      bountyId: 'bnty_0002',
      orgId: 'org_0002',
      createdByUserId: 'usr_0002',
      title: 'Publish a product demo clip',
      rewardAmount: 120,
      rewardToken: 'USDC',
      deadline: '2026-08-14T23:59:00Z',
      status: 'Open',
      ownerHandle: '@bounty_lead',
      requirementSummary: 'Valid link, deadline, minimum duration, and account match',
      escrowTxHash: '0x0c4b7e3fa12d91ff',
      chainId: 80001,
      contractAddress: '0x6666666666666666666666666666666666666666',
      contractVersion: 'v1.3.0',
      abiVersion: 'abi-2026-08',
      contractVerified: true,
      explorerBaseUrl: 'https://explorer.xlayer.tech',
      treasuryType: 'multisig',
      treasuryAddress: '0x7777777777777777777777777777777777777777',
      treasuryThreshold: 3,
      treasurySigners: [
        '0x8888888888888888888888888888888888888888',
        '0x9999999999999999999999999999999999999999',
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      ],
      fundingTxHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      payoutTxHash: '',
      refundTxHash: '',
      onChainStatus: 'draft',
      chainSyncStatus: 'pending',
      lastChainSyncedAt: '2026-08-09T18:31:00Z',
      createdAt: '2026-08-09T18:30:00Z',
      updatedAt: '2026-08-09T18:30:00Z',
      requirements: [
        {
          id: 'req_6',
          type: 'url_exists',
          description: 'Submission includes a valid clip URL',
          params: { domain_allowlist: ['drive.google.com', 'youtube.com', 'youtu.be'] }
        },
        {
          id: 'req_7',
          type: 'before_deadline',
          description: 'Submitted before demo deadline',
          params: { deadline: '2026-08-14T23:59:00Z' }
        },
        {
          id: 'req_8',
          type: 'min_length',
          description: 'Clip description is at least 2 paragraphs',
          params: { unit: 'words', min: 60 }
        },
        {
          id: 'req_9',
          type: 'account_match',
          description: 'Submitted from the linked contributor account',
          params: { verified_account_handle: '@video_creator' }
        }
      ]
    },
    {
      bountyId: 'bnty_0003',
      orgId: 'org_0003',
      createdByUserId: 'usr_0003',
      title: 'Ship a docs update for escrow flow',
      rewardAmount: 75,
      rewardToken: 'USDC',
      deadline: '2026-08-12T23:59:00Z',
      status: 'Paid',
      ownerHandle: '@docs_team',
      requirementSummary: 'Doc URL, changelog keyword, deadline, and account match',
      escrowTxHash: '0x1fa0a22e9dbe11bc',
      chainId: 80001,
      contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      contractVersion: 'v1.2.5',
      abiVersion: 'abi-2026-06',
      contractVerified: true,
      explorerBaseUrl: 'https://explorer.xlayer.tech',
      treasuryType: 'multisig',
      treasuryAddress: '0xcccccccccccccccccccccccccccccccccccccccc',
      treasuryThreshold: 2,
      treasurySigners: [
        '0xdddddddddddddddddddddddddddddddddddddddd',
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
      ],
      fundingTxHash: '0xcccccccccccccccccccccccccccccccc',
      payoutTxHash: '0xdddddddddddddddddddddddddddddddd',
      refundTxHash: '',
      onChainStatus: 'paid',
      chainSyncStatus: 'synced',
      lastChainSyncedAt: '2026-08-07T15:11:00Z',
      createdAt: '2026-08-06T10:20:00Z',
      updatedAt: '2026-08-07T15:10:00Z',
      requirements: [
        {
          id: 'req_10',
          type: 'url_exists',
          description: 'Submission includes the published docs URL',
          params: { domain_allowlist: ['notion.so', 'docs.google.com', 'github.com'] }
        },
        {
          id: 'req_11',
          type: 'text_contains',
          description: 'Update mentions the escrow release flow',
          params: { must_include: ['escrow', 'release'] }
        },
        {
          id: 'req_12',
          type: 'before_deadline',
          description: 'Submitted before the docs deadline',
          params: { deadline: '2026-08-12T23:59:00Z' }
        }
      ]
    }
  ],
  submissions: [
    {
      submissionId: 'sub_0007',
      bountyId: 'bnty_0001',
      contributorHandle: '@submitter_handle',
      contributorUserId: 'usr_0004',
      url: 'https://x.com/submitter/status/1842100000000000000',
      submittedAt: '2026-08-10T09:20:00Z',
      tweetCount: 5,
      content: [
        'Thread 1: X Layer makes settlement feel instant.',
        'Thread 2: The UX is clean, the fees are low, and it is simple to demo.',
        'Thread 3: We built a bounty flow on chain with escrowed rewards.',
        'Thread 4: #XLayer is the right place for fast finality.',
        'Thread 5: Thanks to @okx for the support.'
      ].join('\n\n'),
      createdAt: '2026-08-10T09:20:00Z'
    },
    {
      submissionId: 'sub_0008',
      bountyId: 'bnty_0001',
      contributorHandle: '@another_handle',
      contributorUserId: 'usr_0005',
      url: 'https://x.com/another/status/1842100000000000001',
      submittedAt: '2026-08-10T10:25:00Z',
      tweetCount: 3,
      content: [
        'A shorter thread that misses the minimum length.',
        'It also omits one required tag.',
        'This is the failure path.'
      ].join('\n\n'),
      createdAt: '2026-08-10T10:25:00Z'
    },
    {
      submissionId: 'sub_0009',
      bountyId: 'bnty_0003',
      contributorHandle: '@docs_writer',
      contributorUserId: 'usr_0007',
      url: 'https://github.com/okx-docs/escrow-flow/pull/44',
      submittedAt: '2026-08-07T13:10:00Z',
      tweetCount: 1,
      content: 'Updated the escrow docs with the release notes, the audit trail, and the payout conditions.',
      createdAt: '2026-08-07T13:10:00Z'
    }
  ],
  verifications: [
    {
      verificationId: 'ver_0001',
      bountyId: 'bnty_0001',
      submissionId: 'sub_0007',
      overallPass: true,
      verdictHash: '0x6d3e8f2be73a',
      createdAt: '2026-08-10T09:20:10Z',
      results: [
        { req_id: 'req_1', pass: true, reason: 'Valid x.com URL found.' },
        { req_id: 'req_2', pass: true, reason: 'Both required tags present.' },
        { req_id: 'req_3', pass: true, reason: 'Submitted before the deadline.' },
        { req_id: 'req_4', pass: true, reason: 'Thread has 5 tweets.' },
        { req_id: 'req_5', pass: true, reason: 'Matched verified account handle.' }
      ]
    },
    {
      verificationId: 'ver_0002',
      bountyId: 'bnty_0001',
      submissionId: 'sub_0008',
      overallPass: false,
      verdictHash: '0x4f9ad5d2c37b',
      createdAt: '2026-08-10T10:25:20Z',
      results: [
        { req_id: 'req_1', pass: true, reason: 'Valid x.com URL found.' },
        { req_id: 'req_2', pass: false, reason: 'Missing required tokens: #XLayer, @okx.' },
        { req_id: 'req_3', pass: true, reason: 'Submitted before the deadline.' },
        { req_id: 'req_4', pass: false, reason: 'Thread has 3 tweets, minimum is 5.' },
        { req_id: 'req_5', pass: false, reason: 'Submission came from @another_handle, expected @submitter_handle.' }
      ]
    },
    {
      verificationId: 'ver_0003',
      bountyId: 'bnty_0003',
      submissionId: 'sub_0009',
      overallPass: true,
      verdictHash: '0x1cb71e9a8d55',
      createdAt: '2026-08-07T15:10:10Z',
      results: [
        { req_id: 'req_10', pass: true, reason: 'Valid github.com URL found.' },
        { req_id: 'req_11', pass: true, reason: 'Escrow flow keywords found.' },
        { req_id: 'req_12', pass: true, reason: 'Submitted before the deadline.' }
      ]
    }
  ]
};

export function createFreshState() {
  return structuredClone(seedState);
}
