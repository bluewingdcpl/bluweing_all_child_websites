const { readJson, writeJson } = require('./github');

// Who receives each website form by email. Set from the admin panel
// (Leads → Email recipients); an empty value means "use the default from
// the Vercel environment variables".
const RECIPIENTS_PATH = 'data/form-recipients.json';
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const MAX_ADDRESSES = 10;

const FORMS = [
  { key: 'project-enquiry', label: 'BlueWing: Contact page, Project enquiry' },
  { key: 'vendor-registration', label: 'BlueWing: Contact page, Vendor registration' },
  { key: 'job-application', label: 'BlueWing: Careers page, Job application' },
  { key: 'bhaarat-enquiry', label: 'Bhaarat Precast: Contact page' },
  { key: 'sygnific-enquiry', label: 'Sygnific Infra: Contact form' },
];

function defaults() {
  const main = process.env.SMTP_TO || process.env.SMTP_USER || '';
  return {
    'project-enquiry': main,
    'vendor-registration': main,
    'job-application': main,
    'bhaarat-enquiry': main,
    'sygnific-enquiry': process.env.SYGNIFIC_SMTP_TO || 'info@sygnificinfra.com, mayur.d@sygnificinfra.com',
  };
}

// Normalises "a@x.com; b@y.com" to "a@x.com, b@y.com". Throws on a bad address.
function cleanList(value) {
  const list = String(value || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  if (list.length > MAX_ADDRESSES) throw new Error(`At most ${MAX_ADDRESSES} email addresses per form`);
  const bad = list.find((e) => !EMAIL_RE.test(e));
  if (bad) throw new Error(`"${bad}" is not a valid email address`);
  return list.join(', ');
}

async function readSaved(useCache = true) {
  const { data } = await readJson(RECIPIENTS_PATH, {}, useCache);
  return data && typeof data === 'object' ? data : {};
}

// The address list a form's email goes to: the admin setting, else the default.
async function recipientFor(key) {
  try {
    const saved = await readSaved();
    if (saved[key]) return saved[key];
  } catch (e) {
    console.error('form recipients read failed:', e.message);
  }
  return defaults()[key] || '';
}

async function listRecipients(useCache = true) {
  const saved = await readSaved(useCache);
  const d = defaults();
  return FORMS.map((f) => ({ key: f.key, label: f.label, value: saved[f.key] || '', default: d[f.key] || '' }));
}

async function saveRecipients(input) {
  const saved = await readSaved(false);
  const next = {};
  FORMS.forEach((f) => {
    const raw = input && Object.prototype.hasOwnProperty.call(input, f.key) ? input[f.key] : saved[f.key];
    const value = cleanList(raw);
    if (value) next[f.key] = value;
  });
  await writeJson(RECIPIENTS_PATH, next, 'admin: update form email recipients');
}

module.exports = { recipientFor, listRecipients, saveRecipients };
