import assert from 'node:assert/strict';
import { createBounty, createSubmission, loadState, loginWithEmail, registerEmailAccount, resolveAuthContext, saveState, verifyEmailAccount, verifySubmission } from '../src/store.js';
import { seedState } from '../src/data.js';

async function run() {
  await saveState(seedState);

  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;

  process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        output_text: JSON.stringify({
          model: 'gpt-5',
          mode: 'ai-assisted',
          conclusion: 'approve',
          confidence: 0.91,
          explanation: 'The submission evidence matches the bounty requirements and the deterministic checks passed.',
          evidenceSnapshot: {
            submissionUrl: 'https://x.com/demo/status/9',
            submittedAt: '2026-08-14T09:00:00Z',
            screenshots: ['https://cdn.example.com/ai/screen.png'],
            pageSnapshots: ['{"url":"https://x.com/demo/status/9","title":"AI smoke proof"}'],
            metadataKeys: ['source', 'capturedBy'],
            sourceHost: 'x.com',
            sourcePath: '/demo/status/9'
          },
          requirementFindings: [
            {
              requirementId: 'req_ai_1',
              type: 'url_exists',
              label: 'Submission includes a public X URL',
              pass: true,
              reason: 'The submission points to a public X post and the evidence bundle includes a matching URL.',
              confidence: 0.96,
              evidence: { source: 'submission.url' }
            },
            {
              requirementId: 'req_ai_2',
              type: 'text_contains',
              label: 'Post includes required tags',
              pass: true,
              reason: 'The thread text includes the required tag and mention.',
              confidence: 0.9,
              evidence: { source: 'submission.content' }
            }
          ],
          summary: {
            totalRequirements: 2,
            passedRequirements: 2,
            failedRequirements: 0,
            evidenceCompleteness: 4,
            releaseRecommendation: 'approve'
          }
        })
      };
    }
  });

  try {
    const registration = await registerEmailAccount({
      email: 'ops@okx.local',
      password: 'Str0ngP@ssw0rd!',
      displayName: 'OKX Ops',
      handle: '@okx'
    });
    await verifyEmailAccount({ email: 'ops@okx.local', token: registration.verificationToken });
    const login = await loginWithEmail({
      email: 'ops@okx.local',
      password: 'Str0ngP@ssw0rd!'
    });
    const state = await loadState();
    const auth = resolveAuthContext(state, login.auth.sessionId);

    const bounty = await createBounty({
      title: 'AI verifier smoke bounty',
      rewardAmount: 50,
      rewardToken: 'USDC',
      deadline: '2026-08-31T23:59:00Z',
      ownerHandle: '@okx',
      requirementSummary: 'Accept a public X post that mentions X Layer and includes the required tag.',
      orgId: 'org_0001',
      requirements: [
        {
          id: 'req_ai_1',
          type: 'url_exists',
          description: 'Submission includes a public X URL',
          params: { domain_allowlist: ['x.com'] }
        },
        {
          id: 'req_ai_2',
          type: 'text_contains',
          description: 'Post includes the required tags',
          params: { must_include: ['#XLayer', '@okx'] }
        }
      ]
    }, auth);

    const submission = await createSubmission({
      bountyId: bounty.bountyId,
      contributorHandle: '@submitter_handle',
      url: 'https://x.com/demo/status/9',
      submittedAt: '2026-08-14T09:00:00Z',
      tweetCount: 5,
      content: 'Thread 1: X Layer matters.\n\nThread 2: #XLayer and @okx are both included.',
      screenshotUrls: ['https://cdn.example.com/ai/screen.png'],
      pageSnapshots: ['{"url":"https://x.com/demo/status/9","title":"AI smoke proof"}'],
      evidenceMetadata: { source: 'browser', capturedBy: 'ai test' }
    }, auth);

    const verification = await verifySubmission({
      bountyId: bounty.bountyId,
      submissionId: submission.submissionId
    }, auth);

    assert.equal(verification.aiVerdict?.source, 'openai');
    assert.equal(verification.aiVerdict?.mode, 'ai-assisted');
    assert.equal(verification.aiVerdict?.conclusion, 'approve');
    assert.ok(verification.reasoningSummary.includes('deterministic checks passed'));
    assert.ok(verification.overallPass);
    assert.ok(verification.reasoningTrail.length > 0);
  } finally {
    globalThis.fetch = previousFetch;
    process.env.OPENAI_API_KEY = previousKey;
    await saveState(seedState);
  }
}

await run();
