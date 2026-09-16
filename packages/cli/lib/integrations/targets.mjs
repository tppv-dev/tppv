/**
 * API gateway target registry.
 *
 * `status` is deliberately honest:
 *   template  — a rendered, reviewable integration exists and is version-pinned
 *   contract  — no template yet; we emit the enforcement contract + an agent
 *               prompt so the operator's own tooling can produce the adapter
 *
 * `verified` is the separate, stricter claim: the generated output has actually
 * been executed against a running gateway via its own test harness. A plugin
 * that looks production-ready but was never run is worse than no plugin at all,
 * because it will be trusted. Flip this to true only after `test/smoke.sh`
 * passes all three cases, and record the version you ran it on.
 *
 * `certSource` is the highest-value field in this file: where the client
 * certificate lives, and in what encoding, is the single most common
 * integration bug and it differs on every row.
 */

export const TARGETS = [
  {
    id: 'kong',
    label: 'Kong Gateway',
    hint: 'Lua plugin · access phase',
    status: 'template',
    // Written against the Kong 3.4–3.9 PDK, harness included, NOT YET RUN.
    // Flip to true once docker-compose.test.yml + test/smoke.sh go green.
    verified: false,
    testedAgainst: 'Kong 3.4–3.9 PDK (harness included, not yet executed)',
    mechanism: 'Custom Lua plugin (handler.lua + schema.lua), priority 1005',
    certSource: {
      expr: 'kong.client.tls.get_full_client_certificate_chain()',
      encoding: 'PEM chain, leaf first',
      requires:
        'nginx_proxy_ssl_verify_client=optional_no_ca (OSS) or the mtls-auth plugin (Enterprise)',
    },
    secretRef: {
      style: 'vault',
      example: '{vault://env/TPP_BEARER_TOKEN}',
      note: 'schema field is referenceable — Kong resolves vault:// at runtime',
    },
    cache: 'kong.cache (mlcache: L1 Lua-land + L2 shm), resurrect_ttl for the grace window',
  },
  {
    id: 'azure-apim',
    label: 'Azure API Management',
    hint: 'policy fragment',
    status: 'contract',
    testedAgainst: null,
    mechanism: '<inbound> policy fragment with <send-request> + cache-lookup-value',
    certSource: {
      expr: 'context.Request.Certificate',
      encoding: 'X509Certificate2 — needs Convert.ToBase64String(.GetRawCertData()) + PEM armour',
      requires: '"Negotiate client certificate" enabled on the gateway hostname',
    },
    secretRef: { style: 'named-value', example: '{{tpp-bearer-token}}', note: 'store as a Key Vault-backed named value' },
    cache: '<cache-lookup-value>/<cache-store-value> keyed on the fingerprint',
  },
  {
    id: 'aws-apigw',
    label: 'AWS API Gateway',
    hint: 'Lambda authorizer',
    status: 'contract',
    testedAgainst: null,
    mechanism: 'REQUEST-type Lambda authorizer + mTLS truststore in S3',
    certSource: {
      expr:
        'REST API: $context.identity.clientCert.clientCertPem · ' +
        'HTTP API: event.requestContext.authentication.clientCert.clientCertPem',
      encoding: 'PEM (leaf only — no chain)',
      requires: 'Custom domain with mutualTlsAuthentication configured',
    },
    secretRef: { style: 'secrets-manager', example: 'arn:aws:secretsmanager:…:tpp/bearer', note: null },
    cache: 'Authorizer result caching (TTL on the authorizer) + optional DynamoDB/ElastiCache',
  },
  {
    id: 'envoy',
    label: 'Envoy / Istio',
    hint: 'ext_authz or Wasm',
    status: 'contract',
    testedAgainst: null,
    mechanism: 'ext_authz HTTP filter (recommended) or proxy-wasm plugin',
    certSource: {
      expr: 'x-forwarded-client-cert header, Cert= / Chain= fields',
      encoding: 'URL-encoded PEM — decode before sending',
      requires: 'forward_client_cert_details: APPEND_FORWARD + set_current_client_cert_details.cert/chain',
    },
    secretRef: { style: 'sds', example: 'SDS secret or mounted file', note: null },
    cache: 'No native cache — cache inside the ext_authz service',
  },
  {
    id: 'nginx',
    label: 'NGINX / NGINX Plus',
    hint: 'njs + auth_request',
    status: 'contract',
    testedAgainst: null,
    mechanism: 'njs module with auth_request, or auth_request to a sidecar',
    certSource: {
      expr: '$ssl_client_escaped_cert',
      encoding: 'URL-encoded PEM — decodeURIComponent() in njs',
      requires: 'ssl_verify_client optional_no_ca',
    },
    secretRef: { style: 'env', example: 'js_var or env-injected upstream header', note: null },
    cache: 'keyval (Plus) or proxy_cache on the auth_request subrequest',
  },
  {
    id: 'apigee',
    label: 'Apigee (Edge / X)',
    hint: 'SharedFlow + ServiceCallout',
    status: 'contract',
    testedAgainst: null,
    mechanism: 'SharedFlow with ServiceCallout + JavaScript policy, attached as a FlowHook',
    certSource: {
      expr: 'Edge: tls.client.raw.cert · X: usually X-Forwarded-Client-Cert from the GCLB',
      encoding: 'PEM (Edge) / URL-encoded XFCC (X)',
      requires: 'Client auth enabled on the virtual host, or mTLS on the load balancer',
    },
    secretRef: { style: 'kvm', example: 'Encrypted KVM entry', note: null },
    cache: 'PopulateCache / LookupCache policies keyed on the fingerprint',
  },
  {
    id: 'traefik',
    label: 'Traefik',
    hint: 'ForwardAuth middleware',
    status: 'contract',
    testedAgainst: null,
    mechanism: 'ForwardAuth middleware — the cheapest integration in this list',
    certSource: {
      expr: 'X-Forwarded-Tls-Client-Cert',
      encoding: 'base64 DER without PEM armour — re-armour before sending',
      requires: 'passTLSClientCert middleware with pem: true',
    },
    secretRef: { style: 'env', example: 'env var on the ForwardAuth service', note: null },
    cache: 'None — cache inside the ForwardAuth service',
  },
  {
    id: 'tyk',
    label: 'Tyk Gateway',
    hint: 'Go plugin / JSVM',
    status: 'contract',
    testedAgainst: null,
    mechanism: 'custom_middleware in the API definition (Go plugin preferred over JSVM)',
    certSource: {
      expr: 'r.TLS.PeerCertificates[0] (Go plugin)',
      encoding: '*x509.Certificate — re-encode to PEM',
      requires: 'use_mutual_tls_auth on the API definition',
    },
    secretRef: { style: 'env', example: 'TYK_TPP_BEARER env var', note: null },
    cache: 'Redis via the Tyk storage interface',
  },
  {
    id: 'mulesoft-flex',
    label: 'MuleSoft Flex Gateway',
    hint: 'Rust/Wasm custom policy',
    status: 'contract',
    testedAgainst: null,
    mechanism: 'Custom policy (Rust → Wasm) packaged with the policy SDK',
    certSource: {
      expr: 'x-forwarded-client-cert',
      encoding: 'URL-encoded PEM',
      requires: 'TLS context with client validation on the inbound listener',
    },
    secretRef: { style: 'secret-group', example: 'Flex secret group reference', note: null },
    cache: 'Implement in the policy, or front with a shared cache service',
  },
  {
    id: 'ibm-datapower',
    label: 'IBM API Connect / DataPower',
    hint: 'GatewayScript',
    status: 'contract',
    testedAgainst: null,
    mechanism: 'GatewayScript policy inside the assembly',
    certSource: {
      expr: "context.get('tls') / mutual auth context variables",
      encoding: 'PEM',
      requires: 'TLS server profile with client authentication required',
    },
    secretRef: { style: 'kvm', example: 'API Connect properties / vault', note: null },
    cache: 'urlopen with a document cache policy',
  },
  {
    id: 'wso2',
    label: 'WSO2 API Manager',
    hint: 'Synapse mediation',
    status: 'contract',
    testedAgainst: null,
    mechanism: 'Custom Synapse in-sequence or a class mediator',
    certSource: {
      expr: 'axis2 MessageContext transport property ssl.client.auth.cert.X509',
      encoding: 'X509Certificate[] — re-encode to PEM',
      requires: 'SSLVerifyClient=optional on the passthrough transport',
    },
    secretRef: { style: 'secure-vault', example: 'WSO2 Secure Vault alias', note: null },
    cache: 'Synapse cache mediator or a custom Java cache',
  },
];

export function findTarget(id) {
  return TARGETS.find((t) => t.id === id) || null;
}

/** template + verified, template + unverified, or contract-only. */
export function targetState(t) {
  if (t.status !== 'template') return 'contract';
  return t.verified ? 'verified' : 'untested';
}

export function targetChoices() {
  return TARGETS.map((t) => {
    const state = targetState(t);
    const hint =
      state === 'verified'
        ? `${t.hint} · tested on ${t.testedAgainst}`
        : state === 'untested'
          ? `${t.hint} · generated, not yet run`
          : `${t.hint} · contract only`;
    return { value: t.id, label: t.label, hint };
  });
}
