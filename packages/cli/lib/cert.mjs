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

export async function fetchCertFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs are supported');
  }

  const res = await fetch(url, {
    headers: { Accept: 'application/x-pem-file, text/plain, */*' },
    redirect: 'follow',
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch certificate (${res.status}) from ${url}`);
  }

  const raw = await res.text();
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