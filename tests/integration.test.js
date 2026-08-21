import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Wallet } from 'ethers';
import { startServer } from '../server.js';
import { loadState, registerEmailAccount, saveState, verifyEmailAccount } from '../src/store.js';
import { seedState } from '../src/data.js';

const PORT = Number(process.env.BOUNTYPROOF_TEST_PORT || 3101);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function parseSetCookie(header) {
  if (!header) {
    return null;
  }
  const value = Array.isArray(header) ? header[0] : header;
  return String(value || '').split(';')[0] || null;
}

async function requestJson(path, { method = 'GET', body = undefined, headers = {}, cookie = '' } = {}) {
  const finalHeaders = { Accept: 'application/json', ...headers };
  if (cookie) {
    finalHeaders.Cookie = cookie;
  }
  if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    json,
    text
  };
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {}
    await delay(250);
  }
  throw new Error(`Server did not become ready at ${BASE_URL}`);
}

async function login(email, { displayName, handle, activeOrgId } = {}) {
  const registration = await requestJson('/api/auth/register', {
    method: 'POST',
    body: {
      email,
      password: 'Str0ngP@ssw0rd!',
      displayName,
      handle
    }
  });
  assert.equal(registration.status, 201, `Registration failed: ${registration.text}`);
  const verify = await requestJson('/api/auth/verify-email', {
    method: 'POST',
    body: {
      email,
      token: registration.json?.verificationToken,
      activeOrgId
    }
  });
  assert.equal(verify.status, 200, `Verification failed: ${verify.text}`);
  const response = await requestJson('/api/auth/email-login', {
    method: 'POST',
    body: {
      email,
      password: 'Str0ngP@ssw0rd!',
      activeOrgId
    }
  });
  assert.equal(response.status, 200, `Login failed: ${response.text}`);
  assert.ok(response.json?.auth?.sessionId, 'Expected a session id');
  assert.ok(response.json?.auth?.csrfToken, 'Expected a CSRF token');
  return {
    cookie: parseSetCookie(response.headers.get('set-cookie')),
    auth: response.json.auth
  };
}

async function authedRequest(path, session, { method = 'GET', body = undefined, idempotencyKey = undefined } = {}) {
  const headers = {
    'X-CSRF-Token': session.auth.csrfToken
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return requestJson(path, {
    method,
    body,
    headers,
    cookie: session.cookie
  });
}

async function run() {
  await saveState(seedState);

  const server = await startServer(PORT);
  try {
    await waitForServer();
    const homeResponse = await requestJson('/', { method: 'GET' });
    assert.equal(homeResponse.status, 200, homeResponse.text);
    assert.match(homeResponse.text, /BountyProof/);

    const spaResponse = await requestJson('/dashboard', { method: 'GET' });
    assert.equal(spaResponse.status, 200, spaResponse.text);
    assert.match(spaResponse.text, /BountyProof/);

    await requestJson('/api/reset', { method: 'POST', body: {} });

    const poster = await login('lead@bounties.local', {
      displayName: 'Bounty Lead',
      handle: '@bounty_lead'
    });

    const switchPosterOrg = await authedRequest('/api/orgs/org_0001/switch', poster, {
      method: 'POST',
      body: {}
    });
    assert.equal(switchPosterOrg.status, 200, switchPosterOrg.text);
    assert.equal(switchPosterOrg.json?.auth?.activeOrg?.orgId, 'org_0001');

    const createBountyResponse = await authedRequest('/api/bounties', poster, {
      method: 'POST',
      body: {
        title: 'Real-life smoke bounty',
        rewardAmount: 42,
        rewardToken: 'USDC',
        deadline: '2026-08-31T23:59:00Z',
        ownerHandle: '@bounty_lead',
        requirementSummary: 'URL, screenshots, metadata, and deadline',
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
          '0x4444444444444444444444444444444444444444'
        ],
        fundingTxHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        requirements: [
          {
            id: 'req_smoke_1',
            type: 'url_exists',
            description: 'Include a valid URL',
            params: { domain_allowlist: ['x.com'] }
          },
          {
            id: 'req_smoke_2',
            type: 'text_contains',
            description: 'Include the required tag',
            params: { must_include: ['#XLayer', '@okx'] }
          },
          {
            id: 'req_smoke_3',
            type: 'before_deadline',
            description: 'Submit before the deadline',
            params: { deadline: '2026-08-31T23:59:00Z' }
          }
        ]
      },
      idempotencyKey: 'smoke-create-bounty'
    });
    assert.equal(createBountyResponse.status, 201, createBountyResponse.text);
    assert.ok(createBountyResponse.json?.bounty?.bountyId, 'Expected a bounty id');
    const bountyId = createBountyResponse.json.bounty.bountyId;

    const reviewer = await login('submitter@demo.local', {
      displayName: 'Submitter',
      handle: '@submitter_handle'
    });

    const submissionResponse = await authedRequest('/api/submissions', reviewer, {
      method: 'POST',
      body: {
        bountyId,
        contributorHandle: '@submitter_handle',
        url: 'https://x.com/submitter/status/1842100000000000000',
        submittedAt: '2026-08-14T10:00:00Z',
        tweetCount: 5,
        content: [
          'Thread 1: X Layer makes settlement feel instant.',
          'Thread 2: The UX is clean and the flow is simple to demo.',
          'Thread 3: We built a bounty flow with escrowed rewards.',
          'Thread 4: #XLayer is the right place for fast finality.',
          'Thread 5: Thanks to @okx for the support.'
        ].join('\n\n'),
        screenshotUrls: ['https://cdn.example.com/screens/1.png'],
        pageSnapshots: ['{"url":"https://x.com/submitter/status/1842100000000000000","title":"Smoke proof"}'],
        evidenceMetadata: {
          source: 'browser',
          capturedBy: 'integration test',
          device: 'local machine'
        }
      },
      idempotencyKey: 'smoke-create-submission'
    });
    assert.equal(submissionResponse.status, 201, submissionResponse.text);
    const submissionId = submissionResponse.json?.submission?.submissionId;
    assert.ok(submissionId, 'Expected a submission id');

    const verificationResponse = await authedRequest('/api/verifications', reviewer, {
      method: 'POST',
      body: {
        bountyId,
        submissionId
      },
      idempotencyKey: 'smoke-verify-submission'
    });
    assert.equal(verificationResponse.status, 201, verificationResponse.text);
    assert.equal(verificationResponse.json?.verification?.overallPass, true);
    assert.ok(verificationResponse.json?.verification?.chainProofHash, 'Expected a proof hash');
    assert.ok(verificationResponse.json?.verification?.chainProofTxHash, 'Expected a proof writeback tx hash');
    assert.ok(Array.isArray(verificationResponse.json?.verification?.reasoningTrail));
    assert.ok(verificationResponse.json?.verification?.reasoningTrail.length > 0);

    const releaseResponse = await authedRequest(`/api/bounties/${bountyId}/release`, poster, {
      method: 'POST',
      body: {
        reason: 'Integration smoke test release'
      },
      idempotencyKey: 'smoke-release-bounty'
    });
    assert.equal(releaseResponse.status, 200, releaseResponse.text);
    assert.equal(releaseResponse.json?.bounty?.status, 'Paid');
    assert.equal(releaseResponse.json?.bounty?.payoutStatus, 'Released');

    const historyResponse = await requestJson(`/api/bounties/${bountyId}/history`);
    assert.equal(historyResponse.status, 200, historyResponse.text);
    assert.ok(Array.isArray(historyResponse.json?.timeline));
    assert.ok(historyResponse.json.timeline.some((event) => event.kind === 'verification'));
    assert.ok(historyResponse.json.timeline.some((event) => event.kind === 'audit'));

    const stateResponse = await authedRequest('/api/state', poster, {
      method: 'GET'
    });
    assert.equal(stateResponse.status, 200, stateResponse.text);
    assert.ok(stateResponse.json?.auditLogs?.some((entry) => entry.entityId === bountyId));
    assert.ok(stateResponse.json?.notifications?.some((entry) => entry.relatedId === submissionId));
    assert.ok(stateResponse.json?.chainEvents?.some((event) => event.type === 'proof_writeback' && event.bountyId === bountyId));
    assert.ok(stateResponse.json?.chainEvents?.some((event) => event.type === 'escrow_release' && event.bountyId === bountyId));
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    await delay(500);
    await saveState(seedState);
  }
}

await run();
