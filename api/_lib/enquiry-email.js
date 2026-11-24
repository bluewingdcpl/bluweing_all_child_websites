// The notification email sent to the team for every website form (all four sites).
// Inline styles and table layout, because email clients drop most CSS.

const INK = '#061523';
const ACCENT = '#34446F';
const ACCENT_LT = '#93A1CE';
const MUTED = '#5B6B7C';
const LINE = '#E3E7EC';
const FONT = 'Arial,Helvetica,sans-serif';

// Only links to our own sites are shown as links in the email.
const OWN_HOST = /^(www\.)?(bluewingconstruction|bhaaratprecast|sygnificinfra|alutekenvelope)\.com$|\.vercel\.app$/i;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The page the form was sent from, read from the browser's Referer header.
function pageFrom(req) {
  const ref = String((req.headers || {}).referer || (req.headers || {}).referrer || '');
  let u;
  try { u = new URL(ref); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol) || !OWN_HOST.test(u.hostname)) return null;
  u.hash = '';
  const slug = u.pathname.replace(/\/+$/, '').split('/').pop().replace(/\.html$/i, '');
  const name = slug ? slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'Home page';
  return { url: u.href, host: u.hostname, name, label: u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname) };
}

function siteName(host, formType) {
  if (formType === 'sygnific-enquiry' || /sygnific/i.test(host)) return 'Sygnific Infra';
  if (formType === 'alutek-enquiry' || /alutek/i.test(host)) return 'AluTek BES';
  if (/bhaarat/i.test(host)) return 'Bhaarat Precast';
  return 'BlueWing Group';
}

function whenIST(iso) {
  try {
    return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' IST';
  } catch (e) {
    return iso;
  }
}

const telHref = (phone) => 'tel:' + String(phone).replace(/[^\d+]/g, '');

function valueHtml(key, value) {
  const v = esc(value);
  if (key === 'email') return `<a href="mailto:${v}" style="color:${ACCENT};text-decoration:none">${v}</a>`;
  if (key === 'phone') return `<a href="${esc(telHref(value))}" style="color:${ACCENT};text-decoration:none">${v}</a>`;
  if (key === 'website' && /^https?:\/\/[^\s]+$/i.test(value)) return `<a href="${v}" style="color:${ACCENT}">${v}</a>`;
  return v.replace(/\r?\n/g, '<br>');
}

const button = (href, label, solid) =>
  `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:11px 18px;border-radius:6px;font:600 14px ${FONT};text-decoration:none;` +
  (solid ? `background:${ACCENT};color:#ffffff;border:1px solid ${ACCENT}` : `background:#ffffff;color:${ACCENT};border:1px solid ${ACCENT}`) +
  `">${esc(label)}</a>`;

/**
 * title: "New project enquiry"; subject: the email subject; formType; host: site host;
 * fields: entry.fields; labels: field labels; page: pageFrom(req) or null;
 * submittedAt: ISO time; resume: { filename } when a file is attached.
 */
function buildEnquiryEmail({ title, subject, formType, host, fields, labels, page, submittedAt, resume }) {
  const site = siteName((page && page.host) || host || '', formType);
  const skip = new Set(['message', 'resumeFile', 'resumeUrl', 'pageUrl']);
  const rows = Object.entries(fields).filter(([k, v]) => v && !skip.has(k));

  const rowHtml = rows.map(([k, v], i) =>
    `<tr><td style="padding:11px 14px;width:150px;vertical-align:top;font:600 12px/1.5 ${FONT};letter-spacing:.04em;text-transform:uppercase;color:${MUTED};border-top:${i ? `1px solid ${LINE}` : '0'}">${esc(labels[k] || k)}</td>` +
    `<td style="padding:11px 14px;vertical-align:top;font:15px/1.5 ${FONT};color:${INK};border-top:${i ? `1px solid ${LINE}` : '0'}">${valueHtml(k, v)}</td></tr>`).join('');

  const message = fields.message
    ? `<tr><td style="padding:4px 32px 8px"><div style="font:600 12px ${FONT};letter-spacing:.04em;text-transform:uppercase;color:${MUTED};margin:14px 0 8px">Message</div>` +
      `<div style="padding:14px 16px;background:#F5F7FA;border-left:3px solid ${ACCENT};border-radius:4px;font:15px/1.6 ${FONT};color:${INK}">${valueHtml('message', fields.message)}</div></td></tr>`
    : '';

  const resumeBlock = resume
    ? `<tr><td style="padding:4px 32px 8px"><div style="font:600 12px ${FONT};letter-spacing:.04em;text-transform:uppercase;color:${MUTED};margin:14px 0 8px">Resume</div>` +
      `<div style="padding:12px 16px;border:1px solid ${LINE};border-radius:6px;font:15px/1.5 ${FONT};color:${INK}">&#128206; ${esc(resume.filename)} <span style="color:${MUTED};font-size:13px">(attached to this email)</span>` +
      (fields.resumeUrl ? ` &middot; <a href="${esc(fields.resumeUrl)}" style="color:${ACCENT}">Download</a>` : '') + `</div></td></tr>`
    : '';

  const pageBlock = page
    ? `<a href="${esc(page.url)}" style="color:#ffffff;text-decoration:underline">${esc(page.name)}</a> <span style="color:${ACCENT_LT}">&middot; ${esc(page.label)}</span>`
    : `<span style="color:${ACCENT_LT}">${esc(site)} website</span>`;

  const first = String(fields.name || '').trim().split(/\s+/)[0];
  const buttons = [
    fields.email ? button(`mailto:${fields.email}?subject=${encodeURIComponent('Re: ' + subject)}`, first ? `Reply to ${first}` : 'Reply by email', true) : '',
    fields.phone ? button(telHref(fields.phone), `Call ${fields.phone}`, false) : '',
  ].join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#EEF1F5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F5"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid ${LINE}">
<tr><td style="background:${INK};padding:26px 32px 22px">
<div style="font:600 11px ${FONT};letter-spacing:.16em;text-transform:uppercase;color:${ACCENT_LT}">${esc(site)} &middot; Website form</div>
<div style="font:600 24px/1.3 ${FONT};color:#ffffff;margin-top:8px">${esc(title)}</div>
<div style="font:13px/1.5 ${FONT};color:#B9C3CF;margin-top:6px">${esc(whenIST(submittedAt))}</div>
</td></tr>
<tr><td style="background:${ACCENT};padding:12px 32px;font:14px/1.5 ${FONT};color:#ffffff"><span style="color:${ACCENT_LT};font-weight:600">Sent from:</span> ${pageBlock}</td></tr>
<tr><td style="padding:22px 18px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowHtml}</table></td></tr>
${message}
${resumeBlock}
${buttons ? `<tr><td style="padding:18px 32px 14px">${buttons}</td></tr>` : ''}
<tr><td style="padding:16px 32px;background:#F5F7FA;border-top:1px solid ${LINE};font:12px/1.6 ${FONT};color:${MUTED}">
Replying to this email goes straight to ${fields.email ? esc(fields.email) : 'the sender'}.
</td></tr>
</table>
<div style="font:11px ${FONT};color:#98A2AE;margin-top:14px">Sent automatically by the ${esc(site)} website.</div>
</td></tr></table>
</body></html>`;

  const text = [
    `${title} (${site})`,
    whenIST(submittedAt),
    `Sent from: ${page ? `${page.name} - ${page.url}` : `${site} website`}`,
    '',
    ...rows.map(([k, v]) => `${labels[k] || k}: ${v}`),
    fields.message ? `\nMessage:\n${fields.message}` : null,
    resume ? `\nResume: ${resume.filename} (attached)${fields.resumeUrl ? `\nDownload: ${fields.resumeUrl}` : ''}` : null,
    '',
    `Replying to this email goes straight to ${fields.email || 'the sender'}.`,
  ].filter((l) => l !== null).join('\n');

  return { html, text };
}

module.exports = { buildEnquiryEmail, pageFrom };
