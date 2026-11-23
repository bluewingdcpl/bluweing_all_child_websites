const { put } = require('@vercel/blob');
const { sendMail } = require('./_lib/mailer');
const { recipientFor } = require('./_lib/recipients');
const { requireAuth } = require('./_lib/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The resume travels as base64 inside the JSON body, and Vercel caps a function's request body
// at 4.5 MB, so 3 MB is the largest file that reliably fits (3 MB → about 4 MB of base64).
const MAX_RESUME_BYTES = 3 * 1024 * 1024;
const ALLOWED_RESUME_EXT = /\.(pdf|docx?)$/i;
const RESUME_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const REQUIRED_FIELDS = {
  'project-enquiry': ['name', 'email', 'phone'],
  'vendor-registration': ['company', 'name', 'email', 'phone', 'category', 'city'],
  'job-application': ['name', 'email', 'phone', 'company', 'applyFor'],
  'sygnific-enquiry': ['name', 'company', 'email', 'phone', 'message'],
  'alutek-enquiry': ['name', 'email', 'phone'],
};


const LABELS = {
  name: 'Name', company: 'Company', email: 'Email', phone: 'Phone', interest: 'Interest',
  message: 'Message', category: 'Category of supply', city: 'City / state', gst: 'GST number',
  years: 'Years in business', website: 'Website / catalogue', applyFor: 'Apply for', resumeFile: 'Resume',
  resumeUrl: 'Resume link',
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

async function siteverify(secret, token) {
  const params = new URLSearchParams({ secret, response: token });
  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  return res.json();
}

const BAD_SECRET = ['invalid-input-secret', 'missing-input-secret'];

// Returns { ok, reason }. A wrong RECAPTCHA_SECRET_KEY or Google being
// unreachable is our problem, not spam, so those let the lead through and log.
async function verifyRecaptcha(token) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return { ok: true, reason: 'not-configured' };
  if (!token) return { ok: false, reason: 'missing-token' };

  let result;
  try {
    result = await siteverify(secret, token);
  } catch (e) {
    console.error('reCAPTCHA verify unavailable:', e.message);
    return { ok: true, reason: 'verify-unavailable' };
  }
  const codes = result['error-codes'] || [];
  if (codes.some((c) => BAD_SECRET.includes(c))) {
    console.error('RECAPTCHA_SECRET_KEY is invalid; submissions are not spam-checked until it is fixed.');
    return { ok: true, reason: 'invalid-secret' };
  }
  if (result.success !== true) {
    console.warn('reCAPTCHA rejected:', codes.join(','), result.hostname || '');
    return { ok: false, reason: codes.join(',') || 'failed' };
  }
  if (result.score !== undefined && result.score < 0.5) {
    console.warn('reCAPTCHA low score:', result.score, result.hostname || '');
    return { ok: false, reason: 'low-score' };
  }
  return { ok: true };
}

// Admin-only setup check (GET /api/enquiry?check): is each piece configured?
async function setupCheck(req, res) {
  if (!requireAuth(req, res)) return;
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  let recaptcha = 'not-set';
  if (secret) {
    try {
      const codes = (await siteverify(secret, 'setup-check'))['error-codes'] || [];
      recaptcha = codes.some((c) => BAD_SECRET.includes(c)) ? 'invalid-secret' : 'ok';
    } catch (e) {
      recaptcha = 'unreachable';
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    smtp: ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].filter((k) => !process.env[k]).map((k) => k + ' missing').join(', ') || 'ok',
    storage: process.env.BLOB_READ_WRITE_TOKEN ? 'ok' : 'BLOB_READ_WRITE_TOKEN missing',
    recaptcha,
  });
}

module.exports = async (req, res) => {
  if (req.method === 'GET' && (req.query || {}).check !== undefined) return setupCheck(req, res);
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = await readBody(req);
    const formType = ['vendor-registration', 'job-application', 'sygnific-enquiry', 'alutek-enquiry'].includes(body.formType) ? body.formType : 'project-enquiry';
    const required = REQUIRED_FIELDS[formType];

    for (const field of required) {
      if (!body[field] || !String(body[field]).trim()) {
        return res.status(400).json({ error: `${LABELS[field] || field} is required` });
      }
    }
    if (!EMAIL_RE.test(String(body.email || '').trim())) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    // The resume goes out attached to the email; Blob storage (when set up) only adds a link and a saved copy.
    let resume = null;
    if (formType === 'job-application') {
      const filename = String(body.resumeFilename || '').trim();
      if (!body.resumeBase64 || !filename) {
        return res.status(400).json({ error: 'Resume is required' });
      }
      if (!ALLOWED_RESUME_EXT.test(filename)) {
        return res.status(400).json({ error: 'Resume must be a PDF, DOC or DOCX file' });
      }
      const base64Data = body.resumeBase64.includes(',') ? body.resumeBase64.split(',')[1] : body.resumeBase64;
      const buffer = Buffer.from(base64Data, 'base64');
      if (!buffer.length) {
        return res.status(400).json({ error: 'The resume file is empty. Please attach it again.' });
      }
      if (buffer.length > MAX_RESUME_BYTES) {
        return res.status(400).json({ error: 'Resume must be under 3MB' });
      }
      const ext = filename.split('.').pop().toLowerCase();
      resume = {
        filename: filename.replace(/[\\/:*?"<>|\r\n\t]/g, '_').slice(-120),
        content: buffer,
        contentType: RESUME_TYPES[ext],
      };
    }

    const humanCheck = await verifyRecaptcha(body.recaptchaToken);
    if (!humanCheck.ok) {
      return res.status(400).json({ error: 'Spam check failed. Please try again.', reason: humanCheck.reason });
    }

    let resumeUrl = '';
    if (resume && process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const safeName = resume.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `resumes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
        const blob = await put(key, resume.content, { access: 'public', contentType: resume.contentType });
        resumeUrl = blob.url;
      } catch (err) {
        console.error('resume not saved to Blob (it is still attached to the email):', err.message);
      }
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
    delete entry.fields.resumeFile;
    if (resume) entry.fields.resumeFile = resume.filename;
    if (resumeUrl) entry.fields.resumeUrl = resumeUrl;

    let emailError = 'SMTP_HOST is not set', emailed = false;
    if (process.env.SMTP_HOST) {
      emailError = null;
      try {
        const rows = Object.entries(entry.fields)
          .filter(([, v]) => v)
          .map(([k, v]) => {
            const value = k === 'resumeUrl' ? `<a href="${esc(v)}">Download resume</a>`
              : k === 'resumeFile' ? `${esc(v)} (attached to this email)` : esc(v);
            return `<tr><td style="padding:6px 12px;color:#56687A;font-weight:600">${esc(LABELS[k] || k)}</td><td style="padding:6px 12px">${value}</td></tr>`;
          })
          .join('');
        const titles = {
          'vendor-registration': 'New vendor registration',
          'job-application': 'New job application',
          'project-enquiry': 'New project enquiry',
          'sygnific-enquiry': 'New Sygnific Infra enquiry',
          'bhaarat-enquiry': 'New Bhaarat Precast enquiry',
          'alutek-enquiry': 'New AluTek BES enquiry',
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
          attachments: resume ? [{ filename: resume.filename, content: resume.content, contentType: resume.contentType }] : undefined,
        });
        emailed = true;
      } catch (err) {
        emailError = err.message;
      }
    }
    entry.emailError = emailed ? null : emailError;

    let saved = false, saveError = 'Blob storage not configured';
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        await put(`submissions/${formType}/${entry.id}.json`, JSON.stringify(entry, null, 2), {
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false,
        });
        saved = true;
      } catch (err) {
        saveError = err.message;
        console.error(`${formType} not saved to Blob:`, err.message);
      }
    }

    // Not emailed and not saved means the enquiry would be lost: say so instead of thanking the visitor.
    if (!emailed && !saved) {
      console.error(`${formType} not delivered: ${emailError}; not saved: ${saveError}`);
      return res.status(503).json({ error: 'Your message could not be sent right now. Please email or call us directly.' });
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Server error' });
  }
};
