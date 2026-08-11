import assert from 'node:assert/strict';
import { evaluateBounty } from '../src/requirements.js';

const bounty = {
  bounty_id: 'bnty_0001',
  pass_threshold: 'all_required',
  requirements: [
    {
      id: 'req_1',
      type: 'url_exists',
      params: { domain_allowlist: ['x.com'] }
    },
    {
      id: 'req_2',
      type: 'text_contains',
      params: { must_include: ['#XLayer', '@okx'] }
    },
    {
      id: 'req_3',
      type: 'before_deadline',
      params: { deadline: '2026-08-20T23:59:00Z' }
    },
    {
      id: 'req_4',
      type: 'min_length',
      params: { unit: 'tweets', min: 5 }
    },
    {
      id: 'req_5',
      type: 'account_match',
      params: { verified_account_handle: '@submitter_handle' }
    }
  ]
};

const passingSubmission = {
  submissionId: 'sub_0007',
  url: 'https://x.com/submitter/status/1842100000000000000',
  authorHandle: '@submitter_handle',
  submittedAt: '2026-08-18T09:20:00Z',
  content: [
    'Thread 1',
    'Thread 2 #XLayer',
    'Thread 3',
    'Thread 4',
    'Thread 5 @okx'
  ].join('\n\n'),
  tweetCount: 5
};

const failingSubmission = {
  ...passingSubmission,
  content: 'Too short',
  tweetCount: 1
};

const passVerdict = evaluateBounty(bounty, passingSubmission);
assert.equal(passVerdict.overall_pass, true);
assert.equal(passVerdict.results.every((item) => item.pass), true);

const failVerdict = evaluateBounty(bounty, failingSubmission);
assert.equal(failVerdict.overall_pass, false);
assert.equal(failVerdict.results.some((item) => !item.pass), true);

console.log('Requirement evaluator tests passed.');
