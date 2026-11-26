const { readJson, writeJson } = require('./_lib/github');
const { requireAuth } = require('./_lib/auth');

const PATH = 'data/projects.json';

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

async function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  return body || {};
}

module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      const { data: items } = await readJson(PATH, []);
      const { slug, id } = req.query || {};
      if (slug) {
        const item = items.find((p) => p.slug === slug);
        if (!item) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(item);
      }
      if (id) {
        const item = items.find((p) => p.id === id);
        if (!item) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(item);
      }
      return res.status(200).json(items);
    }

    if (!requireAuth(req, res)) return;

    const { data: items } = await readJson(PATH, []);

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body.title) return res.status(400).json({ error: 'Title is required' });
      let baseSlug = slugify(body.slug || body.title);
      let slug = baseSlug;
      let n = 2;
      while (items.some((p) => p.slug === slug)) {
        slug = `${baseSlug}-${n++}`;
      }
      const item = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title: body.title,
        slug,
        status: body.status || 'Ongoing',
        content: body.content || '',
        category: body.category || '',
        tags: Array.isArray(body.tags) ? body.tags : [],
        images: Array.isArray(body.images) ? body.images : [],
        photoCaption: body.photoCaption || '',
        photoCredit: body.photoCredit || '',
        table: body.table && Array.isArray(body.table.rows) ? body.table : { headers: [], rows: [] },
        date: body.date || new Date().toISOString().slice(0, 10),
        published: body.published !== false,
      };
      items.unshift(item);
      await writeJson(PATH, items, `admin: add project "${item.title}"`);
      return res.status(201).json(item);
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      const idx = items.findIndex((p) => p.id === body.id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      const existing = items[idx];
      let slug = existing.slug;
      if (body.slug && slugify(body.slug) !== existing.slug) {
        let baseSlug = slugify(body.slug);
        slug = baseSlug;
        let n = 2;
        while (items.some((p) => p.slug === slug && p.id !== body.id)) {
          slug = `${baseSlug}-${n++}`;
        }
      }
      items[idx] = {
        ...existing,
        ...body,
        slug,
        updated: new Date().toISOString().slice(0, 10),
        tags: Array.isArray(body.tags) ? body.tags : existing.tags,
        images: Array.isArray(body.images) ? body.images : existing.images,
        table: body.table && Array.isArray(body.table.rows) ? body.table : existing.table,
      };
      await writeJson(PATH, items, `admin: update project "${items[idx].title}"`);
      return res.status(200).json(items[idx]);
    }

    if (req.method === 'DELETE') {
      const { id } = req.query || {};
      const idx = items.findIndex((p) => p.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      const [removed] = items.splice(idx, 1);
      await writeJson(PATH, items, `admin: delete project "${removed.title}"`);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
};
