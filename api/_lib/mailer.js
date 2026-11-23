const nodemailer = require('nodemailer');

function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error('SMTP is not configured on the server yet.');
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

// attachments: nodemailer attachment objects, e.g. [{ filename, content: Buffer, contentType }]
async function sendMail({ subject, html, text, replyTo, to: toOverride, attachments }) {
  const to = toOverride || process.env.SMTP_TO || process.env.SMTP_USER;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const transport = getTransport();
  await transport.sendMail({ from, to, subject, html, text, replyTo, attachments });
}

module.exports = { sendMail };
