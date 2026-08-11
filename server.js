import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBounty, createSubmission, deleteBounty, getBountyHistory, getPublicState, loadState, updateBounty, verifySubmission } from './src/store.js';

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

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(payload);
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
      const state = await loadState();
      sendJson(res, 200, getPublicState(state));
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/bounties') {
      const body = await readJson(req);
      const bounty = await createBounty({
        title: body.title || '',
        rewardAmount: body.rewardAmount || 0,
        rewardToken: body.rewardToken || 'USDC',
        deadline: body.deadline || '',
        ownerHandle: body.ownerHandle || '@okx',
        requirementSummary: body.requirementSummary || '',
        escrowTxHash: body.escrowTxHash,
        requirements: Array.isArray(body.requirements) ? body.requirements : []
      });
      const state = await loadState();
      sendJson(res, 201, { bounty, state: getPublicState(state) });
      return;
    }

    if (req.method === 'PATCH' && urlPath.startsWith('/api/bounties/')) {
      const bountyId = urlPath.split('/').pop();
      const body = await readJson(req);
      const bounty = await updateBounty(bountyId, {
        title: body.title,
        rewardAmount: body.rewardAmount,
        rewardToken: body.rewardToken,
        deadline: body.deadline,
        ownerHandle: body.ownerHandle,
        requirementSummary: body.requirementSummary,
        status: body.status,
        escrowTxHash: body.escrowTxHash,
        requirements: Array.isArray(body.requirements) ? body.requirements : undefined
      });
      const state = await loadState();
      sendJson(res, 200, { bounty, state: getPublicState(state) });
      return;
    }

    if (req.method === 'DELETE' && urlPath.startsWith('/api/bounties/')) {
      const bountyId = urlPath.split('/').pop();
      const removed = await deleteBounty(bountyId);
      const state = await loadState();
      sendJson(res, 200, { bounty: removed, state: getPublicState(state) });
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/submissions') {
      const body = await readJson(req);
      const submission = await createSubmission({
        bountyId: body.bountyId || '',
        contributorHandle: body.contributorHandle || '',
        url: body.url || '',
        submittedAt: body.submittedAt || new Date().toISOString(),
        tweetCount: body.tweetCount,
        content: body.content || ''
      });
      const state = await loadState();
      sendJson(res, 201, { submission, state: getPublicState(state) });
      return;
    }

    if (req.method === 'POST' && urlPath === '/api/verifications') {
      const body = await readJson(req);
      const verification = await verifySubmission({
        bountyId: body.bountyId || '',
        submissionId: body.submissionId || ''
      });
      const state = await loadState();
      sendJson(res, 201, { verification, state: getPublicState(state) });
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

    if (req.method === 'POST' && urlPath === '/api/reset') {
      const { seedState } = await import('./src/data.js');
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
    sendJson(res, 500, { error: error.message });
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '127.0.0.1', () => {
  console.log(`BountyProof running at http://127.0.0.1:${port}`);
});
