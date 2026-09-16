import { maskToken } from './config.mjs';

/** Strip quotes, Bearer prefix, and stray whitespace from pasted tokens. */
export function normalizeBearerToken(raw) {
  let t = String(raw ?? '').trim();
  if (!t) return '';

  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }

  if (/^bearer\s+/i.test(t)) {
    t = t.replace(/^bearer\s+/i, '');
  }

  return t.replace(/\s+/g, '');
}

export function isJwtShape(token) {
  const t = normalizeBearerToken(token);
  const parts = t.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length < 2) return null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    b64 += '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(b64, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function inferTier(payload) {
  const role = (payload.role || '').toLowerCase();
  const sub = (payload.sub || '').toLowerCase();

  if (role === 'trial' || sub.startsWith('trial -')) return 'trial';
  if (role === 'enterprise' || role === 'production' || sub.startsWith('subscription -')) {
    return 'production';
  }
  if (role) return role;
  return 'production';
}

function formatExpiryDate(expUnix) {
  if (!expUnix) return null;
  return new Date(expUnix * 1000).toISOString().slice(0, 10);
}

/**
 * Inspect bearer JWT for splash / status (signature not verified client-side).
 */
export function analyzeToken(token) {
  token = normalizeBearerToken(token);
  if (!token) {
    return {
      hasToken: false,
      tier: 'none',
      label: 'NOT CONFIGURED',
      hint: 'tppv trial  ·  tppv config token <bearer>',
    };
  }

  const payload = decodeJwtPayload(token);
  if (!payload) {
    return {
      hasToken: true,
      valid: false,
      tier: 'unknown',
      label: 'INVALID TOKEN',
      hint: 'malformed JWT — check paste',
      masked: maskToken(token),
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === 'number' ? payload.exp : null;
  const expired = exp !== null && now >= exp;
  const remainingDays =
    exp !== null ? Math.max(0, Math.ceil((exp * 1000 - Date.now()) / 86400000)) : null;

  const tier = inferTier(payload);
  const subject = payload.sub || '';
  const client = payload.client || payload.email || '';
  const uid = payload.uid || '';

  let label;
  let hint;

  if (expired) {
    label = tier === 'trial' ? 'TRIAL EXPIRED' : 'TOKEN EXPIRED';
    hint = 'tppv trial  ·  tppv.dev';
  } else if (tier === 'trial') {
    label = 'TRIAL';
    hint =
      remainingDays !== null
        ? `${remainingDays} day${remainingDays === 1 ? '' : 's'} remaining`
        : 'active';
    if (remainingDays !== null && remainingDays <= 5) {
      hint += ' · renew soon';
    }
  } else if (tier === 'production' || tier === 'enterprise') {
    label = 'PRODUCTION';
    hint = exp ? `valid until ${formatExpiryDate(exp)}` : 'no expiry in token';
  } else {
    label = tier.toUpperCase();
    hint = exp ? `${remainingDays ?? '?'}d remaining` : 'active';
  }

  return {
    hasToken: true,
    valid: !expired,
    expired,
    tier,
    label,
    hint,
    remainingDays,
    exp,
    notAfter: exp ? new Date(exp * 1000).toISOString() : undefined,
    subject,
    client,
    uid,
    role: payload.role,
    masked: maskToken(token),
  };
}