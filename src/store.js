import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFreshState } from './data.js';
import { evaluateBounty } from './requirements.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '..', 'data');
const stateFile = path.join(dataDir, 'state.json');

export async function loadState() {
  await ensureStateFile();
  const raw = await readFile(stateFile, 'utf8');
  return normalizeState(JSON.parse(raw));
}

export async function saveState(state) {
  await mkdir(dataDir, { recursive: true });
  const normalized = normalizeState(state);
  const tmpFile = `${stateFile}.tmp`;
  await writeFile(tmpFile, JSON.stringify(normalized, null, 2), 'utf8');
  await unlink(stateFile).catch(() => {});
  await rename(tmpFile, stateFile);
  return normalized;
}

export async function createBounty(input) {
  const state = await loadState();
  const bounty = {
    bountyId: nextId('bnty', state.bounties),
    title: input.title.trim(),
    rewardAmount: Number(input.rewardAmount),
    rewardToken: input.rewardToken.trim().toUpperCase() || 'USDC',
    deadline: input.deadline,
    status: 'Open',
    ownerHandle: input.ownerHandle.trim(),
    requirementSummary: input.requirementSummary.trim(),
    escrowTxHash: input.escrowTxHash || createTxHash(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    requirements: input.requirements
  };

  state.bounties.unshift(bounty);
  await saveState(state);
  return bounty;
}

export async function updateBounty(bountyId, input) {
  const state = await loadState();
  const bounty = state.bounties.find((item) => item.bountyId === bountyId);
  if (!bounty) {
    throw new Error('Bounty not found');
  }

  if (typeof input.title === 'string') {
    bounty.title = input.title.trim();
  }
  if (input.rewardAmount !== undefined) {
    bounty.rewardAmount = Number(input.rewardAmount);
  }
  if (typeof input.rewardToken === 'string') {
    bounty.rewardToken = input.rewardToken.trim().toUpperCase() || bounty.rewardToken;
  }
  if (typeof input.deadline === 'string' && input.deadline.trim()) {
    bounty.deadline = input.deadline.trim();
  }
  if (typeof input.ownerHandle === 'string') {
    bounty.ownerHandle = input.ownerHandle.trim();
  }
  if (typeof input.requirementSummary === 'string') {
    bounty.requirementSummary = input.requirementSummary.trim();
  }
  if (typeof input.status === 'string') {
    bounty.status = input.status.trim();
  }
  if (typeof input.escrowTxHash === 'string' && input.escrowTxHash.trim()) {
    bounty.escrowTxHash = input.escrowTxHash.trim();
  }
  if (Array.isArray(input.requirements)) {
    bounty.requirements = input.requirements.map(normalizeRequirement);
  }

  bounty.updatedAt = nowIso();
  const latestVerification = state.verifications
    .filter((verification) => verification.bountyId === bountyId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] || null;
  if (bounty.status !== 'Paid') {
    bounty.payoutStatus = latestVerification ? (latestVerification.overallPass ? 'Ready to release' : 'Locked') : 'In escrow';
  }

  await saveState(state);
  return bounty;
}

export async function deleteBounty(bountyId) {
  const state = await loadState();
  const bountyIndex = state.bounties.findIndex((item) => item.bountyId === bountyId);
  if (bountyIndex < 0) {
    throw new Error('Bounty not found');
  }

  const [removed] = state.bounties.splice(bountyIndex, 1);
  state.submissions = state.submissions.filter((submission) => submission.bountyId !== bountyId);
  state.verifications = state.verifications.filter((verification) => verification.bountyId !== bountyId);
  await saveState(state);
  return removed;
}

export async function createSubmission(input) {
  const state = await loadState();
  const bounty = state.bounties.find((item) => item.bountyId === input.bountyId);
  if (!bounty) {
    throw new Error('Bounty not found');
  }

  const submission = {
    submissionId: nextId('sub', state.submissions),
    bountyId: bounty.bountyId,
    contributorHandle: input.contributorHandle.trim(),
    url: input.url.trim(),
    submittedAt: input.submittedAt,
    tweetCount: Number(input.tweetCount || 0),
    content: input.content,
    createdAt: nowIso()
  };

  state.submissions.unshift(submission);
  bounty.updatedAt = nowIso();
  await saveState(state);
  return submission;
}

export async function verifySubmission(input) {
  const state = await loadState();
  const bounty = state.bounties.find((item) => item.bountyId === input.bountyId);
  if (!bounty) {
    throw new Error('Bounty not found');
  }

  const submission = state.submissions.find((item) => item.submissionId === input.submissionId);
  if (!submission) {
    throw new Error('Submission not found');
  }

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
    results: verdict.results
  };

  state.verifications.unshift(verification);
  submission.status = verdict.overall_pass ? 'Passed' : 'Failed';
  submission.verificationId = verification.verificationId;
  bounty.updatedAt = nowIso();
  bounty.latestVerificationId = verification.verificationId;
  bounty.latestSubmissionId = submission.submissionId;
  if (verdict.overall_pass) {
    bounty.status = 'Paid';
    bounty.payoutStatus = 'Released';
    bounty.paidAt = nowIso();
  } else if (bounty.status === 'Open') {
    bounty.payoutStatus = 'Awaiting pass';
  }

  await saveState(state);
  return verification;
}

export function getPublicState(state) {
  const normalized = normalizeState(state);
  return {
    ...normalized,
    stats: deriveStats(normalized),
    bountySummaries: normalized.bounties.map((bounty) => summarizeBounty(normalized, bounty)),
    recentActivity: deriveRecentActivity(normalized),
    transactionHistory: deriveTransactionHistory(normalized)
  };
}

export function normalizeState(input) {
  const state = input && typeof input === 'object' ? input : createFreshState();
  state.currentPosterHandle ||= '@okx';
  state.currentContributorHandle ||= '@submitter_handle';
  state.bounties = Array.isArray(state.bounties) ? state.bounties.map(normalizeBounty) : [];
  state.submissions = Array.isArray(state.submissions) ? state.submissions.map(normalizeSubmission) : [];
  state.verifications = Array.isArray(state.verifications) ? state.verifications.map(normalizeVerification) : [];
  return state;
}

export function deriveStats(state) {
  const openBounties = state.bounties.filter((bounty) => bounty.status !== 'Paid').length;
  const escrowedReward = state.bounties
    .filter((bounty) => bounty.status !== 'Paid')
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

export function summarizeBounty(state, bounty) {
  const submissions = state.submissions.filter((submission) => submission.bountyId === bounty.bountyId);
  const verifications = state.verifications.filter((verification) => verification.bountyId === bounty.bountyId);
  const latestVerification = verifications[0] || null;
  return {
    ...bounty,
    submissionCount: submissions.length,
    verificationCount: verifications.length,
    latestSubmission: submissions[0] || null,
    latestVerification,
    payoutStatus: derivePayoutStatus(bounty, latestVerification)
  };
}

export function deriveRecentActivity(state) {
  return [
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
    ...state.bounties.map((bounty) => ({
      kind: 'bounty',
      label: bounty.status === 'Paid' ? 'Payout completed' : bounty.status === 'Open' ? 'Bounty listed' : 'Bounty funded',
      detail: `${bounty.bountyId} - ${bounty.title}`,
      tone: bounty.status === 'Paid' ? 'good' : bounty.status === 'Open' ? 'neutral' : 'warn',
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

  return {
    bounty: summarizeBounty(state, bounty),
    submissions,
    verifications,
    timeline: [
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

function normalizeBounty(bounty) {
  if (!bounty || typeof bounty !== 'object') {
    return bounty;
  }

  if (bounty.bountyId) {
    return bounty;
  }

  return {
    bountyId: bounty.bounty_id || bounty.id || createTxHash().slice(0, 10),
    title: bounty.title || 'Untitled bounty',
    rewardAmount: Number(String(bounty.rewardAmount || bounty.reward_amount || 0).replace(/[^\d.]/g, '')) || 0,
    rewardToken: bounty.rewardToken || bounty.reward_token || 'USDC',
    deadline: bounty.deadline || bounty.endsAt || nowIso(),
    status: bounty.status || 'Open',
    ownerHandle: bounty.ownerHandle || bounty.owner || '@okx',
    requirementSummary: bounty.requirementSummary || bounty.requirement_summary || '',
    escrowTxHash: bounty.escrowTxHash || bounty.escrow_tx_hash || createTxHash(),
    createdAt: bounty.createdAt || nowIso(),
    updatedAt: bounty.updatedAt || nowIso(),
    requirements: Array.isArray(bounty.requirements) ? bounty.requirements.map(normalizeRequirement) : []
  };
}

function normalizeSubmission(submission) {
  if (!submission || typeof submission !== 'object') {
    return submission;
  }

  if (submission.submissionId) {
    return submission;
  }

  return {
    submissionId: submission.submissionId || submission.id || createTxHash().slice(0, 10),
    bountyId: submission.bountyId || submission.bounty_id || '',
    contributorHandle: submission.contributorHandle || submission.contributor || '@unknown',
    url: submission.url || '',
    submittedAt: submission.submittedAt || submission.createdAt || nowIso(),
    tweetCount: Number(submission.tweetCount || 0),
    content: submission.content || '',
    createdAt: submission.createdAt || nowIso(),
    status: submission.status
  };
}

function normalizeVerification(verification) {
  if (!verification || typeof verification !== 'object') {
    return verification;
  }

  if (verification.verificationId) {
    return verification;
  }

  return {
    verificationId: verification.verificationId || verification.id || createTxHash().slice(0, 10),
    bountyId: verification.bountyId || verification.bounty_id || '',
    submissionId: verification.submissionId || verification.submission_id || '',
    overallPass: Boolean(verification.overallPass ?? verification.overall_pass),
    verdictHash: verification.verdictHash || verification.verdict_hash || createTxHash(),
    createdAt: verification.createdAt || nowIso(),
    results: Array.isArray(verification.results)
      ? verification.results.map((result) => ({
          req_id: result.req_id || result.reqId || result.id || '',
          pass: Boolean(result.pass),
          reason: result.reason || ''
        }))
      : []
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
  if (latestVerification) {
    return latestVerification.overallPass ? 'Ready to release' : 'Locked';
  }
  return bounty.status === 'Open' ? 'In escrow' : 'Awaiting verification';
}

function createTxHash() {
  return `0x${Math.random().toString(16).slice(2, 18).padEnd(16, '0')}`;
}

function createVerdictHash(verdict) {
  return `0x${Buffer.from(JSON.stringify(verdict)).toString('hex').slice(0, 12)}`;
}

function isSameDay(a, b) {
  const left = new Date(a);
  const right = new Date(b);
  return left.toDateString() === right.toDateString();
}

function formatMoney(value) {
  return new Intl.NumberFormat('en-US').format(Number(value || 0));
}
