export const seedState = {
  currentPosterHandle: '@okx',
  currentContributorHandle: '@submitter_handle',
  bounties: [
    {
      bountyId: 'bnty_0001',
      title: 'Write a Twitter thread about X Layer',
      rewardAmount: 50,
      rewardToken: 'USDC',
      deadline: '2026-08-20T23:59:00Z',
      status: 'Funded',
      ownerHandle: '@okx',
      requirementSummary: 'URL, hashtags, deadline, length, account',
      escrowTxHash: '0x7d9b8e2f4a91b4e9',
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
      title: 'Publish a product demo clip',
      rewardAmount: 120,
      rewardToken: 'USDC',
      deadline: '2026-08-14T23:59:00Z',
      status: 'Open',
      ownerHandle: '@bounty_lead',
      requirementSummary: 'Valid link, deadline, minimum duration, and account match',
      escrowTxHash: '0x0c4b7e3fa12d91ff',
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
      title: 'Ship a docs update for escrow flow',
      rewardAmount: 75,
      rewardToken: 'USDC',
      deadline: '2026-08-12T23:59:00Z',
      status: 'Paid',
      ownerHandle: '@docs_team',
      requirementSummary: 'Doc URL, changelog keyword, deadline, and account match',
      escrowTxHash: '0x1fa0a22e9dbe11bc',
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
