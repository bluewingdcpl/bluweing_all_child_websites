const { readJson, writeJson } = require('./_lib/github');
const { requireAuth } = require('./_lib/auth');
const render = require('./_lib/render');

const PATH = 'data/blog.json';

function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}

// A post's categories, main one first. `category` keeps the main one for the cards and breadcrumb.
function categoriesOf(post) {
  const list = Array.isArray(post.categories) ? post.categories : [post.category];
  return Array.from(new Set(list.map((c) => String(c || '').trim()).filter(Boolean)));
}

// /sitemap.xml on the BlueWing domain is rewritten here (vercel.json), so projects and
// posts published from the admin are listed without a deploy. Plain pages are listed below.
const SITE = 'https://www.bluewingconstruction.com';
const SITEMAP_PAGES = [
  '/', '/about-bluewing-dcpl.html', '/bluewing-dcpl.html', '/leadership-message.html', '/value-statement.html',
  '/epc-turnkey-projects.html', '/commercial.html', '/hospitals.html', '/hotels.html', '/industrial.html',
  '/institutional.html', '/residential.html', '/projects.html', '/projects-ongoing.html', '/projects-completed.html',
  '/projects-commercial.html', '/projects-hospitals.html', '/projects-hotels.html', '/projects-industrial.html',
  '/projects-institutional.html', '/projects-residential.html', '/quality-standards.html', '/safety-standards.html',
  '/clients.html', '/careers.html', '/blog.html', '/contact-us.html', '/privacy-policy.html', '/terms-conditions.html',
  '/cookies-policy.html',
];

function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

async function sitemap(res) {
  const [{ data: posts }, { data: projects }] = await Promise.all([readJson(PATH, []), readJson('data/projects.json', [])]);
  const day = (d) => (/^\d{4}-\d{2}-\d{2}/.test(String(d || '')) ? String(d).slice(0, 10) : '');
  const live = (item) => item && item.slug && item.published !== false;
  const urls = [
    ...SITEMAP_PAGES.map((p) => ({ loc: SITE + p })),
    ...projects.filter(live).map((p) => ({ loc: `${SITE}/${p.slug}`, lastmod: day(p.date) })),
    ...posts.filter(live).map((p) => ({ loc: `${SITE}/blog/${p.slug}`, lastmod: day(p.date) })),
  ];
  const rows = urls.map((u) => `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`);
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
      // Server-rendered blog articles, project pages and blog index (see api/_lib/render.js)
      if ((req.query || {}).render !== undefined) return render(req, res);
      if ((req.query || {}).sitemap !== undefined) return sitemap(res);
      res.setHeader('Cache-Control', 'no-store');
      const { data: posts } = await readJson(PATH, []);
      const { slug, id, list } = req.query || {};
      if (list !== undefined) {
        // Blog list and related articles: everything but the article body.
        return res.status(200).json(posts.map(({ content, faqs, ...card }) => card));
      }
      if (slug) {
        const post = posts.find((p) => p.slug === slug);
        if (!post) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(post);
      }
      if (id) {
        const post = posts.find((p) => p.id === id);
        if (!post) return res.status(404).json({ error: 'Not found' });
        return res.status(200).json(post);
      }
      return res.status(200).json(posts);
    }

    if (!requireAuth(req, res)) return;

    const { data: posts } = await readJson(PATH, []);

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body.title) return res.status(400).json({ error: 'Title is required' });
      let baseSlug = slugify(body.slug || body.title);
      let slug = baseSlug;
      let n = 2;
      while (posts.some((p) => p.slug === slug)) {
        slug = `${baseSlug}-${n++}`;
      }
      const categories = categoriesOf(body);
      const post = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        title: body.title,
        slug,
        excerpt: body.excerpt || '',
        content: body.content || '',
        category: categories[0] || '',
        categories,
        tags: Array.isArray(body.tags) ? body.tags : [],
        faqs: Array.isArray(body.faqs) ? body.faqs.filter((f) => f && f.question && f.answer) : [],
        authorId: body.authorId || '',
        mediaType: body.mediaType || 'grid',
        media: Array.isArray(body.media) ? body.media : [],
        videoUrl: body.videoUrl || '',
        coverImage: body.coverImage || (Array.isArray(body.media) && body.media[0] ? body.media[0].url : ''),
        date: body.date || new Date().toISOString().slice(0, 10),
        published: body.published !== false,
        seoTitle: body.seoTitle || '',
        metaDescription: body.metaDescription || '',
      };
      posts.unshift(post);
      await writeJson(PATH, posts, `admin: add blog post "${post.title}"`);
      return res.status(201).json(post);
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      const idx = posts.findIndex((p) => p.id === body.id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      const existing = posts[idx];
      let slug = existing.slug;
      if (body.slug && slugify(body.slug) !== existing.slug) {
        let baseSlug = slugify(body.slug);
        slug = baseSlug;
        let n = 2;
        while (posts.some((p) => p.slug === slug && p.id !== body.id)) {
          slug = `${baseSlug}-${n++}`;
        }
      }
      const categories = (Array.isArray(body.categories) || body.category !== undefined) ? categoriesOf(body) : categoriesOf(existing);
      posts[idx] = {
        ...existing,
        ...body,
        slug,
        category: categories[0] || '',
        categories,
        tags: Array.isArray(body.tags) ? body.tags : existing.tags,
        faqs: Array.isArray(body.faqs) ? body.faqs.filter((f) => f && f.question && f.answer) : existing.faqs,
        media: Array.isArray(body.media) ? body.media : existing.media,
      };
      await writeJson(PATH, posts, `admin: update blog post "${posts[idx].title}"`);
      return res.status(200).json(posts[idx]);
    }

    if (req.method === 'DELETE') {
      const { id } = req.query || {};
      const idx = posts.findIndex((p) => p.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      const [removed] = posts.splice(idx, 1);
      await writeJson(PATH, posts, `admin: delete blog post "${removed.title}"`);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
};
