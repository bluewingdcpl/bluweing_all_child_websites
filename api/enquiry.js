const { put } = require('@vercel/blob');
const { sendMail } = require('./_lib/mailer');
const { recipientFor } = require('./_lib/recipients');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RESUME_BYTES = 5 * 1024 * 1024;
const ALLOWED_RESUME_EXT = /\.(pdf|docx?)$/i;

const REQUIRED_FIELDS = {
  'project-enquiry': ['name', 'email', 'phone'],
  'vendor-registration': ['company', 'name', 'email', 'phone', 'category', 'city'],
  'job-application': ['name', 'email', 'phone', 'company', 'applyFor'],
  'sygnific-enquiry': ['name', 'company', 'email', 'phone', 'message'],
};


const LABELS = {
  name: 'Name', company: 'Company', email: 'Email', phone: 'Phone', interest: 'Interest',
  message: 'Message', category: 'Category of supply', city: 'City / state', gst: 'GST number',
  years: 'Years in business', website: 'Website / catalogue', applyFor: 'Apply for', resumeUrl: 'Resume',
};

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function readBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  return body || {};
}

async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return true; // not configured yet — don't block submissions
  if (!token) return false;

  const params = new URLSearchParams({ secret, response: token });
  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const result = await res.json();
  return result.success === true && (result.score === undefined || result.score >= 0.5);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readBody(req);
    const formType = ['vendor-registration', 'job-application', 'sygnific-enquiry'].includes(body.formType) ? body.formType : 'project-enquiry';
    const required = REQUIRED_FIELDS[formType];

    for (const field of required) {
      if (!body[field] || !String(body[field]).trim()) {
        return res.status(400).json({ error: `${LABELS[field] || field} is required` });
      }
    }
    if (!EMAIL_RE.test(String(body.email || '').trim())) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    let resumeUrl = '';
    if (formType === 'job-application') {
      if (!body.resumeBase64 || !body.resumeFilename) {
        return res.status(400).json({ error: 'Resume is required' });
      }
      if (!ALLOWED_RESUME_EXT.test(body.resumeFilename)) {
        return res.status(400).json({ error: 'Resume must be a PDF or DOCX file' });
      }
      const base64Data = body.resumeBase64.includes(',') ? body.resumeBase64.split(',')[1] : body.resumeBase64;
      const buffer = Buffer.from(base64Data, 'base64');
      if (buffer.length > MAX_RESUME_BYTES) {
        return res.status(400).json({ error: 'Resume must be under 5MB' });
      }
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        const safeName = body.resumeFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `resumes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
        const blob = await put(key, buffer, {
          access: 'public',
          contentType: body.resumeContentType || 'application/octet-stream',
        });
        resumeUrl = blob.url;
      }
    }

    const humanCheck = await verifyRecaptcha(body.recaptchaToken);
    if (!humanCheck) {
      return res.status(400).json({ error: 'Spam check failed. Please try again.' });
    }

    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      formType,
      submittedAt: new Date().toISOString(),
      fields: {},
    };
    Object.keys(LABELS).forEach((key) => {
      if (body[key] !== undefined) entry.fields[key] = String(body[key]).trim();
    });
    if (resumeUrl) entry.fields.resumeUrl = resumeUrl;

    let emailError = null;
    if (process.env.SMTP_HOST) {
      try {
        const rows = Object.entries(entry.fields)
          .filter(([, v]) => v)
          .map(([k, v]) => {
            const value = k === 'resumeUrl' ? `<a href="${esc(v)}">Download resume</a>` : esc(v);
            return `<tr><td style="padding:6px 12px;color:#56687A;font-weight:600">${esc(LABELS[k] || k)}</td><td style="padding:6px 12px">${value}</td></tr>`;
          })
          .join('');
        const titles = {
          'vendor-registration': 'New vendor registration',
          'job-application': 'New job application',
          'project-enquiry': 'New project enquiry',
          'sygnific-enquiry': 'New Sygnific Infra enquiry',
          'bhaarat-enquiry': 'New Bhaarat Precast enquiry',
        };
        // Bhaarat's contact form is saved as a project enquiry but has its own recipients.
        const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
        const mailKey = formType === 'project-enquiry' && /bhaarat/i.test(host) ? 'bhaarat-enquiry' : formType;
        const title = titles[mailKey];
        await sendMail({
          subject: `${title} — ${entry.fields.name || entry.fields.company || 'BlueWing website'}`,
          html: `<h2>${title}</h2><table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">${rows}</table>`,
          replyTo: entry.fields.email,
          to: (await recipientFor(mailKey)) || undefined,
        });
      } catch (err) {
        emailError = err.message;
      }
    }
    entry.emailError = emailError;

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      await put(`submissions/${formType}/${entry.id}.json`, JSON.stringify(entry, null, 2), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
      });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
};
