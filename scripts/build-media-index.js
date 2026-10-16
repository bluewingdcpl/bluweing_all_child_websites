// Rebuilds data/media-index.json: every image and video the three websites use,
// so the admin Media library can show them all. Re-run after adding images to pages:
//   node scripts/build-media-index.js
// The admin panel lives on the BlueWing domain, so site paths are kept relative when
// the file exists in bluewing/, and made absolute (that site's domain) otherwise.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITES = ['bluewing', 'bhaaratprecast', 'sygnificinfra'];
const domains = JSON.parse(fs.readFileSync(path.join(ROOT, 'domains.json'), 'utf8'));
const ORIGIN = { ...domains.current, bhaaratprecast: 'https://www.bhaaratprecast.com' };
const OWN_HOSTS = new Set(
  [...Object.values(domains.current), ...Object.values(domains.production), ORIGIN.bhaaratprecast]
    .map((u) => new URL(u).host)
);
const EXT = '(?:png|jpe?g|webp|gif|svg|avif|mp4|webm|mov)';
const URL_RE = new RegExp(`(?:https?:\\/\\/|\\.{1,2}\\/|\\/|assets\\/)[^\\s"'()<>\\\\]*?\\.${EXT}(?=[?#"'()\\s<>\\\\,]|$)`, 'gi');

function walk(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return walk(p, ext);
    return d.name.endsWith(ext) ? [p] : [];
  }).sort();
}

const sources = [
  ...walk(path.join(ROOT, 'data'), '.json').filter((f) => !f.endsWith('media-index.json')).map((f) => ({ file: f, site: 'bluewing', base: '/' })),
  ...SITES.flatMap((site) => walk(path.join(ROOT, site), '.html').map((f) => ({
    file: f,
    site,
    base: '/' + path.relative(path.join(ROOT, site), path.dirname(f)).split(path.sep).join('/'),
  }))),
];

const seen = new Set();
const index = [];
const broken = new Set();

for (const { file, site, base } of sources) {
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.match(URL_RE) || []) {
    let url = raw;
    let owner = site;
    if (/^https?:\/\//i.test(url)) {
      const u = new URL(url);
      if (!OWN_HOSTS.has(u.host)) { add(url); continue; }
      // our own domain written absolutely (og:image etc.) -> treat as a site path
      owner = Object.keys(ORIGIN).find((s) => new URL(ORIGIN[s]).host === u.host) || site;
      url = u.pathname;
    } else if (!url.startsWith('/')) {
      url = path.posix.normalize(path.posix.join(base, url));
    }
    const onDisk = (s) => fs.existsSync(path.join(ROOT, s, decodeURIComponent(url)));
    if (!onDisk(owner)) { broken.add(`${owner}${url}  (in ${path.relative(ROOT, file)})`); continue; }
    add(owner === 'bluewing' || onDisk('bluewing') ? url : ORIGIN[owner] + url);
  }
}

function add(url) {
  if (seen.has(url)) return;
  seen.add(url);
  index.push({ url });
}

fs.writeFileSync(path.join(ROOT, 'data', 'media-index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`${index.length} images/videos written to data/media-index.json`);
if (broken.size) console.log('Referenced but missing on disk:\n  ' + [...broken].join('\n  '));
