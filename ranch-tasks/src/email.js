// Builds a raw MIME email with a CSV attachment for Cloudflare's send_email binding.

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/.{76}/g, '$&\r\n');
}

const clean = (s) => String(s).replace(/[\r\n]/g, ' ');

export function buildPayrollEmail({ from, to, subject, text, filename, csv }) {
  const boundary = 'ranch-' + crypto.randomUUID();
  const domain = from.split('@')[1] || 'localhost';
  return [
    `From: ${clean(from)}`,
    `To: ${clean(to)}`,
    `Subject: ${clean(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text),
    `--${boundary}`,
    `Content-Type: text/csv; charset=utf-8; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    b64(csv),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
