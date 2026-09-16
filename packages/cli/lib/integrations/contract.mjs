/**
 * The gateway-neutral enforcement contract.
 *
 * Every generated integration — native plugin or sidecar — implements exactly
 * these five steps. Renderers are thin: they translate this spec into one
 * target's dialect and add nothing of their own.
 *
 *   extract    pull the client certificate off the transport
 *   normalize  to PEM (each gateway mangles it differently)
 *   decide     cache lookup by fingerprint → POST /v5 → evaluateVerdict()
 *   inject     stamp the TPP identity onto the upstream request
 *   fallback   what happens when /v5 does not answer
 */

import { API_V5, DEFAULT_COUNTRIES } from '../constants.mjs';
import { RULE_VERSION, VERDICT_RULE } from '../verdict.mjs';

export const CONTRACT_VERSION = 1;

export const FAIL_MODES = [
  {
    value: 'closed_grace',
    label: 'Fail closed, with grace window',
    hint: 'recommended — serve last known-good verdict during an outage',
    description:
      'If /v5 is unreachable, reuse the most recent verdict for this certificate for up to ' +
      'grace_ttl seconds. If there is no prior verdict, deny. Bounded exposure, no hard outage.',
  },
  {
    value: 'closed',
    label: 'Fail closed, strict',
    hint: 'deny every request during an outage',
    description:
      'If /v5 is unreachable, deny. Maximum correctness; your TPP traffic stops when our API stops.',
  },
  {
    value: 'open',
    label: 'Fail open',
    hint: 'not advisable for a regulated control',
    description:
      'If /v5 is unreachable, allow the request and log a warning. This turns your access control ' +
      'into a soft dependency: an outage on our side becomes an authorization bypass on yours.',
  },
];

/**
 * A positive verdict cached for T seconds means a certificate revoked at t=0 is
 * still accepted until t=T. The RTS does not name a number, so this has to be a
 * deliberate, documented choice rather than a default someone inherits.
 */
export const CACHE_PRESETS = [
  { value: 300, label: '5 minutes', hint: 'tight revocation window, ~12 calls/cert/hour' },
  { value: 3600, label: '1 hour', hint: 'recommended — matches typical OCSP freshness' },
  { value: 21600, label: '6 hours', hint: 'low call volume, wider revocation exposure' },
  { value: 86400, label: '24 hours', hint: 'a revoked cert is accepted for up to a day' },
  { value: 0, label: 'No caching', hint: 'one /v5 call per request — expect latency complaints' },
];

export const PSD2_ROLES = [
  { value: 'PSP_AI', label: 'AISP · account information', hint: 'PSP_AI' },
  { value: 'PSP_PI', label: 'PISP · payment initiation', hint: 'PSP_PI' },
  { value: 'PSP_IC', label: 'CBPII · card-based instruments', hint: 'PSP_IC' },
  { value: 'PSP_AS', label: 'ASPSP · account servicing', hint: 'PSP_AS' },
];

export const DEFAULTS = {
  apiUrl: API_V5,
  jurisdictions: DEFAULT_COUNTRIES,
  failMode: 'closed_grace',
  cacheTtl: 3600,
  negativeCacheTtl: 60,
  graceTtl: 21600,
  timeoutMs: 2000,
  allowedRoles: [],
  injectHeaders: true,
  denyStatus: 403,
  unavailableStatus: 503,
};

/**
 * Headers the enforcement point stamps onto the upstream request so the backend
 * gets the TPP identity without parsing X.509 itself.
 *
 * Every one of these is cleared from the inbound request first. A client that
 * can set x-tpp-identifier can impersonate another TPP to your backend, so the
 * clear step is not optional — it is the whole reason this list is explicit.
 */
export const INJECTED_HEADERS = [
  { header: 'x-tpp-entity', path: ['entityName'], note: 'legal name from the NCA register' },
  { header: 'x-tpp-identifier', path: ['organizationIdentifier'], note: 'PSD2 organizationIdentifier' },
  {
    header: 'x-tpp-roles',
    path: ['certificateData', 'entityType'],
    // /v5 has returned this at both depths. The role gate denies on a missing
    // value, so reading only one path would turn a response-shape change into
    // a total outage on any role-restricted route.
    fallbackPath: ['entityType'],
    note: 'PSP_AI / PSP_PI / PSP_IC / PSP_AS',
  },
  { header: 'x-tpp-nca', path: ['ncaData', 'ncaShortName'], note: 'competent authority short name' },
  { header: 'x-tpp-country', path: ['entityCountry'], note: 'home member state' },
];

/** Derived name of the cache key so every target computes the same one. */
export function cacheKeyRecipe() {
  return `tppv:r${RULE_VERSION}:<sha256(pem)>:<jurisdictions>`;
}

export function buildSpec(answers) {
  const merged = { ...DEFAULTS, ...answers };
  const failMode = FAIL_MODES.find((f) => f.value === merged.failMode) || FAIL_MODES[0];

  return {
    contractVersion: CONTRACT_VERSION,
    ruleVersion: RULE_VERSION,
    target: merged.target,
    apiUrl: merged.apiUrl,
    jurisdictions: merged.jurisdictions,
    failMode: failMode.value,
    failModeDescription: failMode.description,
    cacheTtl: merged.cacheTtl,
    negativeCacheTtl: merged.negativeCacheTtl,
    graceTtl: failMode.value === 'closed_grace' ? merged.graceTtl : 0,
    timeoutMs: merged.timeoutMs,
    allowedRoles: merged.allowedRoles || [],
    injectHeaders: merged.injectHeaders !== false,
    denyStatus: merged.denyStatus,
    unavailableStatus: merged.unavailableStatus,
    rule: VERDICT_RULE,
    injectedHeaders: INJECTED_HEADERS,
    cacheKey: cacheKeyRecipe(),
  };
}

/** Human summary shown before writing files, and echoed into every README. */
export function describeSpec(spec) {
  return [
    ['Gateway', spec.target.label],
    ['Mechanism', spec.target.mechanism],
    ['Certificate source', spec.target.certSource.expr],
    ['Validator', `${spec.apiUrl} · rule v${spec.ruleVersion}`],
    ['Jurisdictions', `${spec.jurisdictions.split(',').length} codes`],
    ['On validator outage', spec.failMode],
    ['Cache', spec.cacheTtl ? `${spec.cacheTtl}s allow / ${spec.negativeCacheTtl}s deny` : 'disabled'],
    ['Grace window', spec.graceTtl ? `${spec.graceTtl}s` : 'none'],
    ['Timeout', `${spec.timeoutMs}ms`],
    ['Role restriction', spec.allowedRoles.length ? spec.allowedRoles.join(', ') : 'none — any valid PSD2 role'],
    ['Header injection', spec.injectHeaders ? INJECTED_HEADERS.map((h) => h.header).join(' ') : 'off'],
  ];
}
