import { requirementTypes } from './requirements.js';
import { XLAYER, getDefaultXLayerNetwork, getDefaultXLayerTokenAddress } from './xlayer.js';

const supportedRequirementTypes = Object.keys(requirementTypes);

export function renderApp(state, uiState) {
  if (!state || state.loading) {
    renderStatsSkeleton();
    renderLoadingShell(uiState);
    syncNavigationState(uiState.view);
    return;
  }
  renderStats(state.stats || []);
  renderShell(state, uiState);
  syncNavigationState(uiState.view);
}

function renderStatsSkeleton() {
  const root = document.getElementById('stats');
  root.innerHTML = `
    <div class="stats-grid">
      ${Array.from({ length: 4 })
        .map(
          () => `
            <article class="stat-card skeleton-card" aria-hidden="true">
              <div class="skeleton skeleton-line skeleton-label"></div>
              <div class="skeleton skeleton-line skeleton-value"></div>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function renderLoadingShell(uiState) {
  const root = document.getElementById('view-root');
  root.innerHTML = renderLoadingView(uiState);
}

function renderStats(stats) {
  const root = document.getElementById('stats');
  root.innerHTML = `
    <div class="stats-grid">
      ${stats
        .map(
          (stat) => `
            <article class="stat-card">
              <div class="label">${escapeHtml(stat.label)}</div>
              <strong class="value">${escapeHtml(stat.value)}</strong>
            </article>
          `
        )
        .join('')}
    </div>
  `;
}

function renderShell(state, uiState) {
  const root = document.getElementById('view-root');
  const bounty = selectBounty(state, uiState.selectedBountyId);
  const summary = bounty || null;
  const latestVerification = summary?.latestVerification || null;
  const bountyList = filterBounties(state, uiState.filters || {});

  if (uiState.view === 'create') {
    root.innerHTML = renderCreateView(state, uiState);
  } else if (uiState.view === 'detail') {
    root.innerHTML = renderDetailView(state, summary, uiState);
  } else if (uiState.view === 'result') {
    root.innerHTML = renderResultView(state, summary, latestVerification);
  } else if (uiState.view === 'mine') {
    root.innerHTML = renderMineView(state, uiState);
  } else if (uiState.view === 'account') {
    root.innerHTML = renderAccountView(state, uiState);
  } else if (uiState.view === 'admin') {
    root.innerHTML = renderAdminView(state, uiState);
  } else {
    root.innerHTML = renderDashboardView(state, uiState, bountyList, summary);
  }
}

function renderLoadingView(uiState) {
  const blocks = Array.from({ length: 6 })
    .map(
      () => `
        <article class="panel-dark skeleton-panel" aria-hidden="true">
          <div class="skeleton skeleton-line skeleton-title"></div>
          <div class="skeleton skeleton-line skeleton-text"></div>
          <div class="skeleton skeleton-line skeleton-text"></div>
        </article>
      `
    )
    .join('');

  return `
    <section class="hero-grid">
      <div class="hero-copy panel-dark">
        <div class="skeleton skeleton-line skeleton-title"></div>
        <div class="skeleton skeleton-line skeleton-heading"></div>
        <div class="skeleton skeleton-line skeleton-text"></div>
        <div class="skeleton-row">
          <span class="skeleton skeleton-pill"></span>
          <span class="skeleton skeleton-pill"></span>
          <span class="skeleton skeleton-pill"></span>
        </div>
      </div>
      <div class="hero-panel panel-dark">
        <div class="skeleton-card-grid">
          ${blocks}
        </div>
      </div>
    </section>
  `;
}

function renderDashboardView(state, uiState, bountyList, summary) {
  const auth = state.auth || {};
  const analytics = state.analytics || {};
  return `
    <section class="hero-grid">
      <div class="hero-copy panel-dark">
        <div class="hero-kicker-row">
          <span class="badge badge-dark">Escrowed bounty verification</span>
          <span class="badge">SIWE + CSRF</span>
          <span class="badge">Reviewer queues</span>
        </div>
        <h2>Automatic payout for objective proof, not guesswork.</h2>
        <p>
          BountyProof turns a bounty into a typed checklist, verifies submission evidence, and records the verdict
          before a reward is released on chain.
        </p>
        <div class="hero-actions">
          <button class="primary-action" data-route="create">Create bounty</button>
          <button class="secondary-action" type="button" data-route="detail" data-bounty-id="${escapeHtml(summary?.bountyId || '')}">Review submission</button>
          <button class="secondary-action" type="button" data-route="admin">Open admin</button>
        </div>
        <div class="hero-pills">
          <span class="pill pill-glow">X Layer escrow</span>
          <span class="pill">Structured rules</span>
          <span class="pill">On-chain audit trail</span>
        </div>
        <div class="auth-chip">
          <span class="mini-label">Workspace</span>
          <strong>${escapeHtml(auth.activeOrg?.name || 'Demo workspace')}</strong>
          <span class="muted">${escapeHtml(auth.user?.displayName || 'Demo operator')} - ${escapeHtml(auth.role || 'owner')}</span>
        </div>
      </div>
      <div class="hero-panel panel-dark">
        <div class="hero-orb hero-orb-left"></div>
        <div class="hero-orb hero-orb-right"></div>
        <div class="stack-card stack-card-main hero-stage-main">
          <div class="stack-row">
            <span class="mini-label">Active bounty</span>
            <strong>${escapeHtml(summary?.title || 'No bounty selected')}</strong>
          </div>
          <div class="stack-grid">
            <div>
              <span class="mini-label">Reward</span>
              <strong>${displayReward(summary)}</strong>
            </div>
            <div>
              <span class="mini-label">Status</span>
              <strong class="status-${normalizeStatus(summary?.status)}">${escapeHtml(summary?.status || 'Unknown')}</strong>
            </div>
          </div>
          <div class="divider"></div>
          <div class="stack-grid">
            <div>
              <span class="mini-label">Latest submitter</span>
              <strong>${escapeHtml(summary?.latestSubmission?.contributorHandle || 'None yet')}</strong>
            </div>
            <div>
              <span class="mini-label">Payout</span>
              <strong class="${payoutClass(summary?.payoutStatus)}">${escapeHtml(summary?.payoutStatus || 'In escrow')}</strong>
            </div>
          </div>
        </div>
        <div class="stack-card stack-card-side hero-stage-side">
          <div class="stage-heading">
            <span class="mini-label">Transaction flow</span>
            <strong>Proof passes through a deterministic release path.</strong>
          </div>
          <ol class="flow-list">
            <li>Poster funds the bounty escrow.</li>
            <li>Contributor submits evidence URL.</li>
            <li>Verifier returns structured pass/fail.</li>
            <li>Funds release automatically on pass.</li>
          </ol>
        </div>
      </div>
    </section>

    <section class="panel-dark feed-panel">
      <div class="section-head compact">
        <div>
          <h3>Reporting</h3>
          <p>Operational metrics for verification speed, dispute frequency, and payout timing.</p>
        </div>
      </div>
      <div class="stats-grid analytics-grid">
        ${renderAnalyticsCard('Time to verify', analytics.timeToVerify ? `${formatDuration(analytics.timeToVerify.averageMinutes)}` : '--', `Median ${formatDuration(analytics.timeToVerify?.medianMinutes || 0)} · ${analytics.timeToVerify?.samples || 0} samples`)}
        ${renderAnalyticsCard('Dispute rate', `${analytics.disputeRate || 0}%`, `${analytics.disputeCount || 0} disputes across ${analytics.verificationCount || 0} verifications`)}
        ${renderAnalyticsCard('Payout latency', analytics.payoutLatency ? `${formatDuration(analytics.payoutLatency.averageMinutes)}` : '--', `Median ${formatDuration(analytics.payoutLatency?.medianMinutes || 0)} · ${analytics.payoutLatency?.samples || 0} samples`)}
        ${renderAnalyticsCard('Pass rate', `${analytics.passRate || 0}%`, `${analytics.verificationCount || 0} total verifications`)}
      </div>
    </section>

    <section class="panel-dark feed-panel">
        <div class="section-head compact">
          <div>
            <h3>Bounty explorer</h3>
            <p>Filter and sort the live bounty feed, then open a bounty directly into detail or results.</p>
          </div>
          <span class="badge badge-dark">${bountyList.length} shown</span>
        </div>
      ${renderFilterBar(uiState)}
      <div class="bounty-grid">
        ${bountyList.map((item) => renderBountyCard(item, summary?.bountyId)).join('')}
      </div>
    </section>

    <section class="split-grid">
      <article class="panel-dark activity-panel">
        <div class="section-head compact">
          <div>
            <h3>Live activity</h3>
            <p>Recent submissions and verifications, ordered like a transaction feed.</p>
          </div>
        </div>
        <div class="feed-list">
          ${(state.recentActivity || [])
            .map(
              (item) => `
                <div class="feed-item">
                  <span class="feed-dot ${item.tone}"></span>
                  <div>
                    <strong>${escapeHtml(item.label)}</strong>
                    <p>${escapeHtml(item.detail)}</p>
                  </div>
                  <time>${formatRelative(item.timestamp)}</time>
                </div>
              `
            )
            .join('')}
        </div>
      </article>

      <article class="panel-dark activity-panel">
        <div class="section-head compact">
          <div>
            <h3>Transaction history</h3>
            <p>The escrow life cycle, submissions, and verification outcomes in one audit trail.</p>
          </div>
        </div>
        <div class="feed-list">
          ${(state.transactionHistory || [])
            .map(
              (item) => `
                <div class="feed-item">
                  <span class="feed-dot ${item.tone}"></span>
                  <div>
                    <strong>${escapeHtml(item.label)}</strong>
                    <p>${escapeHtml(item.detail)}</p>
                    ${item.payoutStatus ? `<p class="muted">Payout: ${escapeHtml(item.payoutStatus)}</p>` : ''}
                  </div>
                  <time>${formatRelative(item.timestamp)}</time>
                </div>
              `
            )
            .join('')}
        </div>
      </article>
    </section>
  `;
}

function renderAnalyticsCard(label, value, detail) {
  return `
    <article class="stat-card analytics-card">
      <div class="label">${escapeHtml(label)}</div>
      <strong class="value">${escapeHtml(value)}</strong>
      <p class="muted">${escapeHtml(detail)}</p>
    </article>
  `;
}

function renderFilterBar(uiState) {
  return `
    <div class="filter-bar">
      <label class="field compact-field">
        <span>Search</span>
        <input data-filter="search" value="${escapeHtml(uiState.filters?.search || '')}" placeholder="Search title, owner, or summary" />
      </label>
      <label class="field compact-field">
        <span>Status</span>
        <select data-filter="status">
          ${['all', 'Open', 'Funded', 'Verified', 'Paid']
            .map((status) => `<option value="${status}" ${status === (uiState.filters?.status || 'all') ? 'selected' : ''}>${status === 'all' ? 'All statuses' : status}</option>`)
            .join('')}
        </select>
      </label>
      <label class="field compact-field">
        <span>Sort</span>
        <select data-filter="sort">
          ${[
            ['latest', 'Latest activity'],
            ['reward-desc', 'Reward high to low'],
            ['deadline-asc', 'Deadline soonest']
          ]
            .map(([value, label]) => `<option value="${value}" ${value === (uiState.filters?.sort || 'latest') ? 'selected' : ''}>${label}</option>`)
            .join('')}
        </select>
      </label>
      <div class="filter-reset">
        <button class="ghost-button" type="button" data-route="dashboard">Reset route</button>
      </div>
    </div>
  `;
}

function renderBountyCard(item, selectedId) {
  return `
    <article class="bounty-card ${item.bountyId === selectedId ? 'selected' : ''}">
      <div class="bounty-card-head">
        <div>
          <span class="badge">${escapeHtml(item.status)}</span>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.requirementSummary)}</p>
        </div>
        <strong>${displayReward(item)}</strong>
      </div>
      <div class="bounty-meta">
        <span class="pill">${escapeHtml(item.orgName || 'Workspace')}</span>
        <span class="pill">Owner ${escapeHtml(item.ownerHandle)}</span>
        <span class="pill">Deadline ${formatDate(item.deadline)}</span>
        <span class="pill">Rules ${item.requirements.length}</span>
        <span class="pill ${payoutClass(item.payoutStatus)}">${escapeHtml(item.payoutStatus || 'In escrow')}</span>
      </div>
      <div class="card-actions">
        <button class="ghost-button" type="button" data-route="detail" data-bounty-id="${escapeHtml(item.bountyId)}">Open bounty</button>
        <button class="ghost-button" type="button" data-route="result" data-bounty-id="${escapeHtml(item.bountyId)}">See result</button>
      </div>
    </article>
  `;
}

function renderCreateView(state, uiState) {
  const drafts = Array.isArray(uiState.requirementDrafts) && uiState.requirementDrafts.length ? uiState.requirementDrafts : [createDraft(), createDraft({ type: 'text_contains', params: defaultParamsForType('text_contains') })];
  const activeOrg = state.auth?.activeOrg;
  const defaultChainId = state.xlayerDeployment?.chainId || getDefaultXLayerNetwork().chainId;
  const defaultRewardTokenAddress = getDefaultXLayerTokenAddress('USDC', defaultChainId);

  return `
    <section class="screen-grid screen-split">
      <div class="screen-copy panel-dark screen-copy-hero">
        <div class="hero-kicker-row">
          <span class="badge badge-dark">Create bounty</span>
          <span class="badge">Typed rules</span>
          <span class="badge">Immutable escrow</span>
        </div>
        <h2>Build a locked checklist, not a loose brief.</h2>
        <p>Use typed requirements so the verifier can stay deterministic and the payout path stays auditable.</p>
        <div class="auth-chip">
          <span class="mini-label">Active workspace</span>
          <strong>${escapeHtml(activeOrg?.name || 'Demo workspace')}</strong>
          <span class="muted">${escapeHtml(activeOrg?.slug || 'No org selected')}</span>
        </div>
        <div class="template-box">
          <span class="mini-label">Supported requirements</span>
          <div class="template-pills">
            ${supportedRequirementTypes.map((type) => `<span class="pill">${type}</span>`).join('')}
          </div>
        </div>
        <div class="template-box subtle-box">
          <span class="mini-label">Build notes</span>
          <p class="muted">Each row becomes part of the audit trail, so the brief stays strict from draft to payout.</p>
        </div>
      </div>

      <form class="panel-dark glass-form" data-form="create-bounty">
        <div class="field-grid">
          <label class="field">
            <span>Bounty title</span>
            <input name="title" value="Create a launch thread about X Layer" />
          </label>
          <label class="field">
            <span>Reward amount</span>
            <input name="rewardAmount" type="number" min="1" value="50" />
          </label>
          <label class="field">
            <span>Token</span>
            <input name="rewardToken" value="USDC" />
          </label>
          <label class="field">
            <span>Token contract address</span>
            <input name="rewardTokenAddress" placeholder="0x..." value="${escapeHtml(defaultRewardTokenAddress)}" />
          </label>
          <label class="field">
            <span>Participants</span>
            <input name="participantCount" type="number" min="1" value="30" />
          </label>
          <label class="field">
            <span>Deadline</span>
            <input name="deadline" value="2026-08-20T23:59:00Z" />
          </label>
          <label class="field">
            <span>Poster handle</span>
            <input name="ownerHandle" value="${escapeHtml(state.currentPosterHandle || '@okx')}" />
          </label>
          <label class="field full">
            <span>Requirement summary</span>
            <input name="requirementSummary" value="URL, tags, deadline, length, account" />
          </label>
        </div>
        ${defaultRewardTokenAddress ? '' : '<div class="template-box subtle-box"><span class="mini-label">Testnet note</span><p class="muted">X Layer testnet does not publish an official USDC contract address in the docs, so this field stays blank until you supply a token address.</p></div>'}
        <div class="template-box subtle-box">
          <span class="mini-label">Funding note</span>
          <p class="muted">Reward amount is the total escrow pot. If 30 participants split $1,000, the average payout is about $33.33 each.</p>
        </div>

        <div class="builder-head">
          <div>
            <span class="mini-label">Requirement builder</span>
            <p>Each row is structured and independently checkable. Add or remove rows as needed.</p>
          </div>
          <button class="ghost-button" type="button" data-draft-add>Add requirement</button>
        </div>

        <div class="builder-list">
          ${drafts
            .map(
              (draft, index) => `
                <article class="builder-row" data-draft-row>
                  <div class="builder-row-head">
                    <strong>Requirement ${index + 1}</strong>
                    <button class="ghost-button" type="button" data-draft-remove="${index}">Remove</button>
                  </div>
                  <div class="field-grid">
                    <label class="field">
                      <span>ID</span>
                      <input data-draft-id value="${escapeHtml(draft.id || `req_${index + 1}`)}" />
                    </label>
                    <label class="field">
                      <span>Type</span>
                      <select data-draft-type>
                        ${supportedRequirementTypes
                          .map((type) => `<option value="${type}" ${type === draft.type ? 'selected' : ''}>${type}</option>`)
                          .join('')}
                      </select>
                    </label>
                    <label class="field full">
                      <span>Description</span>
                      <input data-draft-description value="${escapeHtml(draft.description || '')}" placeholder="What should the verifier check?" />
                    </label>
                    <label class="field full">
                      <span>Params JSON</span>
                      <textarea data-draft-params rows="5">${escapeHtml(JSON.stringify(draft.params || defaultParamsForType(draft.type), null, 2))}</textarea>
                    </label>
                  </div>
                </article>
              `
            )
            .join('')}
        </div>

        <div class="form-actions">
          <button type="submit" class="primary-action">Create bounty</button>
          <button type="button" class="secondary-action" data-route="dashboard">Back to list</button>
        </div>
      </form>
    </section>
  `;
}

function renderDetailView(state, bounty, uiState) {
  if (!bounty) {
    return emptyState('No bounty selected', 'Pick a bounty from the dashboard first.');
  }

  const submissions = (state.submissions || [])
    .filter((submission) => submission.bountyId === bounty.bountyId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const verifications = (state.verifications || [])
    .filter((verification) => verification.bountyId === bounty.bountyId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const disputes = (state.disputeSummaries || [])
    .filter((dispute) => dispute.bountyId === bounty.bountyId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const timeline = buildBountyTimeline(submissions, verifications);
  const editDrafts = Array.isArray(uiState.detailDrafts) && uiState.detailDrafts.length
    ? uiState.detailDrafts
    : bounty.requirements.map((requirement, index) => ({
        id: requirement.id || `req_${index + 1}`,
        type: requirement.type || 'url_exists',
        description: requirement.description || '',
        params: JSON.stringify(requirement.params || defaultParamsForType(requirement.type), null, 2)
      }));
  const isEditMode = uiState.detailMode === 'edit';
  const defaultRewardTokenAddress = bounty.rewardTokenAddress || getDefaultXLayerTokenAddress(bounty.rewardToken || 'USDC', bounty.chainId || getDefaultXLayerNetwork().chainId);

  return `
    <section class="screen-grid screen-split">
      <article class="panel-dark detail-panel detail-hero">
        <div class="section-head compact">
          <div>
            <div class="hero-kicker-row">
              <span class="badge badge-dark">Bounty detail</span>
              <span class="badge">Lifecycle</span>
              <span class="badge">Audit trail</span>
            </div>
            <h2>${escapeHtml(bounty.title)}</h2>
            <p>${escapeHtml(bounty.requirementSummary)}</p>
          </div>
          <div class="detail-toolbar">
            <span class="badge badge-dark">${escapeHtml(bounty.status)}</span>
            <button class="ghost-button" type="button" data-detail-mode="${isEditMode ? 'view' : 'edit'}">${isEditMode ? 'View mode' : 'Edit mode'}</button>
            <button class="ghost-button" type="button" data-delete-bounty="${escapeHtml(bounty.bountyId)}">Delete</button>
          </div>
        </div>
        <div class="stacked-info">
          <div><span>Reward</span><strong>${displayReward(bounty)}</strong></div>
          <div><span>Owner</span><strong>${escapeHtml(bounty.ownerHandle)}</strong></div>
          <div><span>Deadline</span><strong>${formatDate(bounty.deadline)}</strong></div>
          <div><span>Payout</span><strong class="${payoutClass(bounty.payoutStatus)}">${escapeHtml(bounty.payoutStatus || 'In escrow')}</strong></div>
          <div><span>Escrow</span><strong>${escapeHtml(bounty.escrowTxHash || 'Pending')}</strong></div>
          <div><span>Chain</span><strong>${escapeHtml(String(bounty.chainId || 'n/a'))}</strong></div>
          <div><span>Contract</span><strong>${escapeHtml(bounty.contractAddress || 'Pending')}</strong></div>
          <div><span>Treasury</span><strong>${escapeHtml(bounty.treasuryAddress || 'Pending')}</strong></div>
        </div>
        <div class="stacked-info chain-links">
          <div><span>Explorer</span>${renderExplorerLinks(bounty.explorerLinks)}</div>
          <div><span>Contract version</span><strong>${escapeHtml(bounty.contractVersion || XLAYER.contract.version)}</strong></div>
          <div><span>ABI version</span><strong>${escapeHtml(bounty.abiVersion || XLAYER.contract.abiVersion)}</strong></div>
          <div><span>Chain sync</span><strong>${escapeHtml(bounty.chainSyncStatus || 'pending')}</strong></div>
        </div>
        ${renderContractDeploymentPanel(state.xlayerDeployment, bounty)}
        <div class="split-stack">
          <section>
            <div class="section-head compact">
              <div>
                <h3>Requirements</h3>
                <p>Objective checks that drive the payout path.</p>
              </div>
            </div>
            <div class="requirement-list">
              ${bounty.requirements.map((req) => renderRequirement(req)).join('')}
            </div>
          </section>
          <section>
            <div class="section-head compact">
              <div>
                <h3>Lifecycle</h3>
                <p>Submission, verification, and payout events for this bounty.</p>
              </div>
            </div>
            <div class="timeline-list">
              ${timeline.length
                ? timeline
                    .map(
                      (item) => `
                        <div class="timeline-item">
                          <div class="timeline-step ${item.tone || 'neutral'}">${item.kind === 'verification' ? 'V' : 'S'}</div>
                          <div>
                            <strong>${escapeHtml(item.label)}</strong>
                            <p>${escapeHtml(item.detail)}</p>
                            <p class="muted">${formatDate(item.timestamp)}${item.payoutStatus ? ` - ${escapeHtml(item.payoutStatus)}` : ''}</p>
                          </div>
                        </div>
                      `
                    )
                    .join('')
                : '<p class="muted">No activity yet.</p>'}
            </div>
          </section>
          <section>
            <div class="section-head compact">
              <div>
                <h3>Disputes</h3>
                <p>Appeals and reviewer decisions attached to this bounty.</p>
              </div>
            </div>
            <div class="timeline-list">
              ${disputes.length
                ? disputes
                    .map(
                      (dispute) => `
                        <div class="timeline-item">
                          <div class="timeline-step ${dispute.status === 'resolved' ? 'good' : 'warn'}">D</div>
                          <div>
                            <strong>${escapeHtml(dispute.disputeId)}</strong>
                            <p>${escapeHtml(dispute.reason || 'No reason provided')}</p>
                            <p class="muted">
                              ${escapeHtml(dispute.status)}${dispute.resolutionOutcome ? ` - ${escapeHtml(dispute.resolutionOutcome)}` : ''}
                            </p>
                            <p class="muted">${formatDate(dispute.createdAt)}${dispute.assignedReviewerHandle ? ` - Reviewer ${escapeHtml(dispute.assignedReviewerHandle)}` : ''}</p>
                          </div>
                        </div>
                      `
                    )
                    .join('')
                : '<p class="muted">No disputes opened for this bounty.</p>'}
            </div>
          </section>
          <section>
            <div class="section-head compact">
              <div>
                <h3>Audit trail</h3>
                <p>Immutable event log for bounty, dispute, and admin actions.</p>
              </div>
            </div>
            <div class="timeline-list">
              ${(state.auditLogSummaries || [])
                .filter((log) => log.bountyId === bounty.bountyId)
                .slice(0, 6)
                .map(
                  (log) => `
                    <div class="timeline-item">
                      <div class="timeline-step ${log.severity === 'warn' ? 'warn' : 'neutral'}">A</div>
                      <div>
                        <strong>${escapeHtml(log.action)}</strong>
                        <p>${escapeHtml(log.summary || '')}</p>
                        <p class="muted">${formatDate(log.createdAt)}${log.actorHandle ? ` - ${escapeHtml(log.actorHandle)}` : ''}</p>
                      </div>
                    </div>
                  `
                )
                .join('') || '<p class="muted">No audit events yet.</p>'}
            </div>
          </section>
          <section>
            <div class="section-head compact">
              <div>
                <h3>Version history</h3>
                <p>Each edit creates a new immutable bounty version.</p>
              </div>
            </div>
            <div class="timeline-list">
              ${(state.bountyVersionSummaries || [])
                .filter((version) => version.bountyId === bounty.bountyId)
                .slice(0, 6)
                .map(
                  (version) => `
                    <div class="timeline-item">
                      <div class="timeline-step neutral">V</div>
                      <div>
                        <strong>Version ${escapeHtml(String(version.versionNumber || '1'))}</strong>
                        <p>${escapeHtml(version.action || 'updated')}</p>
                        <p class="muted">${formatDate(version.createdAt)}${version.actorHandle ? ` - ${escapeHtml(version.actorHandle)}` : ''}</p>
                      </div>
                    </div>
                  `
                )
                .join('') || '<p class="muted">No version history yet.</p>'}
            </div>
          </section>
        </div>
      </article>

      <div class="detail-stack">
        <form class="panel-dark glass-form" data-form="edit-bounty" style="${isEditMode ? '' : 'display:none;'}">
          <div class="section-head compact">
            <div>
              <span class="eyebrow">Edit bounty</span>
              <h2>Adjust the active bounty without recreating it.</h2>
              <p>Changes persist immediately and remain tied to the same on-chain bounty identity.</p>
            </div>
          </div>
          <div class="field-grid">
            <label class="field">
              <span>Title</span>
              <input name="title" value="${escapeHtml(bounty.title)}" />
            </label>
            <label class="field">
              <span>Reward amount</span>
              <input name="rewardAmount" type="number" min="1" value="${Number(bounty.rewardAmount || 0)}" />
            </label>
            <label class="field">
              <span>Token</span>
              <input name="rewardToken" value="${escapeHtml(bounty.rewardToken || 'USDC')}" />
            </label>
            <label class="field">
              <span>Token contract address</span>
              <input name="rewardTokenAddress" value="${escapeHtml(defaultRewardTokenAddress || '')}" />
            </label>
            <label class="field">
              <span>Participants</span>
              <input name="participantCount" type="number" min="1" value="${Number(bounty.participantCount || 0)}" />
            </label>
            <label class="field">
              <span>Deadline</span>
              <input name="deadline" value="${escapeHtml(bounty.deadline)}" />
            </label>
            <label class="field">
              <span>Poster handle</span>
              <input name="ownerHandle" value="${escapeHtml(bounty.ownerHandle)}" />
            </label>
            <label class="field">
              <span>Status</span>
              <select name="status">
                ${['Open', 'Funded', 'Verified', 'Paid']
                  .map((status) => `<option value="${status}" ${status === bounty.status ? 'selected' : ''}>${status}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="field full">
              <span>Requirement summary</span>
              <input name="requirementSummary" value="${escapeHtml(bounty.requirementSummary)}" />
            </label>
            <label class="field full">
              <span>Escrow tx hash</span>
              <input name="escrowTxHash" value="${escapeHtml(bounty.escrowTxHash || '')}" />
            </label>
          </div>

          <div class="builder-head">
            <div>
              <span class="mini-label">Requirement editor</span>
              <p>Update typed checks in place. The edit draft always starts from the stored bounty requirements.</p>
            </div>
            <button class="ghost-button" type="button" data-edit-add>Add requirement</button>
          </div>

          <div class="builder-list">
            ${editDrafts
              .map(
                (draft, index) => `
                  <article class="builder-row" data-edit-row>
                    <div class="builder-row-head">
                      <strong>Requirement ${index + 1}</strong>
                      <button class="ghost-button" type="button" data-edit-remove="${index}">Remove</button>
                    </div>
                    <div class="field-grid">
                      <label class="field">
                        <span>ID</span>
                        <input data-edit-id value="${escapeHtml(draft.id)}" />
                      </label>
                      <label class="field">
                        <span>Type</span>
                        <select data-edit-type>
                          ${supportedRequirementTypes.map((type) => `<option value="${type}" ${type === draft.type ? 'selected' : ''}>${type}</option>`).join('')}
                        </select>
                      </label>
                      <label class="field full">
                        <span>Description</span>
                        <input data-edit-description value="${escapeHtml(draft.description)}" />
                      </label>
                      <label class="field full">
                        <span>Params JSON</span>
                        <textarea data-edit-params rows="5">${escapeHtml(draft.params)}</textarea>
                      </label>
                    </div>
                  </article>
                `
              )
              .join('')}
          </div>

          <div class="form-actions">
            <button type="submit" class="primary-action">Save changes</button>
            <button type="button" class="secondary-action" data-detail-mode="view">Cancel edit</button>
          </div>
        </form>

        <form class="panel-dark glass-form" data-form="sync-chain" style="${isEditMode ? 'display:none;' : ''}">
          <div class="section-head compact">
            <div>
              <span class="eyebrow">Chain sync</span>
              <h2>Keep treasury and contract metadata pinned</h2>
              <p>Track the contract version, ABI version, treasury signers, and on-chain transaction status.</p>
            </div>
          </div>
          <div class="field-grid">
            <label class="field">
              <span>Chain ID</span>
              <input name="chainId" type="number" value="${Number(bounty.chainId || getDefaultXLayerNetwork().chainId)}" />
            </label>
            <label class="field">
              <span>Contract address</span>
              <input name="contractAddress" value="${escapeHtml(bounty.contractAddress || '')}" />
            </label>
            <label class="field">
              <span>Contract version</span>
              <input name="contractVersion" value="${escapeHtml(bounty.contractVersion || XLAYER.contract.version)}" />
            </label>
            <label class="field">
              <span>ABI version</span>
              <input name="abiVersion" value="${escapeHtml(bounty.abiVersion || XLAYER.contract.abiVersion)}" />
            </label>
            <label class="field">
              <span>Explorer base URL</span>
              <input name="explorerBaseUrl" value="${escapeHtml(bounty.explorerBaseUrl || getDefaultXLayerNetwork().explorerBaseUrl)}" />
            </label>
            <label class="field">
              <span>Contract verified</span>
              <select name="contractVerified">
                ${[
                  ['true', 'Verified'],
                  ['false', 'Unverified']
                ]
                  .map(([value, label]) => `<option value="${value}" ${String(Boolean(bounty.contractVerified)) === value ? 'selected' : ''}>${label}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="field">
              <span>Treasury type</span>
              <input name="treasuryType" value="${escapeHtml(bounty.treasuryType || 'multisig')}" />
            </label>
            <label class="field">
              <span>Treasury address</span>
              <input name="treasuryAddress" value="${escapeHtml(bounty.treasuryAddress || '')}" />
            </label>
            <label class="field">
              <span>Treasury threshold</span>
              <input name="treasuryThreshold" type="number" min="1" value="${Number(bounty.treasuryThreshold || 2)}" />
            </label>
            <label class="field full">
              <span>Treasury signers</span>
              <textarea name="treasurySigners" rows="3" placeholder="One signer per line">${escapeHtml((bounty.treasurySigners || []).join('\n'))}</textarea>
            </label>
            <label class="field">
              <span>Funding tx</span>
              <input name="fundingTxHash" value="${escapeHtml(bounty.fundingTxHash || '')}" />
            </label>
            <label class="field">
              <span>Payout tx</span>
              <input name="payoutTxHash" value="${escapeHtml(bounty.payoutTxHash || '')}" />
            </label>
            <label class="field">
              <span>Refund tx</span>
              <input name="refundTxHash" value="${escapeHtml(bounty.refundTxHash || '')}" />
            </label>
            <label class="field">
              <span>On-chain status</span>
              <input name="onChainStatus" value="${escapeHtml(bounty.onChainStatus || 'draft')}" />
            </label>
            <label class="field">
              <span>Chain sync status</span>
              <input name="chainSyncStatus" value="${escapeHtml(bounty.chainSyncStatus || 'pending')}" />
            </label>
            <label class="field">
              <span>Last synced at</span>
              <input name="lastChainSyncedAt" value="${escapeHtml(bounty.lastChainSyncedAt || new Date().toISOString())}" />
            </label>
          </div>
          <div class="form-actions">
            <button type="submit" class="primary-action">Sync chain state</button>
          </div>
        </form>

        <form class="panel-dark glass-form" data-form="submit-and-verify" style="${isEditMode ? 'display:none;' : ''}">
          <div class="section-head compact">
            <div>
              <span class="eyebrow">Submit evidence</span>
              <h2>Wire a live proof submission into verification.</h2>
              <p>Wallet connection is required to participate in a contest. Submit the URL, the content snapshot, and the contributor handle that should be matched.</p>
            </div>
          </div>
          <div class="field-grid">
            <label class="field full">
              <span>Evidence URL</span>
              <input name="url" value="${escapeHtml(submissions[0]?.url || 'https://x.com/submitter/status/1842100000000000000')}" />
            </label>
            <label class="field">
              <span>Contributor handle</span>
              <input name="contributorHandle" value="${escapeHtml(state.currentContributorHandle || '@submitter_handle')}" />
            </label>
            <label class="field">
              <span>Submitted at</span>
              <input name="submittedAt" value="${escapeHtml(submissions[0]?.submittedAt || new Date().toISOString())}" />
            </label>
            <label class="field">
              <span>Tweet count</span>
              <input name="tweetCount" type="number" min="1" value="${submissions[0]?.tweetCount || 5}" />
            </label>
            <label class="field full">
              <span>Evidence content</span>
              <textarea name="content" rows="12">${escapeHtml(submissions[0]?.content || 'Paste the proof content here.')}</textarea>
            </label>
            <label class="field full">
              <span>Screenshot URLs</span>
              <textarea name="screenshotUrls" rows="3" placeholder="One screenshot URL per line">${escapeHtml((submissions[0]?.screenshotUrls || []).join('\n'))}</textarea>
            </label>
            <label class="field full">
              <span>Page snapshots</span>
              <textarea name="pageSnapshots" rows="4" placeholder="One snapshot per line or JSON list">${escapeHtml((submissions[0]?.pageSnapshots || []).join('\n'))}</textarea>
            </label>
            <label class="field full">
              <span>Evidence metadata</span>
              <textarea name="evidenceMetadata" rows="4" placeholder='{"source":"browser","author":"@submitter"}'>${escapeHtml(JSON.stringify(submissions[0]?.evidenceMetadata || {}, null, 2))}</textarea>
            </label>
          </div>
          <div class="form-actions">
            <button type="submit" class="primary-action">Submit and verify</button>
            <button type="button" class="secondary-action" data-route="result" data-bounty-id="${escapeHtml(bounty.bountyId)}">Open result view</button>
          </div>
          <input type="hidden" name="bountyId" value="${escapeHtml(bounty.bountyId)}" />
          <div class="result-preview">
            <span class="mini-label">Latest verification</span>
            ${bounty.latestVerification
              ? `<strong class="${bounty.latestVerification.overallPass ? 'status-good' : 'status-bad'}">${bounty.latestVerification.overallPass ? 'Pass' : 'Fail'}</strong>`
              : '<strong>Pending</strong>'}
          </div>
        </form>

        <form class="panel-dark glass-form" data-form="create-dispute" style="${isEditMode ? 'display:none;' : ''}">
          <div class="section-head compact">
            <div>
              <span class="eyebrow">Open dispute</span>
              <h2>Appeal the latest result</h2>
              <p>Route the case to a reviewer with deadlines and resolution notes.</p>
            </div>
          </div>
          <div class="field-grid">
            <label class="field full">
              <span>Reason</span>
              <textarea name="reason" rows="4" placeholder="Explain why this result should be reviewed."></textarea>
            </label>
            <label class="field full">
              <span>Evidence URL</span>
              <input name="evidenceUrl" value="${escapeHtml(submissions[0]?.url || '')}" />
            </label>
            <label class="field">
              <span>Submission</span>
              <input name="submissionId" value="${escapeHtml(submissions[0]?.submissionId || '')}" />
            </label>
            <label class="field">
              <span>Verification</span>
              <input name="verificationId" value="${escapeHtml(verifications[0]?.verificationId || '')}" />
            </label>
            <label class="field">
              <span>Review deadline</span>
              <input name="deadlineAt" value="${escapeHtml(new Date(Date.now() + 1000 * 60 * 60 * 72).toISOString())}" />
            </label>
          </div>
          <input type="hidden" name="bountyId" value="${escapeHtml(bounty.bountyId)}" />
          <div class="form-actions">
            <button type="submit" class="primary-action">Open dispute</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderContractDeploymentPanel(deployment, bounty) {
  const manifest = deployment?.manifest || null;
  const status = deployment?.status || {};
  const links = deployment?.links || {};
  const sourceMatches = Boolean(manifest?.sourceFile && deployment?.sourceFileExists);
  const abiMatches = Boolean(manifest?.abiFile && deployment?.abiFileExists);
  const addressMatches = Boolean(manifest?.contractAddress && bounty?.contractAddress && manifest.contractAddress === bounty.contractAddress);
  const chainMatches = Boolean(Number(manifest?.chainId || 0) && Number(manifest?.chainId || 0) === Number(bounty?.chainId || 0));
  const readiness = status.verifiedArtifactsReady
    ? 'Ready for verified ABI/source lookup'
    : status.contractVerified
      ? 'Manifest loaded, waiting on artifacts'
      : 'Manifest loaded, contract not yet verified';

  return `
    <article class="panel-dark detail-panel">
      <div class="section-head compact">
        <div>
          <span class="eyebrow">Contract deployment</span>
          <h3>Live X Layer deployment manifest</h3>
          <p>This panel reads the deployment manifest from the server and checks ABI/source readiness.</p>
        </div>
        <span class="badge badge-dark">${escapeHtml(status.verification || 'unknown')}</span>
      </div>
      <div class="stacked-info">
        <div><span>Manifest</span><strong>${escapeHtml(manifest?.manifestPath || 'deploy/xlayer/BountyProofTreasury.manifest.example.json')}</strong></div>
        <div><span>Network</span><strong>${escapeHtml(`${manifest?.network || 'testnet'} · ${manifest?.chainShortName || 'XLAYER'}`)}</strong></div>
        <div><span>Chain ID</span><strong>${escapeHtml(String(manifest?.chainId || bounty?.chainId || 'n/a'))}</strong></div>
        <div><span>Contract</span><strong>${escapeHtml(manifest?.contractName || XLAYER.contract.name)}</strong></div>
        <div><span>Address</span><strong>${escapeHtml(manifest?.contractAddress || bounty?.contractAddress || 'Pending')}</strong></div>
        <div><span>Deployment tx</span><strong>${escapeHtml(manifest?.deploymentTxHash || 'Pending')}</strong></div>
      </div>
      <div class="stacked-info chain-links">
        <div><span>ABI status</span><strong class="${abiMatches ? 'status-good' : 'status-bad'}">${abiMatches ? 'Available' : 'Missing'}</strong></div>
        <div><span>Source status</span><strong class="${sourceMatches ? 'status-good' : 'status-bad'}">${sourceMatches ? 'Available' : 'Missing'}</strong></div>
        <div><span>Address match</span><strong class="${addressMatches ? 'status-good' : 'status-bad'}">${addressMatches ? 'Matches bounty' : 'Not matched yet'}</strong></div>
        <div><span>Chain match</span><strong class="${chainMatches ? 'status-good' : 'status-bad'}">${chainMatches ? 'Matches bounty' : 'Not matched yet'}</strong></div>
      </div>
      <div class="result-summary">
        <div>
          <span class="mini-label">Verified contract info</span>
          <strong>${links.verifiedContractInfo ? `<a href="${escapeHtml(links.verifiedContractInfo)}" target="_blank" rel="noreferrer">Open lookup</a>` : 'Unavailable'}</strong>
        </div>
        <div>
          <span class="mini-label">Verify source endpoint</span>
          <strong>${links.verifySourceCode ? `<a href="${escapeHtml(links.verifySourceCode)}" target="_blank" rel="noreferrer">Open endpoint</a>` : 'Unavailable'}</strong>
        </div>
        <div>
          <span class="mini-label">Verification result endpoint</span>
          <strong>${links.contractVerification ? `<a href="${escapeHtml(links.contractVerification)}" target="_blank" rel="noreferrer">Open endpoint</a>` : 'Unavailable'}</strong>
        </div>
        <div>
          <span class="mini-label">Readiness</span>
          <strong class="${status.verifiedArtifactsReady ? 'status-good' : 'status-open'}">${escapeHtml(readiness)}</strong>
        </div>
      </div>
      <p class="muted">Manifest fetched at ${escapeHtml(deployment?.fetchedAt || 'not yet loaded')}. ABI and source are treated as ready only when the manifest is present and both artifacts are available locally.</p>
    </article>
  `;
}

function renderResultView(state, bounty, verification) {
  if (!bounty) {
    return emptyState('No bounty selected', 'Pick a bounty to see the verification result.');
  }

  if (!verification) {
    return emptyState('No verification yet', 'Submit evidence from the detail screen to generate a result.');
  }

  return `
    <section class="screen-grid result-grid">
      <article class="panel-dark result-hero ${verification.overallPass ? 'good' : 'bad'}">
        <div class="section-head compact">
          <div>
            <span class="eyebrow">Verification result</span>
            <h2>${verification.overallPass ? 'Funds are ready for release.' : 'Funds remain locked.'}</h2>
            <p>${escapeHtml(bounty.title)} - ${escapeHtml(bounty.bountyId)}</p>
          </div>
          <span class="badge badge-dark">${verification.overallPass ? 'Pass' : 'Fail'}</span>
        </div>
        <div class="result-summary">
          <div>
            <span class="mini-label">Submission</span>
            <strong>${escapeHtml(verification.submissionId)}</strong>
          </div>
          <div>
            <span class="mini-label">Hash</span>
            <strong>${escapeHtml(verification.verdictHash)}</strong>
          </div>
          <div>
            <span class="mini-label">Proof hash</span>
            <strong>${escapeHtml(verification.chainProofHash || 'Pending')}</strong>
          </div>
          <div>
            <span class="mini-label">Chain writeback</span>
            <strong>${escapeHtml(verification.chainProofTxHash || 'Pending')}</strong>
          </div>
          <div>
            <span class="mini-label">Recorded</span>
            <strong>${formatDate(verification.createdAt)}</strong>
          </div>
          <div>
            <span class="mini-label">Payout</span>
            <strong class="${verification.overallPass ? 'status-open' : 'status-bad'}">${verification.overallPass ? 'Ready to release' : 'Locked'}</strong>
          </div>
        </div>
        <div class="form-actions">
          ${verification.overallPass
            ? `<button class="primary-action" type="button" data-release-bounty="${escapeHtml(bounty.bountyId)}">Release escrow</button>`
            : `<button class="secondary-action" type="button" data-refund-bounty="${escapeHtml(bounty.bountyId)}">Refund escrow</button>`}
          <button class="secondary-action" type="button" data-route="detail" data-bounty-id="${escapeHtml(bounty.bountyId)}">Back to detail</button>
        </div>
      </article>

      <article class="panel-dark detail-panel">
        <div class="section-head compact">
          <div>
            <h3>Extracted evidence</h3>
            <p>What the verifier extracted from the submission before scoring it.</p>
          </div>
        </div>
        <div class="result-proof-grid">
          <div>
            <span class="mini-label">Submission URL</span>
            <strong>${escapeHtml(verification.evidenceBundle?.submissionUrl || bounty.sourceUrl || 'Not provided')}</strong>
          </div>
          <div>
            <span class="mini-label">Captured at</span>
            <strong>${formatDate(verification.evidenceBundle?.submittedAt || verification.createdAt)}</strong>
          </div>
          <div>
            <span class="mini-label">Screenshots</span>
            <strong>${escapeHtml(String(verification.evidenceSummary?.screenshotCount || verification.evidenceBundle?.screenshots?.length || 0))}</strong>
          </div>
          <div>
            <span class="mini-label">Page snapshots</span>
            <strong>${escapeHtml(String(verification.evidenceSummary?.pageSnapshotCount || verification.evidenceBundle?.pageSnapshots?.length || 0))}</strong>
          </div>
          <div>
            <span class="mini-label">Metadata keys</span>
            <strong>${escapeHtml(String(verification.evidenceSummary?.metadataKeys?.length || verification.evidenceBundle?.metadataKeys?.length || 0))}</strong>
          </div>
          <div>
            <span class="mini-label">Content hash</span>
            <strong>${escapeHtml(verification.evidenceSummary?.contentHash || 'Unavailable')}</strong>
          </div>
        </div>
        <div class="result-artifact-grid">
          <div>
            <h4>Screenshots</h4>
            <div class="record-list">
              ${(verification.evidenceBundle?.screenshots || []).length
                ? verification.evidenceBundle.screenshots.map((item) => `<div class="record-card"><div><strong>${escapeHtml(item)}</strong><p class="muted">Captured proof image</p></div></div>`).join('')
                : '<p class="muted">No screenshots were attached.</p>'}
            </div>
          </div>
          <div>
            <h4>Page snapshots</h4>
            <div class="record-list">
              ${(verification.evidenceBundle?.pageSnapshots || []).length
                ? verification.evidenceBundle.pageSnapshots.map((item) => `<div class="record-card"><div><strong>${escapeHtml(item)}</strong><p class="muted">Stored page snapshot</p></div></div>`).join('')
                : '<p class="muted">No page snapshots were attached.</p>'}
            </div>
          </div>
        </div>
        <pre><code>${escapeHtml(JSON.stringify(verification.evidenceBundle || verification.evidenceSummary || {}, null, 2))}</code></pre>
      </article>

      <article class="panel-dark detail-panel">
        <div class="section-head compact">
          <div>
          <h3>AI explanation</h3>
            <p>Structured explanation for the verdict, confidence, and evidence bundle.</p>
          </div>
          <span class="badge badge-dark">${escapeHtml(String(Math.round((verification.confidenceScore || 0) * 100)))}% confidence</span>
        </div>
        <div class="stacked-info">
          <div><span>Model</span><strong>${escapeHtml(verification.aiVerdict?.model || 'bounded-verifier-v1')}</strong></div>
          <div><span>Mode</span><strong>${escapeHtml(verification.aiVerdict?.mode || 'hybrid')}</strong></div>
          <div><span>Outcome</span><strong>${escapeHtml(verification.aiVerdict?.conclusion || (verification.overallPass ? 'pass' : 'fail'))}</strong></div>
          <div><span>Requirements</span><strong>${escapeHtml(String(verification.aiVerdict?.summary?.totalRequirements || verification.results.length))}</strong></div>
        </div>
        <p class="muted">${escapeHtml(verification.reasoningSummary || verification.aiVerdict?.explanation || '')}</p>
        <div class="record-list">
          ${(verification.aiVerdict?.requirementFindings || verification.reasoningTrail || [])
            .map((finding) => `
              <div class="record-card">
                <div>
                  <strong>${escapeHtml(finding.label || finding.requirementId || 'Requirement')}</strong>
                  <p>${escapeHtml(finding.reason || '')}</p>
                  <p class="muted">${escapeHtml(finding.type || '')} - ${escapeHtml(String(Math.round((finding.confidence || 0) * 100)))}% confidence</p>
                  ${Array.isArray(finding.evidence?.notes) ? `<p class="muted">${escapeHtml(finding.evidence.notes.join(' • '))}</p>` : ''}
                </div>
                <span class="${finding.pass ? 'status-good' : 'status-bad'}">${finding.pass ? 'Pass' : 'Fail'}</span>
              </div>
            `)
            .join('')}
        </div>
      </article>

      <div class="split-grid">
        <article class="panel-dark detail-panel">
          <h3>Deterministic checks</h3>
          <div class="requirement-list">
            ${verification.results
              .map(
                (result) => `
                  <div class="requirement-result ${result.pass ? 'pass' : 'fail'}">
                    <div>
                      <strong>${escapeHtml(result.req_id)}</strong>
                      <p>${escapeHtml(result.reason)}</p>
                    </div>
                    <span>${result.pass ? 'Pass' : 'Fail'}</span>
                  </div>
                `
              )
              .join('')}
          </div>
        </article>

        <article class="panel-dark detail-panel">
          <div class="section-head compact">
            <div>
              <h3>Final verdict and payout action</h3>
              <p>The release or refund decision recorded with proof hashes and chain writeback status.</p>
            </div>
          </div>
          <div class="stacked-info">
            <div><span>Verdict</span><strong class="${verification.overallPass ? 'status-good' : 'status-bad'}">${verification.overallPass ? 'Release approved' : 'Release blocked'}</strong></div>
            <div><span>Payout</span><strong>${escapeHtml(bounty.payoutStatus || (verification.overallPass ? 'Ready to release' : 'Locked'))}</strong></div>
            <div><span>Proof hash</span><strong>${escapeHtml(verification.chainProofHash || 'Pending')}</strong></div>
            <div><span>Writeback</span><strong>${escapeHtml(verification.chainProofTxHash || 'Pending')}</strong></div>
          </div>
          <div class="form-actions">
            ${verification.overallPass
              ? `<button class="primary-action" type="button" data-release-bounty="${escapeHtml(bounty.bountyId)}">Release escrow</button>`
              : `<button class="secondary-action" type="button" data-refund-bounty="${escapeHtml(bounty.bountyId)}">Refund escrow</button>`}
            <button class="secondary-action" type="button" data-route="detail" data-bounty-id="${escapeHtml(bounty.bountyId)}">Back to detail</button>
          </div>
        </article>
      </div>

      <article class="panel-dark detail-panel">
        <h3>Evidence quality</h3>
        <div class="stacked-info">
          <div><span>Score</span><strong>${escapeHtml(String(verification.evidenceQualityScore || 0))}/100</strong></div>
          <div><span>Screenshots</span><strong>${escapeHtml(String(verification.evidenceSummary?.screenshotCount || 0))}</strong></div>
          <div><span>Page snapshots</span><strong>${escapeHtml(String(verification.evidenceSummary?.pageSnapshotCount || 0))}</strong></div>
          <div><span>Metadata keys</span><strong>${escapeHtml(String(verification.evidenceSummary?.metadataKeys?.length || 0))}</strong></div>
        </div>
        <pre><code>${escapeHtml(JSON.stringify(verification.evidenceSummary || {}, null, 2))}</code></pre>
      </article>

      <article class="panel-dark detail-panel">
        <div class="section-head compact">
          <div>
            <h3>Verification history</h3>
            <p>All recorded attempts for this bounty, most recent first.</p>
          </div>
        </div>
        <div class="timeline-list">
          ${(state.verifications || [])
            .filter((item) => item.bountyId === bounty.bountyId)
            .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
            .map(
              (item) => `
                <div class="timeline-item">
                  <div class="timeline-step ${item.overallPass ? 'good' : 'bad'}">V</div>
                  <div>
                    <strong>${escapeHtml(item.verificationId)}</strong>
                    <p>${escapeHtml(item.overallPass ? 'Pass' : 'Fail')} - ${escapeHtml(item.submissionId)}</p>
                    <p class="muted">${formatDate(item.createdAt)} - ${escapeHtml(item.verdictHash)}</p>
                  </div>
                  <button class="ghost-button" type="button" data-route="detail" data-bounty-id="${escapeHtml(bounty.bountyId)}">Open detail</button>
                </div>
              `
            )
            .join('')}
        </div>
      </article>
    </section>
  `;
}

function renderMineView(state, uiState) {
  const posterHandle = state.auth?.user?.handle || state.currentPosterHandle;
  const contributorHandle = state.auth?.user?.handle || state.currentContributorHandle;
  const owned = (state.bountySummaries || []).filter((bounty) => bounty.ownerHandle === posterHandle);
  const submitted = (state.submissions || []).filter((submission) => submission.contributorHandle === contributorHandle);

  return `
    <section class="screen-grid screen-split">
      <article class="panel-dark detail-panel">
        <span class="eyebrow">My bounties</span>
        <h2>Poster workspace</h2>
        <div class="record-list">
          ${owned
            .map(
              (bounty) => `
                <div class="record-card">
                  <div>
                    <strong>${escapeHtml(bounty.title)}</strong>
                    <p>${escapeHtml(bounty.status)} - ${displayReward(bounty)}</p>
                    <p class="muted">Payout: ${escapeHtml(bounty.payoutStatus || 'In escrow')}</p>
                  </div>
                  <button class="ghost-button" type="button" data-route="detail" data-bounty-id="${escapeHtml(bounty.bountyId)}">Open</button>
                </div>
              `
            )
            .join('')}
        </div>
      </article>

      <article class="panel-dark detail-panel">
        <span class="eyebrow">My submissions</span>
        <h2>Contributor workspace</h2>
        <div class="record-list">
          ${submitted
            .map(
              (submission) => `
                <div class="record-card">
                  <div>
                    <strong>${escapeHtml(submission.submissionId)}</strong>
                    <p>${escapeHtml(submission.url)}</p>
                  </div>
                  <button class="ghost-button" type="button" data-route="result" data-bounty-id="${escapeHtml(submission.bountyId)}">Review</button>
                </div>
              `
            )
            .join('')}
        </div>
      </article>
    </section>
  `;
}

function renderAccountView(state) {
  const auth = state.auth || {};
  const pendingInvites = auth.invites || [];
  const orgs = auth.availableOrgs?.length ? auth.availableOrgs : state.orgSummaries || [];
  const reviewQueue = state.reviewQueue || [];

  return `
    <section class="screen-grid screen-split">
      <article class="panel-dark detail-panel">
        <span class="eyebrow">Workspace access</span>
        <h2>Identity, organization, and role management</h2>
        <p>Use email or wallet login, switch workspaces, and manage invites from one place.</p>
        <div class="stacked-info">
          <div><span>User</span><strong>${escapeHtml(auth.user?.displayName || 'Not signed in')}</strong></div>
          <div><span>Handle</span><strong>${escapeHtml(auth.user?.handle || 'Demo mode')}</strong></div>
          <div><span>Role</span><strong>${escapeHtml(auth.role || 'owner')}</strong></div>
          <div><span>Active org</span><strong>${escapeHtml(auth.activeOrg?.name || 'Demo workspace')}</strong></div>
          <div><span>Session</span><strong>${escapeHtml(auth.mode || 'demo')}</strong></div>
        </div>

        <div class="section-head compact">
          <div>
            <h3>Accessible workspaces</h3>
            <p>Switch between all orgs the current identity can access.</p>
          </div>
        </div>
        <div class="record-list">
          ${orgs
            .map(
              (org) => `
                <div class="record-card ${org.orgId === auth.activeOrg?.orgId ? 'selected' : ''}">
                  <div>
                    <strong>${escapeHtml(org.name)}</strong>
                    <p>${escapeHtml(org.role || 'member')} - ${org.memberCount || 0} members</p>
                    <p class="muted">${escapeHtml(org.slug || '')}</p>
                  </div>
                  <button class="ghost-button" type="button" data-switch-org="${escapeHtml(org.orgId)}">${org.orgId === auth.activeOrg?.orgId ? 'Active' : 'Switch'}</button>
                </div>
              `
            )
            .join('')}
        </div>

        <div class="section-head compact">
          <div>
            <h3>Pending invites</h3>
            <p>Accept an invite to join a workspace as the role it was issued for.</p>
          </div>
        </div>
        <div class="record-list">
          ${pendingInvites.length
            ? pendingInvites
                .map(
                  (invite) => `
                    <div class="record-card">
                      <div>
                        <strong>${escapeHtml(invite.code)}</strong>
                        <p>${escapeHtml(invite.orgId)} - ${escapeHtml(invite.role)}</p>
                      </div>
                      <form data-form="accept-invite" class="inline-form">
                        <input name="code" type="hidden" value="${escapeHtml(invite.code)}" />
                        <button class="ghost-button" type="submit">Accept</button>
                      </form>
                    </div>
                  `
                )
                .join('')
            : '<p class="muted">No pending invites for the current identity.</p>'}
        </div>

        <div class="section-head compact">
          <div>
            <h3>Reviewer queue</h3>
            <p>Open disputes assigned to this workspace or this reviewer.</p>
          </div>
        </div>
        <div class="record-list">
          ${reviewQueue.length
            ? reviewQueue
                .map(
                  (dispute) => `
                    <div class="record-card">
                      <div>
                        <strong>${escapeHtml(dispute.disputeId)}</strong>
                        <p>${escapeHtml(dispute.bountyTitle || dispute.bountyId)} - ${escapeHtml(dispute.status)}</p>
                        <p class="muted">${escapeHtml(dispute.reason || '')}</p>
                      </div>
                      <form class="inline-form" data-form="resolve-dispute">
                        <input type="hidden" name="disputeId" value="${escapeHtml(dispute.disputeId)}" />
                        <select name="outcome">
                          ${['release', 'refund', 'reverify', 'deny']
                            .map((outcome) => `<option value="${outcome}">${outcome}</option>`)
                            .join('')}
                        </select>
                        <input name="resolutionNotes" placeholder="Reviewer notes" />
                        <button class="ghost-button" type="submit">Resolve</button>
                      </form>
                    </div>
                  `
                )
                .join('')
            : '<p class="muted">No active disputes in the queue.</p>'}
        </div>

        <div class="section-head compact">
          <div>
            <h3>Recent audit events</h3>
            <p>Latest immutable actions across the workspace.</p>
          </div>
        </div>
        <div class="record-list">
          ${(state.auditLogSummaries || [])
            .slice(0, 8)
            .map(
              (log) => `
                <div class="record-card">
                  <div>
                    <strong>${escapeHtml(log.action)}</strong>
                    <p>${escapeHtml(log.summary || '')}</p>
                    <p class="muted">${formatDate(log.createdAt)}${log.actorHandle ? ` - ${escapeHtml(log.actorHandle)}` : ''}</p>
                  </div>
                </div>
              `
            )
            .join('') || '<p class="muted">No audit events yet.</p>'}
        </div>

        <div class="section-head compact">
          <div>
            <h3>Notifications</h3>
            <p>Email, in-app, and webhook events tied to this identity or workspace.</p>
          </div>
        </div>
        <div class="record-list">
          ${(state.notificationSummaries || [])
            .slice(0, 8)
            .map(
              (notification) => `
                <div class="record-card">
                  <div>
                    <strong>${escapeHtml(notification.title || notification.category || 'Notification')}</strong>
                    <p>${escapeHtml(notification.body || '')}</p>
                    <p class="muted">${formatDate(notification.createdAt)}${notification.recipientHandle ? ` - ${escapeHtml(notification.recipientHandle)}` : ''}</p>
                    <p class="muted">${escapeHtml((notification.channels || []).join(', '))}${notification.readAt ? ' - read' : ' - unread'}</p>
                  </div>
                </div>
              `
            )
            .join('') || '<p class="muted">No notifications yet.</p>'}
        </div>
      </article>

      <div class="detail-stack">
        <form class="panel-dark glass-form" data-form="email-login">
          <div class="section-head compact">
            <div>
              <span class="eyebrow">Email auth</span>
              <h2>Create an account, verify it, then sign in</h2>
              <p>Password-based accounts with a one-time verification code before login. The code is shown once during registration in this demo.</p>
            </div>
          </div>
          <div class="field-grid">
            <label class="field full">
              <span>Email</span>
              <input name="email" type="email" placeholder="owner@company.com" />
            </label>
            <label class="field">
              <span>Display name</span>
              <input name="displayName" placeholder="Owner Name" />
            </label>
            <label class="field">
              <span>Handle</span>
              <input name="handle" placeholder="@owner" />
            </label>
            <label class="field">
              <span>Password</span>
              <input name="password" type="password" placeholder="Create a password" />
            </label>
            <label class="field">
              <span>Verification code</span>
              <input name="verificationToken" placeholder="Paste code after registration" />
            </label>
          </div>
          <div class="form-actions">
            <button type="button" class="secondary-action" data-form-action="register">Register</button>
            <button type="button" class="secondary-action" data-form-action="verify">Verify</button>
            <button type="submit" class="primary-action">Login</button>
          </div>
        </form>

        <form class="panel-dark glass-form" data-form="wallet-login">
          <div class="section-head compact">
            <div>
              <span class="eyebrow">Wallet login</span>
              <h2>Sign in with a wallet address</h2>
              <p>This uses a signed challenge. If a wallet extension is available, we can sign automatically.</p>
            </div>
          </div>
          <div class="field-grid">
            <label class="field full">
              <span>Wallet address</span>
              <input name="walletAddress" placeholder="0xabc123..." />
            </label>
            <label class="field">
              <span>Display name</span>
              <input name="displayName" placeholder="Treasury signer" />
            </label>
            <label class="field">
              <span>Handle</span>
              <input name="handle" placeholder="@signer" />
            </label>
            <label class="field full">
              <span>Signature override</span>
              <textarea name="signature" rows="4" placeholder="Optional fallback if the browser cannot access a wallet extension."></textarea>
            </label>
          </div>
          <div class="form-actions">
            <button type="submit" class="primary-action">Connect wallet</button>
            <button type="button" class="secondary-action" data-logout>Logout</button>
          </div>
        </form>

        <form class="panel-dark glass-form" data-form="create-org">
          <div class="section-head compact">
            <div>
              <span class="eyebrow">Create organization</span>
              <h2>Start a new team workspace</h2>
            </div>
          </div>
          <div class="field-grid">
            <label class="field full">
              <span>Workspace name</span>
              <input name="name" placeholder="Acme Bounties" />
            </label>
            <label class="field full">
              <span>Slug</span>
              <input name="slug" placeholder="acme-bounties" />
            </label>
          </div>
          <div class="form-actions">
            <button type="submit" class="primary-action">Create workspace</button>
          </div>
        </form>

        <form class="panel-dark glass-form" data-form="invite-member">
          <div class="section-head compact">
            <div>
              <span class="eyebrow">Invite member</span>
              <h2>Add someone to the active workspace</h2>
            </div>
          </div>
          <div class="field-grid">
            <label class="field full">
              <span>Org ID</span>
              <input name="orgId" value="${escapeHtml(auth.activeOrg?.orgId || '')}" />
            </label>
            <label class="field full">
              <span>Email</span>
              <input name="email" placeholder="reviewer@company.com" />
            </label>
            <label class="field full">
              <span>Wallet address</span>
              <input name="walletAddress" placeholder="0x..." />
            </label>
            <label class="field">
              <span>Handle</span>
              <input name="handle" placeholder="@reviewer" />
            </label>
            <label class="field">
              <span>Role</span>
              <select name="role">
                ${['owner', 'admin', 'poster', 'reviewer', 'contributor']
                  .map((role) => `<option value="${role}">${role}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="field full">
              <span>Expires at</span>
              <input name="expiresAt" value="${escapeHtml(new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString())}" />
            </label>
          </div>
          <div class="form-actions">
            <button type="submit" class="primary-action">Create invite</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

function renderAdminView(state, uiState) {
  const auth = state.auth || {};
  const filters = uiState.adminFilters || { search: '', type: 'all', severity: 'all', status: 'all' };
  const search = String(filters.search || '').trim().toLowerCase();
  const matchText = (value) => !search || String(value || '').toLowerCase().includes(search);
  const bounties = (state.bountySummaries || []).filter((bounty) => {
    const statusMatch = filters.status === 'all' || bounty.status === filters.status;
    return statusMatch && matchText([bounty.title, bounty.ownerHandle, bounty.requirementSummary, bounty.bountyId].join(' '));
  });
  const disputes = (state.disputeSummaries || []).filter((dispute) => {
    const statusMatch = filters.status === 'all' || dispute.status === filters.status;
    return statusMatch && matchText([dispute.disputeId, dispute.reason, dispute.bountyTitle, dispute.bountyId].join(' '));
  });
  const notifications = (state.notificationSummaries || []).filter((notification) => {
    const typeMatch = filters.type === 'all' || notification.category === filters.type;
    return typeMatch && matchText([notification.title, notification.body, notification.recipientHandle, notification.relatedId].join(' '));
  });
  const auditLogs = (state.auditLogSummaries || []).filter((log) => {
    const severityMatch = filters.severity === 'all' || log.severity === filters.severity;
    return severityMatch && matchText([log.action, log.summary, log.actorHandle, log.entityId].join(' '));
  });
  const observability = (state.observabilityEvents || []).filter((event) => matchText([event.kind, event.route, event.message, event.requestId].join(' ')));

  return `
    <section class="screen-grid screen-split">
      <article class="panel-dark detail-panel admin-hero">
        <div class="hero-kicker-row">
          <span class="badge badge-dark">Admin console</span>
          <span class="badge">Moderation</span>
          <span class="badge">Incident response</span>
        </div>
        <h2>Moderation, overrides, refunds, and incident review</h2>
        <p>Search the operational surface area and act on the most urgent records first.</p>
        <div class="stacked-info">
          <div><span>Bounties</span><strong>${bounties.length}</strong></div>
          <div><span>Disputes</span><strong>${disputes.length}</strong></div>
          <div><span>Notifications</span><strong>${notifications.length}</strong></div>
          <div><span>Audit logs</span><strong>${auditLogs.length}</strong></div>
        </div>
        <div class="template-box subtle-box">
          <span class="mini-label">Operator focus</span>
          <p class="muted">Search, override, refund, and record review decisions from one place with a searchable trail.</p>
        </div>
        <div class="section-head compact">
          <div>
            <h3>Search and filters</h3>
            <p>Filter across entities, audit history, and operational incidents.</p>
          </div>
        </div>
        <div class="field-grid">
          <label class="field full">
            <span>Search</span>
            <input data-admin-filter="search" value="${escapeHtml(filters.search || '')}" placeholder="Search everything" />
          </label>
          <label class="field">
            <span>Status</span>
            <select data-admin-filter="status">
              ${['all', 'Open', 'Funded', 'Verified', 'Paid', 'Refunded', 'Disputed', 'resolved', 'open', 'escalated']
                .map((value) => `<option value="${value}" ${value === (filters.status || 'all') ? 'selected' : ''}>${value === 'all' ? 'All statuses' : value}</option>`)
                .join('')}
            </select>
          </label>
          <label class="field">
            <span>Type</span>
            <select data-admin-filter="type">
              ${['all', 'submission', 'verification', 'dispute', 'refund', 'info']
                .map((value) => `<option value="${value}" ${value === (filters.type || 'all') ? 'selected' : ''}>${value === 'all' ? 'All types' : value}</option>`)
                .join('')}
            </select>
          </label>
          <label class="field">
            <span>Severity</span>
            <select data-admin-filter="severity">
              ${['all', 'info', 'warn', 'error']
                .map((value) => `<option value="${value}" ${value === (filters.severity || 'all') ? 'selected' : ''}>${value === 'all' ? 'All severities' : value}</option>`)
                .join('')}
            </select>
          </label>
        </div>
        <div class="form-actions">
          <button type="button" class="secondary-action" data-export-analytics="json">Export analytics JSON</button>
          <button type="button" class="secondary-action" data-export-analytics="csv">Export analytics CSV</button>
        </div>
      </article>

      <div class="detail-stack">
        <form class="panel-dark glass-form" data-form="admin-override-bounty">
          <div class="section-head compact">
            <div>
              <span class="eyebrow">Override / refund</span>
              <h2>Moderate a bounty</h2>
              <p>Use this for manual status corrections, refunds, or incident response.</p>
            </div>
          </div>
          <div class="field-grid">
            <label class="field full">
              <span>Bounty ID</span>
              <input name="bountyId" placeholder="bnty_0001" />
            </label>
            <label class="field">
              <span>Status</span>
              <select name="status">
              ${['Open', 'Funded', 'Verified', 'Paid', 'Refunded', 'Disputed']
                  .map((value) => `<option value="${value}">${value}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="field">
              <span>Refund tx hash</span>
              <input name="refundTxHash" placeholder="0x..." />
            </label>
            <label class="field full">
              <span>Reason</span>
              <textarea name="reason" rows="4" placeholder="Why was this override or refund required?"></textarea>
            </label>
          </div>
          <div class="form-actions">
            <button type="submit" class="primary-action">Apply action</button>
          </div>
        </form>

        <form class="panel-dark glass-form" data-form="admin-incident-review">
          <div class="section-head compact">
            <div>
              <span class="eyebrow">Incident review</span>
              <h2>Review a log or dispute</h2>
              <p>Attach notes and a decision to any audit or incident record.</p>
            </div>
          </div>
          <div class="field-grid">
            <label class="field">
              <span>Target type</span>
              <input name="targetType" placeholder="audit, dispute, bounty" />
            </label>
            <label class="field">
              <span>Target ID</span>
              <input name="targetId" placeholder="aud_0001" />
            </label>
            <label class="field full">
              <span>Decision</span>
              <input name="decision" placeholder="reviewed, escalated, closed" />
            </label>
            <label class="field full">
              <span>Notes</span>
              <textarea name="notes" rows="4" placeholder="What should the incident record say?"></textarea>
            </label>
          </div>
          <div class="form-actions">
            <button type="submit" class="primary-action">Record review</button>
          </div>
        </form>
      </div>
    </section>

    <section class="split-grid">
      <article class="panel-dark detail-panel">
        <div class="section-head compact">
          <div>
            <h3>Bounties</h3>
            <p>Matching bounty records.</p>
          </div>
        </div>
        <div class="record-list">
          ${bounties
            .slice(0, 12)
            .map(
              (bounty) => `
                <div class="record-card">
                  <div>
                    <strong>${escapeHtml(bounty.title)}</strong>
                    <p>${escapeHtml(bounty.bountyId)} - ${escapeHtml(bounty.status)}</p>
                    <p class="muted">${escapeHtml(bounty.ownerHandle || '')} - ${escapeHtml(bounty.payoutStatus || '')}</p>
                  </div>
                  <button class="ghost-button" type="button" data-route="detail" data-bounty-id="${escapeHtml(bounty.bountyId)}">Open</button>
                </div>
              `
            )
            .join('') || '<p class="muted">No matching bounties.</p>'}
        </div>
      </article>

      <article class="panel-dark detail-panel">
        <div class="section-head compact">
          <div>
            <h3>Disputes</h3>
            <p>Open, resolved, and escalated cases.</p>
          </div>
        </div>
        <div class="record-list">
          ${disputes
            .slice(0, 12)
            .map(
              (dispute) => `
                <div class="record-card">
                  <div>
                    <strong>${escapeHtml(dispute.disputeId)}</strong>
                    <p>${escapeHtml(dispute.bountyTitle || dispute.bountyId)} - ${escapeHtml(dispute.status)}</p>
                    <p class="muted">${escapeHtml(dispute.reason || '')}</p>
                  </div>
                </div>
              `
            )
            .join('') || '<p class="muted">No matching disputes.</p>'}
        </div>
      </article>
    </section>

    <section class="split-grid">
      <article class="panel-dark detail-panel">
        <div class="section-head compact">
          <div>
            <h3>Notifications</h3>
            <p>Searchable delivery inbox.</p>
          </div>
        </div>
        <div class="record-list">
          ${notifications
            .slice(0, 12)
            .map(
              (notification) => `
                <div class="record-card">
                  <div>
                    <strong>${escapeHtml(notification.title || notification.category || 'Notification')}</strong>
                    <p>${escapeHtml(notification.body || '')}</p>
                    <p class="muted">${escapeHtml(notification.recipientHandle || notification.orgName || '')} - ${escapeHtml(notification.channels?.join(', ') || '')}</p>
                  </div>
                </div>
              `
            )
            .join('') || '<p class="muted">No matching notifications.</p>'}
        </div>
      </article>

      <article class="panel-dark detail-panel">
        <div class="section-head compact">
          <div>
            <h3>Audit logs</h3>
            <p>Immutable searchable action log.</p>
          </div>
        </div>
        <div class="record-list">
          ${auditLogs
            .slice(0, 12)
            .map(
              (log) => `
                <div class="record-card">
                  <div>
                    <strong>${escapeHtml(log.action)}</strong>
                    <p>${escapeHtml(log.summary || '')}</p>
                    <p class="muted">${escapeHtml(log.actorHandle || '')} - ${formatDate(log.createdAt)}</p>
                  </div>
                </div>
              `
            )
            .join('') || '<p class="muted">No matching audit logs.</p>'}
        </div>
      </article>
    </section>

    <section class="panel-dark feed-panel">
      <div class="section-head compact">
        <div>
          <h3>Observability</h3>
          <p>Structured traces and error records.</p>
        </div>
      </div>
      <div class="stats-grid analytics-grid">
        ${renderAnalyticsCard('Traces', String((state.observabilityEvents || []).filter((event) => event.kind === 'trace').length), 'Recorded trace events')}
        ${renderAnalyticsCard('Errors', String((state.observabilityEvents || []).filter((event) => event.level === 'error' || Number(event.statusCode || 0) >= 500).length), 'Captured error-level events')}
        ${renderAnalyticsCard('Latency', formatDuration(Math.round((state.observabilityEvents || []).reduce((sum, event) => sum + Number(event.durationMs || 0), 0) / Math.max(1, (state.observabilityEvents || []).length || 1))), 'Average event duration')}
        ${renderAnalyticsCard('Uptime', 'Healthy', 'Health endpoint available')}
      </div>
      <div class="record-list">
        ${(observability || []).slice(0, 8).map((event) => `
          <div class="record-card">
            <div>
              <strong>${escapeHtml(event.kind)}</strong>
              <p>${escapeHtml(event.message || event.route || '')}</p>
              <p class="muted">${escapeHtml(event.source || '')} - ${escapeHtml(String(event.durationMs || 0))}ms - ${escapeHtml(String(event.statusCode || 0))}</p>
            </div>
          </div>
        `).join('') || '<p class="muted">No observability events yet.</p>'}
      </div>
    </section>
  `;
}

function buildBountyTimeline(submissions, verifications) {
  const events = [
    ...submissions.map((submission) => ({
      kind: 'submission',
      label: `Submission ${submission.submissionId}`,
      detail: `${submission.contributorHandle} - ${submission.url}`,
      timestamp: submission.createdAt,
      tone: 'neutral'
    })),
    ...verifications.map((verification) => ({
      kind: 'verification',
      label: `${verification.overallPass ? 'Pass' : 'Fail'} ${verification.verificationId}`,
      detail: verification.results.map((result) => `${result.req_id}:${result.pass ? 'pass' : 'fail'}`).join(' | '),
      timestamp: verification.createdAt,
      tone: verification.overallPass ? 'good' : 'bad',
      payoutStatus: verification.overallPass ? 'Ready to release' : 'Locked'
    }))
  ];

  return events.sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
}

function renderRequirement(req) {
  const meta = requirementTypes[req.type];
  return `
    <div class="requirement-card">
      <div>
        <span class="mini-label">${escapeHtml(meta?.label || req.type)}</span>
        <strong>${escapeHtml(req.id)}</strong>
      </div>
      <p>${escapeHtml(req.description)}</p>
      <code>${escapeHtml(JSON.stringify(req.params, null, 2))}</code>
    </div>
  `;
}

function emptyState(title, message) {
  return `
    <section class="panel-dark empty-state">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
    </section>
  `;
}

function filterBounties(state, filters) {
  const query = String(filters.search || '').trim().toLowerCase();
  const status = filters.status || 'all';
  const sorted = [...(state.bountySummaries || [])].filter((bounty) => {
    const statusMatch = status === 'all' || bounty.status === status;
    const text = `${bounty.title} ${bounty.ownerHandle} ${bounty.requirementSummary} ${bounty.bountyId}`.toLowerCase();
    const queryMatch = !query || text.includes(query);
    return statusMatch && queryMatch;
  });

  switch (filters.sort) {
    case 'reward-desc':
      sorted.sort((left, right) => Number(right.rewardAmount) - Number(left.rewardAmount));
      break;
    case 'deadline-asc':
      sorted.sort((left, right) => Date.parse(left.deadline) - Date.parse(right.deadline));
      break;
    case 'latest':
    default:
      sorted.sort((left, right) => Date.parse(right.updatedAt || right.createdAt) - Date.parse(left.updatedAt || left.createdAt));
      break;
  }

  return sorted;
}

function selectBounty(state, bountyId) {
  const candidates = state.bountySummaries || [];
  return candidates.find((item) => item.bountyId === bountyId) || candidates[0] || null;
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

function createDraft(overrides = {}) {
  return {
    id: '',
    type: 'url_exists',
    description: '',
    params: defaultParamsForType('url_exists'),
    ...overrides
  };
}

function displayReward(bounty) {
  if (!bounty) {
    return '--';
  }
  return `${new Intl.NumberFormat('en-US').format(Number(bounty.rewardAmount || 0))} ${bounty.rewardToken || 'USDC'}`;
}

function formatDuration(minutes) {
  const value = Number(minutes || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return '0m';
  }
  if (value < 60) {
    return `${value}m`;
  }
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return `${hours}h ${remainder}m`;
}

function renderExplorerLinks(links = {}) {
  const entries = [
    ['Escrow', links.escrow],
    ['Funding', links.funding],
    ['Payout', links.payout],
    ['Refund', links.refund],
    ['Contract', links.contract],
    ['Treasury', links.treasury]
  ].filter(([, href]) => Boolean(href));

  if (entries.length === 0) {
    return '<strong class="muted">Pending</strong>';
  }

  return entries
    .map(([label, href]) => `<a class="pill pill-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`)
    .join(' ');
}

function payoutClass(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('released') || value.includes('ready')) {
    return 'status-good';
  }
  if (value.includes('locked')) {
    return 'status-bad';
  }
  return 'status-open';
}

function normalizeStatus(status) {
  return String(status || 'pending').toLowerCase().replace(/\s+/g, '-');
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(value));
}

function formatRelative(value) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function syncNavigationState(view) {
  document.querySelectorAll('.nav-panel .nav-link').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.route === view);
  });
}
