/**
 * Canonical allow/deny rule for a /v5 response — the single source of truth.
 *
 * Declared as DATA rather than code because the same rule has to execute in
 * several places that do not share a runtime: the CLI verdict line, the CLI
 * exit code, the browser widget, and every generated gateway plugin (Lua,
 * GatewayScript, policy expressions, …). Renderers serialize VERDICT_RULE into
 * the target language, so no target ever reimplements the logic by hand.
 *
 * The browser copy is not a copy: scripts/gen-verdict.mjs stringifies the
 * functions below straight into dist/js/verdict-rule.js, so the widget runs the
 * same bytes. `node scripts/gen-verdict.mjs --check` fails on drift.
 *
 * If you add a check here, every generated integration picks it up on the next
 * `tppv integration` run. Bump RULE_VERSION so cached verdicts in deployed
 * gateways are invalidated rather than silently reused under the old rule.
 */

export const RULE_VERSION = 1;

/** Values the API uses interchangeably for "this check passed". */
export const OK_FLAG_VALUES = [true, 'PASSED', 'GOOD', 'granted', 'yes', 1];

/**
 * Ordered so the first failure is the most useful one to report — same
 * short-circuit order as the seven rows the CLI prints.
 *
 * `row` groups rules onto those seven display rows (the UI shows LOTL and TL as
 * one "eIDAS trust chain" line). Every renderer derives its row status from the
 * rule via rowPassed(), so a green row can never contradict a DENIED verdict.
 *
 * op:
 *   okFlag             value is one of OK_FLAG_VALUES
 *   equals             value === `value`
 *   truthy             present and not false/null
 *   nonEmpty           non-empty string
 *   future             parseable date in the future (skipped if unparseable)
 *   nonEmptyFirstEntry array whose first element is a non-empty object
 */
export const VERDICT_RULE = [
  {
    id: 'signature',
    row: 'signature',
    check: 'Certificate signature',
    path: ['certificateData', 'trustChain'],
    op: 'okFlag',
    reason: 'CertificateSignatureInvalid',
  },
  {
    id: 'lotl',
    row: 'trustChain',
    check: 'eIDAS trust chain · LOTL',
    path: ['certificateData', 'lotlData', 'wellSigned'],
    op: 'truthy',
    reason: 'LotlSignatureInvalid',
  },
  {
    id: 'trustList',
    row: 'trustChain',
    check: 'eIDAS trust chain · TL',
    path: ['certificateData', 'trustList', 'wellSigned'],
    op: 'truthy',
    reason: 'TrustListSignatureInvalid',
  },
  {
    id: 'revocation',
    row: 'revocation',
    check: 'Revocation · OCSP',
    path: ['certificateRevocation'],
    op: 'equals',
    value: 'GOOD',
    reason: 'CertificateRevoked',
  },
  {
    id: 'expiry',
    row: 'expiry',
    check: 'Validity · expiry',
    path: ['certificateData', 'notAfter'],
    op: 'future',
    reason: 'CertificateExpired',
  },
  {
    id: 'psd2Role',
    row: 'psd2Role',
    check: 'Role · PSD2 attributes',
    path: ['certificateData', 'constraintIndication'],
    op: 'okFlag',
    reason: 'PSD2AttributesInvalid',
  },
  {
    id: 'nca',
    row: 'nca',
    check: 'NCA register',
    path: ['ncaData', 'ncaShortName'],
    op: 'nonEmpty',
    reason: 'NcaRegistryNotFound',
  },
  {
    id: 'passporting',
    row: 'passporting',
    check: 'Passporting',
    path: ['pspPassports'],
    op: 'nonEmptyFirstEntry',
    reason: 'NoJurisdictionsAuthorized',
  },
];

/*
 * The functions below are exported so scripts/gen-verdict.mjs can stringify
 * them into the browser bundle. Keep them free of module-scope dependencies
 * other than OK_FLAG_VALUES / VERDICT_RULE / each other, or the generated file
 * will reference names that do not exist there.
 */

export function dig(node, path) {
  let cur = node;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[seg];
    if (cur === null || cur === undefined) return undefined;
  }
  return cur;
}

export function testOp(rule, value) {
  switch (rule.op) {
    case 'okFlag':
      return OK_FLAG_VALUES.includes(value);
    case 'equals':
      return value === rule.value;
    case 'truthy':
      return value !== undefined && value !== false;
    case 'nonEmpty':
      return typeof value === 'string' && value.length > 0;
    case 'future': {
      if (value === undefined) return false;
      const t = new Date(value).getTime();
      // Unparseable notAfter is not treated as expired: /v5 already surfaces
      // expiry as certificateRevocation === 'EXPIRED', which the revocation
      // check above catches. Failing here too would deny on a format change.
      if (Number.isNaN(t)) return true;
      return t > Date.now();
    }
    case 'nonEmptyFirstEntry':
      return (
        Array.isArray(value) &&
        value[0] !== null &&
        typeof value[0] === 'object' &&
        Object.keys(value[0]).length > 0
      );
    default:
      throw new Error(`Unknown verdict op: ${rule.op}`);
  }
}

/**
 * @returns {{allowed: boolean, failed: Array<{id,check,reason}>, results: Object}}
 *   results maps every rule id to its boolean outcome, so a UI can colour each
 *   row from the same evaluation that produced the verdict.
 */
export function evaluateVerdict(data) {
  if (!data || typeof data !== 'object') {
    return {
      allowed: false,
      failed: [{ id: 'response', check: 'API response', reason: 'NoValidationResponse' }],
      results: {},
    };
  }

  const failed = [];
  const results = {};
  for (const rule of VERDICT_RULE) {
    const passed = testOp(rule, dig(data, rule.path));
    results[rule.id] = passed;
    if (!passed) {
      failed.push({ id: rule.id, check: rule.check, reason: rule.reason });
    }
  }
  return { allowed: failed.length === 0, failed, results };
}

export function isAllowed(data) {
  return evaluateVerdict(data).allowed;
}

/**
 * Did every rule mapped to this display row pass? A row with no evaluated rule
 * (empty results, e.g. no response at all) is a failure, not a pass.
 */
export function rowPassed(results, row) {
  const ids = VERDICT_RULE.filter((r) => r.row === row).map((r) => r.id);
  if (!ids.length) return false;
  return ids.every((id) => results[id] === true);
}

/** First failure — the one worth putting in x-tpp-reason. */
export function primaryFailReason(data) {
  const failed = evaluateVerdict(data).failed;
  return failed.length ? failed[0].reason : null;
}
