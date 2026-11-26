#!/usr/bin/env node
/*
 * One header, one footer per site.
 *
 * Each site keeps its own files:
 *   <site>/_layout/header.html   header + mobile menu
 *   <site>/_layout/footer.html   footer
 *   <site>/assets/icons.svg      icons used by every page
 *   <site>/assets/js/site.js     script used by every page (contact-us keeps its own inline copy)
 *
 * Every page has markers, and this script fills them from the site's _layout files:
 *   <!-- layout:header current="/projects.html" -->  ...  <!-- /layout:header -->
 *   <!-- layout:footer -->  ...  <!-- /layout:footer -->
 *
 *   current="/x.html"   the menu link marked as the page you are on (aria-current)
 *   cobrand="Name"      company name next to the logo (BlueWing DCPL page)
 *
 * Sites with a <site>/_layout/schema.html also get it in every page's <head>, between
 *   <!-- layout:schema -->  ...  <!-- /layout:schema -->   (added before </head> if missing).
 *   It holds the sitewide structured data (organisation, local business, website).
 *
 * For the BlueWing site it also writes data/page-dates.json: each static page's last change
 * date (from git, or today for pages with uncommitted edits). /sitemap.xml uses it for <lastmod>.
 *
 * It also stamps ?v=<hash> on icons.svg and site.js links, so browsers fetch a new copy only
 * when the file has changed (vercel.json lets browsers keep these files cached).
 *
 *   node scripts/build-layout.js           update every page
 *   node scripts/build-layout.js --check   list pages that are out of date, change nothing
 *
 * Run it after editing anything in _layout/, icons.svg or site.js, and commit the pages it changes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SITES = ['bluewing', 'bhaaratprecast', 'sygnificinfra', 'alutek'];
const SKIP_DIRS = new Set(['_layout', 'assets', 'new-pillar']);
const check = process.argv.includes('--check');

function pagesOf(siteDir) {
  const out = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p); } else if (name.endsWith('.html')) out.push(p);
    }
  })(siteDir);
  return out.sort();
}

function hashOf(file) {
  return fs.existsSync(file) ? crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').slice(0, 8) : null;
}

function attrsOf(text) {
  const attrs = {};
  for (const m of text.matchAll(/([a-z]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}

function render(name, partial, attrs, file) {
  let html = partial;
  if (name === 'header') {
    if (attrs.current) {
      const link = `<a class="nav__l" href="${attrs.current}">`;
      if (!html.includes(link)) throw new Error(`${file}: no menu link ${attrs.current} in the header`);
      html = html.split(link).join(`<a class="nav__l" aria-current="page" href="${attrs.current}">`);
    }
    const cobrand = attrs.cobrand ? `<span class="brand__div"></span><span class="brand__co">${attrs.cobrand}</span>` : '';
    html = html.split('{{cobrand}}').join(cobrand);
  }
  return html;
}

let changed = 0, total = 0;
for (const site of SITES) {
  const siteDir = path.join(ROOT, site);
  const partials = {};
  for (const name of ['header', 'footer']) {
    partials[name] = fs.readFileSync(path.join(siteDir, '_layout', `${name}.html`), 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  }
  const schemaFile = path.join(siteDir, '_layout', 'schema.html');
  const schema = fs.existsSync(schemaFile) ? fs.readFileSync(schemaFile, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '') : null;
  const iconsV = hashOf(path.join(siteDir, 'assets', 'icons.svg'));
  const jsV = hashOf(path.join(siteDir, 'assets', 'js', 'site.js'));

  for (const file of pagesOf(siteDir)) {
    total++;
    const before = fs.readFileSync(file, 'utf8');
    const eol = before.includes('\r\n') ? '\r\n' : '\n';
    let html = before.replace(/\r\n/g, '\n');
    for (const name of ['header', 'footer']) {
      const re = new RegExp(`(<!-- layout:${name}\\b([^>]*?)-->)[\\s\\S]*?(<!-- /layout:${name} -->)`);
      const m = html.match(re);
      if (!m) throw new Error(`${path.relative(ROOT, file)}: no layout:${name} markers`);
      const body = render(name, partials[name], attrsOf(m[2]), path.relative(ROOT, file));
      html = html.replace(re, () => `${m[1]}\n${body}\n${m[3]}`);
    }
    if (schema) {
      const block = `<!-- layout:schema -->\n${schema}\n<!-- /layout:schema -->`;
      const re = /<!-- layout:schema -->[\s\S]*?<!-- \/layout:schema -->/;
      if (re.test(html)) html = html.replace(re, () => block);
      else if (html.includes('</head>')) html = html.replace('</head>', () => `\n${block}\n</head>`);
    }
    if (iconsV) html = html.replace(/\/assets\/icons\.svg(\?v=[0-9a-f]*)?#/g, `/assets/icons.svg?v=${iconsV}#`);
    if (jsV) html = html.replace(/\/assets\/js\/site\.js(\?v=[0-9a-f]*)?"/g, `/assets/js/site.js?v=${jsV}"`);
    html = html.replace(/\n/g, eol);
    if (html !== before) {
      changed++;
      if (check) console.log('out of date:', path.relative(ROOT, file));
      else fs.writeFileSync(file, html);
    }
  }
}
if (!check) writePageDates();
console.log(`${check ? 'checked' : 'built'} ${total} pages, ${changed} ${check ? 'out of date' : 'updated'}`);
if (check && changed) process.exit(1);

// data/page-dates.json for the sitemap: URL -> last change date of the page file.
function writePageDates() {
  const site = path.join(ROOT, 'bluewing');
  const git = (args) => execSync(`git -c safe.directory=* ${args}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let dirty;
  try {
    dirty = new Set(git('status --porcelain -- bluewing').split('\n')
      .map((l) => l.slice(3).trim().replace(/^"|"$/g, '')).filter(Boolean));
  } catch (e) { console.log('page-dates: git not available, skipped'); return; }
  const today = new Date().toISOString().slice(0, 10);
  const dates = {};
  for (const file of pagesOf(site)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const inSite = rel.slice('bluewing/'.length);
    let url;
    if (inSite === 'index.html') url = '/';
    else if (inSite === 'projects/rameshwar-sky.html') url = '/projects/rameshwar-sky.html';
    else if (!inSite.includes('/')) url = '/' + inSite;
    else continue; // other sub-folder pages are redirects or templates
    let d = '';
    if (!dirty.has(rel)) { try { d = git(`log -1 --format=%cs -- "${rel}"`).trim(); } catch (e) { d = ''; } }
    dates[url] = d || today;
  }
  const out = path.join(ROOT, 'data', 'page-dates.json');
  const json = JSON.stringify(dates, null, 2) + '\n';
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== json) fs.writeFileSync(out, json);
}
