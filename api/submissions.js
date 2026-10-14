const { list, del } = require('@vercel/blob');
const { requireAuth } = require('./_lib/auth');
const { listRecipients, saveRecipients } = require('./_lib/recipients');

// Form email recipients (/api/submissions?recipients), kept here to stay
// within the serverless function limit.
async function recipients(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json(await listRecipients());
  if (req.method === 'PUT') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    try {
      await saveRecipients((body || {}).recipients || {});
    } catch (e) {
      if (/not a valid email|At most/.test(e.message)) return res.status(400).json({ error: e.message });
      throw e;
    }
    return res.status(200).json(await listRecipients());
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  try {
    if ((req.query || {}).recipients !== undefined) return await recipients(req, res);

    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.status(500).json({ error: 'Storage is not configured yet. Enable Vercel Blob storage for this project.' });
    }

    const { type } = req.query || {};
    const formType = ['vendor-registration', 'job-application', 'sygnific-enquiry'].includes(type) ? type : 'project-enquiry';
    const prefix = `submissions/${formType}/`;

    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      const items = [];
      let cursor;
      do {
        const page = await list({ prefix, cursor, limit: 100 });
        items.push(...page.blobs);
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);

      const entries = await Promise.all(items.map(async (b) => {
        const r = await fetch(b.url);
        return r.ok ? r.json() : null;
      }));
      const clean = entries.filter(Boolean).sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
      return res.status(200).json(clean);
    }

    if (req.method === 'DELETE') {
      const { id } = req.query || {};
      if (!id) return res.status(400).json({ error: 'id is required' });
      await del(`${prefix}${id}.json`);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
};
