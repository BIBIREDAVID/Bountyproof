import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acceptInvite,
  createBounty,
  createDispute,
  createInvite,
  createOrganization,
  createSubmission,
  deleteBounty,
  getBountyHistory,
  getPublicState,
  loadState,
  loginWithEmail,
  loginWithWallet,
  logoutSession,
  resolveAuthContext,
  resolveDispute,
  issueWalletChallenge,
  releaseBounty,
  overrideBounty,
  refundBounty,
  reviewIncident,
  switchActiveOrg,
  updateBounty,
  updateMembershipRole,
  verifySubmission
} from './src/store.js';
import { seedState } from './src/data.js';
import { saveState } from './src/store.js';
import { getFirebaseStatus } from './src/firebase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon']
]);

function safeJoin(base, target) {
  const baseResolved = path.resolve(base);
  const resolved = path.resolve(baseResolved, '.' + target);
  if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) {
    return null;
  }
  return resolved;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    ...headers
  });
  res.end(payload);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, entry) => {
    const index = entry.indexOf('=');
    if (index < 0) {
      return acc;
    }
    const key = entry.slice(0, index).trim();
    const value = entry.slice(index + 1).trim();
    if (key) {
      acc[key] = decodeURIComponent(value);
    }
    return acc;
  }, {});
}

function readHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value || '';
}

function sessionCookie(sessionId) {
  if (!sessionId) {
    return 'bp_session=; Max-Age=0; Path=/; SameSite=Lax';
  }
  return `bp_session=${encodeURIComponent(sessionId)}; HttpOnly; Path=/; SameSite=Lax`;
}

async function getAuthContext(req) {
  const state = await loadState();
  const cookies = parseCookies(req);
  const sessionId = cookies.bp_session || null;
  return resolveAuthContext(state, sessionId);
}

function requireSignedIn(auth) {
  if (!auth?.sessionId || !auth?.user) {
    throw Object.assign(new Error('Login required'), { statusCode: 401 });
  }
}

function requireCsrf(req, auth) {
  if (!auth?.sessionId) {
    return;
  }
  const csrf = readHeader(req, 'x-csrf-token');
  if (!csrf || csrf !== auth.csrfToken) {
    throw Object.assign(new Error('Invalid CSRF token'), { statusCode: 403 });
  }
}

function hashBody(body) {
  return createHash('sha256').update(JSON.stringify(body || {})).digest('hex');
}

async function readIdempotentResponse(req, scope, body) {
  const key = readHeader(req, 'idempotency-key').trim();
  if (!key) {
    return { key: null, cached: null };
  }
  const state = await loadState();
  const record = state.idempotencyRecords.find((item) => item.key === key && item.scope === scope) || null;
  const bodyHash = hashBody(body);
  if (record && record.bodyHash !== bodyHash) {
    throw Object.assign(new Error('Idempotency key already used with a different request'), { statusCode: 409 });
  }
  return { key, cached: record, bodyHash };
}

async function rememberIdempotentResponse(req, scope, body, response, statusCode = 200) {
  const key = readHeader(req, 'idempotency-key').trim();
  if (!key) {
    return;
  }
  const state = await loadState();
  state.idempotencyRecords.unshift({
    key,
    scope,
    bodyHash: hashBody(body),
    response,
    statusCode,
    createdAt: new Date().toISOString()
  });
  state.idempotencyRecords = state.idempotencyRecords.slice(0, 100);
  await saveState(state);
}

async function runProtectedMutation(req, res, scope, body, handler, options = {}) {
  const auth = await getAuthContext(req);
  requireSignedIn(auth);
  requireCsrf(req, auth);
  const cached = await readIdempotentResponse(req, scope, body);
  if (cached.cached) {
    sendJson(res, cached.cached.statusCode, cached.cached.response);
    return true;
  }

  const result = await handler(auth, cached.bodyHash);
  const statusCode = Number(options.statusCode || 200);
  await rememberIdempotentResponse(req, scope, body, result, statusCode);
  sendJson(res, statusCode, result, options.headers || {});
  return true;
}

async function sendCurrentState(res, req) {
  const state = await loadState();
  const auth = await getAuthContext(req);
  sendJson(res, 200, getPublicState(state, auth));
}

function handleError(res, error) {
  const statusCode = Number(error?.statusCode || 500);
  const message = error?.message || 'Internal server error';
  sendJson(res, statusCode, { error: message });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const urlPath = decodeURIComponent(url.pathname);

    if (req.method === 'GET' && urlPath === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && urlPath === '/api/state') {
      await sendCurrentState(res, req);
      return;
    }

    if (req.method === 'GET' && urlPath === '/api/auth/me') {
      await sendCurrentState(res, req);
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/auth/email-login') {
      const body = await readJson(req);
      const payload = await loginWithEmail({
        email: body.email || '',
        displayName: body.displayName || '',
        handle: body.handle || '',
        activeOrgId: body.activeOrgId || null
      });
      const cookies = parseCookies(req);
      const sessionId = payload.auth?.sessionId || cookies.bp_session || null;
      sendJson(res, 200, payload, { 'Set-Cookie': sessionCookie(sessionId) });
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/auth/wallet-challenge') {
      const body = await readJson(req);
      const url = new URL(req.url, 'http://localhost');
      const challenge = await issueWalletChallenge({
        walletAddress: body.walletAddress || '',
        domain: body.domain || req.headers.host || 'localhost',
        uri: body.uri || `${url.protocol}//${req.headers.host || '127.0.0.1:3000'}`,
        chainId: body.chainId || 1
      });
      sendJson(res, 201, { challenge });
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/auth/wallet-login') {
      const body = await readJson(req);
      const payload = await loginWithWallet({
        walletAddress: body.walletAddress || '',
        displayName: body.displayName || '',
        handle: body.handle || '',
        activeOrgId: body.activeOrgId || null,
        challengeId: body.challengeId || '',
        nonce: body.nonce || '',
        signature: body.signature || '',
        domain: body.domain || req.headers.host || 'localhost',
        uri: body.uri || `http://${req.headers.host || '127.0.0.1:3000'}`
      });
      const cookies = parseCookies(req);
      const sessionId = payload.auth?.sessionId || cookies.bp_session || null;
      sendJson(res, 200, payload, { 'Set-Cookie': sessionCookie(sessionId) });
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/auth/logout') {
      const body = await readJson(req);
      await runProtectedMutation(req, res, 'auth:logout', body, async (auth) => {
        await logoutSession(auth.sessionId || null);
        const state = await loadState();
        return { ok: true, state: getPublicState(state, resolveAuthContext(state, null)) };
      }, { headers: { 'Set-Cookie': sessionCookie(null) } });
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/orgs') {
      const body = await readJson(req);
      await runProtectedMutation(req, res, 'org:create', body, async (auth) => {
        const org = await createOrganization(body, auth);
        const state = await loadState();
        return { org, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      }, { statusCode: 201 });
      return;
    }

    if (req.method === 'POST' && urlPath.match(/^\/api\/orgs\/[^/]+\/invites$/)) {
      const orgId = urlPath.split('/')[3];
      const body = await readJson(req);
      await runProtectedMutation(req, res, `org:invite:${orgId}`, body, async (auth) => {
        const invite = await createInvite(orgId, body, auth);
        const state = await loadState();
        return { invite, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      }, { statusCode: 201 });
      return;
    }

    if (req.method === 'POST' && urlPath.match(/^\/api\/orgs\/[^/]+\/switch$/)) {
      const orgId = urlPath.split('/')[3];
      const body = await readJson(req);
      await runProtectedMutation(req, res, `session:switch-org:${orgId}`, body, async (auth) => {
        const payload = await switchActiveOrg(auth.sessionId || null, orgId);
        return payload;
      }, { headers: { 'Set-Cookie': sessionCookie((await getAuthContext(req)).sessionId || null) } });
      return;
    }

    if (req.method === 'PATCH' && urlPath.match(/^\/api\/orgs\/[^/]+\/members\/[^/]+$/)) {
      const segments = urlPath.split('/');
      const orgId = segments[3];
      const userId = segments[5];
      const body = await readJson(req);
      await runProtectedMutation(req, res, `org:member-role:${orgId}:${userId}`, body, async (auth) => {
        const membership = await updateMembershipRole(orgId, userId, body.role || 'contributor', auth);
        const state = await loadState();
        return { membership, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      });
      return;
    }

    if (req.method === 'POST' && urlPath.startsWith('/api/invites/') && urlPath.endsWith('/accept')) {
      const code = urlPath.split('/')[3];
      const body = await readJson(req);
      await runProtectedMutation(req, res, `invite:accept:${code}`, body, async (auth) => {
        const invite = await acceptInvite(code, auth);
        const state = await loadState();
        return { invite, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      });
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/bounties') {
      const body = await readJson(req);
      await runProtectedMutation(req, res, 'bounty:create', body, async (auth) => {
        const bounty = await createBounty(
          {
            title: body.title || '',
            rewardAmount: body.rewardAmount || 0,
            rewardToken: body.rewardToken || 'USDC',
            deadline: body.deadline || '',
            ownerHandle: body.ownerHandle || auth.currentPosterHandle || '@okx',
            requirementSummary: body.requirementSummary || '',
            escrowTxHash: body.escrowTxHash,
            chainId: body.chainId,
            contractAddress: body.contractAddress,
            contractVersion: body.contractVersion,
            abiVersion: body.abiVersion,
            contractVerified: body.contractVerified,
            explorerBaseUrl: body.explorerBaseUrl,
            treasuryType: body.treasuryType,
            treasuryAddress: body.treasuryAddress,
            treasuryThreshold: body.treasuryThreshold,
            treasurySigners: body.treasurySigners,
            fundingTxHash: body.fundingTxHash,
            payoutTxHash: body.payoutTxHash,
            refundTxHash: body.refundTxHash,
            onChainStatus: body.onChainStatus,
            chainSyncStatus: body.chainSyncStatus,
            lastChainSyncedAt: body.lastChainSyncedAt,
            requirements: Array.isArray(body.requirements) ? body.requirements : [],
            orgId: body.orgId || auth.activeOrg?.orgId || null
          },
          auth
        );
        const state = await loadState();
        return { bounty, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      }, { statusCode: 201 });
      return;
    }

    if (req.method === 'PATCH' && urlPath.startsWith('/api/bounties/')) {
      const bountyId = urlPath.split('/').pop();
      const body = await readJson(req);
      await runProtectedMutation(req, res, `bounty:update:${bountyId}`, body, async (auth) => {
        const bounty = await updateBounty(
          bountyId,
          {
            title: body.title,
            rewardAmount: body.rewardAmount,
            rewardToken: body.rewardToken,
            deadline: body.deadline,
            ownerHandle: body.ownerHandle,
            requirementSummary: body.requirementSummary,
            status: body.status,
            escrowTxHash: body.escrowTxHash,
            chainId: body.chainId,
            contractAddress: body.contractAddress,
            contractVersion: body.contractVersion,
            abiVersion: body.abiVersion,
            contractVerified: body.contractVerified,
            explorerBaseUrl: body.explorerBaseUrl,
            treasuryType: body.treasuryType,
            treasuryAddress: body.treasuryAddress,
            treasuryThreshold: body.treasuryThreshold,
            treasurySigners: body.treasurySigners,
            fundingTxHash: body.fundingTxHash,
            payoutTxHash: body.payoutTxHash,
            refundTxHash: body.refundTxHash,
            onChainStatus: body.onChainStatus,
            chainSyncStatus: body.chainSyncStatus,
            lastChainSyncedAt: body.lastChainSyncedAt,
            requirements: Array.isArray(body.requirements) ? body.requirements : undefined
          },
          auth
        );
        const state = await loadState();
        return { bounty, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      });
      return;
    }

    if (req.method === 'POST' && urlPath.match(/^\/api\/bounties\/[^/]+\/chain-sync$/)) {
      const bountyId = urlPath.split('/')[3];
      const body = await readJson(req);
      await runProtectedMutation(req, res, `bounty:chain-sync:${bountyId}`, body, async (auth) => {
        const bounty = await updateBounty(
          bountyId,
          {
            chainId: body.chainId,
            contractAddress: body.contractAddress,
            contractVersion: body.contractVersion,
            abiVersion: body.abiVersion,
            contractVerified: body.contractVerified,
            explorerBaseUrl: body.explorerBaseUrl,
            treasuryType: body.treasuryType,
            treasuryAddress: body.treasuryAddress,
            treasuryThreshold: body.treasuryThreshold,
            treasurySigners: body.treasurySigners,
            fundingTxHash: body.fundingTxHash,
            payoutTxHash: body.payoutTxHash,
            refundTxHash: body.refundTxHash,
            onChainStatus: body.onChainStatus,
            chainSyncStatus: body.chainSyncStatus || 'synced',
            lastChainSyncedAt: body.lastChainSyncedAt || new Date().toISOString()
          },
          auth
        );
        const state = await loadState();
        return { bounty, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      });
      return;
    }

    if (req.method === 'DELETE' && urlPath.startsWith('/api/bounties/')) {
      const bountyId = urlPath.split('/').pop();
      const body = await readJson(req);
      await runProtectedMutation(req, res, `bounty:delete:${bountyId}`, body, async (auth) => {
        const removed = await deleteBounty(bountyId, auth);
        const state = await loadState();
        return { bounty: removed, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      });
      return;
    }

    if (req.method === 'POST' && urlPath.match(/^\/api\/admin\/bounties\/[^/]+\/override$/)) {
      const bountyId = urlPath.split('/')[4];
      const body = await readJson(req);
      await runProtectedMutation(req, res, `admin:bounty:override:${bountyId}`, body, async (auth) => {
        const bounty = await overrideBounty(bountyId, body, auth);
        const state = await loadState();
        return { bounty, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      });
      return;
    }

    if (req.method === 'POST' && urlPath.match(/^\/api\/admin\/bounties\/[^/]+\/refund$/)) {
      const bountyId = urlPath.split('/')[4];
      const body = await readJson(req);
      await runProtectedMutation(req, res, `admin:bounty:refund:${bountyId}`, body, async (auth) => {
        const bounty = await refundBounty(bountyId, body, auth);
        const state = await loadState();
        return { bounty, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      });
      return;
    }

    if (req.method === 'POST' && urlPath.match(/^\/api\/admin\/bounties\/[^/]+\/release$/)) {
      const bountyId = urlPath.split('/')[4];
      const body = await readJson(req);
      await runProtectedMutation(req, res, `admin:bounty:release:${bountyId}`, body, async (auth) => {
        const bounty = await releaseBounty(bountyId, body, auth);
        const state = await loadState();
        return { bounty, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      });
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/admin/incidents/review') {
      const body = await readJson(req);
      await runProtectedMutation(req, res, 'admin:incident:review', body, async (auth) => {
        const incident = await reviewIncident(body, auth);
        const state = await loadState();
        return { incident, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      });
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/submissions') {
      const body = await readJson(req);
      await runProtectedMutation(req, res, `submission:create:${body.bountyId || 'none'}`, body, async (auth) => {
        const submission = await createSubmission(
          {
            bountyId: body.bountyId || '',
            contributorHandle: body.contributorHandle || '',
            url: body.url || '',
            submittedAt: body.submittedAt || new Date().toISOString(),
            tweetCount: body.tweetCount,
            content: body.content || '',
            screenshotUrls: body.screenshotUrls || [],
            pageSnapshots: body.pageSnapshots || [],
            evidenceMetadata: body.evidenceMetadata || {}
          },
          auth
        );
        const state = await loadState();
        return { submission, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      }, { statusCode: 201 });
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/verifications') {
      const body = await readJson(req);
      await runProtectedMutation(req, res, `verification:create:${body.bountyId || 'none'}:${body.submissionId || 'none'}`, body, async (auth) => {
        const verification = await verifySubmission(
          {
            bountyId: body.bountyId || '',
            submissionId: body.submissionId || ''
          },
          auth
        );
        const state = await loadState();
        return { verification, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      }, { statusCode: 201 });
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/disputes') {
      const body = await readJson(req);
      await runProtectedMutation(req, res, `dispute:create:${body.bountyId || 'none'}:${body.submissionId || 'none'}`, body, async (auth) => {
        const dispute = await createDispute(
          {
            bountyId: body.bountyId || '',
            submissionId: body.submissionId || '',
            verificationId: body.verificationId || null,
            reason: body.reason || '',
            evidenceUrl: body.evidenceUrl || '',
            deadlineAt: body.deadlineAt || null
          },
          auth
        );
        const state = await loadState();
        return { dispute, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      }, { statusCode: 201 });
      return;
    }

    if (req.method === 'PATCH' && urlPath.startsWith('/api/disputes/')) {
      const disputeId = urlPath.split('/').pop();
      const body = await readJson(req);
      await runProtectedMutation(req, res, `dispute:resolve:${disputeId}`, body, async (auth) => {
        const dispute = await resolveDispute(disputeId, body, auth);
        const state = await loadState();
        return { dispute, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      });
      return;
    }

    if (req.method === 'POST' && urlPath.match(/^\/api\/bounties\/[^/]+\/release$/)) {
      const bountyId = urlPath.split('/')[3];
      const body = await readJson(req);
      await runProtectedMutation(req, res, `bounty:release:${bountyId}`, body, async (auth) => {
        const bounty = await releaseBounty(bountyId, body, auth);
        const state = await loadState();
        return { bounty, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      });
      return;
    }

    if (req.method === 'GET' && urlPath.startsWith('/api/bounties/') && urlPath.endsWith('/history')) {
      const bountyId = urlPath.split('/')[3];
      const state = await loadState();
      const history = getBountyHistory(state, bountyId);
      if (!history) {
        sendText(res, 404, 'Bounty not found');
        return;
      }
      sendJson(res, 200, history);
      return;
    }

    if (req.method === 'GET' && urlPath === '/api/audit-logs') {
      const state = await loadState();
      const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
      const bountyId = String(url.searchParams.get('bountyId') || '').trim();
      const orgId = String(url.searchParams.get('orgId') || '').trim();
      const action = String(url.searchParams.get('action') || '').trim().toLowerCase();
      const entityType = String(url.searchParams.get('entityType') || '').trim().toLowerCase();
      const logs = getPublicState(state).auditLogSummaries.filter((log) => {
        if (bountyId && log.bountyId !== bountyId) {
          return false;
        }
        if (orgId && log.orgId !== orgId) {
          return false;
        }
        if (action && String(log.action || '').toLowerCase() !== action) {
          return false;
        }
        if (entityType && String(log.entityType || '').toLowerCase() !== entityType) {
          return false;
        }
        if (!search) {
          return true;
        }
        return [log.action, log.summary, log.actorHandle, log.bountyTitle, log.orgName]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(search));
      });
      sendJson(res, 200, { logs, count: logs.length });
      return;
    }

    if (req.method === 'GET' && urlPath === '/api/notifications') {
      const state = await loadState();
      const auth = await getAuthContext(req);
      const notifications = getPublicState(state, auth).notificationSummaries;
      sendJson(res, 200, { notifications, count: notifications.length });
      return;
    }

    if (req.method === 'PATCH' && urlPath.startsWith('/api/notifications/')) {
      const notificationId = urlPath.split('/').pop();
      const body = await readJson(req);
      await runProtectedMutation(req, res, `notification:read:${notificationId}`, body, async (auth) => {
        const state = await loadState();
        const notification = state.notifications.find((item) => item.notificationId === notificationId);
        if (!notification) {
          throw Object.assign(new Error('Notification not found'), { statusCode: 404 });
        }
        if (notification.recipientUserId && notification.recipientUserId !== auth.user.userId) {
          throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
        }
        notification.readAt = notification.readAt || new Date().toISOString();
        await saveState(state);
        return { notification, state: getPublicState(state, resolveAuthContext(state, auth.sessionId)) };
      });
      return;
    }

    if (req.method === 'GET' && urlPath.match(/^\/api\/bounties\/[^/]+\/versions$/)) {
      const bountyId = urlPath.split('/')[3];
      const state = await loadState();
      const versions = getPublicState(state).bountyVersionSummaries.filter((version) => version.bountyId === bountyId);
      sendJson(res, 200, { versions, count: versions.length });
      return;
    }

    if (req.method === 'GET' && urlPath === '/api/observability') {
      const state = await loadState();
      const payload = getPublicState(state);
      sendJson(res, 200, {
        overview: payload.observabilityOverview || null,
        events: (payload.observabilityEvents || []).slice(0, 50)
      });
      return;
    }

    if (req.method === 'GET' && urlPath.startsWith('/api/exports/analytics.')) {
      const state = await loadState();
      const payload = getPublicState(state);
      const analytics = payload.analytics || {};
      if (urlPath.endsWith('.csv')) {
        const rows = [
          ['metric', 'value'],
          ['time_to_verify_average_minutes', String(analytics.timeToVerify?.averageMinutes || 0)],
          ['time_to_verify_median_minutes', String(analytics.timeToVerify?.medianMinutes || 0)],
          ['dispute_rate_percent', String(analytics.disputeRate || 0)],
          ['payout_latency_average_minutes', String(analytics.payoutLatency?.averageMinutes || 0)],
          ['payout_latency_median_minutes', String(analytics.payoutLatency?.medianMinutes || 0)],
          ['pass_rate_percent', String(analytics.passRate || 0)],
          ['verification_count', String(analytics.verificationCount || 0)],
          ['dispute_count', String(analytics.disputeCount || 0)]
        ];
        const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
        sendText(res, 200, csv, { 'Content-Type': 'text/csv; charset=utf-8' });
      } else {
        sendJson(res, 200, { analytics, exportedAt: new Date().toISOString() });
      }
      return;
    }

    if (req.method === 'GET' && urlPath === '/api/integrations/firebase') {
      const status = await getFirebaseStatus();
      sendJson(res, 200, status);
      return;
    }

    if (req.method === 'GET' && urlPath === '/api/uptime') {
      const state = await loadState();
      sendJson(res, 200, {
        ok: true,
        uptimeSeconds: Math.round(process.uptime()),
        memory: process.memoryUsage(),
        firebase: await getFirebaseStatus(),
        counts: {
          bounties: state.bounties.length,
          disputes: state.disputes.length,
          notifications: state.notifications.length,
          auditLogs: state.auditLogs.length
        }
      });
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/reset') {
      const { saveState } = await import('./src/store.js');
      await saveState(seedState);
      const state = await loadState();
      sendJson(res, 200, { ok: true, state: getPublicState(state) });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method not allowed');
      return;
    }

    const requestPath = urlPath === '/' ? '/index.html' : urlPath;
    const filePath = safeJoin(root, requestPath);
    if (!filePath) {
      sendText(res, 400, 'Bad request');
      return;
    }

    let fileStat;
    try {
      fileStat = await stat(filePath);
    } catch {
      sendText(res, 404, 'Not found');
      return;
    }

    if (fileStat.isDirectory()) {
      sendText(res, 403, 'Directory listing disabled');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes.get(ext) || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    handleError(res, error);
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '127.0.0.1', () => {
  console.log(`BountyProof running at http://127.0.0.1:${port}`);
});
