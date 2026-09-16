import { DEFAULT_COUNTRIES } from './constants.mjs';

const VALID_CODES = new Set(DEFAULT_COUNTRIES.split(','));

/** PEM/base64 accidentally pasted into the jurisdictions field. */
export function looksLikeCertInput(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  if (/-----BEGIN/i.test(s)) return true;
  if (/CERTIFICATE/i.test(s) && !/^[A-Z]{2}(,[A-Z]{2})*$/.test(s.replace(/\s+/g, ''))) return true;
  if (/^MI[A-Za-z0-9+/=]{80,}/.test(s.replace(/\s+/g, ''))) return true;
  return false;
}

/**
 * Parse and validate a jurisdictions string (comma-separated ISO country codes).
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function parseJurisdictions(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return { ok: true, value: DEFAULT_COUNTRIES, isDefault: true };
  }

  if (looksLikeCertInput(trimmed)) {
    return {
      ok: false,
      error: 'That looks like a certificate — enter country codes (e.g. SE,FI,DE)',
    };
  }

  const codes = trimmed
    .replace(/\s+/g, '')
    .toUpperCase()
    .split(',')
    .filter(Boolean);

  if (!codes.length) {
    return { ok: false, error: 'Enter at least one country code (e.g. SE,FI,DE)' };
  }

  const invalid = codes.filter((c) => !VALID_CODES.has(c));
  if (invalid.length) {
    return { ok: false, error: `Unknown country codes: ${invalid.join(', ')}` };
  }

  return { ok: true, value: codes.join(','), isDefault: false };
}

/** Return stored jurisdictions if valid, otherwise null (and optional reason). */
export function sanitizeStoredJurisdictions(stored) {
  if (stored == null || stored === '') return { value: null };
  const parsed = parseJurisdictions(stored);
  if (!parsed.ok) return { value: null, corrupt: true, error: parsed.error };
  if (parsed.isDefault) return { value: null };
  return { value: parsed.value };
}

/** Config → API `cc` param (never pass corrupt PEM-as-jurisdictions). */
export function countriesForValidation(config, flagsCc) {
  if (flagsCc) {
    const parsed = parseJurisdictions(flagsCc);
    return parsed.ok ? parsed.value : DEFAULT_COUNTRIES;
  }
  const stored = sanitizeStoredJurisdictions(config?.jurisdictions);
  return stored.value || DEFAULT_COUNTRIES;
}