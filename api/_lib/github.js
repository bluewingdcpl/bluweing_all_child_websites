const OWNER = process.env.GITHUB_OWNER || 'brandismtechnologies2023-eng';
const REPO = process.env.GITHUB_REPO || 'bluweing_all_child_websites';
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const API = 'https://api.github.com';

function headers() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not configured on the server');
  return {
    Authorization: `token ${token}`,
    'User-Agent': 'bluewing-admin-panel',
    Accept: 'application/vnd.github+json',
  };
}

// Tiny in-memory cache, keyed by path. It only merges bursts of requests; after
// 2s every read asks GitHub again with the stored ETag, so admin changes show up
// on the next page refresh. An unchanged file comes back as a 304, which is fast
// and does not count against the GitHub rate limit. The cached copy is also the
// stale fallback if GitHub has a transient hiccup.
const CACHE_TTL_MS = 2 * 1000;
const cache = new Map(); // path -> { result, at, etag }

// Reads a JSON file from the repo. Returns { data, sha }. If missing, returns { data: fallback, sha: null }.
async function readJson(path, fallback, useCache = true) {
  const cached = cache.get(path);
  if (useCache && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.result;
  }

  try {
    const reqHeaders = headers();
    if (cached && cached.etag) reqHeaders['If-None-Match'] = cached.etag;
    const res = await fetch(
      `${API}/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`,
      { headers: reqHeaders }
    );
    if (res.status === 304 && cached) {
      cached.at = Date.now();
      return cached.result;
    }
    if (res.status === 404) {
      const result = { data: fallback, sha: null };
      cache.set(path, { result, at: Date.now() });
      return result;
    }
    if (!res.ok) throw new Error(`GitHub read failed (${res.status}): ${await res.text()}`);
    const json = await res.json();
    const content = Buffer.from(json.content, 'base64').toString('utf-8');
    const result = { data: JSON.parse(content), sha: json.sha };
    cache.set(path, { result, at: Date.now(), etag: res.headers.get('etag') });
    return result;
  } catch (err) {
    if (cached) return cached.result; // serve stale rather than fail outright
    throw err;
  }
}

// Writes a JSON file back to the repo (creates or updates).
async function writeJson(path, data, message) {
  const { sha } = await readJson(path, null, false).catch(() => ({ sha: null }));
  cache.delete(path);
  const body = {
    message,
    content: Buffer.from(JSON.stringify(data, null, 2), 'utf-8').toString('base64'),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub write failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  // Remember what we just wrote so this instance serves it straight away.
  if (json.content && json.content.sha) {
    cache.set(path, { result: { data, sha: json.content.sha }, at: Date.now() });
  }
  return json;
}

// Public URL GitHub serves a repo file from straight after it is committed
// (the site itself only has it after the next deploy).
function rawUrl(path) {
  return `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path}`;
}

let treeCache = null;

// Adds a new file (base64 content) to the repo.
async function createFile(path, base64, message) {
  const res = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: base64, branch: BRANCH }),
  });
  if (!res.ok) throw new Error(`GitHub upload failed (${res.status}): ${await res.text()}`);
  treeCache = null;
  return res.json();
}

async function deleteFile(path, message) {
  const meta = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`, { headers: headers() });
  if (meta.status === 404) return;
  if (!meta.ok) throw new Error(`GitHub read failed (${meta.status}): ${await meta.text()}`);
  const { sha } = await meta.json();
  const res = await fetch(`${API}/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'DELETE',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch: BRANCH }),
  });
  if (!res.ok) throw new Error(`GitHub delete failed (${res.status}): ${await res.text()}`);
  treeCache = null;
}

// Paths of all files under a folder, from one call for the whole repo tree.
async function listFiles(prefix) {
  if (!treeCache || Date.now() - treeCache.at > CACHE_TTL_MS) {
    const res = await fetch(`${API}/repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`, { headers: headers() });
    if (!res.ok) throw new Error(`GitHub list failed (${res.status}): ${await res.text()}`);
    const json = await res.json();
    treeCache = { at: Date.now(), paths: json.tree.filter((t) => t.type === 'blob').map((t) => t.path) };
  }
  return treeCache.paths.filter((p) => p.startsWith(prefix));
}

module.exports = { readJson, writeJson, rawUrl, createFile, deleteFile, listFiles };
