import fs from 'node:fs';
import path from 'node:path';

const PEM_BLOCK_RE =
  /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;

function rewrapPemBlock(label, body) {
  const b64 = body.replace(/\s+/g, '');
  if (!b64 || b64.length < 50) return null;
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

/**
 * Normalize PEM / base64 input (mirrors MCP widget normalizePem).
 * Preserves multiple BEGIN/END blocks — API validates the full chain.
 */
export function normalizePem(input) {
  const trimmed = (input || '').trim();
  if (!trimmed) return null;

  if (/-----BEGIN [A-Z0-9 ]+-----/.test(trimmed)) {
    const blocks = [];
    for (const match of trimmed.matchAll(PEM_BLOCK_RE)) {
      const formatted = rewrapPemBlock(match[1], match[2]);
      if (formatted) blocks.push(formatted);
    }
    if (blocks.length > 0) {
      return blocks.join('\n');
    }
    return trimmed;
  }

  if (/^MI[A-Za-z0-9+/=\r\n\s]+$/.test(trimmed) && trimmed.length > 100) {
    const formatted = rewrapPemBlock('CERTIFICATE', trimmed);
    if (formatted) return formatted;
  }

  return null;
}

export function readCertFromFile(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const pem = normalizePem(raw);
  if (!pem) {
    throw new Error(`Not a recognised certificate format: ${resolved}`);
  }
  return pem;
}

const MAX_CERT_BYTES = 64 * 1024;

export async function fetchCertFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Only https:// URLs are supported');
  }

  const res = await fetch(url, {
    headers: { Accept: 'application/x-pem-file, text/plain, */*' },
    redirect: 'follow',
  });

  const finalUrl = res.url || url;
  if (!finalUrl.startsWith('https:')) {
    throw new Error('Redirect left HTTPS; refusing to fetch certificate');
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch certificate (${res.status}) from ${url}`);
  }

  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_CERT_BYTES) {
    throw new Error('Certificate response is too large');
  }

  const raw = await res.text();
  if (raw.length > MAX_CERT_BYTES) {
    throw new Error('Certificate response is too large');
  }
  const pem = normalizePem(raw);
  if (!pem) {
    throw new Error(`URL did not return a PEM certificate: ${url}`);
  }
  return pem;
}

export async function resolveCert({ file, url, pem }) {
  if (pem) {
    const normalized = normalizePem(pem);
    if (!normalized) throw new Error('Invalid PEM content');
    return normalized;
  }
  if (file) return readCertFromFile(file);
  if (url) return fetchCertFromUrl(url);
  throw new Error('Provide --file, --url, or --pem');
}