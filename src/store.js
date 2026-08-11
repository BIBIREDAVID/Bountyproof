import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress, verifyMessage } from 'ethers';
import { createFreshState } from './data.js';
import { evaluateBounty } from './requirements.js';
import { syncFirebaseSnapshot } from './firebase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '..', 'data');
const stateFile = path.join(dataDir, 'state.json');

const rolePermissions = {
  owner: new Set(['org:create', 'org:invite', 'org:member-role', 'bounty:create', 'bounty:update', 'bounty:delete', 'bounty:fund', 'bounty:verify', 'bounty:refund', 'bounty:override', 'submission:create', 'session:switch-org', 'dispute:create', 'dispute:resolve']),
  admin: new Set(['org:create', 'org:invite', 'org:member-role', 'bounty:create', 'bounty:update', 'bounty:delete', 'bounty:fund', 'bounty:verify', 'bounty:refund', 'bounty:override', 'submission:create', 'session:switch-org', 'dispute:create', 'dispute:resolve']),
  poster: new Set(['bounty:create', 'bounty:update', 'bounty:fund', 'submission:create', 'session:switch-org', 'dispute:create']),
  reviewer: new Set(['bounty:verify', 'submission:create', 'session:switch-org', 'dispute:create', 'dispute:resolve']),
  contributor: new Set(['submission:create', 'session:switch-org', 'dispute:create'])
};

export async function loadState() {
  await ensureStateFile();
  const raw = await readFile(stateFile, 'utf8');
  const state = normalizeState(JSON.parse(raw));
  if (applyAutomaticStateTransitions(state)) {
    await persistState(state);
  }
  return state;
}

export async function saveState(state) {
  await mkdir(dataDir, { recursive: true });
  const normalized = normalizeState(state);
  await persistState(normalized);
  await syncFirebaseSnapshot(normalized).catch(() => {});
  return normalized;
}

async function persistState(state) {
  const tmpFile = `${stateFile}.tmp`;
  await writeFile(tmpFile, JSON.stringify(state, null, 2), 'utf8');
  await unlink(stateFile).catch(() => {});
  await rename(tmpFile, stateFile);
}

export async function loginWithEmail(input) {
  const state = await loadState();
  const email = String(input.email || '').trim().toLowerCase();
  if (!email) {
    throw createError(400, 'Email is required');
  }

  const displayName = String(input.displayName || input.handle || email.split('@')[0] || 'Email User').trim();
  const handle = normalizeHandle(input.handle || displayName || email.split('@')[0]);
  const user = upsertUser(state, {
    authMethod: 'email',
    email,
    displayName,
    handle
  });
  const session = createOrRefreshSession(state, user.userId, input.activeOrgId || null);
  const activeOrg = ensureActiveOrgForUser(state, user, session.activeOrgId);
  session.activeOrgId = activeOrg.orgId;
  session.lastSeenAt = nowIso();
  recordAuditEvent(state, {
    action: 'auth.email_login',
    entityType: 'session',
    entityId: session.sessionId,
    orgId: activeOrg.orgId,
    actorUserId: user.userId,
    actorHandle: user.handle,
    summary: `Email login for ${user.handle}`,
    metadata: {
      email: user.email
    }
  });
  await saveState(state);
  return buildAuthPayload(state, session.sessionId);
}

export async function loginWithWallet(input) {
  const state = await loadState();
  const challenge = consumeWalletChallenge(state, {
    challengeId: input.challengeId,
    nonce: input.nonce,
    walletAddress: input.walletAddress,
    signature: input.signature,
    domain: input.domain,
    uri: input.uri
  });

  const walletAddress = challenge.address;
  const displayName = String(input.displayName || input.handle || walletAddress.slice(0, 10)).trim();
  const handle = normalizeHandle(input.handle || displayName || walletAddress.slice(2, 8));
  const user = upsertUser(state, {
    authMethod: 'wallet',
    walletAddress,
    displayName,
    handle
  });
  const session = createOrRefreshSession(state, user.userId, input.activeOrgId || null);
  const activeOrg = ensureActiveOrgForUser(state, user, session.activeOrgId);
  session.activeOrgId = activeOrg.orgId;
  session.lastSeenAt = nowIso();
  recordAuditEvent(state, {
    action: 'auth.wallet_login',
    entityType: 'session',
    entityId: session.sessionId,
    orgId: activeOrg.orgId,
    actorUserId: user.userId,
    actorHandle: user.handle,
    summary: `Wallet login for ${user.handle}`,
    metadata: {
      challengeId: challenge.challengeId,
      challengeAddress: challenge.address,
      signatureHash: createHash('sha256').update(String(input.signature || '')).digest('hex').slice(0, 16)
    }
  });
  await saveState(state);
  return buildAuthPayload(state, session.sessionId);
}

export async function issueWalletChallenge(input = {}) {
  const state = await loadState();
  const address = normalizeWalletAddress(input.walletAddress);
  if (!address) {
    throw createError(400, 'Wallet address is required');
  }

  const challenge = {
    challengeId: `wch_${randomUUID().slice(0, 8)}`,
    address,
    nonce: randomUUID().replaceAll('-', '').slice(0, 16),
    domain: String(input.domain || 'localhost').trim(),
    uri: String(input.uri || 'http://127.0.0.1:3000').trim(),
    chainId: Number(input.chainId || 1),
    issuedAt: nowIso(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 10).toISOString(),
    status: 'pending'
  };
  challenge.message = buildSiweMessage(challenge);
  state.walletChallenges.unshift(challenge);
  recordAuditEvent(state, {
    action: 'auth.wallet_challenge_issued',
    entityType: 'walletChallenge',
    entityId: challenge.challengeId,
    summary: `Challenge issued for ${challenge.address}`,
    metadata: {
      address: challenge.address,
      chainId: challenge.chainId,
      expiresAt: challenge.expiresAt
    }
  });
  await saveState(state);
  return {
    challengeId: challenge.challengeId,
    address: challenge.address,
    nonce: challenge.nonce,
    domain: challenge.domain,
    uri: challenge.uri,
    chainId: challenge.chainId,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
    message: challenge.message
  };
}

function recordAuditEvent(state, event) {
  if (!state.auditLogs) {
    state.auditLogs = [];
  }
  const log = {
    auditLogId: nextId('aud', state.auditLogs),
    action: String(event.action || 'unknown'),
    entityType: String(event.entityType || 'system'),
    entityId: String(event.entityId || ''),
    orgId: event.orgId || null,
    bountyId: event.bountyId || null,
    actorUserId: event.actorUserId || null,
    actorHandle: event.actorHandle || null,
    severity: event.severity || 'info',
    summary: String(event.summary || ''),
    metadata: event.metadata && typeof event.metadata === 'object' ? structuredClone(event.metadata) : {},
    createdAt: event.createdAt || nowIso()
  };
  state.auditLogs.unshift(log);
  state.auditLogs = state.auditLogs.slice(0, 1000);
  return log;
}

function appendBountyVersion(state, bounty, actor, action, changes = {}) {
  if (!state.bountyVersions) {
    state.bountyVersions = [];
  }
  const versions = state.bountyVersions.filter((item) => item.bountyId === bounty.bountyId);
  const version = {
    bountyVersionId: nextId('bver', state.bountyVersions),
    bountyId: bounty.bountyId,
    orgId: bounty.orgId || null,
    versionNumber: versions.length + 1,
    action,
    actorUserId: actor?.user?.userId || null,
    actorHandle: actor?.user?.handle || null,
    snapshot: structuredClone(bounty),
    changes: changes && typeof changes === 'object' ? structuredClone(changes) : {},
    createdAt: nowIso()
  };
  state.bountyVersions.unshift(version);
  state.bountyVersions = state.bountyVersions.slice(0, 2000);
  return version;
}

function summarizeAuditLog(state, log) {
  if (!log) {
    return null;
  }

  const actor = state.users.find((item) => item.userId === log.actorUserId) || null;
  const bounty = log.bountyId ? state.bounties.find((item) => item.bountyId === log.bountyId) || null : null;
  const org = log.orgId ? state.orgs.find((item) => item.orgId === log.orgId) || null : null;
  return {
    ...log,
    actorHandle: actor?.handle || log.actorHandle || null,
    actorDisplayName: actor?.displayName || null,
    bountyTitle: bounty?.title || null,
    orgName: org?.name || null
  };
}

function summarizeBountyVersion(state, version) {
  if (!version) {
    return null;
  }
  const bounty = state.bounties.find((item) => item.bountyId === version.bountyId) || null;
  const actor = state.users.find((item) => item.userId === version.actorUserId) || null;
  return {
    ...version,
    bountyTitle: bounty?.title || version.snapshot?.title || null,
    actorHandle: actor?.handle || version.actorHandle || null
  };
}

function buildExplorerLinks(bounty) {
  const baseUrl = String(bounty.explorerBaseUrl || '').trim().replace(/\/+$/, '');
  const base = baseUrl || 'https://explorer.example';
  const tx = (hash) => (hash ? `${base}/tx/${hash}` : '');
  const address = (value) => (value ? `${base}/address/${value}` : '');
  return {
    chainId: bounty.chainId || null,
    contract: address(bounty.contractAddress),
    treasury: address(bounty.treasuryAddress),
    escrow: tx(bounty.escrowTxHash),
    funding: tx(bounty.fundingTxHash),
    payout: tx(bounty.payoutTxHash),
    refund: tx(bounty.refundTxHash)
  };
}

function summarizeChainEvent(state, event) {
  if (!event) {
    return null;
  }
  const bounty = state.bounties.find((item) => item.bountyId === event.bountyId) || null;
  return {
    ...event,
    bountyTitle: bounty?.title || null
  };
}

function applyAutomaticStateTransitions(state) {
  return sweepDisputeEscalations(state);
}

function sweepDisputeEscalations(state) {
  let changed = false;
  const now = Date.now();

  state.disputes.forEach((dispute) => {
    if (!dispute || !['open', 'in_review'].includes(dispute.status)) {
      return;
    }
    if (!dispute.deadlineAt || Number.isNaN(Date.parse(dispute.deadlineAt))) {
      return;
    }
    if (Date.parse(dispute.deadlineAt) > now) {
      return;
    }

    const bounty = state.bounties.find((item) => item.bountyId === dispute.bountyId) || null;
    const fallbackReviewer = bounty ? selectReviewer(state, bounty.orgId, [dispute.openedByUserId, dispute.assignedReviewerUserId]) : null;
    dispute.status = 'escalated';
    dispute.escalatedAt = dispute.escalatedAt || nowIso();
    dispute.escalatedByUserId = dispute.escalatedByUserId || null;
    dispute.escalationReason = dispute.escalationReason || 'Review deadline passed';
    if (!dispute.assignedReviewerUserId && fallbackReviewer) {
      dispute.assignedReviewerUserId = fallbackReviewer.userId;
      dispute.assignedReviewerHandle = fallbackReviewer.handle;
    }
    dispute.updatedAt = nowIso();
    if (bounty) {
      bounty.status = bounty.status === 'Paid' ? bounty.status : 'Disputed';
      bounty.payoutStatus = 'Disputed';
      bounty.latestDisputeId = dispute.disputeId;
      bounty.updatedAt = nowIso();
      recordAuditEvent(state, {
        action: 'dispute.escalated',
        entityType: 'dispute',
        entityId: dispute.disputeId,
        bountyId: bounty.bountyId,
        orgId: bounty.orgId,
        actorUserId: dispute.openedByUserId,
        actorHandle: dispute.openedByHandle,
        severity: 'warn',
        summary: `Dispute ${dispute.disputeId} escalated after deadline`,
        metadata: {
          deadlineAt: dispute.deadlineAt,
          assignedReviewerUserId: dispute.assignedReviewerUserId,
          assignedReviewerHandle: dispute.assignedReviewerHandle
        }
      });
    }
    changed = true;
  });

  return changed;
}

function syncBountyChainState(bounty, input, actor = null) {
  const changes = {};
  const assignString = (key, fallback = '') => {
    if (typeof input[key] === 'string') {
      const value = input[key].trim();
      if (value) {
        bounty[key] = value;
        changes[key] = value;
      }
    } else if (input[key] === '') {
      bounty[key] = '';
      changes[key] = '';
    } else if (input[key] !== undefined && input[key] !== null && typeof input[key] !== 'object') {
      const value = String(input[key]).trim();
      if (value) {
        bounty[key] = value;
        changes[key] = value;
      }
    }
  };

  const assignNumber = (key) => {
    if (input[key] === undefined || input[key] === null || input[key] === '') {
      return;
    }
    const value = Number(input[key]);
    if (Number.isFinite(value)) {
      bounty[key] = value;
      changes[key] = value;
    }
  };

  const assignBoolean = (key) => {
    if (input[key] === undefined || input[key] === null || input[key] === '') {
      return;
    }
    const value = Boolean(input[key] === true || input[key] === 'true' || input[key] === 1 || input[key] === '1');
    bounty[key] = value;
    changes[key] = value;
  };

  const assignArray = (key) => {
    if (input[key] === undefined || input[key] === null) {
      return;
    }
    const value = Array.isArray(input[key])
      ? input[key].map((item) => String(item || '').trim()).filter(Boolean)
      : String(input[key]).split(/[,\n]+/).map((item) => item.trim()).filter(Boolean);
    bounty[key] = value;
    changes[key] = value;
  };

  assignNumber('chainId');
  assignString('contractAddress');
  assignString('contractVersion');
  assignString('abiVersion');
  assignBoolean('contractVerified');
  assignString('explorerBaseUrl');
  assignString('treasuryType');
  assignString('treasuryAddress');
  assignNumber('treasuryThreshold');
  assignArray('treasurySigners');
  assignString('fundingTxHash');
  assignString('payoutTxHash');
  assignString('refundTxHash');
  assignString('onChainStatus');
  assignString('chainSyncStatus');
  assignString('lastChainSyncedAt');

  if (Object.keys(changes).length > 0 && !changes.lastChainSyncedAt) {
    bounty.lastChainSyncedAt = nowIso();
    changes.lastChainSyncedAt = bounty.lastChainSyncedAt;
  }

  return changes;
}

export async function logoutSession(sessionId) {
  const state = await loadState();
  const index = state.sessions.findIndex((session) => session.sessionId === sessionId);
  if (index >= 0) {
    state.sessions.splice(index, 1);
    await saveState(state);
  }
  return true;
}

export async function createDispute(input, authContext = null) {
  const state = await loadState();
  const bounty = state.bounties.find((item) => item.bountyId === input.bountyId);
  if (!bounty) {
    throw createError(404, 'Bounty not found');
  }

  const submission = state.submissions.find((item) => item.submissionId === input.submissionId);
  if (!submission) {
    throw createError(404, 'Submission not found');
  }

  const verification = input.verificationId
    ? state.verifications.find((item) => item.verificationId === input.verificationId)
    : state.verifications.find((item) => item.submissionId === submission.submissionId && item.bountyId === bounty.bountyId) || null;

  const actor = resolveActor(state, authContext, bounty.orgId);
  if (!actor?.user) {
    throw createError(401, 'Login required');
  }
  const membership = state.memberships.find((item) => item.userId === actor.user.userId && item.orgId === bounty.orgId) || null;
  const canOpenDispute = Boolean(
    submission.contributorUserId === actor.user.userId ||
    ['owner', 'admin', 'poster', 'reviewer'].includes(normalizeRole(membership?.role))
  );
  if (!canOpenDispute) {
    throw createError(403, 'Forbidden: dispute:create');
  }

  const assignedReviewer = selectReviewer(state, bounty.orgId, [actor.user.userId]);
  const dispute = {
    disputeId: nextId('dsp', state.disputes),
    bountyId: bounty.bountyId,
    submissionId: submission.submissionId,
    verificationId: verification?.verificationId || null,
    openedByUserId: actor.user.userId,
    openedByHandle: actor.user.handle,
    assignedReviewerUserId: assignedReviewer?.userId || null,
    assignedReviewerHandle: assignedReviewer?.handle || null,
    reason: String(input.reason || '').trim(),
    evidenceUrl: String(input.evidenceUrl || submission.url || '').trim(),
    status: 'open',
    deadlineAt: input.deadlineAt ? String(input.deadlineAt) : new Date(Date.now() + 1000 * 60 * 60 * 72).toISOString(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    reviewNotes: '',
    resolutionOutcome: null,
    resolutionNotes: '',
    resolvedAt: null,
    resolvedByUserId: null
  };

  state.disputes.unshift(dispute);
  bounty.status = 'Disputed';
  bounty.payoutStatus = 'Disputed';
  bounty.latestDisputeId = dispute.disputeId;
  bounty.updatedAt = nowIso();
  recordAuditEvent(state, {
    action: 'dispute.created',
    entityType: 'dispute',
    entityId: dispute.disputeId,
    orgId: bounty.orgId,
    bountyId: bounty.bountyId,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    severity: 'warn',
    summary: `Opened dispute ${dispute.disputeId}`,
    metadata: {
      submissionId: submission.submissionId,
      assignedReviewerUserId: dispute.assignedReviewerUserId,
      deadlineAt: dispute.deadlineAt
    }
  });
  dispatchNotifications(state, [submission.contributorUserId, ...state.memberships.filter((membership) => membership.orgId === bounty.orgId && ['owner', 'admin', 'reviewer'].includes(normalizeRole(membership.role))).map((membership) => membership.userId)], {
    orgId: bounty.orgId,
    channels: ['email', 'in-app', 'webhook'],
    category: 'dispute',
    title: `Dispute opened for ${bounty.title}`,
    body: `${dispute.disputeId} was opened and assigned for review.`,
    relatedType: 'dispute',
    relatedId: dispute.disputeId,
    metadata: {
      bountyId: bounty.bountyId,
      submissionId: submission.submissionId,
      deadlineAt: dispute.deadlineAt
    }
  });
  await saveState(state);
  return dispute;
}

export async function resolveDispute(disputeId, input, authContext = null) {
  const state = await loadState();
  const dispute = state.disputes.find((item) => item.disputeId === disputeId);
  if (!dispute) {
    throw createError(404, 'Dispute not found');
  }

  const bounty = state.bounties.find((item) => item.bountyId === dispute.bountyId);
  if (!bounty) {
    throw createError(404, 'Bounty not found');
  }

  const actor = resolveActor(state, authContext, bounty.orgId);
  if (!actor?.user) {
    throw createError(401, 'Login required');
  }
  const membership = state.memberships.find((item) => item.userId === actor.user.userId && item.orgId === bounty.orgId) || null;
  const role = normalizeRole(membership?.role);
  const canResolve = actor.user.userId === dispute.assignedReviewerUserId || ['owner', 'admin', 'reviewer'].includes(role);
  if (!canResolve) {
    throw createError(403, 'Forbidden: dispute:resolve');
  }

  dispute.status = 'resolved';
  dispute.resolutionOutcome = normalizeDisputeOutcome(input.outcome);
  dispute.resolutionNotes = String(input.resolutionNotes || '').trim();
  dispute.reviewNotes = String(input.reviewNotes || dispute.reviewNotes || '').trim();
  dispute.resolvedAt = nowIso();
  dispute.resolvedByUserId = actor.user.userId;
  dispute.updatedAt = nowIso();

  if (dispute.resolutionOutcome === 'release') {
    finalizeRelease(state, bounty, actor, {
      payoutTxHash: bounty.payoutTxHash || createTxHash(),
      reason: dispute.resolutionNotes || `Dispute ${dispute.disputeId} resolved in favor of the contributor`
    });
  } else if (dispute.resolutionOutcome === 'refund') {
    finalizeRefund(state, bounty, actor, {
      refundTxHash: bounty.refundTxHash || createTxHash(),
      reason: dispute.resolutionNotes || `Dispute ${dispute.disputeId} resolved with refund`
    });
  } else if (dispute.resolutionOutcome === 'reverify') {
    bounty.status = 'Funded';
    bounty.payoutStatus = 'Awaiting verification';
    bounty.onChainStatus = 'verified';
  } else {
    bounty.payoutStatus = bounty.latestVerificationId ? 'Locked' : 'In escrow';
  }

  bounty.resolutionStatus = dispute.resolutionOutcome;
  bounty.updatedAt = nowIso();
  recordAuditEvent(state, {
    action: 'dispute.resolved',
    entityType: 'dispute',
    entityId: dispute.disputeId,
    orgId: bounty.orgId,
    bountyId: bounty.bountyId,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    severity: dispute.resolutionOutcome === 'refund' ? 'warn' : 'info',
    summary: `Resolved dispute ${dispute.disputeId} with ${dispute.resolutionOutcome}`,
    metadata: {
      outcome: dispute.resolutionOutcome,
      resolutionNotes: dispute.resolutionNotes
    }
  });
  dispatchNotifications(state, [dispute.openedByUserId, dispute.assignedReviewerUserId, ...state.memberships.filter((membership) => membership.orgId === bounty.orgId && ['owner', 'admin', 'poster', 'reviewer'].includes(normalizeRole(membership.role))).map((membership) => membership.userId)], {
    orgId: bounty.orgId,
    channels: ['email', 'in-app', 'webhook'],
    category: 'dispute',
    title: `Dispute resolved for ${bounty.title}`,
    body: `${dispute.disputeId} resolved with ${dispute.resolutionOutcome}.`,
    relatedType: 'dispute',
    relatedId: dispute.disputeId,
    metadata: {
      bountyId: bounty.bountyId,
      outcome: dispute.resolutionOutcome
    }
  });
  await saveState(state);
  return dispute;
}

export async function overrideBounty(bountyId, input, authContext = null) {
  const state = await loadState();
  const bounty = state.bounties.find((item) => item.bountyId === bountyId);
  if (!bounty) {
    throw createError(404, 'Bounty not found');
  }
  const actor = resolveActor(state, authContext, bounty.orgId);
  assertPermission(state, actor, 'bounty:override', bounty.orgId);

  const previous = structuredClone(bounty);
  const nextStatus = normalizeAdminBountyStatus(input.status || bounty.status);
  bounty.status = nextStatus;
  bounty.payoutStatus = nextStatus === 'Refunded' ? 'Refunded' : nextStatus === 'Paid' ? 'Released' : bounty.payoutStatus;
  bounty.overrideReason = String(input.reason || '').trim();
  bounty.updatedAt = nowIso();
  appendBountyVersion(state, bounty, actor, 'admin_override', {
    previous,
    changes: {
      status: nextStatus,
      reason: bounty.overrideReason
    }
  });
  recordAuditEvent(state, {
    action: 'bounty.overridden',
    entityType: 'bounty',
    entityId: bounty.bountyId,
    orgId: bounty.orgId,
    bountyId: bounty.bountyId,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    severity: 'warn',
    summary: `Admin override applied to ${bounty.title}`,
    metadata: {
      previousStatus: previous.status,
      nextStatus,
      reason: bounty.overrideReason
    }
  });
  recordObservabilityEvent(state, {
    kind: 'trace',
    source: 'admin',
    route: `/admin/bounties/${bountyId}/override`,
    level: 'info',
    message: 'Bounty override completed',
    metadata: { bountyId, nextStatus }
  });
  await saveState(state);
  return bounty;
}

export async function refundBounty(bountyId, input, authContext = null) {
  const state = await loadState();
  const bounty = state.bounties.find((item) => item.bountyId === bountyId);
  if (!bounty) {
    throw createError(404, 'Bounty not found');
  }
  const actor = resolveActor(state, authContext, bounty.orgId);
  assertPermission(state, actor, 'bounty:refund', bounty.orgId);

  finalizeRefund(state, bounty, actor, input);
  await saveState(state);
  return bounty;
}

export async function releaseBounty(bountyId, input, authContext = null) {
  const state = await loadState();
  const bounty = state.bounties.find((item) => item.bountyId === bountyId);
  if (!bounty) {
    throw createError(404, 'Bounty not found');
  }
  const actor = resolveActor(state, authContext, bounty.orgId);
  assertPermission(state, actor, 'bounty:fund', bounty.orgId);

  if (!['Verified', 'Funded', 'Open'].includes(bounty.status) && bounty.payoutStatus !== 'Ready to release') {
    throw createError(409, 'Bounty is not ready for release');
  }

  finalizeRelease(state, bounty, actor, input);
  await saveState(state);
  return bounty;
}

export async function reviewIncident(input, authContext = null) {
  const state = await loadState();
  const actor = resolveActor(state, authContext);
  assertPermission(state, actor, 'bounty:override', actor.activeOrg?.orgId || null);

  const incident = {
    incidentReviewId: nextId('inc', state.auditLogs),
    targetType: String(input.targetType || 'audit').trim(),
    targetId: String(input.targetId || '').trim(),
    decision: String(input.decision || 'reviewed').trim(),
    notes: String(input.notes || '').trim(),
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    createdAt: nowIso()
  };

  recordAuditEvent(state, {
    action: 'incident.reviewed',
    entityType: incident.targetType,
    entityId: incident.targetId,
    orgId: actor.activeOrg?.orgId || null,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    severity: 'info',
    summary: `Incident reviewed for ${incident.targetType} ${incident.targetId}`,
    metadata: incident
  });
  recordObservabilityEvent(state, {
    kind: 'trace',
    source: 'admin',
    route: `/admin/incidents/${incident.targetType}/${incident.targetId}/review`,
    level: 'info',
    message: 'Incident reviewed',
    metadata: incident
  });
  await saveState(state);
  return incident;
}

export async function createOrganization(input, authContext) {
  const state = await loadState();
  const actor = resolveActor(state, authContext);
  assertPermission(state, actor, 'org:create');

  const name = String(input.name || '').trim();
  if (!name) {
    throw createError(400, 'Organization name is required');
  }

  const org = {
    orgId: nextId('org', state.orgs),
    name,
    slug: uniqueSlug(state.orgs, input.slug || name),
    ownerUserId: actor.user.userId,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  state.orgs.unshift(org);
  upsertMembership(state, {
    orgId: org.orgId,
    userId: actor.user.userId,
    role: 'owner'
  });

  const session = authContext?.sessionId ? state.sessions.find((item) => item.sessionId === authContext.sessionId) : null;
  if (session) {
    session.activeOrgId = org.orgId;
    session.lastSeenAt = nowIso();
  }

  recordAuditEvent(state, {
    action: 'org.created',
    entityType: 'org',
    entityId: org.orgId,
    orgId: org.orgId,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    summary: `Created organization ${org.name}`,
    metadata: { slug: org.slug }
  });
  await saveState(state);
  return org;
}

export async function createInvite(orgId, input, authContext) {
  const state = await loadState();
  const actor = resolveActor(state, authContext);
  assertPermission(state, actor, 'org:invite', orgId);

  const org = state.orgs.find((item) => item.orgId === orgId);
  if (!org) {
    throw createError(404, 'Organization not found');
  }

  const role = normalizeRole(input.role || 'reviewer');
  const invite = {
    inviteId: nextId('inv', state.invites),
    code: input.code ? String(input.code).trim() : `invite_${randomUUID().slice(0, 8)}`,
    orgId,
    email: String(input.email || '').trim().toLowerCase(),
    walletAddress: String(input.walletAddress || '').trim().toLowerCase(),
    handle: normalizeHandle(input.handle || ''),
    role,
    invitedByUserId: actor.user.userId,
    status: 'pending',
    createdAt: nowIso(),
    expiresAt: input.expiresAt ? String(input.expiresAt) : new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
  };

  state.invites.unshift(invite);
  recordAuditEvent(state, {
    action: 'org.invite_created',
    entityType: 'invite',
    entityId: invite.inviteId,
    orgId,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    summary: `Created invite ${invite.code}`,
    metadata: {
      role: invite.role,
      email: invite.email,
      walletAddress: invite.walletAddress
    }
  });
  await saveState(state);
  return invite;
}

export async function acceptInvite(code, authContext) {
  const state = await loadState();
  const actor = resolveActor(state, authContext);
  const invite = state.invites.find((item) => item.code === code);
  if (!invite) {
    throw createError(404, 'Invite not found');
  }
  if (invite.status !== 'pending') {
    throw createError(409, 'Invite is no longer pending');
  }
  if (invite.expiresAt && Date.parse(invite.expiresAt) < Date.now()) {
    throw createError(410, 'Invite has expired');
  }

  upsertMembership(state, {
    orgId: invite.orgId,
    userId: actor.user.userId,
    role: invite.role
  });
  invite.status = 'accepted';
  invite.acceptedAt = nowIso();
  invite.acceptedByUserId = actor.user.userId;

  const session = authContext?.sessionId ? state.sessions.find((item) => item.sessionId === authContext.sessionId) : null;
  if (session) {
    session.activeOrgId = invite.orgId;
    session.lastSeenAt = nowIso();
  }

  recordAuditEvent(state, {
    action: 'org.invite_accepted',
    entityType: 'invite',
    entityId: invite.inviteId,
    orgId: invite.orgId,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    summary: `Accepted invite ${invite.code}`,
    metadata: {
      role: invite.role
    }
  });
  await saveState(state);
  return invite;
}

export async function updateMembershipRole(orgId, userId, role, authContext) {
  const state = await loadState();
  const actor = resolveActor(state, authContext);
  assertPermission(state, actor, 'org:member-role', orgId);

  const membership = state.memberships.find((item) => item.orgId === orgId && item.userId === userId);
  if (!membership) {
    throw createError(404, 'Membership not found');
  }

  membership.role = normalizeRole(role);
  membership.updatedAt = nowIso();
  recordAuditEvent(state, {
    action: 'org.member_role_updated',
    entityType: 'membership',
    entityId: membership.membershipId,
    orgId,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    summary: `Updated role for ${userId} to ${membership.role}`,
    metadata: {
      userId,
      role: membership.role
    }
  });
  await saveState(state);
  return membership;
}

export async function switchActiveOrg(sessionId, orgId) {
  const state = await loadState();
  const session = state.sessions.find((item) => item.sessionId === sessionId);
  if (!session) {
    throw createError(404, 'Session not found');
  }

  const previousOrgId = session.activeOrgId || null;

  const membership = state.memberships.find((item) => item.sessionId === sessionId || (item.userId === session.userId && item.orgId === orgId));
  if (!membership && orgId) {
    const userMembership = state.memberships.find((item) => item.userId === session.userId && item.orgId === orgId);
    if (!userMembership) {
      throw createError(403, 'You are not a member of that organization');
    }
  }

  session.activeOrgId = orgId;
  session.lastSeenAt = nowIso();
  recordAuditEvent(state, {
    action: 'session.org_switched',
    entityType: 'session',
    entityId: session.sessionId,
    orgId,
    actorUserId: session.userId,
    summary: `Switched active org to ${orgId || 'none'}`,
    metadata: {
      previousOrgId
    }
  });
  await saveState(state);
  return buildAuthPayload(state, sessionId);
}

export async function createBounty(input, authContext = null) {
  const state = await loadState();
  const actor = resolveActor(state, authContext);
  const activeOrgId = String(input.orgId || actor.activeOrg?.orgId || state.currentOrgId || state.orgs[0]?.orgId || '').trim();
  assertPermission(state, actor, 'bounty:create', activeOrgId);

  const bounty = {
    bountyId: nextId('bnty', state.bounties),
    orgId: activeOrgId,
    createdByUserId: actor.user.userId,
    title: String(input.title || '').trim(),
    rewardAmount: Number(input.rewardAmount),
    rewardToken: String(input.rewardToken || 'USDC').trim().toUpperCase() || 'USDC',
    deadline: input.deadline,
    status: 'Open',
    ownerHandle: String(input.ownerHandle || actor.user.handle || '').trim(),
    requirementSummary: String(input.requirementSummary || '').trim(),
    escrowTxHash: input.escrowTxHash || createTxHash(),
    chainId: input.chainId !== undefined ? Number(input.chainId) : Number(input.chainId || 0) || 80001,
    contractAddress: normalizeWalletAddress(input.contractAddress || '') || String(input.contractAddress || '').trim(),
    contractVersion: String(input.contractVersion || 'v1.0.0').trim(),
    abiVersion: String(input.abiVersion || 'abi-v1').trim(),
    contractVerified: Boolean(input.contractVerified ?? true),
    explorerBaseUrl: String(input.explorerBaseUrl || 'https://explorer.xlayer.tech').trim(),
    treasuryType: String(input.treasuryType || 'multisig').trim(),
    treasuryAddress: normalizeWalletAddress(input.treasuryAddress || '') || String(input.treasuryAddress || '').trim(),
    treasuryThreshold: Number(input.treasuryThreshold || 2),
    treasurySigners: Array.isArray(input.treasurySigners)
      ? input.treasurySigners.map((value) => normalizeWalletAddress(value) || String(value || '').trim()).filter(Boolean)
      : [],
    fundingTxHash: String(input.fundingTxHash || '').trim(),
    payoutTxHash: String(input.payoutTxHash || '').trim(),
    refundTxHash: String(input.refundTxHash || '').trim(),
    onChainStatus: String(input.onChainStatus || 'draft').trim(),
    chainSyncStatus: String(input.chainSyncStatus || 'pending').trim(),
    lastChainSyncedAt: input.lastChainSyncedAt ? String(input.lastChainSyncedAt) : nowIso(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    requirements: Array.isArray(input.requirements) ? input.requirements.map(normalizeRequirement) : []
  };

  state.bounties.unshift(bounty);
  appendBountyVersion(state, bounty, actor, 'created', { bounty });
  recordAuditEvent(state, {
    action: 'bounty.created',
    entityType: 'bounty',
    entityId: bounty.bountyId,
    orgId: bounty.orgId,
    bountyId: bounty.bountyId,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    summary: `Created bounty ${bounty.title}`,
    metadata: {
      rewardAmount: bounty.rewardAmount,
      rewardToken: bounty.rewardToken,
      status: bounty.status,
      chainId: bounty.chainId,
      contractAddress: bounty.contractAddress
    }
  });
  await saveState(state);
  return bounty;
}

export async function updateBounty(bountyId, input, authContext = null) {
  const state = await loadState();
  const bounty = state.bounties.find((item) => item.bountyId === bountyId);
  if (!bounty) {
    throw createError(404, 'Bounty not found');
  }

  const actor = resolveActor(state, authContext, bounty.orgId);
  assertPermission(state, actor, 'bounty:update', bounty.orgId);
  const previous = structuredClone(bounty);
  const changes = {};

  if (typeof input.title === 'string') {
    const value = input.title.trim();
    if (value !== bounty.title) {
      bounty.title = value;
      changes.title = value;
    }
  }
  if (input.rewardAmount !== undefined) {
    const value = Number(input.rewardAmount);
    if (Number.isFinite(value) && value !== bounty.rewardAmount) {
      bounty.rewardAmount = value;
      changes.rewardAmount = value;
    }
  }
  if (typeof input.rewardToken === 'string') {
    const value = input.rewardToken.trim().toUpperCase() || bounty.rewardToken;
    if (value !== bounty.rewardToken) {
      bounty.rewardToken = value;
      changes.rewardToken = value;
    }
  }
  if (typeof input.deadline === 'string' && input.deadline.trim()) {
    const value = input.deadline.trim();
    if (value !== bounty.deadline) {
      bounty.deadline = value;
      changes.deadline = value;
    }
  }
  if (typeof input.ownerHandle === 'string') {
    const value = input.ownerHandle.trim();
    if (value !== bounty.ownerHandle) {
      bounty.ownerHandle = value;
      changes.ownerHandle = value;
    }
  }
  if (typeof input.requirementSummary === 'string') {
    const value = input.requirementSummary.trim();
    if (value !== bounty.requirementSummary) {
      bounty.requirementSummary = value;
      changes.requirementSummary = value;
    }
  }
  if (typeof input.status === 'string') {
    const value = input.status.trim();
    if (value !== bounty.status) {
      bounty.status = value;
      changes.status = value;
    }
  }
  if (typeof input.escrowTxHash === 'string' && input.escrowTxHash.trim()) {
    const value = input.escrowTxHash.trim();
    if (value !== bounty.escrowTxHash) {
      bounty.escrowTxHash = value;
      changes.escrowTxHash = value;
    }
  }
  if (Array.isArray(input.requirements)) {
    const value = input.requirements.map(normalizeRequirement);
    bounty.requirements = value;
    changes.requirements = value;
  }
  const chainFields = syncBountyChainState(bounty, input, actor);
  Object.assign(changes, chainFields);
  if (typeof input.onChainStatus === 'string') {
    const value = input.onChainStatus.trim();
    if (value !== bounty.onChainStatus) {
      bounty.onChainStatus = value;
      changes.onChainStatus = value;
    }
  }
  if (typeof input.chainSyncStatus === 'string') {
    const value = input.chainSyncStatus.trim();
    if (value !== bounty.chainSyncStatus) {
      bounty.chainSyncStatus = value;
      changes.chainSyncStatus = value;
    }
  }

  bounty.updatedAt = nowIso();
  bounty.updatedByUserId = actor.user.userId;
  const latestVerification = state.verifications
    .filter((verification) => verification.bountyId === bountyId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] || null;
  if (bounty.status !== 'Paid') {
    bounty.payoutStatus = latestVerification ? (latestVerification.overallPass ? 'Ready to release' : 'Locked') : 'In escrow';
  }
  if (Object.keys(changes).length > 0) {
    appendBountyVersion(state, bounty, actor, 'updated', {
      previous,
      changes
    });
  }
  recordAuditEvent(state, {
    action: 'bounty.updated',
    entityType: 'bounty',
    entityId: bounty.bountyId,
    orgId: bounty.orgId,
    bountyId: bounty.bountyId,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    summary: `Updated bounty ${bounty.title}`,
    metadata: {
      changes
    }
  });

  await saveState(state);
  return bounty;
}

export async function deleteBounty(bountyId, authContext = null) {
  const state = await loadState();
  const bountyIndex = state.bounties.findIndex((item) => item.bountyId === bountyId);
  if (bountyIndex < 0) {
    throw createError(404, 'Bounty not found');
  }

  const bounty = state.bounties[bountyIndex];
  const actor = resolveActor(state, authContext, bounty.orgId);
  assertPermission(state, actor, 'bounty:delete', bounty.orgId);

  appendBountyVersion(state, bounty, actor, 'deleted', { deleted: true });
  recordAuditEvent(state, {
    action: 'bounty.deleted',
    entityType: 'bounty',
    entityId: bounty.bountyId,
    orgId: bounty.orgId,
    bountyId: bounty.bountyId,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    severity: 'warn',
    summary: `Deleted bounty ${bounty.title}`,
    metadata: {
      bountyTitle: bounty.title
    }
  });

  const [removed] = state.bounties.splice(bountyIndex, 1);
  state.submissions = state.submissions.filter((submission) => submission.bountyId !== bountyId);
  state.verifications = state.verifications.filter((verification) => verification.bountyId !== bountyId);
  await saveState(state);
  return removed;
}

export async function createSubmission(input, authContext = null) {
  const state = await loadState();
  const bounty = state.bounties.find((item) => item.bountyId === input.bountyId);
  if (!bounty) {
    throw createError(404, 'Bounty not found');
  }

  const actor = resolveActor(state, authContext, bounty.orgId);
  assertPermission(state, actor, 'submission:create', bounty.orgId);
  const screenshotUrls = normalizeEvidenceList(input.screenshotUrls);
  const pageSnapshots = normalizeEvidenceList(input.pageSnapshots);
  const evidenceMetadata = normalizeEvidenceMetadata(input.evidenceMetadata || input.metadata);
  const evidenceProfile = extractEvidenceProfile({
    url: input.url || '',
    content: input.content || '',
    screenshotUrls,
    pageSnapshots,
    evidenceMetadata
  });

  const submission = {
    submissionId: nextId('sub', state.submissions),
    bountyId: bounty.bountyId,
    contributorHandle: String(input.contributorHandle || actor.user.handle || '').trim(),
    contributorUserId: actor.user.userId,
    url: String(input.url || '').trim(),
    submittedAt: input.submittedAt || nowIso(),
    tweetCount: Number(input.tweetCount || 0),
    content: String(input.content || ''),
    screenshotUrls,
    pageSnapshots,
    evidenceMetadata,
    evidenceProfile,
    createdAt: nowIso()
  };

  state.submissions.unshift(submission);
  bounty.updatedAt = nowIso();
  recordAuditEvent(state, {
    action: 'submission.created',
    entityType: 'submission',
    entityId: submission.submissionId,
    orgId: bounty.orgId,
    bountyId: bounty.bountyId,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    summary: `Submission ${submission.submissionId} created for ${bounty.bountyId}`,
    metadata: {
      url: submission.url,
      tweetCount: submission.tweetCount
    }
  });
  dispatchNotifications(state, state.memberships.filter((membership) => membership.orgId === bounty.orgId && ['owner', 'admin', 'poster', 'reviewer'].includes(normalizeRole(membership.role))).map((membership) => membership.userId), {
    orgId: bounty.orgId,
    channels: ['email', 'in-app', 'webhook'],
    category: 'submission',
    title: `New submission for ${bounty.title}`,
    body: `${submission.contributorHandle} submitted evidence for ${bounty.bountyId}.`,
    relatedType: 'submission',
    relatedId: submission.submissionId,
    metadata: {
      bountyId: bounty.bountyId,
      submissionId: submission.submissionId,
      evidenceProfile
    }
  });
  await saveState(state);
  return submission;
}

export async function verifySubmission(input, authContext = null) {
  const state = await loadState();
  const bounty = state.bounties.find((item) => item.bountyId === input.bountyId);
  if (!bounty) {
    throw createError(404, 'Bounty not found');
  }

  const actor = resolveActor(state, authContext, bounty.orgId);
  assertPermission(state, actor, 'bounty:verify', bounty.orgId);

  const submission = state.submissions.find((item) => item.submissionId === input.submissionId);
  if (!submission) {
    throw createError(404, 'Submission not found');
  }
  const evidenceProfile = extractEvidenceProfile(submission);
  const evidenceQualityScore = Math.min(
    100,
    (evidenceProfile.screenshotCount > 0 ? 30 : 0) +
    (evidenceProfile.pageSnapshotCount > 0 ? 30 : 0) +
    (evidenceProfile.metadataKeys.length > 0 ? 20 : 0) +
    (evidenceProfile.contentWords > 0 ? 20 : 0)
  );

  const verdict = evaluateBounty(
    {
      bounty_id: bounty.bountyId,
      pass_threshold: 'all_required',
      requirements: bounty.requirements
    },
    {
      submissionId: submission.submissionId,
      url: submission.url,
      authorHandle: submission.contributorHandle,
      submittedAt: submission.submittedAt,
      content: submission.content,
      tweetCount: submission.tweetCount
    }
  );

  const verification = {
    verificationId: nextId('ver', state.verifications),
    bountyId: bounty.bountyId,
    submissionId: submission.submissionId,
    overallPass: verdict.overall_pass,
    verdictHash: createVerdictHash(verdict),
    createdAt: nowIso(),
    verifiedByUserId: actor.user.userId,
    results: verdict.results,
    evidenceProfile,
    evidenceQualityScore,
    evidenceSummary: {
      screenshotCount: evidenceProfile.screenshotCount,
      pageSnapshotCount: evidenceProfile.pageSnapshotCount,
      metadataKeys: evidenceProfile.metadataKeys,
      contentHash: evidenceProfile.contentHash
    }
  };
  const aiVerdict = buildStructuredVerdict({
    bounty,
    submission,
    evidenceProfile,
    verdict
  });
  const proofPayload = {
    bountyId: bounty.bountyId,
    submissionId: submission.submissionId,
    verificationId: verification.verificationId,
    verdictHash: verification.verdictHash,
    overallPass: verification.overallPass,
    evidenceQualityScore: verification.evidenceQualityScore,
    results: verification.results,
    evidenceSummary: verification.evidenceSummary
  };
  const proofHash = createProofHash(proofPayload);
  const proofTxHash = createTxHash();
  verification.chainProofHash = proofHash;
  verification.chainProofTxHash = proofTxHash;
  verification.chainProofStatus = 'confirmed';
  verification.chainProofRecordedAt = nowIso();
  verification.aiVerdict = aiVerdict;
  verification.reasoningSummary = aiVerdict.explanation;
  verification.confidenceScore = aiVerdict.confidence;
  verification.evidenceBundle = aiVerdict.evidenceSnapshot;
  verification.reasoningTrail = aiVerdict.requirementFindings;

  state.verifications.unshift(verification);
  submission.status = verdict.overall_pass ? 'Passed' : 'Failed';
  submission.verificationId = verification.verificationId;
  bounty.updatedAt = nowIso();
  bounty.latestVerificationId = verification.verificationId;
  bounty.latestSubmissionId = submission.submissionId;
  bounty.lastProofHash = proofHash;
  bounty.lastProofTxHash = proofTxHash;
  bounty.lastProofRecordedAt = verification.chainProofRecordedAt;
  if (verdict.overall_pass) {
    bounty.status = 'Verified';
    bounty.payoutStatus = 'Ready to release';
    bounty.onChainStatus = 'verified';
  } else if (bounty.status === 'Open') {
    bounty.payoutStatus = 'Locked';
    bounty.onChainStatus = 'verified';
  }
  recordAuditEvent(state, {
    action: 'submission.verified',
    entityType: 'verification',
    entityId: verification.verificationId,
    orgId: bounty.orgId,
    bountyId: bounty.bountyId,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    summary: `Verification ${verification.verificationId} completed`,
    metadata: {
      submissionId: submission.submissionId,
      overallPass: verification.overallPass,
      verdictHash: verification.verdictHash,
      proofHash,
      proofTxHash,
      reasoningSummary: aiVerdict.explanation,
      confidenceScore: aiVerdict.confidence,
      evidenceBundle: aiVerdict.evidenceSnapshot,
      reasoningTrail: aiVerdict.requirementFindings
    }
  });
  recordChainEvent(state, {
    bountyId: bounty.bountyId,
    type: 'proof_writeback',
    txHash: proofTxHash,
    status: 'confirmed',
    details: {
      proofHash,
      verdictHash: verification.verdictHash,
      verificationId: verification.verificationId,
      submissionId: submission.submissionId,
      overallPass: verification.overallPass,
      chainId: bounty.chainId,
      contractAddress: bounty.contractAddress,
      explorerBaseUrl: bounty.explorerBaseUrl
    }
  });
  dispatchNotifications(state, state.memberships.filter((membership) => membership.orgId === bounty.orgId && ['owner', 'admin', 'poster', 'reviewer'].includes(normalizeRole(membership.role))).map((membership) => membership.userId), {
    orgId: bounty.orgId,
    channels: ['email', 'in-app', 'webhook'],
    category: 'verification',
    title: `${verification.overallPass ? 'Passed' : 'Failed'} verification for ${bounty.title}`,
    body: `${submission.submissionId} completed with ${verification.overallPass ? 'a pass' : 'a fail'} verdict.`,
    relatedType: 'verification',
    relatedId: verification.verificationId,
    metadata: {
      bountyId: bounty.bountyId,
      submissionId: submission.submissionId,
      overallPass: verification.overallPass,
      evidenceQualityScore
    }
  });

  await saveState(state);
  return verification;
}

function finalizeRelease(state, bounty, actor, input = {}) {
  const previous = structuredClone(bounty);
  bounty.status = 'Paid';
  bounty.payoutStatus = 'Released';
  bounty.payoutTxHash = String(input.payoutTxHash || bounty.payoutTxHash || createTxHash()).trim();
  bounty.releasedAt = nowIso();
  bounty.paidAt = bounty.releasedAt;
  bounty.releaseReason = String(input.reason || '').trim();
  bounty.onChainStatus = 'paid';
  bounty.chainSyncStatus = 'synced';
  bounty.updatedAt = nowIso();
  appendBountyVersion(state, bounty, actor, 'release', {
    previous,
    changes: {
      payoutTxHash: bounty.payoutTxHash,
      releaseReason: bounty.releaseReason
    }
  });
  recordAuditEvent(state, {
    action: 'bounty.released',
    entityType: 'bounty',
    entityId: bounty.bountyId,
    orgId: bounty.orgId,
    bountyId: bounty.bountyId,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    severity: 'info',
    summary: `Escrow released for ${bounty.title}`,
    metadata: {
      payoutTxHash: bounty.payoutTxHash,
      reason: bounty.releaseReason
    }
  });
  recordChainEvent(state, {
    bountyId: bounty.bountyId,
    type: 'escrow_release',
    txHash: bounty.payoutTxHash,
    status: 'confirmed',
    details: {
      payoutTxHash: bounty.payoutTxHash,
      reason: bounty.releaseReason,
      proofHash: bounty.lastProofHash || null,
      proofTxHash: bounty.lastProofTxHash || null,
      chainId: bounty.chainId,
      contractAddress: bounty.contractAddress
    }
  });
  recordObservabilityEvent(state, {
    kind: 'trace',
    source: 'escrow',
    route: `/bounties/${bounty.bountyId}/release`,
    level: 'info',
    message: 'Escrow release completed',
    metadata: { bountyId: bounty.bountyId, payoutTxHash: bounty.payoutTxHash }
  });
  dispatchNotifications(state, state.memberships.filter((membership) => membership.orgId === bounty.orgId && ['owner', 'admin', 'poster'].includes(normalizeRole(membership.role))).map((membership) => membership.userId), {
    orgId: bounty.orgId,
    channels: ['email', 'in-app', 'webhook'],
    category: 'payout',
    title: `Escrow released for ${bounty.title}`,
    body: `Funds were released with tx ${bounty.payoutTxHash}.`,
    relatedType: 'bounty',
    relatedId: bounty.bountyId,
    metadata: {
      payoutTxHash: bounty.payoutTxHash,
      proofHash: bounty.lastProofHash || null
    }
  });
  return bounty;
}

function finalizeRefund(state, bounty, actor, input = {}) {
  const previous = structuredClone(bounty);
  bounty.status = 'Refunded';
  bounty.payoutStatus = 'Refunded';
  bounty.refundTxHash = String(input.refundTxHash || bounty.refundTxHash || createTxHash()).trim();
  bounty.refundedAt = nowIso();
  bounty.refundReason = String(input.reason || '').trim();
  bounty.onChainStatus = 'refunded';
  bounty.chainSyncStatus = 'synced';
  bounty.updatedAt = nowIso();
  appendBountyVersion(state, bounty, actor, 'refund', {
    previous,
    changes: {
      refundTxHash: bounty.refundTxHash,
      refundReason: bounty.refundReason
    }
  });
  recordAuditEvent(state, {
    action: 'bounty.refunded',
    entityType: 'bounty',
    entityId: bounty.bountyId,
    orgId: bounty.orgId,
    bountyId: bounty.bountyId,
    actorUserId: actor.user.userId,
    actorHandle: actor.user.handle,
    severity: 'warn',
    summary: `Refund issued for ${bounty.title}`,
    metadata: {
      refundTxHash: bounty.refundTxHash,
      reason: bounty.refundReason
    }
  });
  recordChainEvent(state, {
    bountyId: bounty.bountyId,
    type: 'escrow_refund',
    txHash: bounty.refundTxHash,
    status: 'confirmed',
    details: {
      refundTxHash: bounty.refundTxHash,
      reason: bounty.refundReason,
      proofHash: bounty.lastProofHash || null,
      proofTxHash: bounty.lastProofTxHash || null,
      chainId: bounty.chainId,
      contractAddress: bounty.contractAddress
    }
  });
  recordObservabilityEvent(state, {
    kind: 'trace',
    source: 'escrow',
    route: `/bounties/${bounty.bountyId}/refund`,
    level: 'warn',
    message: 'Escrow refund completed',
    metadata: { bountyId: bounty.bountyId, refundTxHash: bounty.refundTxHash }
  });
  dispatchNotifications(state, state.memberships.filter((membership) => membership.orgId === bounty.orgId && ['owner', 'admin', 'poster'].includes(normalizeRole(membership.role))).map((membership) => membership.userId), {
    orgId: bounty.orgId,
    channels: ['email', 'in-app', 'webhook'],
    category: 'refund',
    title: `Refund issued for ${bounty.title}`,
    body: `The bounty was refunded with tx ${bounty.refundTxHash}.`,
    relatedType: 'bounty',
    relatedId: bounty.bountyId,
    metadata: {
      refundTxHash: bounty.refundTxHash,
      proofHash: bounty.lastProofHash || null
    }
  });
  return bounty;
}

export function getPublicState(state, authContext = null) {
  const normalized = normalizeState(state);
  const auth = authContext ? summarizeAuthContext(normalized, authContext) : resolveAuthContext(normalized);
  return {
    ...normalized,
    auth,
    stats: deriveStats(normalized),
    analytics: deriveAnalytics(normalized),
    bountySummaries: normalized.bounties.map((bounty) => summarizeBounty(normalized, bounty, auth?.activeOrg?.orgId)),
    orgSummaries: normalized.orgs.map((org) => summarizeOrg(normalized, org, auth?.user?.userId)),
    disputeSummaries: normalized.disputes.map((dispute) => summarizeDispute(normalized, dispute)),
    auditLogSummaries: normalized.auditLogs.map((log) => summarizeAuditLog(normalized, log)),
    bountyVersionSummaries: normalized.bountyVersions.map((version) => summarizeBountyVersion(normalized, version)),
    chainEventSummaries: normalized.chainEvents.map((event) => summarizeChainEvent(normalized, event)),
    notificationSummaries: deriveNotificationInbox(normalized, auth),
    observabilityOverview: deriveObservabilityOverview(normalized),
    reviewQueue: deriveReviewQueue(normalized, auth),
    recentActivity: deriveRecentActivity(normalized),
    transactionHistory: deriveTransactionHistory(normalized)
  };
}

export function normalizeState(input) {
  const state = input && typeof input === 'object' ? input : createFreshState();
  state.currentPosterHandle ||= '@okx';
  state.currentContributorHandle ||= '@submitter_handle';
  state.currentUserId ||= null;
  state.currentOrgId ||= null;
  state.users = Array.isArray(state.users) ? state.users.map(normalizeUser) : [];
  state.orgs = Array.isArray(state.orgs) ? state.orgs.map(normalizeOrg) : [];
  state.memberships = Array.isArray(state.memberships) ? state.memberships.map(normalizeMembership) : [];
  state.invites = Array.isArray(state.invites) ? state.invites.map(normalizeInvite) : [];
  state.sessions = Array.isArray(state.sessions) ? state.sessions.map(normalizeSession) : [];
  state.auditLogs = Array.isArray(state.auditLogs) ? state.auditLogs.map(normalizeAuditLog) : [];
  state.bountyVersions = Array.isArray(state.bountyVersions) ? state.bountyVersions.map(normalizeBountyVersion) : [];
  state.chainEvents = Array.isArray(state.chainEvents) ? state.chainEvents.map(normalizeChainEvent) : [];
  state.notifications = Array.isArray(state.notifications) ? state.notifications.map(normalizeNotification) : [];
  state.observabilityEvents = Array.isArray(state.observabilityEvents) ? state.observabilityEvents.map((event) => ({
    observabilityEventId: event.observabilityEventId || event.id || nextId('obs', []),
    kind: event.kind || 'trace',
    source: event.source || 'server',
    level: event.level || 'info',
    route: event.route || '',
    requestId: event.requestId || null,
    durationMs: Number(event.durationMs || 0),
    statusCode: Number(event.statusCode || 0),
    message: event.message || '',
    metadata: event.metadata && typeof event.metadata === 'object' ? structuredClone(event.metadata) : {},
    createdAt: event.createdAt || nowIso()
  })) : [];
  state.walletChallenges = Array.isArray(state.walletChallenges) ? state.walletChallenges.map(normalizeWalletChallenge) : [];
  state.disputes = Array.isArray(state.disputes) ? state.disputes.map(normalizeDispute) : [];
  state.idempotencyRecords = Array.isArray(state.idempotencyRecords) ? state.idempotencyRecords.map(normalizeIdempotencyRecord) : [];
  state.bounties = Array.isArray(state.bounties) ? state.bounties.map((bounty) => normalizeBounty(bounty, state)) : [];
  state.submissions = Array.isArray(state.submissions) ? state.submissions.map((submission) => normalizeSubmission(submission, state)) : [];
  state.verifications = Array.isArray(state.verifications) ? state.verifications.map(normalizeVerification) : [];

  if (state.users.length === 0) {
    state.users = createSeedUsersFromState(state);
  }

  if (state.orgs.length === 0) {
    state.orgs = createSeedOrgsFromState(state);
  }

  if (state.memberships.length === 0) {
    state.memberships = createSeedMembershipsFromState(state);
  }

  if (state.disputes.length > 0) {
    state.disputes.forEach((dispute) => {
      if (!state.bounties.some((bounty) => bounty.bountyId === dispute.bountyId)) {
        dispute.bountyId = null;
      }
    });
  }

  state.sessions = state.sessions.map((session) => ({
    ...session,
    csrfToken: session.csrfToken || createToken('csrf'),
    activeOrgId: session.activeOrgId || null
  }));

  linkBountiesToOrgs(state);
  return state;
}

export function resolveAuthContext(state, sessionId = null) {
  const normalized = normalizeState(state);
  const session = sessionId
    ? normalized.sessions.find((item) => item.sessionId === sessionId) || null
    : normalized.sessions[0] || normalized.sessions.find((item) => item.userId === normalized.currentUserId) || null;
  const demoUser = normalized.users.find((item) => item.userId === normalized.currentUserId) || normalized.users.find((item) => item.handle === normalized.currentPosterHandle) || normalized.users[0] || null;
  const demoOrg = normalized.orgs.find((item) => item.orgId === normalized.currentOrgId) || normalized.orgs.find((item) => item.ownerUserId === demoUser?.userId) || normalized.orgs[0] || null;
  const isSession = Boolean(session && demoUser);
  const user = isSession
    ? normalized.users.find((item) => item.userId === session.userId) || demoUser
    : demoUser;
  const activeOrg = isSession
    ? normalized.orgs.find((item) => item.orgId === session.activeOrgId) || normalized.orgs.find((item) => item.ownerUserId === user?.userId) || demoOrg
    : demoOrg;
  const membership = user && activeOrg
    ? normalized.memberships.find((item) => item.userId === user.userId && item.orgId === activeOrg.orgId) || null
    : null;
  const role = resolveRole(normalized, user, activeOrg, membership);
  const permissions = Array.from(rolePermissions[role] || rolePermissions.contributor);
  const availableOrgs = user
    ? normalized.memberships
        .filter((item) => item.userId === user.userId)
        .map((item) => summarizeOrg(normalized, normalized.orgs.find((org) => org.orgId === item.orgId), user.userId))
        .filter(Boolean)
    : [];
  const csrfToken = session?.csrfToken || null;

  return summarizeAuthContext(normalized, {
    mode: session ? 'session' : 'demo',
    sessionId: session?.sessionId || null,
    csrfToken,
    user,
    activeOrg,
    membership,
    role,
    permissions,
    availableOrgs,
    currentPosterHandle: normalized.currentPosterHandle,
    currentContributorHandle: normalized.currentContributorHandle,
    invites: normalized.invites.filter((invite) => {
      if (!user) {
        return false;
      }
      const emailMatch = invite.email && user.email && invite.email === user.email;
      const walletMatch = invite.walletAddress && user.walletAddress && invite.walletAddress === user.walletAddress;
      const handleMatch = invite.handle && user.handle && invite.handle === user.handle;
      return invite.status === 'pending' && (emailMatch || walletMatch || handleMatch);
    })
  });
}

export function deriveStats(state) {
  const openBounties = state.bounties.filter((bounty) => !['Paid', 'Refunded', 'Verified'].includes(bounty.status)).length;
  const escrowedReward = state.bounties
    .filter((bounty) => !['Paid', 'Refunded', 'Verified'].includes(bounty.status))
    .reduce((sum, bounty) => sum + Number(bounty.rewardAmount || 0), 0);
  const todaysVerifications = state.verifications.filter((verification) => isSameDay(verification.createdAt, nowIso())).length;
  const passRate = state.verifications.length === 0
    ? 0
    : Math.round((state.verifications.filter((verification) => verification.overallPass).length / state.verifications.length) * 100);

  return [
    { label: 'Open bounties', value: String(openBounties) },
    { label: 'Escrowed reward', value: `${formatMoney(escrowedReward)} USDC` },
    { label: "Today's verifications", value: String(todaysVerifications) },
    { label: 'Pass rate', value: `${passRate}%` }
  ];
}

export function deriveAnalytics(state) {
  const verificationPairs = state.verifications
    .map((verification) => {
      const submission = state.submissions.find((item) => item.submissionId === verification.submissionId) || null;
      if (!submission) {
        return null;
      }
      const deltaMinutes = Math.max(0, Math.round((Date.parse(verification.createdAt) - Date.parse(submission.createdAt)) / 60000));
      return {
        bountyId: verification.bountyId,
        submissionId: verification.submissionId,
        minutes: deltaMinutes,
        overallPass: Boolean(verification.overallPass)
      };
    })
    .filter(Boolean);

  const payoutLatencyPairs = state.bounties
    .map((bounty) => {
      const startAt = bounty.latestVerificationId
        ? state.verifications.find((item) => item.verificationId === bounty.latestVerificationId)?.createdAt
        : null;
      const endAt = bounty.releasedAt || bounty.paidAt || bounty.refundedAt || bounty.updatedAt || null;
      if (!startAt || !endAt) {
        return null;
      }
      return {
        bountyId: bounty.bountyId,
        minutes: Math.max(0, Math.round((Date.parse(endAt) - Date.parse(startAt)) / 60000)),
        status: bounty.status
      };
    })
    .filter(Boolean);

  const disputesPerBounty = new Map();
  state.disputes.forEach((dispute) => {
    disputesPerBounty.set(dispute.bountyId, (disputesPerBounty.get(dispute.bountyId) || 0) + 1);
  });

  const avg = (values) => (values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0);
  const median = (values) => {
    if (!values.length) {
      return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  };

  const totalVerifications = state.verifications.length;
  const disputeRate = totalVerifications === 0 ? 0 : Math.round((state.disputes.length / totalVerifications) * 100);
  const passedVerifications = state.verifications.filter((verification) => verification.overallPass).length;
  const averageTimeToVerifyMinutes = avg(verificationPairs.map((item) => item.minutes));
  const medianTimeToVerifyMinutes = median(verificationPairs.map((item) => item.minutes));
  const averagePayoutLatencyMinutes = avg(payoutLatencyPairs.map((item) => item.minutes));
  const medianPayoutLatencyMinutes = median(payoutLatencyPairs.map((item) => item.minutes));
  const disputedBounties = Array.from(disputesPerBounty.values()).filter((count) => count > 0).length;

  return {
    verificationCount: totalVerifications,
    passRate: totalVerifications === 0 ? 0 : Math.round((passedVerifications / totalVerifications) * 100),
    disputeCount: state.disputes.length,
    disputeRate,
    disputedBounties,
    timeToVerify: {
      averageMinutes: averageTimeToVerifyMinutes,
      medianMinutes: medianTimeToVerifyMinutes,
      samples: verificationPairs.length
    },
    payoutLatency: {
      averageMinutes: averagePayoutLatencyMinutes,
      medianMinutes: medianPayoutLatencyMinutes,
      samples: payoutLatencyPairs.length
    }
  };
}

export function summarizeBounty(state, bounty, viewerOrgId = null) {
  const submissions = state.submissions.filter((submission) => submission.bountyId === bounty.bountyId);
  const verifications = state.verifications.filter((verification) => verification.bountyId === bounty.bountyId);
  const disputes = state.disputes.filter((dispute) => dispute.bountyId === bounty.bountyId);
  const versions = state.bountyVersions.filter((version) => version.bountyId === bounty.bountyId);
  const latestVerification = verifications[0] || null;
  const latestDispute = disputes[0] || null;
  const latestVersion = versions[0] || null;
  const org = state.orgs.find((item) => item.orgId === bounty.orgId) || null;
  const creator = state.users.find((item) => item.userId === bounty.createdByUserId) || null;
  return {
    ...bounty,
    orgName: org?.name || 'Unassigned workspace',
    orgSlug: org?.slug || null,
    creatorHandle: creator?.handle || bounty.ownerHandle || null,
    submissionCount: submissions.length,
    verificationCount: verifications.length,
    disputeCount: disputes.length,
    versionCount: versions.length,
    latestSubmission: submissions[0] || null,
    latestVerification,
    latestDispute,
    latestVersion,
    canEdit: viewerOrgId ? viewerOrgId === bounty.orgId : true,
    payoutStatus: derivePayoutStatus(bounty, latestVerification),
    explorerLinks: buildExplorerLinks(bounty)
  };
}

export function summarizeOrg(state, org, viewerUserId = null) {
  if (!org) {
    return null;
  }

  const owner = state.users.find((item) => item.userId === org.ownerUserId) || null;
  const members = state.memberships.filter((item) => item.orgId === org.orgId);
  const role = viewerUserId ? members.find((item) => item.userId === viewerUserId)?.role || null : null;
  return {
    ...org,
    ownerHandle: owner?.handle || null,
    memberCount: members.length,
    bountyCount: state.bounties.filter((item) => item.orgId === org.orgId).length,
    role,
    members: members.map((membership) => summarizeMembership(state, membership)).filter(Boolean)
  };
}

export function summarizeMembership(state, membership) {
  if (!membership) {
    return null;
  }

  const user = state.users.find((item) => item.userId === membership.userId) || null;
  return {
    ...membership,
    userHandle: user?.handle || null,
    displayName: user?.displayName || user?.handle || 'Unknown'
  };
}

export function summarizeAuthContext(state, authContext) {
  if (!authContext) {
    return null;
  }

  const user = authContext.user ? summarizeUser(authContext.user) : null;
  const activeOrg = authContext.activeOrg ? summarizeOrg(state, authContext.activeOrg, authContext.user?.userId) : null;
  const membership = authContext.membership ? { ...authContext.membership } : null;
  const availableOrgs = Array.isArray(authContext.availableOrgs) ? authContext.availableOrgs : [];
  return {
    mode: authContext.mode || 'demo',
    sessionId: authContext.sessionId || null,
    csrfToken: authContext.csrfToken || null,
    user,
    activeOrg,
    membership,
    role: authContext.role || membership?.role || null,
    permissions: Array.isArray(authContext.permissions) ? authContext.permissions : [],
    availableOrgs,
    currentPosterHandle: authContext.currentPosterHandle || state.currentPosterHandle,
    currentContributorHandle: authContext.currentContributorHandle || state.currentContributorHandle,
    invites: Array.isArray(authContext.invites) ? authContext.invites.map(summarizeInvite) : [],
    can: buildPermissionMap(authContext.permissions || [])
  };
}

export function deriveRecentActivity(state) {
  return [
    ...state.disputes.slice(0, 2).map((dispute) => ({
      label: dispute.status === 'resolved' ? 'Dispute resolved' : 'Dispute opened',
      detail: `${dispute.disputeId} on ${dispute.bountyId}`,
      tone: dispute.status === 'resolved' ? 'good' : 'warn',
      timestamp: dispute.updatedAt || dispute.createdAt
    })),
    ...state.verifications.slice(0, 3).map((verification) => ({
      label: verification.overallPass ? 'Verification passed' : 'Verification failed',
      detail: `${verification.submissionId} on ${verification.bountyId}`,
      tone: verification.overallPass ? 'good' : 'bad',
      timestamp: verification.createdAt
    })),
    ...state.submissions.slice(0, 3).map((submission) => ({
      label: 'Submission received',
      detail: `${submission.submissionId} from ${submission.contributorHandle}`,
      tone: 'neutral',
      timestamp: submission.createdAt
    }))
  ]
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, 5);
}

export function deriveTransactionHistory(state) {
  const events = [
    ...state.disputes.map((dispute) => ({
      kind: 'dispute',
      label: dispute.status === 'resolved' ? `Dispute ${dispute.resolutionOutcome}` : 'Dispute opened',
      detail: `${dispute.disputeId} for ${dispute.bountyId}`,
      tone: dispute.status === 'resolved' ? 'good' : 'warn',
      timestamp: dispute.updatedAt || dispute.createdAt,
      bountyId: dispute.bountyId,
      payoutStatus: dispute.status === 'resolved' ? dispute.resolutionOutcome : 'Disputed'
    })),
    ...state.bounties.map((bounty) => ({
      kind: 'bounty',
      label: bounty.status === 'Paid'
        ? 'Payout completed'
        : bounty.status === 'Verified'
          ? 'Verification ready for release'
          : bounty.status === 'Open'
            ? 'Bounty listed'
            : bounty.status === 'Disputed'
              ? 'Bounty disputed'
              : 'Bounty funded',
      detail: `${bounty.bountyId} - ${bounty.title}`,
      tone: bounty.status === 'Paid' ? 'good' : bounty.status === 'Open' ? 'neutral' : bounty.status === 'Disputed' ? 'warn' : bounty.status === 'Verified' ? 'good' : 'warn',
      timestamp: bounty.updatedAt || bounty.createdAt,
      bountyId: bounty.bountyId
    })),
    ...state.submissions.map((submission) => ({
      kind: 'submission',
      label: 'Submission stored',
      detail: `${submission.submissionId} from ${submission.contributorHandle}`,
      tone: 'neutral',
      timestamp: submission.createdAt,
      bountyId: submission.bountyId
    })),
    ...state.verifications.map((verification) => ({
      kind: 'verification',
      label: verification.overallPass ? 'Verification passed' : 'Verification failed',
      detail: `${verification.verificationId} for ${verification.submissionId}`,
      tone: verification.overallPass ? 'good' : 'bad',
      timestamp: verification.createdAt,
      bountyId: verification.bountyId,
      payoutStatus: verification.overallPass ? 'Released' : 'Locked'
    }))
  ];

  return events.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp)).slice(0, 12);
}

export function getBountyHistory(state, bountyId) {
  const bounty = state.bounties.find((item) => item.bountyId === bountyId);
  if (!bounty) {
    return null;
  }

  const submissions = state.submissions
    .filter((submission) => submission.bountyId === bountyId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const verifications = state.verifications
    .filter((verification) => verification.bountyId === bountyId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const disputes = state.disputes
    .filter((dispute) => dispute.bountyId === bountyId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const versions = state.bountyVersions
    .filter((version) => version.bountyId === bountyId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const auditLogs = state.auditLogs
    .filter((log) => log.bountyId === bountyId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  return {
    bounty: summarizeBounty(state, bounty),
    submissions,
    verifications,
    disputes,
    versions,
    auditLogs,
    timeline: [
      ...disputes.map((dispute) => ({
        kind: 'dispute',
        id: dispute.disputeId,
        label: dispute.status === 'resolved' ? `Dispute ${dispute.resolutionOutcome}` : 'Dispute opened',
        timestamp: dispute.updatedAt || dispute.createdAt,
        tone: dispute.status === 'resolved' ? 'good' : 'warn',
        detail: dispute.reason,
        resolutionOutcome: dispute.resolutionOutcome,
        resolutionNotes: dispute.resolutionNotes
      })),
      ...versions.map((version) => ({
        kind: 'version',
        id: version.bountyVersionId,
        label: `Version ${version.versionNumber}`,
        timestamp: version.createdAt,
        tone: 'neutral',
        detail: version.action
      })),
      ...auditLogs.map((log) => ({
        kind: 'audit',
        id: log.auditLogId,
        label: log.action,
        timestamp: log.createdAt,
        tone: log.severity === 'warn' ? 'warn' : log.severity === 'danger' ? 'bad' : 'neutral',
        detail: log.summary
      })),
      ...submissions.map((submission) => ({
        kind: 'submission',
        id: submission.submissionId,
        label: 'Submission recorded',
        timestamp: submission.createdAt,
        tone: 'neutral',
        detail: submission.url
      })),
      ...verifications.map((verification) => ({
        kind: 'verification',
        id: verification.verificationId,
        label: verification.overallPass ? 'Verification passed' : 'Verification failed',
        timestamp: verification.createdAt,
        tone: verification.overallPass ? 'good' : 'bad',
        detail: verification.overallPass ? 'Ready for payout' : 'Locked for review',
        results: verification.results
      }))
    ].sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
  };
}

async function ensureStateFile() {
  await mkdir(dataDir, { recursive: true });
  try {
    await readFile(stateFile, 'utf8');
  } catch {
    await writeFile(stateFile, JSON.stringify(createFreshState(), null, 2), 'utf8');
  }
}

function buildAuthPayload(state, sessionId) {
  const auth = resolveAuthContext(state, sessionId);
  return getPublicState(state, auth);
}

function createOrRefreshSession(state, userId, activeOrgId = null) {
  let session = state.sessions.find((item) => item.userId === userId);
  if (!session) {
    session = {
      sessionId: `ses_${randomUUID().slice(0, 8)}`,
      userId,
      activeOrgId: activeOrgId || null,
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
      csrfToken: createToken('csrf')
    };
    state.sessions.unshift(session);
  } else {
    if (activeOrgId) {
      session.activeOrgId = activeOrgId;
    }
    session.lastSeenAt = nowIso();
    session.csrfToken ||= createToken('csrf');
  }
  return session;
}

function upsertUser(state, input) {
  let user = null;
  if (input.email) {
    user = state.users.find((item) => item.email && item.email.toLowerCase() === input.email.toLowerCase()) || null;
  }
  if (!user && input.walletAddress) {
    user = state.users.find((item) => item.walletAddress && item.walletAddress.toLowerCase() === input.walletAddress.toLowerCase()) || null;
  }
  if (!user && input.handle) {
    user = state.users.find((item) => item.handle && item.handle.toLowerCase() === input.handle.toLowerCase()) || null;
  }

  if (!user) {
    user = {
      userId: nextId('usr', state.users),
      handle: normalizeHandle(input.handle || input.displayName || input.email || input.walletAddress),
      displayName: String(input.displayName || input.handle || 'User').trim(),
      email: input.email || '',
      walletAddress: input.walletAddress || '',
      authMethod: input.authMethod || 'email',
      createdAt: nowIso()
    };
    state.users.unshift(user);
  } else {
    if (input.displayName) {
      user.displayName = String(input.displayName).trim();
    }
    if (input.handle) {
      user.handle = normalizeHandle(input.handle);
    }
    if (input.email && !user.email) {
      user.email = String(input.email).trim().toLowerCase();
    }
    if (input.walletAddress && !user.walletAddress) {
      user.walletAddress = String(input.walletAddress).trim().toLowerCase();
    }
    user.authMethod = input.authMethod || user.authMethod;
  }

  return user;
}

function ensureActiveOrgForUser(state, user, requestedOrgId = null) {
  const memberships = state.memberships.filter((item) => item.userId === user.userId);
  let org = requestedOrgId ? state.orgs.find((item) => item.orgId === requestedOrgId) || null : null;
  if (org && !memberships.find((item) => item.orgId === org.orgId)) {
    org = null;
  }
  if (!org) {
    const memberOrgId = memberships[0]?.orgId || null;
    org = memberOrgId ? state.orgs.find((item) => item.orgId === memberOrgId) || null : null;
  }
  if (!org) {
    org = createPersonalOrgForUser(state, user);
  }
  return org;
}

function createPersonalOrgForUser(state, user) {
  const existing = state.orgs.find((item) => item.ownerUserId === user.userId);
  if (existing) {
    upsertMembership(state, {
      orgId: existing.orgId,
      userId: user.userId,
      role: 'owner'
    });
    return existing;
  }

  const org = {
    orgId: nextId('org', state.orgs),
    name: `${user.displayName || user.handle || 'Workspace'} Workspace`,
    slug: uniqueSlug(state.orgs, `${user.displayName || user.handle || 'workspace'} workspace`),
    ownerUserId: user.userId,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  state.orgs.unshift(org);
  upsertMembership(state, {
    orgId: org.orgId,
    userId: user.userId,
    role: 'owner'
  });
  return org;
}

function upsertMembership(state, input) {
  let membership = state.memberships.find((item) => item.orgId === input.orgId && item.userId === input.userId);
  if (!membership) {
    membership = {
      membershipId: nextId('mbr', state.memberships),
      orgId: input.orgId,
      userId: input.userId,
      role: normalizeRole(input.role || 'contributor'),
      createdAt: nowIso()
    };
    state.memberships.unshift(membership);
  } else {
    membership.role = normalizeRole(input.role || membership.role);
    membership.updatedAt = nowIso();
  }
  return membership;
}

function normalizeRole(role) {
  const value = String(role || '').toLowerCase();
  if (value === 'owner' || value === 'admin' || value === 'poster' || value === 'reviewer' || value === 'contributor') {
    return value;
  }
  return 'contributor';
}

function resolveRole(state, user, org, membership) {
  if (!user || !org) {
    return 'contributor';
  }
  if (membership?.role) {
    return normalizeRole(membership.role);
  }
  if (org.ownerUserId === user.userId) {
    return 'owner';
  }
  return 'contributor';
}

function assertPermission(state, actor, action, orgId = null) {
  if (!actor?.user) {
    return;
  }
  const role = normalizeRole(actor.role || actor.membership?.role || 'contributor');
  const permissions = rolePermissions[role] || rolePermissions.contributor;
  if (permissions.has(action)) {
    return;
  }

  if (orgId && actor.activeOrg?.orgId !== orgId) {
    const sameOrgMembership = state.memberships.find((item) => item.userId === actor.user.userId && item.orgId === orgId);
    if (sameOrgMembership) {
      const fallbackRole = normalizeRole(sameOrgMembership.role);
      if ((rolePermissions[fallbackRole] || rolePermissions.contributor).has(action)) {
        return;
      }
    }
  }

  throw createError(403, `Forbidden: ${action}`);
}

function resolveActor(state, authContext = null, orgId = null) {
  const auth = authContext && authContext.user ? authContext : resolveAuthContext(state, authContext?.sessionId || null);
  if (!orgId || auth?.activeOrg?.orgId === orgId) {
    return auth;
  }
  const membership = state.memberships.find((item) => item.userId === auth.user?.userId && item.orgId === orgId) || null;
  return {
    ...auth,
    activeOrg: state.orgs.find((item) => item.orgId === orgId) || auth.activeOrg,
    membership,
    role: resolveRole(state, auth.user, state.orgs.find((item) => item.orgId === orgId) || auth.activeOrg, membership)
  };
}

function normalizeUser(user) {
  if (!user || typeof user !== 'object') {
    return user;
  }

  return {
    userId: user.userId || user.id || nextId('usr', []),
    handle: normalizeHandle(user.handle || user.ownerHandle || user.displayName || user.email || user.walletAddress),
    displayName: user.displayName || user.name || user.handle || 'User',
    email: user.email ? String(user.email).trim().toLowerCase() : '',
    walletAddress: user.walletAddress ? String(user.walletAddress).trim().toLowerCase() : '',
    authMethod: user.authMethod || (user.walletAddress ? 'wallet' : 'email'),
    createdAt: user.createdAt || nowIso(),
    updatedAt: user.updatedAt || undefined
  };
}

function normalizeOrg(org) {
  if (!org || typeof org !== 'object') {
    return org;
  }

  return {
    orgId: org.orgId || org.id || nextId('org', []),
    name: org.name || org.title || 'Workspace',
    slug: org.slug || uniqueSlug([], org.name || 'workspace'),
    ownerUserId: org.ownerUserId || org.owner_user_id || null,
    createdAt: org.createdAt || nowIso(),
    updatedAt: org.updatedAt || nowIso()
  };
}

function normalizeMembership(membership) {
  if (!membership || typeof membership !== 'object') {
    return membership;
  }

  return {
    membershipId: membership.membershipId || membership.id || nextId('mbr', []),
    orgId: membership.orgId || membership.org_id || '',
    userId: membership.userId || membership.user_id || '',
    role: normalizeRole(membership.role),
    createdAt: membership.createdAt || nowIso(),
    updatedAt: membership.updatedAt || undefined
  };
}

function normalizeInvite(invite) {
  if (!invite || typeof invite !== 'object') {
    return invite;
  }

  return {
    inviteId: invite.inviteId || invite.id || nextId('inv', []),
    code: invite.code || `invite_${randomUUID().slice(0, 8)}`,
    orgId: invite.orgId || invite.org_id || '',
    email: invite.email ? String(invite.email).trim().toLowerCase() : '',
    walletAddress: invite.walletAddress ? String(invite.walletAddress).trim().toLowerCase() : '',
    handle: normalizeHandle(invite.handle || ''),
    role: normalizeRole(invite.role),
    invitedByUserId: invite.invitedByUserId || invite.invited_by_user_id || '',
    status: invite.status || 'pending',
    createdAt: invite.createdAt || nowIso(),
    expiresAt: invite.expiresAt || invite.expires_at || ''
  };
}

function normalizeSession(session) {
  if (!session || typeof session !== 'object') {
    return session;
  }

  return {
    sessionId: session.sessionId || session.id || nextId('ses', []),
    userId: session.userId || session.user_id || '',
    activeOrgId: session.activeOrgId || session.active_org_id || null,
    createdAt: session.createdAt || nowIso(),
    lastSeenAt: session.lastSeenAt || nowIso(),
    csrfToken: session.csrfToken || createToken('csrf')
  };
}

function normalizeWalletChallenge(challenge) {
  if (!challenge || typeof challenge !== 'object') {
    return challenge;
  }

  return {
    challengeId: challenge.challengeId || challenge.id || `wch_${randomUUID().slice(0, 8)}`,
    address: normalizeWalletAddress(challenge.address || challenge.walletAddress || ''),
    nonce: challenge.nonce || randomUUID().replaceAll('-', '').slice(0, 16),
    domain: challenge.domain || 'localhost',
    uri: challenge.uri || 'http://127.0.0.1:3000',
    chainId: Number(challenge.chainId || 1),
    issuedAt: challenge.issuedAt || nowIso(),
    expiresAt: challenge.expiresAt || new Date(Date.now() + 1000 * 60 * 10).toISOString(),
    status: challenge.status || 'pending',
    message: challenge.message || ''
  };
}

function normalizeDispute(dispute) {
  if (!dispute || typeof dispute !== 'object') {
    return dispute;
  }

  return {
    disputeId: dispute.disputeId || dispute.id || nextId('dsp', []),
    bountyId: dispute.bountyId || dispute.bounty_id || '',
    submissionId: dispute.submissionId || dispute.submission_id || '',
    verificationId: dispute.verificationId || dispute.verification_id || null,
    openedByUserId: dispute.openedByUserId || dispute.opened_by_user_id || null,
    openedByHandle: dispute.openedByHandle || dispute.opened_by_handle || '',
    assignedReviewerUserId: dispute.assignedReviewerUserId || dispute.assigned_reviewer_user_id || null,
    assignedReviewerHandle: dispute.assignedReviewerHandle || dispute.assigned_reviewer_handle || '',
    reason: dispute.reason || '',
    evidenceUrl: dispute.evidenceUrl || dispute.evidence_url || '',
    status: dispute.status || 'open',
    deadlineAt: dispute.deadlineAt || dispute.deadline_at || null,
    createdAt: dispute.createdAt || nowIso(),
    updatedAt: dispute.updatedAt || dispute.createdAt || nowIso(),
    reviewNotes: dispute.reviewNotes || dispute.review_notes || '',
    resolutionOutcome: dispute.resolutionOutcome || dispute.resolution_outcome || null,
    resolutionNotes: dispute.resolutionNotes || dispute.resolution_notes || '',
    resolvedAt: dispute.resolvedAt || dispute.resolved_at || null,
    resolvedByUserId: dispute.resolvedByUserId || dispute.resolved_by_user_id || null,
    escalatedAt: dispute.escalatedAt || dispute.escalated_at || null,
    escalatedByUserId: dispute.escalatedByUserId || dispute.escalated_by_user_id || null,
    escalationReason: dispute.escalationReason || dispute.escalation_reason || ''
  };
}

function normalizeIdempotencyRecord(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  return {
    key: record.key || '',
    scope: record.scope || '',
    bodyHash: record.bodyHash || '',
    response: record.response || null,
    statusCode: Number(record.statusCode || 200),
    createdAt: record.createdAt || nowIso()
  };
}

function normalizeNotification(notification) {
  if (!notification || typeof notification !== 'object') {
    return notification;
  }

  return {
    notificationId: notification.notificationId || notification.id || nextId('not', []),
    recipientUserId: notification.recipientUserId || notification.recipient_user_id || null,
    orgId: notification.orgId || notification.org_id || null,
    channel: notification.channel || 'in-app',
    channels: Array.isArray(notification.channels)
      ? notification.channels.map((item) => String(item || '').trim()).filter(Boolean)
      : [notification.channel || 'in-app'],
    category: notification.category || 'info',
    title: notification.title || '',
    body: notification.body || '',
    relatedType: notification.relatedType || notification.related_type || '',
    relatedId: notification.relatedId || notification.related_id || '',
    readAt: notification.readAt || notification.read_at || null,
    deliveryStatus: notification.deliveryStatus && typeof notification.deliveryStatus === 'object' ? structuredClone(notification.deliveryStatus) : {},
    metadata: notification.metadata && typeof notification.metadata === 'object' ? structuredClone(notification.metadata) : {},
    createdAt: notification.createdAt || nowIso()
  };
}

function normalizeObservabilityEvent(event) {
  if (!event || typeof event !== 'object') {
    return event;
  }

  return {
    observabilityEventId: event.observabilityEventId || event.id || nextId('obs', []),
    kind: event.kind || 'trace',
    source: event.source || 'server',
    level: event.level || 'info',
    route: event.route || '',
    requestId: event.requestId || null,
    durationMs: Number(event.durationMs || 0),
    statusCode: Number(event.statusCode || 0),
    message: event.message || '',
    metadata: event.metadata && typeof event.metadata === 'object' ? structuredClone(event.metadata) : {},
    createdAt: event.createdAt || nowIso()
  };
}

function normalizeEvidenceList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/[,\n]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeEvidenceMetadata(value) {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) {
      return {};
    }
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { note: text };
    } catch {
      return { note: text };
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return structuredClone(value);
  }
  return {};
}

function extractEvidenceProfile(submission) {
  const content = String(submission.content || '');
  let sourceHost = '';
  let sourcePath = '';
  try {
    const parsed = new URL(submission.url);
    sourceHost = parsed.host;
    sourcePath = parsed.pathname;
  } catch {}

  const metadata = submission.evidenceMetadata && typeof submission.evidenceMetadata === 'object' ? submission.evidenceMetadata : {};
  const pageSnapshots = Array.isArray(submission.pageSnapshots) ? submission.pageSnapshots : [];
  const screenshotUrls = Array.isArray(submission.screenshotUrls) ? submission.screenshotUrls : [];
  const contentWords = content.trim() ? content.trim().split(/\s+/).length : 0;
  return {
    sourceHost,
    sourcePath,
    screenshotCount: screenshotUrls.length,
    pageSnapshotCount: pageSnapshots.length,
    metadataKeys: Object.keys(metadata),
    contentLength: content.length,
    contentWords,
    contentHash: createHash('sha256').update(content).digest('hex').slice(0, 16)
  };
}

function buildEvidenceSnapshot(submission) {
  const screenshots = normalizeEvidenceList(submission.screenshotUrls || submission.screenshot_urls);
  const pageSnapshots = normalizeEvidenceList(submission.pageSnapshots || submission.page_snapshots);
  const metadata = normalizeEvidenceMetadata(submission.evidenceMetadata || submission.evidence_metadata);
  const timestamp = submission.submittedAt || submission.createdAt || nowIso();
  return {
    submissionUrl: String(submission.url || '').trim(),
    submittedAt: timestamp,
    screenshots: screenshots.slice(0, 5),
    pageSnapshots: pageSnapshots.slice(0, 5),
    metadata,
    metadataKeys: Object.keys(metadata),
    sourceHost: extractSubmissionHost(submission.url),
    sourcePath: extractSubmissionPath(submission.url)
  };
}

function extractSubmissionHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

function extractSubmissionPath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function buildStructuredVerdict({ bounty, submission, evidenceProfile, verdict }) {
  const evidenceSnapshot = buildEvidenceSnapshot(submission);
  const requirementFindings = (verdict.results || []).map((result, index) => {
    const requirement = bounty.requirements?.find((item) => item.id === result.req_id) || bounty.requirements?.[index] || null;
    return {
      requirementId: result.req_id,
      type: requirement?.type || 'unknown',
      label: requirement?.description || result.req_id,
      pass: Boolean(result.pass),
      reason: result.reason || '',
      evidence: buildRequirementEvidence(requirement, submission, evidenceProfile, result),
      confidence: result.pass ? 0.9 : 0.78
    };
  });

  const supportScore = [
    evidenceProfile.screenshotCount > 0 ? 1 : 0,
    evidenceProfile.pageSnapshotCount > 0 ? 1 : 0,
    evidenceProfile.metadataKeys.length > 0 ? 1 : 0,
    evidenceProfile.contentWords > 0 ? 1 : 0
  ].reduce((sum, value) => sum + value, 0);
  const passScore = requirementFindings.filter((item) => item.pass).length / Math.max(1, requirementFindings.length);
  const confidence = Math.max(0.3, Math.min(0.98, 0.25 + (supportScore * 0.12) + (passScore * 0.55)));

  return {
    model: 'bounded-verifier-v1',
    mode: 'hybrid',
    confidence: Number(confidence.toFixed(2)),
    conclusion: verdict.overall_pass ? 'pass' : 'fail',
    explanation: verdict.overall_pass
      ? 'Deterministic requirements passed and the evidence package is sufficient for release.'
      : 'One or more deterministic requirements failed, so release is blocked.',
    evidenceSnapshot,
    requirementFindings,
    summary: {
      totalRequirements: requirementFindings.length,
      passedRequirements: requirementFindings.filter((item) => item.pass).length,
      failedRequirements: requirementFindings.filter((item) => !item.pass).length,
      evidenceCompleteness: evidenceProfile.screenshotCount + evidenceProfile.pageSnapshotCount + evidenceProfile.metadataKeys.length
    }
  };
}

function buildRequirementEvidence(requirement, submission, evidenceProfile, result) {
  if (!requirement) {
    return {
      source: 'deterministic',
      notes: ['No requirement metadata was available.']
    };
  }

  if (requirement.type === 'url_exists') {
    return {
      source: 'submission.url',
      notes: [
        `URL host: ${evidenceProfile.sourceHost || 'unknown'}`,
        `Path: ${evidenceProfile.sourcePath || 'unknown'}`
      ],
      url: submission.url || ''
    };
  }

  if (requirement.type === 'text_contains') {
    const mustInclude = requirement.params?.must_include || [];
    const content = String(submission.content || '');
    const matched = mustInclude.filter((token) => content.toLowerCase().includes(String(token).toLowerCase()));
    return {
      source: 'submission.content',
      notes: [
        `Matched tokens: ${matched.length ? matched.join(', ') : 'none'}`,
        `Required tokens: ${mustInclude.join(', ')}`
      ],
      excerpt: content.slice(0, 280)
    };
  }

  if (requirement.type === 'before_deadline') {
    return {
      source: 'submission.submittedAt',
      notes: [
        `Submitted at ${submission.submittedAt || 'unknown'}`,
        `Deadline ${requirement.params?.deadline || 'unknown'}`
      ]
    };
  }

  if (requirement.type === 'min_length') {
    return {
      source: 'submission.content',
      notes: [
        `Measured ${measureSubmission(submission, requirement.params?.unit || 'characters')} ${requirement.params?.unit || 'characters'}`,
        `Minimum ${Number(requirement.params?.min || 0)}`
      ]
    };
  }

  if (requirement.type === 'account_match') {
    return {
      source: 'submission.authorHandle',
      notes: [
        `Actual handle ${submission.authorHandle || submission.contributorHandle || 'unknown'}`,
        `Expected handle ${requirement.params?.verified_account_handle || 'unknown'}`
      ]
    };
  }

  return {
    source: 'structured-rule-engine',
    notes: [result.reason || 'Requirement evaluated without extra evidence.']
  };
}

function recordNotification(state, event) {
  if (!state.notifications) {
    state.notifications = [];
  }
  const notification = {
    notificationId: nextId('not', state.notifications),
    recipientUserId: event.recipientUserId || null,
    orgId: event.orgId || null,
    channel: event.channel || 'in-app',
    channels: Array.isArray(event.channels) ? event.channels.map((item) => String(item || '').trim()).filter(Boolean) : [event.channel || 'in-app'],
    category: event.category || 'info',
    title: String(event.title || ''),
    body: String(event.body || ''),
    relatedType: event.relatedType || '',
    relatedId: event.relatedId || '',
    readAt: event.readAt || null,
    deliveryStatus: event.deliveryStatus && typeof event.deliveryStatus === 'object' ? structuredClone(event.deliveryStatus) : {
      email: event.channels?.includes('email') ? 'queued' : 'not-configured',
      'in-app': event.channels?.includes('in-app') ? 'delivered' : 'not-configured',
      webhook: event.channels?.includes('webhook') ? 'queued' : 'not-configured'
    },
    metadata: event.metadata && typeof event.metadata === 'object' ? structuredClone(event.metadata) : {},
    createdAt: event.createdAt || nowIso()
  };
  state.notifications.unshift(notification);
  state.notifications = state.notifications.slice(0, 2000);
  return notification;
}

function dispatchNotifications(state, recipients, event) {
  const sent = [];
  const channels = Array.isArray(event.channels) && event.channels.length ? event.channels : ['email', 'in-app', 'webhook'];
  Array.from(new Set(recipients.filter(Boolean))).forEach((recipientUserId) => {
    sent.push(recordNotification(state, {
      recipientUserId,
      orgId: event.orgId || null,
      channels,
      channel: channels[0] || 'in-app',
      category: event.category || 'info',
      title: event.title || '',
      body: event.body || '',
      relatedType: event.relatedType || '',
      relatedId: event.relatedId || '',
      metadata: event.metadata || {}
    }));
  });
  return sent;
}

function recordChainEvent(state, event) {
  if (!state.chainEvents) {
    state.chainEvents = [];
  }
  const entry = {
    chainEventId: nextId('che', state.chainEvents),
    bountyId: event.bountyId || '',
    type: event.type || 'sync',
    txHash: String(event.txHash || '').trim(),
    status: event.status || 'pending',
    details: event.details && typeof event.details === 'object' ? structuredClone(event.details) : {},
    createdAt: event.createdAt || nowIso()
  };
  state.chainEvents.unshift(entry);
  state.chainEvents = state.chainEvents.slice(0, 1000);
  return entry;
}

function summarizeNotification(state, notification) {
  if (!notification) {
    return null;
  }
  const recipient = state.users.find((item) => item.userId === notification.recipientUserId) || null;
  const org = notification.orgId ? state.orgs.find((item) => item.orgId === notification.orgId) || null : null;
  return {
    ...notification,
    recipientHandle: recipient?.handle || null,
    recipientDisplayName: recipient?.displayName || null,
    orgName: org?.name || null
  };
}

function deriveNotificationInbox(state, auth) {
  const userId = auth?.user?.userId || null;
  const orgId = auth?.activeOrg?.orgId || null;
  return state.notifications
    .filter((notification) => {
      if (notification.recipientUserId && userId && notification.recipientUserId === userId) {
        return true;
      }
      return Boolean(orgId && notification.orgId === orgId && !notification.recipientUserId);
    })
    .map((notification) => summarizeNotification(state, notification))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

function recordObservabilityEvent(state, event) {
  if (!state.observabilityEvents) {
    state.observabilityEvents = [];
  }
  const entry = {
    observabilityEventId: nextId('obs', state.observabilityEvents),
    kind: event.kind || 'trace',
    source: event.source || 'server',
    level: event.level || 'info',
    route: event.route || '',
    requestId: event.requestId || null,
    durationMs: Number(event.durationMs || 0),
    statusCode: Number(event.statusCode || 0),
    message: String(event.message || ''),
    metadata: event.metadata && typeof event.metadata === 'object' ? structuredClone(event.metadata) : {},
    createdAt: event.createdAt || nowIso()
  };
  state.observabilityEvents.unshift(entry);
  state.observabilityEvents = state.observabilityEvents.slice(0, 1000);
  return entry;
}

function summarizeObservabilityEvent(state, event) {
  if (!event) {
    return null;
  }
  return {
    ...event,
    routeLabel: event.route || event.metadata?.routeLabel || event.kind,
    isError: event.level === 'error' || event.statusCode >= 500
  };
}

function deriveObservabilityOverview(state) {
  const events = state.observabilityEvents || [];
  const traceCount = events.filter((event) => event.kind === 'trace').length;
  const errorCount = events.filter((event) => event.level === 'error' || event.statusCode >= 500).length;
  const avgLatency = events.length
    ? Math.round(events.filter((event) => Number.isFinite(event.durationMs)).reduce((sum, event) => sum + Number(event.durationMs || 0), 0) / Math.max(1, events.length))
    : 0;
  return {
    traceCount,
    errorCount,
    avgLatency,
    recent: events.slice(0, 20).map((event) => summarizeObservabilityEvent(state, event))
  };
}

function normalizeAuditLog(log) {
  if (!log || typeof log !== 'object') {
    return log;
  }

  return {
    auditLogId: log.auditLogId || log.id || nextId('aud', []),
    action: log.action || 'unknown',
    entityType: log.entityType || 'system',
    entityId: log.entityId || '',
    orgId: log.orgId || null,
    bountyId: log.bountyId || null,
    actorUserId: log.actorUserId || null,
    actorHandle: log.actorHandle || '',
    severity: log.severity || 'info',
    summary: log.summary || '',
    metadata: log.metadata && typeof log.metadata === 'object' ? structuredClone(log.metadata) : {},
    createdAt: log.createdAt || nowIso()
  };
}

function normalizeBountyVersion(version) {
  if (!version || typeof version !== 'object') {
    return version;
  }

  return {
    bountyVersionId: version.bountyVersionId || version.id || nextId('bver', []),
    bountyId: version.bountyId || version.bounty_id || '',
    orgId: version.orgId || null,
    versionNumber: Number(version.versionNumber || version.version_number || 1),
    action: version.action || 'updated',
    actorUserId: version.actorUserId || version.actor_user_id || null,
    actorHandle: version.actorHandle || version.actor_handle || '',
    snapshot: version.snapshot && typeof version.snapshot === 'object' ? structuredClone(version.snapshot) : {},
    changes: version.changes && typeof version.changes === 'object' ? structuredClone(version.changes) : {},
    createdAt: version.createdAt || nowIso()
  };
}

function normalizeChainEvent(event) {
  if (!event || typeof event !== 'object') {
    return event;
  }

  return {
    chainEventId: event.chainEventId || event.id || nextId('che', []),
    bountyId: event.bountyId || event.bounty_id || '',
    type: event.type || 'sync',
    txHash: event.txHash || '',
    status: event.status || 'pending',
    details: event.details && typeof event.details === 'object' ? structuredClone(event.details) : {},
    createdAt: event.createdAt || nowIso()
  };
}

function normalizeBounty(bounty, state = null) {
  if (!bounty || typeof bounty !== 'object') {
    return bounty;
  }

  const ownerHandle = bounty.ownerHandle || bounty.owner || '@okx';
  const ownerUser = state?.users?.find((user) => user.handle === ownerHandle) || null;
  const ownerOrg = state?.orgs?.find((org) => org.ownerUserId === ownerUser?.userId) || null;
  return {
    bountyId: bounty.bountyId || bounty.bounty_id || nextId('bnty', []),
    orgId: bounty.orgId || bounty.org_id || ownerOrg?.orgId || state?.currentOrgId || null,
    createdByUserId: bounty.createdByUserId || bounty.created_by_user_id || ownerUser?.userId || null,
    title: bounty.title || 'Untitled bounty',
    rewardAmount: Number(String(bounty.rewardAmount || bounty.reward_amount || 0).replace(/[^\d.]/g, '')) || 0,
    rewardToken: bounty.rewardToken || bounty.reward_token || 'USDC',
    deadline: bounty.deadline || bounty.endsAt || nowIso(),
    status: bounty.status || 'Open',
    ownerHandle,
    requirementSummary: bounty.requirementSummary || bounty.requirement_summary || '',
    escrowTxHash: bounty.escrowTxHash || bounty.escrow_tx_hash || createTxHash(),
    chainId: Number(bounty.chainId || bounty.chain_id || 80001),
    contractAddress: bounty.contractAddress || bounty.contract_address || '',
    contractVersion: bounty.contractVersion || bounty.contract_version || 'v1.0.0',
    abiVersion: bounty.abiVersion || bounty.abi_version || 'abi-v1',
    contractVerified: Boolean(bounty.contractVerified ?? bounty.contract_verified ?? true),
    explorerBaseUrl: bounty.explorerBaseUrl || bounty.explorer_base_url || 'https://explorer.xlayer.tech',
    treasuryType: bounty.treasuryType || bounty.treasury_type || 'multisig',
    treasuryAddress: bounty.treasuryAddress || bounty.treasury_address || '',
    treasuryThreshold: Number(bounty.treasuryThreshold || bounty.treasury_threshold || 2),
    treasurySigners: Array.isArray(bounty.treasurySigners)
      ? bounty.treasurySigners.map((signer) => String(signer || '').trim()).filter(Boolean)
      : Array.isArray(bounty.treasury_signers)
        ? bounty.treasury_signers.map((signer) => String(signer || '').trim()).filter(Boolean)
        : [],
    fundingTxHash: bounty.fundingTxHash || bounty.funding_tx_hash || '',
    payoutTxHash: bounty.payoutTxHash || bounty.payout_tx_hash || '',
    refundTxHash: bounty.refundTxHash || bounty.refund_tx_hash || '',
    paidAt: bounty.paidAt || bounty.paid_at || null,
    onChainStatus: bounty.onChainStatus || bounty.on_chain_status || 'draft',
    chainSyncStatus: bounty.chainSyncStatus || bounty.chain_sync_status || 'pending',
    lastChainSyncedAt: bounty.lastChainSyncedAt || bounty.last_chain_synced_at || null,
    releasedAt: bounty.releasedAt || bounty.released_at || null,
    refundedAt: bounty.refundedAt || bounty.refunded_at || null,
    releaseReason: bounty.releaseReason || bounty.release_reason || '',
    refundReason: bounty.refundReason || bounty.refund_reason || '',
    lastProofHash: bounty.lastProofHash || bounty.last_proof_hash || '',
    lastProofTxHash: bounty.lastProofTxHash || bounty.last_proof_tx_hash || '',
    lastProofRecordedAt: bounty.lastProofRecordedAt || bounty.last_proof_recorded_at || null,
    createdAt: bounty.createdAt || nowIso(),
    updatedAt: bounty.updatedAt || nowIso(),
    requirements: Array.isArray(bounty.requirements) ? bounty.requirements.map(normalizeRequirement) : []
  };
}

function normalizeSubmission(submission) {
  if (!submission || typeof submission !== 'object') {
    return submission;
  }

  return {
    submissionId: submission.submissionId || submission.id || nextId('sub', []),
    bountyId: submission.bountyId || submission.bounty_id || '',
    contributorHandle: submission.contributorHandle || submission.contributor || '@unknown',
    contributorUserId: submission.contributorUserId || submission.contributor_user_id || null,
    url: submission.url || '',
    submittedAt: submission.submittedAt || submission.createdAt || nowIso(),
    tweetCount: Number(submission.tweetCount || 0),
    content: submission.content || '',
    screenshotUrls: normalizeEvidenceList(submission.screenshotUrls || submission.screenshot_urls),
    pageSnapshots: normalizeEvidenceList(submission.pageSnapshots || submission.page_snapshots),
    evidenceMetadata: normalizeEvidenceMetadata(submission.evidenceMetadata || submission.evidence_metadata),
    evidenceProfile: submission.evidenceProfile && typeof submission.evidenceProfile === 'object' ? structuredClone(submission.evidenceProfile) : extractEvidenceProfile(submission),
    createdAt: submission.createdAt || nowIso(),
    status: submission.status
  };
}

function normalizeVerification(verification) {
  if (!verification || typeof verification !== 'object') {
    return verification;
  }

  return {
    verificationId: verification.verificationId || verification.id || nextId('ver', []),
    bountyId: verification.bountyId || verification.bounty_id || '',
    submissionId: verification.submissionId || verification.submission_id || '',
    overallPass: Boolean(verification.overallPass ?? verification.overall_pass),
    verdictHash: verification.verdictHash || verification.verdict_hash || createTxHash(),
    createdAt: verification.createdAt || nowIso(),
    verifiedByUserId: verification.verifiedByUserId || verification.verified_by_user_id || null,
    results: Array.isArray(verification.results)
      ? verification.results.map((result) => ({
          req_id: result.req_id || result.reqId || result.id || '',
          pass: Boolean(result.pass),
          reason: result.reason || ''
        }))
      : [],
    evidenceProfile: verification.evidenceProfile && typeof verification.evidenceProfile === 'object' ? structuredClone(verification.evidenceProfile) : null,
    evidenceQualityScore: Number(verification.evidenceQualityScore || verification.evidence_quality_score || 0),
    evidenceSummary: verification.evidenceSummary && typeof verification.evidenceSummary === 'object' ? structuredClone(verification.evidenceSummary) : null,
    chainProofHash: verification.chainProofHash || verification.chain_proof_hash || '',
    chainProofTxHash: verification.chainProofTxHash || verification.chain_proof_tx_hash || '',
    chainProofStatus: verification.chainProofStatus || verification.chain_proof_status || 'pending',
    chainProofRecordedAt: verification.chainProofRecordedAt || verification.chain_proof_recorded_at || null,
    aiVerdict: verification.aiVerdict && typeof verification.aiVerdict === 'object' ? structuredClone(verification.aiVerdict) : null,
    reasoningSummary: verification.reasoningSummary || verification.reasoning_summary || '',
    confidenceScore: Number(verification.confidenceScore || verification.confidence_score || 0),
    evidenceBundle: verification.evidenceBundle && typeof verification.evidenceBundle === 'object' ? structuredClone(verification.evidenceBundle) : null,
    reasoningTrail: Array.isArray(verification.reasoningTrail) ? verification.reasoningTrail.map((item) => (item && typeof item === 'object' ? structuredClone(item) : item)) : []
  };
}

function normalizeRequirement(requirement) {
  if (!requirement || typeof requirement !== 'object') {
    return requirement;
  }

  return {
    ...requirement,
    params: normalizeRequirementParams(requirement.type, requirement.params)
  };
}

function normalizeRequirementParams(type, params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return params;
  }

  const cloned = { ...params };
  if (type === 'url_exists' && typeof cloned.domain_allowlist === 'string') {
    cloned.domain_allowlist = cloned.domain_allowlist.split(/[,\s]+/).filter(Boolean);
  }
  if (type === 'text_contains' && typeof cloned.must_include === 'string') {
    cloned.must_include = cloned.must_include.split(/[,\n]+/).map((item) => item.trim()).filter(Boolean);
  }
  return cloned;
}

function derivePayoutStatus(bounty, latestVerification) {
  if (bounty.status === 'Paid') {
    return 'Released';
  }
  if (bounty.status === 'Refunded') {
    return 'Refunded';
  }
  if (bounty.status === 'Disputed') {
    return 'Disputed';
  }
  if (latestVerification) {
    return latestVerification.overallPass ? 'Ready to release' : 'Locked';
  }
  return bounty.status === 'Open' ? 'In escrow' : 'Awaiting verification';
}

function createSeedUsersFromState(state) {
  const handles = new Set([
    state.currentPosterHandle,
    state.currentContributorHandle,
    ...state.bounties.map((bounty) => bounty.ownerHandle).filter(Boolean)
  ]);
  return Array.from(handles).filter(Boolean).map((handle, index) => ({
    userId: `usr_${String(index + 1).padStart(4, '0')}`,
    handle,
    displayName: handle.replace(/^@/, '').replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
    email: '',
    walletAddress: '',
    authMethod: 'email',
    createdAt: nowIso()
  }));
}

function createSeedOrgsFromState(state) {
  const owners = new Map();
  state.bounties.forEach((bounty, index) => {
    const handle = bounty.ownerHandle || `@owner_${index + 1}`;
    if (!owners.has(handle)) {
      owners.set(handle, index + 1);
    }
  });

  return Array.from(owners.entries()).map(([handle, index]) => {
    const owner = state.users.find((user) => user.handle === handle) || null;
    return {
      orgId: `org_${String(index).padStart(4, '0')}`,
      name: `${handle.replace(/^@/, '').replaceAll('_', ' ')} Workspace`,
      slug: slugify(`${handle.replace(/^@/, '').replaceAll('_', ' ')} Workspace`),
      ownerUserId: owner?.userId || null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  });
}

function createSeedMembershipsFromState(state) {
  const memberships = [];
  state.orgs.forEach((org, index) => {
    if (org.ownerUserId) {
      memberships.push({
        membershipId: `mbr_${String(index + 1).padStart(4, '0')}`,
        orgId: org.orgId,
        userId: org.ownerUserId,
        role: 'owner',
        createdAt: nowIso()
      });
    }
  });
  return memberships;
}

function summarizeDispute(state, dispute) {
  if (!dispute) {
    return null;
  }

  const bounty = state.bounties.find((item) => item.bountyId === dispute.bountyId) || null;
  const submission = state.submissions.find((item) => item.submissionId === dispute.submissionId) || null;
  const reviewer = state.users.find((item) => item.userId === dispute.assignedReviewerUserId) || null;
  const opener = state.users.find((item) => item.userId === dispute.openedByUserId) || null;

  return {
    ...dispute,
    bountyTitle: bounty?.title || null,
    bountyStatus: bounty?.status || null,
    submissionHandle: submission?.contributorHandle || null,
    reviewerHandle: reviewer?.handle || null,
    openedByHandle: opener?.handle || dispute.openedByHandle || null,
    isOverdue: Boolean(dispute.deadlineAt && Date.parse(dispute.deadlineAt) < Date.now() && ['open', 'in_review'].includes(dispute.status))
  };
}

function deriveReviewQueue(state, auth) {
  const userId = auth?.user?.userId || null;
  const orgId = auth?.activeOrg?.orgId || null;
  return state.disputes
    .filter((dispute) => ['open', 'in_review', 'escalated'].includes(dispute.status))
    .map((dispute) => summarizeDispute(state, dispute))
    .filter((dispute) => {
      if (!dispute) {
        return false;
      }
      if (orgId) {
        const bounty = state.bounties.find((item) => item.bountyId === dispute.bountyId);
        if (bounty && bounty.orgId !== orgId) {
          return false;
        }
      }
      return !userId || dispute.assignedReviewerUserId === userId || dispute.resolvedByUserId === userId || dispute.openedByUserId === userId || dispute.status === 'open';
    })
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt));
}

function linkBountiesToOrgs(state) {
  const orgByHandle = new Map(
    state.orgs
      .map((org) => {
        const owner = state.users.find((user) => user.userId === org.ownerUserId) || null;
        return [owner?.handle || null, org];
      })
      .filter(([handle]) => Boolean(handle))
  );

  state.bounties.forEach((bounty) => {
    if (!bounty.orgId) {
      const org = orgByHandle.get(bounty.ownerHandle) || state.orgs[0] || null;
      bounty.orgId = org?.orgId || null;
    }
    if (!bounty.createdByUserId) {
      const creator = state.users.find((user) => user.handle === bounty.ownerHandle) || null;
      bounty.createdByUserId = creator?.userId || null;
    }
  });
}

function uniqueSlug(items, text) {
  const base = slugify(text);
  let slug = base;
  let index = 2;
  while (items.some((item) => item.slug === slug)) {
    slug = `${base}-${index}`;
    index += 1;
  }
  return slug;
}

function slugify(text) {
  return String(text || 'workspace')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';
}

function nextId(prefix, items) {
  const max = items.reduce((acc, item) => {
    const candidate = Object.values(item)
      .map((value) => String(value))
      .find((value) => value.startsWith(`${prefix}_`));
    if (!candidate) {
      return acc;
    }
    const numeric = Number(candidate.split('_')[1]);
    return Number.isFinite(numeric) ? Math.max(acc, numeric) : acc;
  }, 0);
  return `${prefix}_${String(max + 1).padStart(4, '0')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeHandle(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '@user';
  }
  return text.startsWith('@') ? text : `@${text.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '').toLowerCase()}`;
}

function createTxHash() {
  return `0x${Math.random().toString(16).slice(2, 18).padEnd(16, '0')}`;
}

function createVerdictHash(verdict) {
  return `0x${Buffer.from(JSON.stringify(verdict)).toString('hex').slice(0, 12)}`;
}

function createProofHash(payload) {
  return `0x${createHash('sha256').update(JSON.stringify(payload || {})).digest('hex').slice(0, 32)}`;
}

function createToken(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
}

function normalizeWalletAddress(value) {
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

function buildSiweMessage(challenge) {
  return [
    `${challenge.domain} wants you to sign in with your Ethereum account:`,
    challenge.address,
    '',
    'Sign in to BountyProof.',
    '',
    `URI: ${challenge.uri}`,
    `Version: 1`,
    `Chain ID: ${challenge.chainId}`,
    `Nonce: ${challenge.nonce}`,
    `Issued At: ${challenge.issuedAt}`
  ].join('\n');
}

function consumeWalletChallenge(state, input) {
  const address = normalizeWalletAddress(input.walletAddress);
  if (!address) {
    throw createError(400, 'Wallet address is required');
  }

  const challenge = state.walletChallenges.find((item) => {
    if (!item || item.status !== 'pending') {
      return false;
    }
    const addressMatch = normalizeWalletAddress(item.address) === address;
    const nonceMatch = input.challengeId ? item.challengeId === input.challengeId : true;
    const signatureMatch = input.nonce ? item.nonce === input.nonce : true;
    return addressMatch && nonceMatch && signatureMatch;
  });

  if (!challenge) {
    throw createError(404, 'Wallet challenge not found');
  }
  if (challenge.expiresAt && Date.parse(challenge.expiresAt) < Date.now()) {
    throw createError(410, 'Wallet challenge expired');
  }

  const message = challenge.message || buildSiweMessage(challenge);
  const recovered = normalizeWalletAddress(verifyMessage(message, input.signature || ''));
  if (!recovered || recovered !== address) {
    throw createError(401, 'Invalid wallet signature');
  }

  challenge.status = 'consumed';
  challenge.usedAt = nowIso();
  return challenge;
}

function selectReviewer(state, orgId, excludeUserIds = []) {
  const excluded = new Set(excludeUserIds.filter(Boolean));
  const priorities = ['reviewer', 'admin', 'owner'];
  for (const role of priorities) {
    const membership = state.memberships.find((item) => item.orgId === orgId && normalizeRole(item.role) === role && !excluded.has(item.userId));
    if (membership) {
      return state.users.find((user) => user.userId === membership.userId) || null;
    }
  }
  return state.users.find((user) => !excluded.has(user.userId)) || null;
}

function normalizeDisputeOutcome(value) {
  const outcome = String(value || '').trim().toLowerCase();
  if (['release', 'refund', 'reverify', 'deny'].includes(outcome)) {
    return outcome;
  }
  return 'deny';
}

function normalizeAdminBountyStatus(value) {
  const status = String(value || '').trim();
  if (['Open', 'Funded', 'Verified', 'Paid', 'Refunded', 'Disputed'].includes(status)) {
    return status;
  }
  return 'Open';
}

function isSameDay(a, b) {
  const left = new Date(a);
  const right = new Date(b);
  return left.toDateString() === right.toDateString();
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}

function summarizeUser(user) {
  if (!user) {
    return null;
  }
  return {
    userId: user.userId,
    handle: user.handle,
    displayName: user.displayName,
    email: user.email || '',
    walletAddress: user.walletAddress || '',
    authMethod: user.authMethod || 'email',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt || null
  };
}

function summarizeInvite(invite) {
  if (!invite) {
    return null;
  }
  return {
    inviteId: invite.inviteId,
    code: invite.code,
    orgId: invite.orgId,
    email: invite.email || '',
    walletAddress: invite.walletAddress || '',
    handle: invite.handle || '',
    role: invite.role,
    status: invite.status,
    expiresAt: invite.expiresAt || null,
    createdAt: invite.createdAt,
    acceptedAt: invite.acceptedAt || null
  };
}

function buildPermissionMap(permissions) {
  const set = new Set(permissions || []);
  return {
    canCreateBounty: set.has('bounty:create'),
    canEditBounty: set.has('bounty:update'),
    canDeleteBounty: set.has('bounty:delete'),
    canVerify: set.has('bounty:verify'),
    canCreateDispute: set.has('dispute:create'),
    canResolveDispute: set.has('dispute:resolve'),
    canInvite: set.has('org:invite'),
    canChangeRoles: set.has('org:member-role'),
    canCreateOrg: set.has('org:create'),
    canSubmit: set.has('submission:create'),
    canSwitchOrg: set.has('session:switch-org')
  };
}

function createError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
