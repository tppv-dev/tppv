import { API_V5, API_TRIAL_MCP, API_TRIAL_PAGES } from './constants.mjs';
import { normalizeBearerToken } from './token.mjs';

async function postTrial(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const snippet = (await res.text()).slice(0, 80).replace(/\s+/g, ' ');
    return {
      ok: false,
      status: res.status,
      body: {
        text: `Unexpected response (not JSON). Check URL/host. Got: ${snippet}…`,
        error: 'not_json',
      },
    };
  }

  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export async function requestTrial(email, name = 'CLI User') {
  const mcpPayload = { email, name };
  const mcp = await postTrial(API_TRIAL_MCP, mcpPayload);
  if (mcp.ok || mcp.status !== 404) return mcp;

  // Fallback until /cli/trial is deployed
  return postTrial(API_TRIAL_PAGES, { email, name, mode: 'trial', source: 'cli' });
}

export function parseTrialMessage(body) {
  if (body?.error === 'not_json') {
    return { state: 'error', message: body.text };
  }
  const text = body?.text || '';
  if (!text) return { state: 'unknown', message: 'Trial request sent (no confirmation text — check Telegram).' };

  if (text.includes('Trial request submitted')) return { state: 'new', message: text };
  if (text.includes('already pending')) return { state: 'pending', message: text };
  if (text.includes('already has an active trial')) return { state: 'active', message: text };
  if (text.includes('trial has expired')) return { state: 'expired', message: text };
  if (text.includes('not approved')) return { state: 'denied', message: text };
  if (text.includes('failed')) return { state: 'error', message: text };

  return { state: 'unknown', message: text.replace(/\*/g, '') };
}

export async function validateCertificate({ token, countries, pem }) {
  token = normalizeBearerToken(token);
  const url = new URL(API_V5);
  url.searchParams.set('cc', countries);
  url.searchParams.set('details', 'true');

  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      Authorization: `Bearer ${token}`,
    },
    body: pem.trim(),
  });

  const durationMs = Date.now() - started;
  const headers = {
    tppReason: res.headers.get('x-tpp-reason'),
    tppCert: res.headers.get('x-tpp-cert'),
    tppEntity: res.headers.get('x-tpp-entity'),
    tppPassports: res.headers.get('x-tpp-passports'),
    tppIdentifier: res.headers.get('x-tpp-identifier'),
    tppLatest: res.headers.get('x-tpp-latest'),
  };

  if (res.status === 401) {
    return {
      ok: false,
      status: 401,
      error: 'Bearer token expired or invalid. Run: tppv config token <token>',
      durationMs,
      headers,
    };
  }

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      status: res.status,
      error: text || `HTTP ${res.status}`,
      durationMs,
      headers,
    };
  }

  if (res.status === 200 || res.status === 422) {
    return { ok: true, status: res.status, data: json, durationMs, headers };
  }

  let errMsg =
    json.error ||
    json.message ||
    json.subject ||
    (typeof json === 'string' ? json : null) ||
    text.slice(0, 200) ||
    `HTTP ${res.status}`;

  if (res.status === 500) {
    errMsg =
      'V5 backend error — trial/API tokens may be missing from SUBSCRIBERS_KV. ' +
      'CLI calls POST api.tppvalidation.com/v5 (not /v4).';
  }

  return {
    ok: false,
    status: res.status,
    error: errMsg,
    data: json,
    durationMs,
    headers,
  };
}