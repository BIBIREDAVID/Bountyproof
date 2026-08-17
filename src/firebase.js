import './load-env.js';
let cachedStatus = {
  enabled: false,
  connected: false,
  projectId: '',
  collection: '',
  message: 'Firebase is not configured'
};

let cachedClient = null;

function readConfig() {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  const collection = String(process.env.FIREBASE_COLLECTION || 'bountyproof_snapshots').trim();
  const serviceAccountJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  return {
    projectId,
    collection,
    serviceAccountJson,
    clientEmail,
    privateKey
  };
}

async function getFirebaseClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const config = readConfig();
  if (!config.projectId) {
    cachedStatus = {
      enabled: false,
      connected: false,
      projectId: '',
      collection: config.collection,
      message: 'Set FIREBASE_PROJECT_ID to enable sync'
    };
    return null;
  }

  try {
    const [{ initializeApp, cert, getApps }, { getFirestore }] = await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/firestore')
    ]);

    let credential = undefined;
    if (config.serviceAccountJson) {
      credential = cert(JSON.parse(config.serviceAccountJson));
    } else if (config.clientEmail && config.privateKey) {
      credential = cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail,
        privateKey: config.privateKey
      });
    }

    const app = getApps().length
      ? getApps()[0]
      : initializeApp({
          credential,
          projectId: config.projectId
        });

    const db = getFirestore(app);
    cachedClient = { app, db, config };
    cachedStatus = {
      enabled: true,
      connected: true,
      projectId: config.projectId,
      collection: config.collection,
      message: 'Firebase connected'
    };
    return cachedClient;
  } catch (error) {
    cachedStatus = {
      enabled: true,
      connected: false,
      projectId: config.projectId,
      collection: config.collection,
      message: `Firebase sync unavailable: ${error.message}`
    };
    return null;
  }
}

function buildSnapshot(state) {
  return {
    updatedAt: new Date().toISOString(),
    counts: {
      bounties: state.bounties?.length || 0,
      submissions: state.submissions?.length || 0,
      verifications: state.verifications?.length || 0,
      disputes: state.disputes?.length || 0,
      notifications: state.notifications?.length || 0,
      auditLogs: state.auditLogs?.length || 0
    },
    analytics: state.analytics || null,
    stats: state.stats || null,
    currentOrgId: state.currentOrgId || null,
    currentUserId: state.currentUserId || null,
    bounties: (state.bounties || []).slice(0, 50),
    disputes: (state.disputes || []).slice(0, 50),
    notifications: (state.notifications || []).slice(0, 50),
    auditLogs: (state.auditLogs || []).slice(0, 50)
  };
}

export async function syncFirebaseSnapshot(state) {
  const client = await getFirebaseClient();
  if (!client) {
    return cachedStatus;
  }

  try {
    await client.db.collection(client.config.collection).doc('latest').set(buildSnapshot(state), { merge: true });
    cachedStatus = {
      ...cachedStatus,
      lastSyncedAt: new Date().toISOString(),
      message: 'Firebase sync complete'
    };
  } catch (error) {
    cachedStatus = {
      ...cachedStatus,
      connected: false,
      message: `Firebase sync failed: ${error.message}`
    };
  }

  return cachedStatus;
}

export async function getFirebaseStatus() {
  await getFirebaseClient();
  return cachedStatus;
}
