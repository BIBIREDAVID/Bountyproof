import { renderApp } from './render.js';

const uiState = {
  view: 'dashboard',
  selectedBountyId: null,
  detailMode: 'view',
  detailDraftBountyId: null,
  filters: {
    search: '',
    status: 'all',
    sort: 'latest'
  },
  detailDrafts: [],
  requirementDrafts: createDefaultRequirementDrafts()
};

let appState = null;

await init();

async function init() {
  appState = await fetchState();
  syncRouteFromHash();
  if (!uiState.selectedBountyId) {
    uiState.selectedBountyId = getDefaultBountyId();
  }
  window.addEventListener('hashchange', () => {
    syncRouteFromHash();
    render();
  });
  render();
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

  document.querySelectorAll('[data-delete-bounty]').forEach((button) => {
    button.onclick = async (event) => {
      event.preventDefault();
      await handleDeleteBounty(button.dataset.deleteBounty);
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

  const response = await fetch('/api/bounties', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: formData.get('title'),
      rewardAmount: Number(formData.get('rewardAmount')),
      rewardToken: formData.get('rewardToken'),
      deadline: formData.get('deadline'),
      ownerHandle: formData.get('ownerHandle'),
      requirementSummary: formData.get('requirementSummary'),
      requirements
    })
  });

  if (!response.ok) {
    alert('Failed to create bounty.');
    return;
  }

  const payload = await response.json();
  appState = payload.state;
  uiState.selectedBountyId = payload.bounty.bountyId;
  uiState.requirementDrafts = createDefaultRequirementDrafts();
  navigate('detail', payload.bounty.bountyId, false);
  render();
}

async function handleSubmitAndVerify(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const bountyId = String(formData.get('bountyId') || uiState.selectedBountyId || '');

  const submissionResponse = await fetch('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bountyId,
      contributorHandle: formData.get('contributorHandle'),
      url: formData.get('url'),
      submittedAt: formData.get('submittedAt'),
      tweetCount: Number(formData.get('tweetCount')),
      content: formData.get('content')
    })
  });

  if (!submissionResponse.ok) {
    alert('Failed to submit evidence.');
    return;
  }

  const submissionPayload = await submissionResponse.json();
  const verificationResponse = await fetch('/api/verifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bountyId,
      submissionId: submissionPayload.submission.submissionId
    })
  });

  if (!verificationResponse.ok) {
    alert('Submission saved, but verification failed.');
    return;
  }

  const verificationPayload = await verificationResponse.json();
  appState = verificationPayload.state;
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

  const response = await fetch(`/api/bounties/${encodeURIComponent(bountyId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: formData.get('title'),
      rewardAmount: Number(formData.get('rewardAmount')),
      rewardToken: formData.get('rewardToken'),
      deadline: formData.get('deadline'),
      ownerHandle: formData.get('ownerHandle'),
      requirementSummary: formData.get('requirementSummary'),
      status: formData.get('status'),
      escrowTxHash: formData.get('escrowTxHash'),
      requirements
    })
  });

  if (!response.ok) {
    alert('Failed to update bounty.');
    return;
  }

  const payload = await response.json();
  appState = payload.state;
  uiState.selectedBountyId = payload.bounty.bountyId;
  uiState.detailMode = 'view';
  uiState.detailDrafts = createDraftsFromBounty(payload.bounty);
  uiState.detailDraftBountyId = payload.bounty.bountyId;
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

  const response = await fetch(`/api/bounties/${encodeURIComponent(bountyId)}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    alert('Failed to delete bounty.');
    return;
  }

  const payload = await response.json();
  appState = payload.state;
  uiState.selectedBountyId = getDefaultBountyId();
  uiState.detailMode = 'view';
  uiState.detailDrafts = createDefaultRequirementDrafts();
  uiState.detailDraftBountyId = null;
  navigate('dashboard', getDefaultBountyId(), false);
  render();
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
