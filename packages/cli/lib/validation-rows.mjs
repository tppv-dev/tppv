/**
 * Canonical validation check names + row mapping for API responses.
 * Used by CLI (tppv), marketing widget (tpp-response.js), and MCP dispatch.
 * Keep tppv26/dist/tpp-response.js in sync when editing check names.
 *
 * The allow/deny decision itself lives in verdict.mjs, not here — generated
 * gateway plugins render the same rule, so it may only exist in one place.
 */

import { evaluateVerdict, rowPassed } from './verdict.mjs';

export const VALIDATION_CHECK_NAMES = [
  'Certificate signature',
  'eIDAS trust chain',
  'Revocation · OCSP',
  'Validity · expiry',
  'NCA register',
  'Role · PSD2 attributes',
  'Passporting',
];

const CHECK_SEP = '  ·  ';

export function validationCheckFooterLines() {
  return [
    VALIDATION_CHECK_NAMES.slice(0, 3).join(CHECK_SEP),
    VALIDATION_CHECK_NAMES.slice(3).join(CHECK_SEP),
  ];
}

function roleLabel(t) {
  if (!t) return '—';
  const map = {
    PSP_PI: 'Payment Institution',
    PSP_AI: 'Account Information',
    PSP_IC: 'Issuing of Cards',
    PSP_AS: 'Account Servicing Payment Service Provider',
    PSD_PI: 'Payment Institution',
    PSD_AI: 'Account Information',
  };
  return map[t] || t;
}

function rolesShort(t) {
  if (!t) return [];
  const m = { PSP_PI: 'PIS', PSP_AI: 'AIS', PSP_IC: 'CBPII', PSP_AS: 'ACQ', PSD_PI: 'PIS', PSD_AI: 'AIS' };
  return [m[t] || t];
}

function passportCountries(pspPassports) {
  if (!Array.isArray(pspPassports) || !pspPassports.length) return [];
  return Object.keys(pspPassports[0]);
}

function parseExpiryDate(notAfter) {
  if (!notAfter) return null;
  const d = new Date(notAfter);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysUntilExpiry(notAfter) {
  const d = parseExpiryDate(notAfter);
  if (!d) return null;
  return Math.floor((d.getTime() - Date.now()) / 86400000);
}

function isCertExpiringSoon(notAfter) {
  const days = daysUntilExpiry(notAfter);
  return days !== null && days > 0 && days < 30;
}

function formatExpiryDetail(notAfter) {
  const d = parseExpiryDate(notAfter);
  if (!d) return 'not evaluated';
  const days = daysUntilExpiry(notAfter);
  const dateStr = d.toISOString().split('T')[0];
  if (days < 0) return `expired ${Math.abs(days)} days ago · ${dateStr}`;
  if (days < 30) return `${days} days left · ${dateStr} ⚠`;
  return `expires ${dateStr}`;
}

/** Build the ordered validation checks for a raw /v5 response. */
export function buildValidationChecks(r) {
  const cd = r.certificateData || {};
  const nca = r.ncaData || {};
  const tl = cd.trustList || {};
  const lotl = cd.lotlData || {};
  const svc = (cd.trustServices && cd.trustServices[0]) || {};
  const issuer = svc.serviceName || 'eIDAS QTSP';
  const countries = passportCountries(r.pspPassports);

  // Row status comes from the same evaluation that produces the verdict, so a
  // green row can never sit above a DENIED footer. Only the `detail` strings
  // and the expiry warning are display-local.
  const { results } = evaluateVerdict(r);
  const row = (id) => rowPassed(results, id);

  return [
    {
      name: VALIDATION_CHECK_NAMES[0],
      detail: `X.509 · issuer ${(issuer || '').split(' ')[0] || 'unknown'}…`,
      passed: row('signature'),
      failReason: r.failReasons?.signature || ['CertificateSignatureInvalid'],
    },
    {
      name: VALIDATION_CHECK_NAMES[1],
      detail: `LOTL seq ${lotl.sequenceNumber ?? '—'} · TL seq ${tl.sequenceNumber ?? '—'}`,
      passed: row('trustChain'),
      failReason: r.failReasons?.trustChain || ['TrustListSignatureInvalid'],
    },
    {
      name: VALIDATION_CHECK_NAMES[2],
      detail: r.certificateRevocation || '—',
      passed: row('revocation'),
      failReason:
        r.failReasons?.revocation ||
        (r.certificateRevocation === 'REVOKED'
          ? ['CertificateRevoked']
          : r.certificateRevocation === 'EXPIRED'
            ? ['CertificateExpired']
            : ['RevocationStatusUnknown']),
    },
    {
      name: VALIDATION_CHECK_NAMES[3],
      detail: formatExpiryDetail(cd.notAfter),
      passed: row('expiry'),
      warning: isCertExpiringSoon(cd.notAfter),
      failReason: r.failReasons?.expiry || ['CertificateExpired'],
    },
    {
      name: VALIDATION_CHECK_NAMES[4],
      detail: `${nca.ncaShortName || '—'} · ${nca.ncaName || ''}`.trim().replace(/·\s*$/, ''),
      passed: row('nca'),
      failReason: r.failReasons?.nca || ['NcaRegistryNotFound'],
    },
    {
      name: VALIDATION_CHECK_NAMES[5],
      detail: roleLabel(cd.entityType || r.entityType),
      passed: row('psd2Role'),
      failReason: r.failReasons?.role || ['PSD2AttributesInvalid'],
    },
    {
      name: `${VALIDATION_CHECK_NAMES[6]} · ${countries.length} states`,
      detail: countries.slice(0, 8).join(' ') + (countries.length > 8 ? ' …' : ''),
      passed: row('passporting'),
      failReason: r.failReasons?.passporting || ['NoJurisdictionsAuthorized'],
    },
  ];
}

/** Short-circuit: first failing check wins; downstream rows are skipped. */
export function mapChecksToRows(checks) {
  const rows = [];
  let hitFail = false;
  for (const c of checks) {
    if (hitFail) {
      rows.push({ name: c.name, detail: c.detail, ok: false, skipped: true });
    } else if (c.passed) {
      rows.push({ name: c.name, detail: c.detail, ok: true, skipped: false, warning: c.warning || false });
    } else {
      hitFail = true;
      rows.push({ name: c.name, detail: c.detail, ok: false, skipped: false, failReason: c.failReason });
    }
  }
  return rows;
}

export function toRows(r) {
  if (!r) return [];
  return mapChecksToRows(buildValidationChecks(r));
}

export function toSummary(r) {
  if (!r) return { verdict: 'ERROR', provider: '—', issuer: '—', label: 'no response' };
  const cd = r.certificateData || {};
  const svc = (cd.trustServices && cd.trustServices[0]) || {};
  const { allowed } = evaluateVerdict(r);

  const roles = rolesShort(cd.entityType || r.entityType).join('+');
  return {
    verdict: allowed ? 'ALLOWED' : 'DENIED',
    provider: `${r.entityName || 'Unknown entity'} · ${r.entityCountry || ''}`.trim().replace(/·\s*$/, ''),
    issuer: svc.serviceName || 'eIDAS QTSP',
    orgId: r.organizationIdentifier || '—',
    roles: roles || '—',
    label: allowed
      ? `${roles || 'role'} · ${r.ncaData?.ncaShortName || r.entityCountry || ''}`
      : 'validation failed',
    qualification: cd.qualificationAtValidation || '—',
    validationTime: r.validationTime || '',
  };
}

export function formatCheckDetail(row) {
  if (row.skipped) return 'skipped';
  if (!row.ok && row.failReason) return row.failReason.join(' · ');
  return row.detail;
}