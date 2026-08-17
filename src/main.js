import { renderApp } from './render.js';

const uiState = {
  view: 'dashboard',
  selectedBountyId: null,
  detailMode: 'view',
  detailDraftBountyId: null,
  theme: loadThemePreference(),
  loading: true,
  filters: {
    search: '',
    status: 'all',
    sort: 'latest'
  },
  adminFilters: {
    search: '',
    type: 'all',
    severity: 'all',
    status: 'all'
  },
  detailDrafts: [],
  requirementDrafts: createDefaultRequirementDrafts()
};

let appState = null;
let xlayerDeploymentRefreshTimer = null;

await init();

async function init() {
  applyTheme(uiState.theme);
  render();
  const [state, deployment] = await Promise.all([
    fetchState(),
    fetchXLayerDeployment().catch(() => null)
  ]);
  setAppState(state, deployment);
  uiState.loading = false;
  syncRouteFromHash();
  if (!uiState.selectedBountyId) {
    uiState.selectedBountyId = getDefaultBountyId();
  }
  window.addEventListener('hashchange', () => {
    syncRouteFromHash();
    render();
  });
  xlayerDeploymentRefreshTimer = window.setInterval(refreshXLayerDeployment, 30000);
  render();
}

function setAppState(nextState, deploymentSnapshot = null) {
  appState = {
    ...nextState,
    xlayerDeployment: deploymentSnapshot ?? nextState?.xlayerDeployment ?? appState?.xlayerDeployment ?? null
  };
}

function render() {
  renderApp(appState, uiState);
  bindEvents();
}

async function fetchState() {
  const response = await fetch('/api/state');
  if (!response.ok) {
    throw new Error(`Failed to load state: ${response.status}`);
  }
  return response.json();
}

async function fetchXLayerDeployment() {
  const response = await fetch('/api/xlayer/deployment');
  if (!response.ok) {
    throw new Error(`Failed to load X Layer deployment metadata: ${response.status}`);
  }
  return response.json();
}

async function refreshXLayerDeployment() {
  try {
    const deployment = await fetchXLayerDeployment();
    if (deployment) {
      setAppState(appState || {}, deployment);
      render();
    }
  } catch {
    // Keep the last known deployment snapshot if the endpoint blips.
  }
}

async function apiJson(url, { method = 'GET', body, headers = {}, idempotent = false } = {}) {
  const finalHeaders = { ...headers };
  const isMutating = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method.toUpperCase());
  if (body !== undefined && body !== null && !finalHeaders['Content-Type']) {
    finalHeaders['Content-Type'] = 'application/json';
  }
  if (isMutating && appState?.auth?.csrfToken) {
    finalHeaders['X-CSRF-Token'] = appState.auth.csrfToken;
  }
  if (isMutating && idempotent) {
    finalHeaders['Idempotency-Key'] = cryptoRandomId();
  }

  const response = await fetch(url, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return response;
}

function cryptoRandomId() {
  return globalThis.crypto?.randomUUID?.() || `req_${Math.random().toString(16).slice(2)}`;
}

function loadThemePreference() {
  const stored = window.localStorage?.getItem('bountyproof-theme');
  return stored === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = nextTheme;
  if (nextTheme === 'light') {
    document.body.classList.add('theme-light');
  } else {
    document.body.classList.remove('theme-light');
  }
  window.localStorage?.setItem('bountyproof-theme', nextTheme);
  const toggle = document.querySelector('[data-theme-toggle]');
  if (toggle) {
    toggle.textContent = nextTheme === 'light' ? 'Dark theme' : 'Light theme';
    toggle.setAttribute('aria-pressed', String(nextTheme === 'light'));
  }
}

function bindEvents() {
  document.querySelectorAll('[data-route]').forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      const targetView = button.dataset.route;
      const targetBountyId = button.dataset.bountyId || uiState.selectedBountyId || getDefaultBountyId();
      navigate(targetView, targetBountyId);
    };
  });

  document.querySelectorAll('[data-select-bounty]').forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      const bountyId = button.dataset.selectBounty;
      const targetView = button.dataset.route || 'detail';
      navigate(targetView, bountyId);
    };
  });

  document.querySelectorAll('[data-detail-mode]').forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      uiState.detailMode = button.dataset.detailMode;
      ensureDetailDrafts();
      render();
    };
  });

  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.onclick = (event) => {
      event.preventDefault();
      uiState.theme = uiState.theme === 'light' ? 'dark' : 'light';
      applyTheme(uiState.theme);
      render();
    };
  });

  document.querySelectorAll('[data-filter]').forEach((control) => {
    const field = control.dataset.filter;
    if (control.tagName === 'INPUT') {
      control.oninput = () => {
        uiState.filters[field] = control.value;
        render();
      };
    } else {
      control.onchange = () => {
        uiState.filters[field] = control.value;
        render();
      };
    }
  });

  document.querySelectorAll('[data-admin-filter]').forEach((control) => {
    const field = control.dataset.adminFilter;
    if (control.tagName === 'INPUT') {
      control.oninput = () => {
        uiState.adminFilters[field] = control.value;
        render();
      };
    } else {
      control.onchange = () => {
        uiState.adminFilters[field] = control.value;
        render();
      };
    }
  });

  const createForm = document.querySelector('[data-form="create-bounty"]');
  if (createForm) {
    createForm.onsubmit = handleCreateBounty;
    createForm.oninput = handleDraftFieldChange;
    createForm.onchange = handleDraftFieldChange;
    createForm.querySelectorAll('[data-draft-add]').forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        syncDraftStateFromForm(createForm);
        uiState.requirementDrafts.push(createRequirementDraft());
        render();
      };
    });
    createForm.querySelectorAll('[data-draft-remove]').forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        syncDraftStateFromForm(createForm);
        const index = Number(button.dataset.draftRemove);
        uiState.requirementDrafts.splice(index, 1);
        if (uiState.requirementDrafts.length === 0) {
          uiState.requirementDrafts.push(createRequirementDraft());
        }
        render();
      };
    });
  }

  const submitForm = document.querySelector('[data-form="submit-and-verify"]');
  if (submitForm) {
    submitForm.onsubmit = handleSubmitAndVerify;
  }

  const editForm = document.querySelector('[data-form="edit-bounty"]');
  if (editForm) {
    editForm.onsubmit = handleUpdateBounty;
    editForm.oninput = handleDetailFieldChange;
    editForm.onchange = handleDetailFieldChange;
    editForm.querySelectorAll('[data-edit-add]').forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        syncDetailDraftStateFromForm(editForm);
        uiState.detailDrafts.push(createRequirementDraft());
        render();
      };
    });
    editForm.querySelectorAll('[data-edit-remove]').forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        syncDetailDraftStateFromForm(editForm);
        const index = Number(button.dataset.editRemove);
        uiState.detailDrafts.splice(index, 1);
        if (uiState.detailDrafts.length === 0) {
          uiState.detailDrafts.push(createRequirementDraft());
        }
        render();
      };
    });
  }

  const syncChainForm = document.querySelector('[data-form="sync-chain"]');
  if (syncChainForm) {
    syncChainForm.onsubmit = handleSyncChain;
  }

  document.querySelectorAll('[data-delete-bounty]').forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      await handleDeleteBounty(button.dataset.deleteBounty);
    };
  });

  const emailLoginForm = document.querySelector('[data-form="email-login"]');
  if (emailLoginForm) {
    emailLoginForm.onsubmit = handleEmailLogin;
  }

  const walletLoginForm = document.querySelector('[data-form="wallet-login"]');
  if (walletLoginForm) {
    walletLoginForm.onsubmit = handleWalletLogin;
  }

  const orgForm = document.querySelector('[data-form="create-org"]');
  if (orgForm) {
    orgForm.onsubmit = handleCreateOrg;
  }

  const inviteForm = document.querySelector('[data-form="invite-member"]');
  if (inviteForm) {
    inviteForm.onsubmit = handleCreateInvite;
  }

  const disputeForm = document.querySelector('[data-form="create-dispute"]');
  if (disputeForm) {
    disputeForm.onsubmit = handleCreateDispute;
  }

  const adminOverrideForm = document.querySelector('[data-form="admin-override-bounty"]');
  if (adminOverrideForm) {
    adminOverrideForm.onsubmit = handleAdminOverrideBounty;
  }

  const adminIncidentForm = document.querySelector('[data-form="admin-incident-review"]');
  if (adminIncidentForm) {
    adminIncidentForm.onsubmit = handleAdminIncidentReview;
  }

  document.querySelectorAll('[data-export-analytics]').forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      await handleExportAnalytics(button.dataset.exportAnalytics);
    };
  });

  document.querySelectorAll('[data-release-bounty]').forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      await handleReleaseBounty(button.dataset.releaseBounty);
    };
  });

  document.querySelectorAll('[data-refund-bounty]').forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      await handleRefundBounty(button.dataset.refundBounty);
    };
  });

  document.querySelectorAll('[data-form="resolve-dispute"]').forEach((form) => {
    form.onsubmit = handleResolveDispute;
  });

  document.querySelectorAll('[data-form="accept-invite"]').forEach((form) => {
    form.onsubmit = handleAcceptInvite;
  });

  document.querySelectorAll('[data-switch-org]').forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      await handleSwitchOrg(button.dataset.switchOrg);
    };
  });

  document.querySelectorAll('[data-logout]').forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      await handleLogout();
    };
  });
}

async function handleCreateBounty(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  syncDraftStateFromForm(event.currentTarget);

  const requirements = uiState.requirementDrafts.map((draft, index) => ({
    id: draft.id.trim() || `req_${index + 1}`,
    type: draft.type,
    description: draft.description.trim(),
    params: parseParams(draft.params, draft.type)
  }));

  const response = await apiJson('/api/bounties', {
    method: 'POST',
    body: {
      orgId: appState?.auth?.activeOrg?.orgId || '',
      title: formData.get('title'),
      rewardAmount: Number(formData.get('rewardAmount')),
      rewardToken: formData.get('rewardToken'),
      deadline: formData.get('deadline'),
      ownerHandle: formData.get('ownerHandle'),
      requirementSummary: formData.get('requirementSummary'),
      requirements
    },
    idempotent: true
  });

  if (!response.ok) {
    alert('Failed to create bounty.');
    return;
  }

  const payload = await response.json();
  setAppState(payload.state);
  uiState.selectedBountyId = payload.bounty.bountyId;
  uiState.requirementDrafts = createDefaultRequirementDrafts();
  navigate('detail', payload.bounty.bountyId, false);
  render();
}

async function handleSubmitAndVerify(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const bountyId = String(formData.get('bountyId') || uiState.selectedBountyId || '');

  const submissionResponse = await apiJson('/api/submissions', {
    method: 'POST',
    body: {
      bountyId,
      contributorHandle: formData.get('contributorHandle'),
      url: formData.get('url'),
      submittedAt: formData.get('submittedAt'),
      tweetCount: Number(formData.get('tweetCount')),
      content: formData.get('content'),
      screenshotUrls: formData.get('screenshotUrls'),
      pageSnapshots: formData.get('pageSnapshots'),
      evidenceMetadata: formData.get('evidenceMetadata')
    },
    idempotent: true
  });

  if (!submissionResponse.ok) {
    alert('Failed to submit evidence.');
    return;
  }

  const submissionPayload = await submissionResponse.json();
  const verificationResponse = await apiJson('/api/verifications', {
    method: 'POST',
    body: {
      bountyId,
      submissionId: submissionPayload.submission.submissionId
    },
    idempotent: true
  });

  if (!verificationResponse.ok) {
    alert('Submission saved, but verification failed.');
    return;
  }

  const verificationPayload = await verificationResponse.json();
  setAppState(verificationPayload.state);
  uiState.selectedBountyId = bountyId;
  navigate('result', bountyId, false);
  render();
}

function navigate(view, bountyId, shouldRender = true) {
  const hash = bountyId ? `#/${view}/${bountyId}` : `#/${view}`;
  if (location.hash !== hash) {
    location.hash = hash;
  }
  uiState.view = view;
  uiState.detailMode = view === 'detail' ? 'view' : uiState.detailMode;
  uiState.selectedBountyId = bountyId || uiState.selectedBountyId || getDefaultBountyId();
  if (view === 'detail') {
    ensureDetailDrafts();
  }
  if (shouldRender) {
    render();
  }
}

function syncRouteFromHash() {
  const parsed = parseHash(location.hash);
  uiState.view = parsed.view || 'dashboard';
  uiState.selectedBountyId = parsed.bountyId || uiState.selectedBountyId || getDefaultBountyId();
  uiState.detailMode = uiState.view === 'detail' ? uiState.detailMode : 'view';
  if (uiState.view === 'detail') {
    ensureDetailDrafts();
  }
}

function parseHash(hash) {
  const parts = String(hash || '')
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean);
  const [view, bountyId] = parts;
  return {
    view: view || 'dashboard',
    bountyId: bountyId || null
  };
}

function getDefaultBountyId() {
  return appState?.bountySummaries?.[0]?.bountyId || appState?.bounties?.[0]?.bountyId || null;
}

function createRequirementDraft(overrides = {}) {
  return {
    id: '',
    type: 'url_exists',
    description: '',
    params: defaultParamsForType('url_exists'),
    ...overrides
  };
}

function createDefaultRequirementDrafts() {
  return [createRequirementDraft(), createRequirementDraft({ type: 'text_contains', params: defaultParamsForType('text_contains') })];
}

function createDraftsFromBounty(bounty) {
  return (bounty?.requirements || []).map((requirement, index) => ({
    id: requirement.id || `req_${index + 1}`,
    type: requirement.type || 'url_exists',
    description: requirement.description || '',
    params: JSON.stringify(requirement.params || defaultParamsForType(requirement.type), null, 2)
  }));
}

function defaultParamsForType(type) {
  if (type === 'url_exists') {
    return { domain_allowlist: ['x.com', 'twitter.com'] };
  }
  if (type === 'text_contains') {
    return { must_include: ['#XLayer', '@okx'] };
  }
  if (type === 'before_deadline') {
    return { deadline: '2026-08-20T23:59:00Z' };
  }
  if (type === 'min_length') {
    return { unit: 'tweets', min: 5 };
  }
  if (type === 'account_match') {
    return { verified_account_handle: '@submitter_handle' };
  }
  return {};
}

function parseParams(raw, type) {
  if (!raw || !String(raw).trim()) {
    return defaultParamsForType(type);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Requirement params for ${type} must be valid JSON.`);
  }
}

function syncDraftStateFromForm(form) {
  const rows = Array.from(form.querySelectorAll('[data-draft-row]'));
  uiState.requirementDrafts = rows.map((row) => ({
    id: row.querySelector('[data-draft-id]')?.value || '',
    type: row.querySelector('[data-draft-type]')?.value || 'url_exists',
    description: row.querySelector('[data-draft-description]')?.value || '',
    params: row.querySelector('[data-draft-params]')?.value || ''
  }));
}

function syncDetailDraftStateFromForm(form) {
  const rows = Array.from(form.querySelectorAll('[data-edit-row]'));
  uiState.detailDrafts = rows.map((row) => ({
    id: row.querySelector('[data-edit-id]')?.value || '',
    type: row.querySelector('[data-edit-type]')?.value || 'url_exists',
    description: row.querySelector('[data-edit-description]')?.value || '',
    params: row.querySelector('[data-edit-params]')?.value || ''
  }));
}

function handleDraftFieldChange(event) {
  const target = event.target;
  if (!target || !target.closest) {
    return;
  }

  const row = target.closest('[data-draft-row]');
  if (!row) {
    return;
  }

  const rows = Array.from(row.parentElement.querySelectorAll('[data-draft-row]'));
  const index = rows.indexOf(row);
  if (index < 0) {
    return;
  }

  const draft = uiState.requirementDrafts[index] || createRequirementDraft();
  if (target.hasAttribute('data-draft-id')) {
    draft.id = target.value;
  } else if (target.hasAttribute('data-draft-description')) {
    draft.description = target.value;
  } else if (target.hasAttribute('data-draft-params')) {
    draft.params = target.value;
  } else if (target.hasAttribute('data-draft-type')) {
    draft.type = target.value;
    draft.params = JSON.stringify(defaultParamsForType(target.value), null, 2);
    const paramsField = row.querySelector('[data-draft-params]');
    if (paramsField) {
      paramsField.value = draft.params;
    }
  }

  uiState.requirementDrafts[index] = draft;
}

function handleDetailFieldChange(event) {
  const target = event.target;
  if (!target || !target.closest) {
    return;
  }

  const row = target.closest('[data-edit-row]');
  if (!row) {
    return;
  }

  const rows = Array.from(row.parentElement.querySelectorAll('[data-edit-row]'));
  const index = rows.indexOf(row);
  if (index < 0) {
    return;
  }

  const draft = uiState.detailDrafts[index] || createRequirementDraft();
  if (target.hasAttribute('data-edit-id')) {
    draft.id = target.value;
  } else if (target.hasAttribute('data-edit-description')) {
    draft.description = target.value;
  } else if (target.hasAttribute('data-edit-params')) {
    draft.params = target.value;
  } else if (target.hasAttribute('data-edit-type')) {
    draft.type = target.value;
    draft.params = JSON.stringify(defaultParamsForType(target.value), null, 2);
    const paramsField = row.querySelector('[data-edit-params]');
    if (paramsField) {
      paramsField.value = draft.params;
    }
  }

  uiState.detailDrafts[index] = draft;
}

async function handleUpdateBounty(event) {
  event.preventDefault();
  const bountyId = uiState.selectedBountyId || getDefaultBountyId();
  syncDetailDraftStateFromForm(event.currentTarget);
  const formData = new FormData(event.currentTarget);
  const requirements = uiState.detailDrafts.map((draft, index) => ({
    id: draft.id.trim() || `req_${index + 1}`,
    type: draft.type,
    description: draft.description.trim(),
    params: parseParams(draft.params, draft.type)
  }));

  const response = await apiJson(`/api/bounties/${encodeURIComponent(bountyId)}`, {
    method: 'PATCH',
    body: {
      title: formData.get('title'),
      rewardAmount: Number(formData.get('rewardAmount')),
      rewardToken: formData.get('rewardToken'),
      deadline: formData.get('deadline'),
      ownerHandle: formData.get('ownerHandle'),
      requirementSummary: formData.get('requirementSummary'),
      status: formData.get('status'),
      escrowTxHash: formData.get('escrowTxHash'),
      requirements
    },
    idempotent: true
  });

  if (!response.ok) {
    alert('Failed to update bounty.');
    return;
  }

  const payload = await response.json();
  setAppState(payload.state);
  uiState.selectedBountyId = payload.bounty.bountyId;
  uiState.detailMode = 'view';
  uiState.detailDrafts = createDraftsFromBounty(payload.bounty);
  uiState.detailDraftBountyId = payload.bounty.bountyId;
  render();
}

async function handleSyncChain(event) {
  event.preventDefault();
  const bountyId = uiState.selectedBountyId || getDefaultBountyId();
  const formData = new FormData(event.currentTarget);
  const response = await apiJson(`/api/bounties/${encodeURIComponent(bountyId)}/chain-sync`, {
    method: 'POST',
    body: {
      chainId: Number(formData.get('chainId')),
      contractAddress: formData.get('contractAddress'),
      contractVersion: formData.get('contractVersion'),
      abiVersion: formData.get('abiVersion'),
      contractVerified: formData.get('contractVerified') === 'true',
      explorerBaseUrl: formData.get('explorerBaseUrl'),
      treasuryType: formData.get('treasuryType'),
      treasuryAddress: formData.get('treasuryAddress'),
      treasuryThreshold: Number(formData.get('treasuryThreshold')),
      treasurySigners: String(formData.get('treasurySigners') || '')
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
      fundingTxHash: formData.get('fundingTxHash'),
      payoutTxHash: formData.get('payoutTxHash'),
      refundTxHash: formData.get('refundTxHash'),
      onChainStatus: formData.get('onChainStatus'),
      chainSyncStatus: formData.get('chainSyncStatus'),
      lastChainSyncedAt: formData.get('lastChainSyncedAt')
    },
    idempotent: true
  });

  if (!response.ok) {
    alert('Failed to sync chain state.');
    return;
  }

  const payload = await response.json();
  setAppState(payload.state);
  uiState.selectedBountyId = payload.bounty.bountyId;
  render();
}

async function handleDeleteBounty(bountyId) {
  if (!bountyId) {
    return;
  }
  const confirmed = window.confirm('Delete this bounty and all related submissions and verifications?');
  if (!confirmed) {
    return;
  }

  const response = await apiJson(`/api/bounties/${encodeURIComponent(bountyId)}`, {
    method: 'DELETE',
    body: {},
    idempotent: true
  });

  if (!response.ok) {
    alert('Failed to delete bounty.');
    return;
  }

  const payload = await response.json();
  setAppState(payload.state);
  uiState.selectedBountyId = getDefaultBountyId();
  uiState.detailMode = 'view';
  uiState.detailDrafts = createDefaultRequirementDrafts();
  uiState.detailDraftBountyId = null;
  navigate('dashboard', getDefaultBountyId(), false);
  render();
}

async function handleEmailLogin(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const response = await apiJson('/api/auth/email-login', {
    method: 'POST',
    body: {
      email: formData.get('email'),
      displayName: formData.get('displayName'),
      handle: formData.get('handle'),
      activeOrgId: formData.get('activeOrgId')
    }
  });

  if (!response.ok) {
    alert('Email login failed.');
    return;
  }

  const payload = await response.json();
  setAppState(payload);
  uiState.selectedBountyId = getDefaultBountyId();
  navigate('account', uiState.selectedBountyId, false);
  render();
}

async function handleWalletLogin(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  let walletAddress = String(formData.get('walletAddress') || '').trim();
  if (!walletAddress && window.ethereum?.request) {
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      walletAddress = String(accounts?.[0] || '').trim();
    } catch (error) {
      alert(`Wallet connect failed: ${error.message}`);
      return;
    }
  }
  if (!walletAddress) {
    walletAddress = String(window.prompt('Enter the wallet address to challenge') || '').trim();
  }
  if (!walletAddress) {
    alert('Wallet address is required.');
    return;
  }

  const challengeResponse = await apiJson('/api/auth/wallet-challenge', {
    method: 'POST',
    body: {
      walletAddress
    }
  });

  if (!challengeResponse.ok) {
    alert('Failed to request wallet challenge.');
    return;
  }

  const challengePayload = await challengeResponse.json();
  const challenge = challengePayload.challenge;
  let signature = String(formData.get('signature') || '').trim();
  walletAddress = walletAddress || String(challenge.address || '').trim();

  if (!signature && window.ethereum?.request) {
    try {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [challenge.message, walletAddress]
      });
    } catch (error) {
      alert(`Wallet signing failed: ${error.message}`);
      return;
    }
  }

  if (!signature) {
    signature = window.prompt(`Sign this message in your wallet and paste the signature:\n\n${challenge.message}`) || '';
  }

  const response = await apiJson('/api/auth/wallet-login', {
    method: 'POST',
    body: {
      walletAddress,
      displayName: formData.get('displayName'),
      handle: formData.get('handle'),
      activeOrgId: formData.get('activeOrgId'),
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      signature,
      domain: challenge.domain,
      uri: challenge.uri
    }
  });

  if (!response.ok) {
    alert('Wallet login failed.');
    return;
  }

  const payload = await response.json();
  setAppState(payload);
  uiState.selectedBountyId = getDefaultBountyId();
  navigate('account', uiState.selectedBountyId, false);
  render();
}

async function handleLogout() {
  const response = await apiJson('/api/auth/logout', { method: 'POST', body: {}, idempotent: true });
  if (!response.ok) {
    alert('Logout failed.');
    return;
  }
  const payload = await response.json();
  setAppState(payload.state);
  uiState.selectedBountyId = getDefaultBountyId();
  navigate('dashboard', uiState.selectedBountyId, false);
  render();
}

async function handleCreateOrg(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const response = await apiJson('/api/orgs', {
    method: 'POST',
    body: {
      name: formData.get('name'),
      slug: formData.get('slug')
    },
    idempotent: true
  });

  if (!response.ok) {
    alert('Failed to create organization.');
    return;
  }

  const payload = await response.json();
  setAppState(payload.state);
  render();
}

async function handleCreateInvite(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const orgId = String(formData.get('orgId') || appState?.auth?.activeOrg?.orgId || '');
  const response = await apiJson(`/api/orgs/${encodeURIComponent(orgId)}/invites`, {
    method: 'POST',
    body: {
      email: formData.get('email'),
      walletAddress: formData.get('walletAddress'),
      handle: formData.get('handle'),
      role: formData.get('role'),
      expiresAt: formData.get('expiresAt')
    },
    idempotent: true
  });

  if (!response.ok) {
    alert('Failed to create invite.');
    return;
  }

  const payload = await response.json();
  setAppState(payload.state);
  render();
}

async function handleAcceptInvite(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const code = String(formData.get('code') || '').trim();
  if (!code) {
    alert('Invite code is required.');
    return;
  }

  const response = await apiJson(`/api/invites/${encodeURIComponent(code)}/accept`, {
    method: 'POST',
    body: {},
    idempotent: true
  });

  if (!response.ok) {
    alert('Failed to accept invite.');
    return;
  }

  const payload = await response.json();
  setAppState(payload.state);
  render();
}

async function handleSwitchOrg(orgId) {
  if (!orgId) {
    return;
  }
  const response = await apiJson(`/api/orgs/${encodeURIComponent(orgId)}/switch`, {
    method: 'POST',
    body: {},
    idempotent: true
  });
  if (!response.ok) {
    alert('Failed to switch workspace.');
    return;
  }

  const payload = await response.json();
  setAppState(payload);
  render();
}

async function handleCreateDispute(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const response = await apiJson('/api/disputes', {
    method: 'POST',
    body: {
      bountyId: formData.get('bountyId'),
      submissionId: formData.get('submissionId'),
      verificationId: formData.get('verificationId'),
      reason: formData.get('reason'),
      evidenceUrl: formData.get('evidenceUrl'),
      deadlineAt: formData.get('deadlineAt')
    },
    idempotent: true
  });

  if (!response.ok) {
    alert('Failed to open dispute.');
    return;
  }

  const payload = await response.json();
  setAppState(payload.state);
  render();
}

async function handleResolveDispute(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const disputeId = String(formData.get('disputeId') || '').trim();
  const response = await apiJson(`/api/disputes/${encodeURIComponent(disputeId)}`, {
    method: 'PATCH',
    body: {
      outcome: formData.get('outcome'),
      reviewNotes: formData.get('reviewNotes') || '',
      resolutionNotes: formData.get('resolutionNotes') || ''
    },
    idempotent: true
  });

  if (!response.ok) {
    alert('Failed to resolve dispute.');
    return;
  }

  const payload = await response.json();
  setAppState(payload.state);
  render();
}

async function handleAdminOverrideBounty(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const bountyId = String(formData.get('bountyId') || '').trim();
  const response = await apiJson(`/api/admin/bounties/${encodeURIComponent(bountyId)}/override`, {
    method: 'POST',
    body: {
      status: formData.get('status'),
      refundTxHash: formData.get('refundTxHash'),
      reason: formData.get('reason')
    },
    idempotent: true
  });
  if (!response.ok) {
    alert('Failed to apply admin override.');
    return;
  }
  const payload = await response.json();
  setAppState(payload.state);
  render();
}

async function handleReleaseBounty(bountyId) {
  if (!bountyId) {
    return;
  }
  const reason = window.prompt('Optional release note', 'Verification passed and escrow is ready to release.') || '';
  const response = await apiJson(`/api/bounties/${encodeURIComponent(bountyId)}/release`, {
    method: 'POST',
    body: {
      reason
    },
    idempotent: true
  });
  if (!response.ok) {
    alert('Failed to release escrow.');
    return;
  }
  const payload = await response.json();
  setAppState(payload.state);
  render();
}

async function handleRefundBounty(bountyId) {
  if (!bountyId) {
    return;
  }
  const reason = window.prompt('Refund reason', 'Verification failed or dispute requires refund.') || '';
  const response = await apiJson(`/api/admin/bounties/${encodeURIComponent(bountyId)}/refund`, {
    method: 'POST',
    body: {
      reason
    },
    idempotent: true
  });
  if (!response.ok) {
    alert('Failed to refund escrow.');
    return;
  }
  const payload = await response.json();
  setAppState(payload.state);
  render();
}

async function handleAdminIncidentReview(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const response = await apiJson('/api/admin/incidents/review', {
    method: 'POST',
    body: {
      targetType: formData.get('targetType'),
      targetId: formData.get('targetId'),
      decision: formData.get('decision'),
      notes: formData.get('notes')
    },
    idempotent: true
  });
  if (!response.ok) {
    alert('Failed to record incident review.');
    return;
  }
  const payload = await response.json();
  setAppState(payload.state);
  render();
}

async function handleExportAnalytics(format) {
  const response = await fetch(`/api/exports/analytics.${format === 'csv' ? 'csv' : 'json'}`);
  if (!response.ok) {
    alert('Failed to export analytics.');
    return;
  }
  if (format === 'csv') {
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'bountyproof-analytics.csv';
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'bountyproof-analytics.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

function ensureDetailDrafts() {
  const bounty = selectCurrentBounty();
  if (!bounty) {
    uiState.detailDrafts = createDefaultRequirementDrafts();
    uiState.detailDraftBountyId = null;
    return;
  }

  if (uiState.detailDraftBountyId === bounty.bountyId && uiState.detailDrafts?.length) {
    return;
  }

  uiState.detailDrafts = createDraftsFromBounty(bounty);
  uiState.detailDraftBountyId = bounty.bountyId;
}

function selectCurrentBounty() {
  return appState?.bountySummaries?.find((item) => item.bountyId === uiState.selectedBountyId) || appState?.bountySummaries?.[0] || null;
}
