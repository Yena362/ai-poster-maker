// Server only. Never copy Firebase credentials into index.html.
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function database() {
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error('FIREBASE_CONFIG_MISSING');
  }
  const app = getApps().find(app => app.name === 'usage-logger') || initializeApp({
    credential: cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  }, 'usage-logger');
  return getFirestore(app);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  // A same-origin check reduces cross-site browser submissions; it is not user authentication.
  const origin = req.headers.origin;
  const configuredHosts = [
    'ai-poster-maker-swart.vercel.app',
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    process.env.VERCEL_URL,
    ...(process.env.USAGE_ALLOWED_HOSTS || '').split(',').map(s => s.trim())
  ].filter(Boolean);
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' || !configuredHosts.includes(parsed.host)) throw new Error();
  } catch {
    return res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
  }
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'JSON_REQUIRED' });
  }
  let body;
  try {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!raw || Buffer.byteLength(raw) > 12000) return res.status(413).json({ error: 'BODY_TOO_LARGE' });
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'INVALID_JSON' });
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!body || !uuid.test(body.sessionId) || !uuid.test(body.eventId) ||
      !['page_view', 'download_requested'].includes(body.event)) {
    return res.status(400).json({ error: 'INVALID_EVENT' });
  }
  const event = {
    event: body.event,
    sessionId: body.sessionId,
    source: 'browser_reported',
    createdAt: FieldValue.serverTimestamp()
  };
  if (body.event === 'download_requested') {
    if (!['png', 'pdf', 'zip'].includes(body.format) ||
        !['single', 'batch'].includes(body.mode) ||
        !Number.isInteger(body.posterCount) || body.posterCount < 1 || body.posterCount > 10000 ||
        typeof body.theme !== 'string' || body.theme.length > 30 ||
        !Array.isArray(body.titles) || body.titles.length > 10 ||
        body.titles.some(t => typeof t !== 'string' || t.length > 120)) {
      return res.status(400).json({ error: 'INVALID_DOWNLOAD' });
    }
    Object.assign(event, {
      format: body.format, mode: body.mode, posterCount: body.posterCount,
      theme: body.theme, titles: body.titles, titlesTruncated: body.posterCount > body.titles.length
    });
  }
  try {
    const db = database();
    const day = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const counter = db.collection('usage_limits').doc(day);
    const log = db.collection('usage_logs').doc(body.eventId);
    const saved = await db.runTransaction(async tx => {
      // A duplicate event ID is idempotent. Cap stored events to limit ordinary usage costs.
      const [existing, count] = await Promise.all([tx.get(log), tx.get(counter)]);
      if (existing.exists) return 'duplicate';
      if ((count.data()?.count || 0) >= 2000) return 'limit';
      tx.set(counter, { count: (count.data()?.count || 0) + 1, updatedAt: FieldValue.serverTimestamp() });
      tx.set(log, event);
      return 'saved';
    });
    if (saved === 'limit') return res.status(429).json({ error: 'DAILY_LOG_LIMIT' });
    return res.status(200).json({ ok: true });
  } catch {
    // Never print credentials, raw request bodies, or Firebase error detail.
    console.error('Usage logging unavailable: check Firebase credentials, Firestore and quotas.');
    return res.status(503).json({ error: 'LOGGING_UNAVAILABLE' });
  }
};
