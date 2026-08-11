import { requirementTypes } from './requirements.js';

const supportedRequirementTypes = Object.keys(requirementTypes);

export function renderApp(state, uiState) {
  renderStats(state.stats || []);
  renderShell(state, uiState);
  syncNavigationState(uiState.view);
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
  } else {
    root.innerHTML = renderDashboardView(state, uiState, bountyList, summary);
  }
}

function renderDashboardView(state, uiState, bountyList, summary) {
  return `
    <section class="hero-grid">
      <div class="hero-copy panel-dark">
        <span class="eyebrow">Escrowed bounty verification</span>
        <h2>Automatic payout for objective proof, not guesswork.</h2>
        <p>
          BountyProof turns a bounty into a typed checklist, verifies submission evidence, and records the verdict
          before a reward is released on chain.
        </p>
        <div class="hero-actions">
          <button class="primary-action" data-route="create">Create bounty</button>
          <button class="secondary-action" type="button" data-route="detail" data-bounty-id="${escapeHtml(summary?.bountyId || '')}">Review submission</button>
        </div>
        <div class="hero-pills">
          <span class="pill pill-glow">X Layer escrow</span>
          <span class="pill">Structured rules</span>
          <span class="pill">On-chain audit trail</span>
        </div>
      </div>
      <div class="hero-panel panel-dark">
        <div class="stack-card stack-card-main">
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
        <div class="stack-card stack-card-side">
          <span class="mini-label">Transaction flow</span>
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
          ${['all', 'Open', 'Funded', 'Paid']
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

  return `
    <section class="screen-grid screen-split">
      <div class="screen-copy panel-dark">
        <span class="eyebrow">Create bounty</span>
        <h2>Build a locked checklist, not a loose brief.</h2>
        <p>Use typed requirements so the verifier can stay deterministic and the payout path stays auditable.</p>
        <div class="template-box">
          <span class="mini-label">Supported requirements</span>
          <div class="template-pills">
            ${supportedRequirementTypes.map((type) => `<span class="pill">${type}</span>`).join('')}
          </div>
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

  return `
    <section class="screen-grid screen-split">
      <article class="panel-dark detail-panel">
        <div class="section-head compact">
          <div>
            <span class="eyebrow">Bounty detail</span>
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
        </div>
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
                ${['Open', 'Funded', 'Paid']
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

        <form class="panel-dark glass-form" data-form="submit-and-verify" style="${isEditMode ? 'display:none;' : ''}">
          <div class="section-head compact">
            <div>
              <span class="eyebrow">Submit evidence</span>
              <h2>Wire a live proof submission into verification.</h2>
              <p>Submit the URL, the content snapshot, and the contributor handle that should be matched.</p>
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
      </div>
    </section>
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
            <h2>${verification.overallPass ? 'Funds can be released.' : 'Funds remain locked.'}</h2>
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
            <span class="mini-label">Recorded</span>
            <strong>${formatDate(verification.createdAt)}</strong>
          </div>
          <div>
            <span class="mini-label">Payout</span>
            <strong class="${verification.overallPass ? 'status-good' : 'status-bad'}">${verification.overallPass ? 'Released' : 'Locked'}</strong>
          </div>
        </div>
      </article>

      <div class="split-grid">
        <article class="panel-dark detail-panel">
          <h3>Per-requirement verdicts</h3>
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
          <h3>Verification JSON</h3>
          <pre><code>${escapeHtml(JSON.stringify(verification, null, 2))}</code></pre>
        </article>
      </div>

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
  const owned = (state.bountySummaries || []).filter((bounty) => bounty.ownerHandle === state.currentPosterHandle);
  const submitted = (state.submissions || []).filter((submission) => submission.contributorHandle === state.currentContributorHandle);

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
