// Images uploaded from the admin panel while Vercel Blob storage is not set up are
// committed to the repo under bluewing/assets/uploads/YYYY/MM/ and served by the
// BlueWing site itself. Admin uploads are named "<13-digit time>-<6 chars>-<name>",
// which is what tells them apart from the site's own images in that folder.
const SITE_DIR = 'bluewing';
const UPLOAD_DIR = `${SITE_DIR}/assets/uploads`;
const ADMIN_UPLOAD_RE = /^\d{13}-[a-z0-9]{6}-/;
const IMAGE_RE = /\.(png|jpe?g|webp|gif|svg|avif)$/i;

// Absolute URL on the domain the admin panel is open on, so the image also works
// when used on the Bhaarat / Sygnific sites (e.g. as a logo).
function siteUrl(req, repoPath) {
  return `https://${req.headers.host}${repoPath.slice(SITE_DIR.length)}`;
}

// Repo path for a site URL (absolute on our host, or a /assets/uploads/... path), else null.
function repoPathFor(req, url) {
  let pathname;
  try {
    const u = new URL(url, `https://${req.headers.host}`);
    if (u.host !== req.headers.host) return null;
    pathname = decodeURIComponent(u.pathname);
  } catch (e) {
    return null;
  }
  return pathname.startsWith('/assets/uploads/') ? SITE_DIR + pathname : null;
}

function isAdminUpload(repoPath) {
  return ADMIN_UPLOAD_RE.test(repoPath.split('/').pop());
}

module.exports = { UPLOAD_DIR, IMAGE_RE, siteUrl, repoPathFor, isAdminUpload };
