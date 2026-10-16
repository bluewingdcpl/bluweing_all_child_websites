const { put } = require('@vercel/blob');
const { requireAuth } = require('./_lib/auth');
const { createFile, rawUrl } = require('./_lib/github');
const { UPLOAD_DIR, IMAGE_RE, siteUrl } = require('./_lib/repo-uploads');

// Request bodies are capped at 4.5 MB on Vercel; base64 adds a third.
const MAX_REPO_BYTES = 3 * 1024 * 1024;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!requireAuth(req, res)) return;

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    const { filename, dataBase64, contentType } = body || {};
    if (!filename || !dataBase64) {
      return res.status(400).json({ error: 'filename and dataBase64 are required' });
    }

    const base64Data = dataBase64.includes(',') ? dataBase64.split(',')[1] : dataBase64;
    const buffer = Buffer.from(base64Data, 'base64');

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8).padEnd(6, '0')}`;

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await put(`uploads/${stamp}-${safeName}`, buffer, {
        access: 'public',
        contentType: contentType || 'application/octet-stream',
      });
      return res.status(200).json({ url: blob.url });
    }

    // No Blob storage: keep the image in the repo instead (see _lib/repo-uploads.js).
    if (!IMAGE_RE.test(safeName)) {
      return res.status(400).json({ error: 'Only images (PNG, JPG, WebP, GIF, SVG, AVIF) can be uploaded until Vercel Blob storage is connected.' });
    }
    if (buffer.length > MAX_REPO_BYTES) {
      return res.status(400).json({ error: 'This image is over 3 MB. Please use a smaller image.' });
    }
    const now = new Date();
    const folder = `${UPLOAD_DIR}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const repoPath = `${folder}/${stamp}-${safeName}`;
    await createFile(repoPath, buffer.toString('base64'), `admin: upload ${safeName}`);
    res.status(200).json({ url: siteUrl(req, repoPath), preview: rawUrl(repoPath), stored: 'repo' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
};
