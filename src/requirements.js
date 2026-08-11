const urlPattern = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

export const requirementTypes = {
  url_exists: {
    label: 'URL exists',
    evaluate(requirement, submission) {
      const url = submission?.url?.trim() || '';
      const allowedDomains = requirement.params?.domain_allowlist || [];
      if (!urlPattern.test(url)) {
        return fail('Submission does not include a valid public URL.');
      }

      try {
        const parsed = new URL(url);
        const host = parsed.hostname.toLowerCase();
        const matches = allowedDomains.length === 0 || allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
        return matches ? pass(`Found an accessible URL on ${host}.`) : fail(`URL host ${host} is not in the allowlist.`);
      } catch {
        return fail('URL could not be parsed.');
      }
    }
  },
  text_contains: {
    label: 'Text contains',
    evaluate(requirement, submission) {
      const content = submission?.content || '';
      const mustInclude = requirement.params?.must_include || [];
      const missing = mustInclude.filter((token) => !content.toLowerCase().includes(String(token).toLowerCase()));
      return missing.length === 0
        ? pass(`All required tokens are present: ${mustInclude.join(', ')}.`)
        : fail(`Missing required tokens: ${missing.join(', ')}.`);
    }
  },
  before_deadline: {
    label: 'Before deadline',
    evaluate(requirement, submission) {
      const submittedAt = submission?.submittedAt;
      const deadline = requirement.params?.deadline;
      if (!submittedAt || !deadline) {
        return fail('Missing submission timestamp or deadline.');
      }

      const submittedMs = Date.parse(submittedAt);
      const deadlineMs = Date.parse(deadline);
      if (Number.isNaN(submittedMs) || Number.isNaN(deadlineMs)) {
        return fail('Could not parse submission timestamp or deadline.');
      }

      return submittedMs <= deadlineMs
        ? pass(`Submitted at ${submittedAt}, before deadline ${deadline}.`)
        : fail(`Submitted at ${submittedAt}, after deadline ${deadline}.`);
    }
  },
  min_length: {
    label: 'Minimum length',
    evaluate(requirement, submission) {
      const unit = requirement.params?.unit || 'characters';
      const min = Number(requirement.params?.min || 0);
      const value = measureSubmission(submission, unit);
      return value >= min
        ? pass(`Submission meets the minimum ${unit} threshold (${value}/${min}).`)
        : fail(`Submission only reached ${value}/${min} ${unit}.`);
    }
  },
  account_match: {
    label: 'Account match',
    evaluate(requirement, submission) {
      const expected = String(requirement.params?.verified_account_handle || '').toLowerCase();
      const actual = String(submission?.authorHandle || '').toLowerCase();
      if (!expected || !actual) {
        return fail('Missing account handle evidence.');
      }

      return expected === actual
        ? pass(`Submission came from the verified account ${submission.authorHandle}.`)
        : fail(`Submission came from ${submission.authorHandle}, expected ${requirement.params.verified_account_handle}.`);
    }
  }
};

export function evaluateBounty(bounty, submission) {
  const results = bounty.requirements.map((requirement) => {
    const evaluator = requirementTypes[requirement.type];
    if (!evaluator) {
      return {
        req_id: requirement.id,
        pass: false,
        reason: `Unsupported requirement type: ${requirement.type}`
      };
    }

    const verdict = evaluator.evaluate(requirement, submission);
    return {
      req_id: requirement.id,
      pass: verdict.pass,
      reason: verdict.reason
    };
  });

  const overallPass = bounty.pass_threshold === 'all_required'
    ? results.every((item) => item.pass)
    : results.filter((item) => item.pass).length >= Number(bounty.pass_threshold || 0);

  return {
    bounty_id: bounty.bounty_id,
    submission_id: submission.submissionId,
    results,
    overall_pass: overallPass
  };
}

function measureSubmission(submission, unit) {
  const content = submission?.content || '';
  if (unit === 'tweets') {
    return submission?.tweetCount ?? estimateTweetCount(content);
  }

  if (unit === 'words') {
    return content.trim().split(/\s+/).filter(Boolean).length;
  }

  return content.length;
}

function estimateTweetCount(content) {
  return content
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean).length || 0;
}

function pass(reason) {
  return { pass: true, reason };
}

function fail(reason) {
  return { pass: false, reason };
}
