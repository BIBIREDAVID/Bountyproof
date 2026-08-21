import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import {
  acceptInvite,
  createBounty,
  createDispute,
  createInvite,
  createSubmission,
  issueWalletChallenge,
  loginWithEmail,
  loginWithWallet,
  registerEmailAccount,
  resolveAuthContext,
  resolveDispute,
  releaseBounty,
  refundBounty,
  saveState,
  verifyEmailAccount,
  switchActiveOrg,
  verifySubmission,
  loadState
} from '../src/store.js';
import { seedState } from '../src/data.js';

async function expectReject(promise, messagePattern) {
  let caught = null;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'Expected the operation to fail');
  assert.match(String(caught.message || caught), messagePattern);
}

async function registerVerifyLogin(email, password, extra = {}) {
  const registration = await registerEmailAccount({
    email,
    password,
    displayName: extra.displayName,
    handle: extra.handle
  });
  return verifyEmailAccount({ email, token: registration.verificationToken });
}

async function run() {
  await saveState(seedState);

  try {
    const emailLogin = await registerVerifyLogin('ops@okx.local', 'Str0ngP@ssw0rd!', {
      displayName: 'OKX Ops',
      handle: '@okx'
    });
    assert.equal(emailLogin.auth.mode, 'session');
    assert.ok(emailLogin.auth.sessionId);
    assert.equal(emailLogin.auth.activeOrg.orgId, 'org_0001');
    assert.ok(emailLogin.auth.csrfToken);

    const wallet = new Wallet('0x59c6995e998f97a5a004497e5da9c12f4a5c7dff3b4d8f6c1f2f4b9b7a8c1d23');
    const challenge = await issueWalletChallenge({
      walletAddress: wallet.address,
      domain: 'localhost',
      uri: 'http://127.0.0.1:3000'
    });
    const signature = await wallet.signMessage(challenge.message);
    const walletLogin = await loginWithWallet({
      walletAddress: wallet.address,
      displayName: 'Wallet Operator',
      handle: '@wallet_ops',
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      signature,
      domain: challenge.domain,
      uri: challenge.uri
    });
    assert.equal(walletLogin.auth.mode, 'session');
    assert.ok(walletLogin.auth.sessionId);
    assert.equal(walletLogin.auth.user.handle, '@wallet_ops');

    const ownerState = await loadState();
    const ownerAuth = resolveAuthContext(ownerState, emailLogin.auth.sessionId);
    const invite = await createInvite('org_0001', {
      email: 'reviewer@okx.local',
      role: 'reviewer'
    }, ownerAuth);
    assert.equal(invite.role, 'reviewer');

    const reviewerLogin = await registerVerifyLogin('reviewer@okx.local', 'Reviewer@1234', {
      displayName: 'Reviewer'
    });
    const reviewerAuth = resolveAuthContext(await loadState(), reviewerLogin.auth.sessionId);
    const acceptedInvite = await acceptInvite(invite.code, reviewerAuth);
    assert.equal(acceptedInvite.status, 'accepted');
    await switchActiveOrg(reviewerLogin.auth.sessionId, 'org_0001');

    const reviewerState = await loadState();
    const reviewerAfterAccept = resolveAuthContext(reviewerState, reviewerLogin.auth.sessionId);
    assert.equal(reviewerAfterAccept.activeOrg.orgId, 'org_0001');
    assert.ok(reviewerAfterAccept.availableOrgs.some((org) => org.orgId === 'org_0001'));

    const posterLogin = await registerVerifyLogin('lead@bounties.local', 'Lead@1234', {
      displayName: 'Bounty Lead'
    });
    await switchActiveOrg(posterLogin.auth.sessionId, 'org_0001');
    const posterAuth = resolveAuthContext(await loadState(), posterLogin.auth.sessionId);
    assert.equal(posterAuth.role, 'poster');

    const bounty = await createBounty({
      title: 'Auth smoke bounty',
      rewardAmount: 25,
      rewardToken: 'USDC',
      deadline: '2026-08-30T23:59:00Z',
      ownerHandle: '@bounty_lead',
      requirementSummary: 'URL and text checks',
      orgId: 'org_0001',
      requirements: [
        {
          id: 'req_auth_1',
          type: 'url_exists',
          description: 'Must include a valid URL',
          params: { domain_allowlist: ['x.com'] }
        }
      ]
    }, posterAuth);
    assert.equal(bounty.orgId, 'org_0001');

    const submission = await createSubmission({
      bountyId: bounty.bountyId,
      contributorHandle: '@bounty_lead',
      url: 'https://x.com/demo/status/1',
      submittedAt: '2026-08-11T10:00:00Z',
      tweetCount: 1,
      content: 'Proof content for the auth smoke test.',
      screenshotUrls: ['https://cdn.example.com/screens/1.png'],
      pageSnapshots: ['{"url":"https://x.com/demo/status/1","title":"Demo proof"}'],
      evidenceMetadata: { source: 'browser', capturedBy: 'auth test' }
    }, posterAuth);
    assert.equal(submission.bountyId, bounty.bountyId);
    assert.ok(submission.evidenceProfile.screenshotCount >= 1);

    await expectReject(
      verifySubmission({
        bountyId: bounty.bountyId,
        submissionId: submission.submissionId
      }, posterAuth),
      /Forbidden/
    );

    const dispute = await createDispute({
      bountyId: bounty.bountyId,
      submissionId: submission.submissionId,
      verificationId: null,
      reason: 'The submission is missing evidence context.',
      evidenceUrl: 'https://example.com/evidence'
    }, posterAuth);
    assert.equal(dispute.status, 'open');

    const resolved = await resolveDispute(dispute.disputeId, {
      outcome: 'reverify',
      resolutionNotes: 'Reviewer requested another pass.'
    }, ownerAuth);
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.resolutionOutcome, 'reverify');

    const liveState = await loadState();
    assert.ok(liveState.notifications.some((notification) => notification.relatedId === submission.submissionId));
    assert.ok(liveState.auditLogs.some((log) => log.entityId === submission.submissionId || log.entityId === dispute.disputeId));

    const releaseBountyRecord = await createBounty({
      title: 'Release smoke bounty',
      rewardAmount: 30,
      rewardToken: 'USDC',
      deadline: '2026-08-31T23:59:00Z',
      ownerHandle: '@bounty_lead',
      requirementSummary: 'Release flow smoke test',
      orgId: 'org_0001',
      requirements: [
        {
          id: 'req_release_1',
          type: 'url_exists',
          description: 'Must include a valid URL',
          params: { domain_allowlist: ['x.com'] }
        }
      ]
    }, ownerAuth);

    const releaseSubmission = await createSubmission({
      bountyId: releaseBountyRecord.bountyId,
      contributorHandle: '@bounty_lead',
      url: 'https://x.com/demo/status/2',
      submittedAt: '2026-08-11T11:00:00Z',
      tweetCount: 1,
      content: 'Release proof content.',
      screenshotUrls: ['https://cdn.example.com/screens/release.png'],
      pageSnapshots: ['{"url":"https://x.com/demo/status/2","title":"Release proof"}'],
      evidenceMetadata: { source: 'browser', capturedBy: 'release test' }
    }, ownerAuth);

    const releaseVerification = await verifySubmission({
      bountyId: releaseBountyRecord.bountyId,
      submissionId: releaseSubmission.submissionId
    }, ownerAuth);
    assert.ok(releaseVerification.chainProofHash);
    assert.ok(releaseVerification.aiVerdict);
    assert.ok(releaseVerification.reasoningSummary);
    assert.ok(releaseVerification.confidenceScore > 0);
    assert.ok(Array.isArray(releaseVerification.reasoningTrail));
    assert.ok(releaseVerification.reasoningTrail.length > 0);

    const released = await releaseBounty(releaseBountyRecord.bountyId, {
      reason: 'Release smoke test'
    }, ownerAuth);
    assert.equal(released.status, 'Paid');
    assert.equal(released.payoutStatus, 'Released');

    const refundBountyRecord = await createBounty({
      title: 'Refund smoke bounty',
      rewardAmount: 15,
      rewardToken: 'USDC',
      deadline: '2026-08-31T23:59:00Z',
      ownerHandle: '@bounty_lead',
      requirementSummary: 'Refund flow smoke test',
      orgId: 'org_0001',
      requirements: []
    }, ownerAuth);

    const refunded = await refundBounty(refundBountyRecord.bountyId, {
      reason: 'Refund smoke test'
    }, ownerAuth);
    assert.equal(refunded.status, 'Refunded');
    assert.equal(refunded.payoutStatus, 'Refunded');

    const postChainState = await loadState();
    assert.ok(postChainState.chainEvents.some((event) => event.type === 'proof_writeback' && event.bountyId === releaseBountyRecord.bountyId));
    assert.ok(postChainState.chainEvents.some((event) => event.type === 'escrow_release' && event.bountyId === releaseBountyRecord.bountyId));
    assert.ok(postChainState.chainEvents.some((event) => event.type === 'escrow_refund' && event.bountyId === refundBountyRecord.bountyId));
  } finally {
    await saveState(seedState);
  }
}

await run();
