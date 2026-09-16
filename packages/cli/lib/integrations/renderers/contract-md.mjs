/**
 * Escape hatch for targets without a tested template.
 *
 * We emit the enforcement contract and a prompt for the operator's own coding
 * agent, rather than scraping the vendor's documentation and generating plugin
 * code we have never executed. Scaffolding that is labelled as scaffolding is
 * useful; a .lua file that looks production-ready and was never run is not.
 */

import { describeSpec } from '../contract.mjs';

function ruleTable(rule) {
  return rule
    .map(
      (r) =>
        `| ${r.check} | \`${r.path.join('.')}\` | \`${r.op}\`${r.value !== undefined ? ` = \`${r.value}\`` : ''} | \`${r.reason}\` |`,
    )
    .join('\n');
}

function opsReference() {
  return `- \`okFlag\` — passes when the value is one of \`true\`, \`"PASSED"\`, \`"GOOD"\`, \`"granted"\`, \`"yes"\`, \`1\`
- \`equals\` — strict equality with the stated value
- \`truthy\` — present, and not \`false\` or \`null\`
- \`nonEmpty\` — a string of length > 0
- \`future\` — a parseable date in the future. **If unparseable, pass.** \`/v5\` already
  reports expiry as \`certificateRevocation = "EXPIRED"\`, so the revocation check
  covers it; failing here too turns an API date-format change into an outage.
- \`nonEmptyFirstEntry\` — an array whose first element is a non-empty object`;
}

function contractMd(spec) {
  const t = spec.target;
  const table = describeSpec(spec)
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join('\n');

  return `# TPP validation enforcement contract — ${t.label}

There is no tested template for ${t.label} yet, so this is the specification
rather than an implementation. Everything below is what a working adapter has to
do; \`AGENT-PROMPT.md\` in this directory is the same thing phrased for a coding
agent.

| Setting | Value |
|---|---|
${table}

## Where the certificate comes from

This is the part that differs on every gateway and the part most integrations get
wrong.

- **Expression** — \`${t.certSource.expr}\`
- **Encoding** — ${t.certSource.encoding}
- **Requires** — ${t.certSource.requires}

Normalize to PEM before sending. If the gateway hands you URL-encoded PEM, decode
it. If it hands you bare base64 DER, wrap it at 64 columns and add the
\`-----BEGIN CERTIFICATE-----\` armour.

## The five steps

### 1. extract
Read the client certificate using the expression above. If there is none, deny
with **${spec.denyStatus}** and \`x-tpp-reason: NoClientCertificate\`. A missing
certificate is a client error, not an outage — do not apply the fail mode to it.

### 2. decide
Compute \`sha256(pem)\` as hex. Cache key:

\`\`\`
${spec.cacheKey}
\`\`\`

The jurisdictions and rule version belong in the key: the same certificate can
get a different verdict under a different \`cc\` list, and a rule change must miss
cache rather than reuse yesterday's answer.

On a miss:

\`\`\`http
POST ${spec.apiUrl}?cc=${spec.jurisdictions}&details=true
Authorization: Bearer <token from ${t.secretRef.style}>
Content-Type: text/plain

<PEM>
\`\`\`

- **200** — validated. **422** — validated and failed. Both carry a usable body.
- **401** — your token, not the certificate. Do not cache; alert.
- Anything else, or a timeout past ${spec.timeoutMs}ms — infrastructure failure,
  go to step 5.

Cache allow verdicts for **${spec.cacheTtl}s** and deny verdicts for
**${spec.negativeCacheTtl}s**. Denials get a shorter life because a certificate
that failed may be fixed minutes later.

${t.cache ? `On ${t.label}: ${t.cache}.` : ''}

### 3. evaluate
Run these checks against the response body in order. First failure wins and its
reason goes in \`x-tpp-reason\`.

| Check | Path | Test | Reason on failure |
|---|---|---|---|
${ruleTable(spec.rule)}

Operators:

${opsReference()}

${
  spec.allowedRoles.length
    ? `Then the role gate: \`certificateData.entityType\` must contain one of ` +
      `${spec.allowedRoles.map((r) => `\`${r}\``).join(', ')}, else deny with ` +
      `\`RoleNotPermitted\`. The field may be a single role or a comma-separated list.`
    : `No role restriction was configured, so any certificate that passes the checks ` +
      `above is admitted. If this route is payment-initiation only, come back and set ` +
      `\`--roles PSP_PI\` — an AISP certificate should not reach it.`
}

### 4. inject
**Clear these headers from the inbound request first**, then set them from the
response. A caller able to send \`x-tpp-identifier\` could otherwise impersonate
another TPP to your backend. This ordering is the whole point of the step.

| Header | Source path |
|---|---|
${spec.injectedHeaders
  .map(
    (h) =>
      `| \`${h.header}\` | \`${h.path.join('.')}\`${h.fallbackPath ? `, falling back to \`${h.fallbackPath.join('.')}\`` : ''} |`,
  )
  .join('\n')}

Also set \`x-tpp-fingerprint\` to the hex digest, so upstream logs can be
correlated with gateway logs.

### 5. fallback
\`fail_mode: ${spec.failMode}\` — ${spec.failModeDescription}

${
  spec.graceTtl
    ? `Implement the grace window by keeping the last successful verdict for ` +
      `${spec.graceTtl}s beyond its normal TTL and serving it only when the validator ` +
      `call fails. Log every use of it; that log line is what tells you that you are ` +
      `running on stale verdicts.`
    : ''
}

Denials return **${spec.denyStatus}**; validator outages return
**${spec.unavailableStatus}**, which tells a well-behaved TPP to retry. Never put
internal detail in the response body — log it, return only the reason code.

## Before you deploy

A plugin that has never run against a real certificate is not an integration, it
is a guess. Minimum bar:

1. No client certificate → ${spec.denyStatus}, \`NoClientCertificate\`
2. Self-signed non-PSD2 certificate → ${spec.denyStatus}, first failing check in \`x-tpp-reason\`
3. Real QWAC → 200, upstream receives the \`x-tpp-*\` headers
4. Validator unreachable (block egress) → behaviour matches \`${spec.failMode}\`

Case 4 is the one everybody skips and the one that will page you.

## Mechanism on ${t.label}

${t.mechanism}

Secret storage: ${t.secretRef.style}${t.secretRef.example ? ` — e.g. \`${t.secretRef.example}\`` : ''}${t.secretRef.note ? `. ${t.secretRef.note}` : ''}.

## A cheaper option

Every gateway in this list can call an external authorization service —
\`ext_authz\`, \`ForwardAuth\`, \`auth_request\`, a Lambda authorizer, a
\`send-request\` policy. Implementing this contract **once** as a small service and
pointing ${t.label} at it is usually less work and much less to maintain than a
native plugin, and the cache lives in one place. Consider the native plugin only
if you cannot accept the extra hop.
`;
}

function agentPrompt(spec) {
  const t = spec.target;

  return `# Agent prompt — ${t.label} adapter

Paste this into your coding agent, in a repo where the ${t.label} config lives.
\`CONTRACT.md\` next to this file is the authoritative specification; this is just
the framing.

---

Implement a ${t.label} integration that validates PSD2 eIDAS client certificates
against the TPP Validation API before a request reaches the upstream service.

Mechanism: ${t.mechanism}

**Read \`CONTRACT.md\` in this directory first.** It defines the five steps, the
exact validation rule with all ${spec.rule.length} checks and their JSON paths, the cache key
recipe, and the required outage behaviour. Do not invent a rule — implement that
one exactly, including the operator semantics for \`future\`.

Configuration to honour:

- Validator: \`${spec.apiUrl}\`, \`cc=${spec.jurisdictions}\`, \`details=true\`
- Timeout ${spec.timeoutMs}ms, cache ${spec.cacheTtl}s allow / ${spec.negativeCacheTtl}s deny
- \`fail_mode: ${spec.failMode}\`${spec.graceTtl ? `, grace window ${spec.graceTtl}s` : ''}
- Deny ${spec.denyStatus}, validator unavailable ${spec.unavailableStatus}
- ${spec.allowedRoles.length ? `Allowed PSD2 roles: ${spec.allowedRoles.join(', ')}` : 'No role restriction'}
- Bearer token from ${t.secretRef.style}${t.secretRef.example ? ` (\`${t.secretRef.example}\`)` : ''} — **never a literal in a config file**

Certificate source on this gateway: \`${t.certSource.expr}\`, encoded as
${t.certSource.encoding}. Requires: ${t.certSource.requires}.

Hard requirements, in order of how often they are missed:

1. Clear all inbound \`x-tpp-*\` headers before setting them. Without this a TPP
   can claim another TPP's identity to the backend.
2. Include the jurisdiction list and rule version in the cache key.
3. A missing client certificate is a ${spec.denyStatus}, not a fail-mode case.
4. Never return internal error detail to the caller. Log it; return the reason code.
5. Look up how caching TTL works in this gateway's cache API before trusting a
   \`0\` value — several treat 0 as "never expire" rather than "do not cache".

Deliver the adapter, the configuration to attach it to one route, and an
integration test covering all four cases in the "Before you deploy" section of
\`CONTRACT.md\` — including the validator-unreachable case. Tell me plainly which
cases you actually ran and which you did not.
`;
}

export function renderContractOnly(spec) {
  return [
    { path: 'CONTRACT.md', contents: contractMd(spec) },
    { path: 'AGENT-PROMPT.md', contents: agentPrompt(spec) },
  ];
}
