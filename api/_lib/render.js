// Server-side rendering for blog articles, project pages and the blog index.
//
// Before: /blog/<slug> and /<project-slug> served an empty template; the browser then
// fetched /api/blog or /api/projects and filled it in. Google saw "Loading…" and one
// generic title on every page; AI crawlers and social previews saw nothing.
//
// Now: vercel.json rewrites those URLs to /api/blog?render=… (kept inside api/blog.js so the
// project stays within Vercel's 12-function limit), which calls this module. This function reads the same template and
// the same data/*.json the admin panel writes, fills in the title, meta tags, canonical,
// structured data and the visible content, and returns finished HTML. The template's own
// script still runs in the browser afterwards (filters, sliders, accordions), so the page
// looks and behaves exactly as before. Admin edits show within a minute (s-maxage=60).

const fs = require('fs');
const path = require('path');
const { readJson } = require('./github');

const SITE = 'https://www.bluewingconstruction.com';
const ORG = {
  '@type': 'Organization',
  name: 'BlueWing Design & Construction Pvt. Ltd.',
  alternateName: 'BlueWing DCPL',
  url: SITE + '/',
  logo: SITE + '/apple-touch-icon.png',
};
const TEMPLATES = {
  post: 'bluewing/blog-post.html',
  project: 'bluewing/project-view.html',
  list: 'bluewing/blog.html',
};

const tplCache = {};
function template(type) {
  if (!tplCache[type]) {
    const rel = TEMPLATES[type];
    const candidates = [path.join(__dirname, '..', '..', rel), path.join(process.cwd(), rel)];
    const file = candidates.find((f) => fs.existsSync(f));
    if (!file) throw new Error('Template not found: ' + rel);
    tplCache[type] = fs.readFileSync(file, 'utf8');
  }
  return tplCache[type];
}

// The icon sprite URL the template already uses (it carries the current ?v= cache tag
// stamped by scripts/build-layout.js), so icons added here never point at a stale copy.
function iconHref(html, name) {
  const m = html.match(/\/assets\/icons\.svg(\?v=[0-9a-f]+)?#/);
  return '/assets/icons.svg' + (m && m[1] ? m[1] : '') + '#' + name;
}

// ---------- small helpers ----------

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function text(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
// Cut at a word boundary, ~155 characters, for meta descriptions.
function clip(s, max = 155) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 25)).replace(/[\s,;:.–—-]+$/, '') + '…';
}
function abs(url) {
  if (!url) return '';
  return /^https?:\/\//i.test(url) ? url : SITE + (url.startsWith('/') ? '' : '/') + url;
}
function slugify(s) {
  return String(s || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function list(v) {
  return Array.isArray(v) ? v.filter(Boolean) : [];
}
function day(d) {
  return /^\d{4}-\d{2}-\d{2}/.test(String(d || '')) ? String(d).slice(0, 10) : '';
}
function jsonLd(obj) {
  // "<" escaped so article text can never close the script tag
  return '<script type="application/ld+json">' + JSON.stringify(obj).replace(/</g, '\\u003c') + '</script>';
}

// ---------- template editing ----------

function setTitle(html, t) {
  return html.replace(/<title>[\s\S]*?<\/title>/, () => '<title>' + esc(t) + '</title>');
}
function setMeta(html, attr, key, value) {
  if (!value) return html;
  const tag = `<meta ${attr}="${key}" content="${esc(value)}">`;
  const re = new RegExp(`<meta\\s+${attr}="${key.replace(/[.:]/g, '\\$&')}"[^>]*>`);
  return re.test(html) ? html.replace(re, () => tag) : html.replace('</head>', () => tag + '\n</head>');
}
function setCanonical(html, url) {
  const tag = `<link rel="canonical" href="${esc(url)}">`;
  return /<link rel="canonical"[^>]*>/.test(html)
    ? html.replace(/<link rel="canonical"[^>]*>/, () => tag)
    : html.replace('</head>', () => tag + '\n</head>');
}
function addHead(html, snippet) {
  return html.replace('</head>', () => snippet + '\n</head>');
}
// Replace the inner HTML of the element with this id. Only used on elements that are
// empty or hold plain text in the template, so a non-greedy match is safe.
function fill(html, id, inner) {
  const re = new RegExp(`(<([a-z0-9]+)\\b[^>]*\\bid="${id}"[^>]*>)([\\s\\S]*?)(</\\2>)`);
  return html.replace(re, (m, open, tag, _old, close) => open + inner + close);
}
// Remove `hidden` / `style="display:none"` from the element with this id.
function show(html, id) {
  const re = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bid="${id}"[^>]*>`);
  return html.replace(re, (open) => open.replace(/\s+hidden(?=[\s>])/, '').replace(/\s+style="display:none"/, ''));
}

function notFound(res, html, what) {
  html = setTitle(html, what + ' not found | BlueWing Group');
  html = setMeta(html, 'name', 'robots', 'noindex, follow');
  html = fill(html, what === 'Article' ? 'bp-title' : 'pv-title', what + ' not found');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60');
  return res.status(404).send(html);
}

function send(res, html) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=86400');
  return res.status(200).send(html);
}

// ---------- blog article ----------

async function renderPost(res, slug) {
  // The browser script re-sets document.title after load; drop that line so Google's rendered
  // view keeps the server title.
  let html = template('post').replace("document.title = p.seoTitle || (p.title + ' — BlueWing Group');", '');
  const [{ data: posts }, { data: authors }] = await Promise.all([
    readJson('data/blog.json', []),
    readJson('data/authors.json', []),
  ]);
  const p = posts.find((x) => x.slug === slug && x.published !== false);
  if (!p) return notFound(res, html, 'Article');

  const url = `${SITE}/blog/${p.slug}`;
  const base = p.seoTitle || p.title;
  const title = base.length <= 52 && !/bluewing/i.test(base) ? `${base} | BlueWing` : base;
  const desc = clip(p.metaDescription || p.excerpt || text(p.content));
  const media = list(p.media);
  const image = abs(p.coverImage || (media[0] && media[0].url));
  const author = authors.find((a) => a.id === p.authorId);
  const cats = list(p.categories).length ? list(p.categories) : (p.category ? [p.category] : []);
  const tags = list(p.tags);
  const faqs = list(p.faqs).filter((f) => f.question && f.answer);
  const date = day(p.date);

  html = setTitle(html, title);
  html = setMeta(html, 'name', 'description', desc);
  html = setCanonical(html, url);
  html = setMeta(html, 'property', 'og:title', p.seoTitle || p.title);
  html = setMeta(html, 'property', 'og:description', desc);
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'property', 'og:image', image);
  html = setMeta(html, 'property', 'article:published_time', date);
  if (author) html = setMeta(html, 'name', 'author', author.name);

  const ld = [{
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: p.title,
    description: desc,
    image: image || undefined,
    datePublished: date || undefined,
    dateModified: day(p.updated) || date || undefined,
    author: author
      ? { '@type': 'Person', name: author.name, jobTitle: author.designation || undefined, worksFor: { '@type': 'Organization', name: ORG.name } }
      : ORG,
    publisher: ORG,
    mainEntityOfPage: url,
    articleSection: cats[0] || undefined,
    keywords: tags.length ? tags.join(', ') : undefined,
  }, {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: SITE + '/blog.html' },
      { '@type': 'ListItem', position: 3, name: p.title, item: url },
    ],
  }];
  if (faqs.length) {
    ld.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
    });
  }
  html = addHead(html, ld.map(jsonLd).join('\n'));

  html = fill(html, 'bp-title', esc(p.title));
  html = fill(html, 'bp-crumb', esc(p.title));
  html = fill(html, 'bp-category', esc(p.category || 'Blog'));
  html = fill(html, 'bp-category2', esc(p.category || 'Blog'));
  html = fill(html, 'bp-lead', esc(p.excerpt || ''));
  html = fill(html, 'bp-content', p.content || ''); // admin-authored HTML, same as the browser script inserts

  if (cats.length) {
    html = fill(html, 'bp-meta', `<span class="post-meta__l">${cats.length > 1 ? 'Categories' : 'Category'}</span>` +
      cats.map((c) => `<a class="post-cat" href="/blog/category/${slugify(c)}">${esc(c)}</a>`).join(''));
    html = show(html, 'bp-meta');
  }
  if (tags.length) {
    html = fill(html, 'bp-tag-list', '<span class="post-tags__l">Tags</span>' +
      tags.map((t) => `<a class="post-tag" href="/blog/tag/${slugify(t)}">${esc(t)}</a>`).join(''));
    html = show(html, 'bp-tag-list');
  }

  // Images: same layout the browser script uses for the default "grid" type; it upgrades
  // sliders and videos once it runs.
  if (p.mediaType === 'video' && p.videoUrl) {
    // left to the browser script
  } else if (media.length > 1) {
    html = fill(html, 'bp-media', '<div class="bp-only-grid">' + media.slice(0, 4).map((m, i) =>
      `<img decoding="async" src="${esc(m.url)}" alt="${esc(p.title)}${i ? ' — image ' + (i + 1) : ''}">`).join('') + '</div>');
  } else if (media.length === 1) {
    html = fill(html, 'bp-media', `<img decoding="async" class="bp-feature" src="${esc(media[0].url)}" alt="${esc(p.title)}">`);
  }

  if (faqs.length) {
    const plus = iconHref(html, 'i-plus');
    const answer = (a) => String(a).split(/\n\s*\n/).map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length && lines.every((l) => l.startsWith('- '))) return '<ul>' + lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join('') + '</ul>';
      return '<p>' + esc(block.trim()).replace(/\n/g, '<br>') + '</p>';
    }).join('');
    html = fill(html, 'bp-faq-list', faqs.map((f, i) =>
      `<div class="acc__i"><button class="acc__b" aria-expanded="${i === 0 ? 'true' : 'false'}">${esc(f.question)}` +
      `<span class="acc__ic"><svg><use href="${plus}"/></svg></span></button>` +
      `<div class="acc__p">${answer(f.answer)}</div></div>`).join(''));
    html = show(html, 'bp-faq-section');
  }

  if (author) {
    html = fill(html, 'bp-byline', (author.image ? `<img decoding="async" src="${esc(author.image)}" alt="${esc(author.name)}" width="46" height="46" loading="lazy">` : '') +
      `<div><b>${esc(author.name)}</b>${author.designation ? `<span>${esc(author.designation)}</span>` : ''}</div>`);
    html = show(html, 'bp-byline');
  }

  const related = posts.filter((o) => o.slug !== p.slug && o.published !== false)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 3);
  html = fill(html, 'bp-related', related.map(card).join(''));

  return send(res, html);
}

function card(o) {
  const img = o.coverImage || (o.media && o.media[0] && o.media[0].url) || '';
  return `<a class="art" href="/blog/${encodeURIComponent(o.slug)}">` +
    `<div class="art__im">${img ? `<img decoding="async" src="${esc(img)}" alt="${esc(o.title)}" loading="lazy" width="600" height="400">` : ''}</div>` +
    `<div><p class="lbl">${esc(o.category || 'Blog')}</p><h3>${esc(o.title)}</h3></div></a>`;
}

// ---------- blog index ----------

async function renderList(res) {
  let html = template('list');
  const { data: posts } = await readJson('data/blog.json', []);
  const published = posts.filter((p) => p.published !== false)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  // Every article is linked in the HTML, so crawlers find all of them. The browser script
  // then shows 12 at a time with "Load more" and the topic filter, as before.
  html = fill(html, 'ins-grid', published.map(card).join(''));
  html = addHead(html, [
    jsonLd({
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: 'BlueWing Blog & Industry Insights',
      url: SITE + '/blog.html',
      publisher: ORG,
      blogPost: published.slice(0, 20).map((p) => ({ '@type': 'BlogPosting', headline: p.title, url: `${SITE}/blog/${p.slug}`, datePublished: day(p.date) || undefined })),
    }),
    jsonLd({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: SITE + '/blog.html' },
      ],
    }),
  ].join('\n'));
  return send(res, html);
}

// ---------- project page ----------

function spec(p, re) {
  const rows = p.table && Array.isArray(p.table.rows) ? p.table.rows : [];
  const row = rows.find((r) => Array.isArray(r) && re.test(String(r[0] || '')));
  return row ? String(row[1] || '').trim() : '';
}

async function renderProject(res, slug) {
  let html = template('project').replace("document.title = p.title + ' — BlueWing Group';", '');
  const { data: projects } = await readJson('data/projects.json', []);
  const p = projects.find((x) => x.slug === slug && x.published !== false);
  if (!p) return notFound(res, html, 'Project');

  const url = `${SITE}/${p.slug}`;
  const sector = p.category || '';
  const status = p.status || 'Project';
  const location = spec(p, /location/i);
  const area = spec(p, /built.?up area/i);
  const images = list(p.images).filter((i) => i && i.url);
  const image = abs(images[0] && images[0].url);
  const body = text(p.content);

  // Location cleaned for display; a city for the title only when the name doesn't already carry one.
  const place = location.replace(/\s*-\s*/g, ' - ').replace(/[\s-]+$/, '').replace(/^gujarat,?\s*india$/i, 'Gujarat').trim();
  const cityMatch = place.match(/\b(Ahmedabad|Gandhinagar|Rajkot|Vadodara|Surat|Bharuch|Dahej|Kevadia|Kalol|Goa|Mumbai)\b/i);
  let city = cityMatch ? cityMatch[1] : (place && place !== 'Gujarat' && place.length <= 20 ? place : '');
  if (city && p.title.toLowerCase().includes(city.toLowerCase())) city = '';
  const sectorOne = sector.replace(/s$/, ''); // Hotels → Hotel, Hospitals → Hospital
  const sqft = area.replace(/\.0+$/, '');

  let title = `${p.title}${city ? ', ' + city : ''} | ${sectorOne ? sectorOne + ' ' : ''}Project | BlueWing`;
  if (title.length > 65) title = `${p.title} | ${sectorOne ? sectorOne + ' ' : ''}Project | BlueWing`;
  if (title.length > 65) title = `${p.title} | BlueWing DCPL`;

  const showPlace = place && !p.title.toLowerCase().includes(place.toLowerCase()) ? place : '';
  const facts = `${p.title}${showPlace ? ', ' + showPlace : ''}: ${status.toLowerCase()} ${sectorOne ? sectorOne.toLowerCase() + ' ' : ''}project by BlueWing DCPL` +
    (sqft && /\d/.test(sqft) ? `, ${sqft} sq ft built-up` : '') + '.';
  const desc = clip(facts + (body ? ' ' + body : ''));
  const alt = (i) => `${p.title}${place ? ', ' + place : ''} — ${sectorOne ? sectorOne.toLowerCase() + ' ' : ''}project by BlueWing DCPL${i ? ', photo ' + (i + 1) : ''}`;

  html = setTitle(html, title);
  html = setMeta(html, 'name', 'description', desc);
  html = setCanonical(html, url);
  html = setMeta(html, 'property', 'og:title', `${p.title} | BlueWing DCPL`);
  html = setMeta(html, 'property', 'og:description', desc);
  html = setMeta(html, 'property', 'og:url', url);
  html = setMeta(html, 'property', 'og:image', image);

  html = addHead(html, [
    jsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: p.title,
      url,
      description: desc,
      primaryImageOfPage: image || undefined,
      about: {
        '@type': 'CreativeWork',
        name: p.title,
        genre: sectorOne ? sectorOne + ' construction' : undefined,
        creativeWorkStatus: status,
        locationCreated: place ? { '@type': 'Place', name: place, address: { '@type': 'PostalAddress', addressRegion: 'Gujarat', addressCountry: 'IN' } } : undefined,
        image: images.map((i) => abs(i.url)),
        creator: ORG,
      },
      publisher: ORG,
    }),
    jsonLd({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Projects', item: SITE + '/projects.html' },
        { '@type': 'ListItem', position: 3, name: p.title, item: url },
      ],
    }),
  ].join('\n'));

  html = fill(html, 'pv-title', esc(p.title));
  html = fill(html, 'pv-crumb', esc(p.title));
  html = fill(html, 'pv-status', esc(status));
  html = fill(html, 'pv-category', esc(sector) || '&nbsp;');
  html = fill(html, 'pv-lead', esc(body.slice(0, 180)));
  html = fill(html, 'pv-content', p.content || '');

  if (list(p.tags).length) {
    html = fill(html, 'pv-tags', esc(p.tags.join(', ')));
    html = show(html, 'pv-tags-wrap');
  }

  if (images.length) {
    html = show(html, 'pv-gallery-section');
    html = fill(html, 'pv-gallery-hero', `<img decoding="async" src="${esc(images[0].url)}" alt="${esc(alt(0))}" width="1400" height="790">`);
    const rest = images.slice(1);
    if (rest.length) {
      html = fill(html, 'pv-gallery-grid', rest.map((img, i) =>
        `<img decoding="async" src="${esc(img.url)}" alt="${esc(alt(i + 1))}" loading="lazy" width="600" height="450">`).join(''));
    }
    if (p.photoCaption || p.photoCredit) {
      html = show(html, 'pv-gallery-cap');
      html = fill(html, 'pv-photo-caption', esc(p.photoCaption || ''));
      html = fill(html, 'pv-photo-credit', esc(p.photoCredit || ''));
    }
  }

  if (p.table && Array.isArray(p.table.rows) && p.table.rows.length) {
    const th = list(p.table.headers).length
      ? '<thead><tr>' + p.table.headers.map((h) => `<th style="text-align:left;padding:10px 14px;border-bottom:2px solid var(--line-dk)">${esc(h)}</th>`).join('') + '</tr></thead>'
      : '';
    const tb = '<tbody>' + p.table.rows.map((row) => '<tr>' + list(row).map((c) =>
      `<td style="padding:10px 14px;border-bottom:1px solid var(--line-2)">${esc(c)}</td>`).join('') + '</tr>').join('') + '</tbody>';
    html = fill(html, 'pv-table', th + tb);
    html = show(html, 'pv-table-section');
  }

  return send(res, html);
}

// ---------- entry ----------

module.exports = async (req, res) => {
  const { render: type, slug } = req.query || {};
  const clean = String(slug || '').toLowerCase();
  try {
    if (type === 'list') return await renderList(res);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean)) return notFound(res, template(type === 'post' ? 'post' : 'project'), type === 'post' ? 'Article' : 'Project');
    if (type === 'post') return await renderPost(res, clean);
    if (type === 'project') return await renderProject(res, clean);
    return res.status(400).send('Bad request');
  } catch (err) {
    // If data can't be read, fall back to the plain template; the browser script fills it
    // in as it did before this change, so visitors never see an error page.
    try {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(template(type === 'post' ? 'post' : type === 'list' ? 'list' : 'project'));
    } catch (e) {
      return res.status(500).send('Server error');
    }
  }
};
