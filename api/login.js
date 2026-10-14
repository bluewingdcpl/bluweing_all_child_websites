const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { list, put, del } = require('@vercel/blob');
const { getSecret, signSession, setSessionCookie } = require('./_lib/auth');
const { sendMail } = require('./_lib/mailer');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
// Reset links only ever go to this inbox, never to an address typed into the form.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.SMTP_TO || process.env.SMTP_USER;

// A password set through "Forgot password" is stored scrypt-hashed in Blob
// storage and takes over from ADMIN_PASSWORD. The random suffix keeps the
// file's public URL unguessable; it is found again with list().
const CRED_PREFIX = 'admin/credentials';
const RESET_TTL = '30m';
const MIN_PASSWORD = 8;

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

async function readStored() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const { blobs } = await list({ prefix: CRED_PREFIX });
  if (!blobs.length) return null;
  blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  const r = await fetch(blobs[0].url, { cache: 'no-store' });
  return r.ok ? r.json() : null;
}

function checkPassword(password, stored) {
  if (stored && stored.salt && stored.hash) return safeEqual(hashPassword(password, stored.salt), stored.hash);
  return safeEqual(password, ADMIN_PASSWORD);
}

// Ties a reset link to the current password, so the link stops working once it has been used.
function fingerprint(stored) {
  const current = stored && stored.hash ? stored.hash : ADMIN_PASSWORD;
  return crypto.createHash('sha256').update(getSecret() + '|' + current).digest('hex').slice(0, 16);
}

async function login(req, res, body) {
  const { username, password } = body;
  getSecret();
  let stored = null;
  try {
    stored = await readStored();
  } catch (e) {
    // Storage trouble must not lock the admin out; fall back to ADMIN_PASSWORD.
    console.error('admin credentials read failed:', e.message);
  }
  if (username === ADMIN_USERNAME && checkPassword(password || '', stored)) {
    setSessionCookie(res, signSession(username));
    return res.status(200).json({ ok: true });
  }
  return res.status(401).json({ error: 'Invalid username or password' });
}

async function forgot(req, res, body) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !ADMIN_EMAIL) {
    return res.status(500).json({ error: 'Email is not configured on the server. Set SMTP_HOST, SMTP_USER, SMTP_PASS and ADMIN_EMAIL in Vercel.' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'Storage is not configured yet. Connect Vercel Blob storage (BLOB_READ_WRITE_TOKEN).' });
  }
  const sent = { ok: true, message: 'If the username is correct, a reset link has been sent to the admin email. It is valid for 30 minutes.' };
  if (String(body.username || '').trim() !== ADMIN_USERNAME) return res.status(200).json(sent);

  const token = jwt.sign({ p: 'reset', v: fingerprint(await readStored()) }, getSecret(), { expiresIn: RESET_TTL });
  // Vercel only routes hosts assigned to this project, so the Host header is one of our domains.
  const link = `https://${req.headers.host}/new-pillar/?reset=${encodeURIComponent(token)}`;
  await sendMail({
    to: ADMIN_EMAIL,
    subject: 'BlueWing admin panel: reset your password',
    text: `A password reset was requested for the BlueWing admin panel.\n\nSet a new password here (valid for 30 minutes):\n${link}\n\nIf you did not request this, ignore this email. Your password will not change.`,
    html: `<p>A password reset was requested for the BlueWing admin panel.</p>
<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#34446f;color:#fff;text-decoration:none;border-radius:4px">Set a new password</a></p>
<p style="color:#666;font-size:13px">The link is valid for 30 minutes. If you did not request this, ignore this email. Your password will not change.</p>`,
  });
  return res.status(200).json(sent);
}

async function reset(req, res, body) {
  const invalid = 'This reset link is invalid or has expired. Please request a new one.';
  let payload;
  try {
    payload = jwt.verify(String(body.token || ''), getSecret());
  } catch (e) {
    return res.status(400).json({ error: invalid });
  }
  if (payload.p !== 'reset') return res.status(400).json({ error: invalid });

  const password = body.password;
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD} characters.` });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'Storage is not configured yet. Connect Vercel Blob storage (BLOB_READ_WRITE_TOKEN).' });
  }
  if (payload.v !== fingerprint(await readStored())) {
    return res.status(400).json({ error: 'This reset link has already been used. Please request a new one.' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const saved = await put(`${CRED_PREFIX}.json`, JSON.stringify({
    salt,
    hash: hashPassword(password, salt),
    updatedAt: new Date().toISOString(),
  }), { access: 'public', addRandomSuffix: true, contentType: 'application/json' });

  const { blobs } = await list({ prefix: CRED_PREFIX });
  const old = blobs.filter((b) => b.url !== saved.url).map((b) => b.url);
  if (old.length) await del(old);

  setSessionCookie(res, signSession(ADMIN_USERNAME));
  return res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    res.status(500).json({ error: 'Admin credentials are not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD in Vercel project environment variables.' });
    return;
  }
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  try {
    if (body.action === 'forgot') return await forgot(req, res, body);
    if (body.action === 'reset') return await reset(req, res, body);
    return await login(req, res, body);
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
};
