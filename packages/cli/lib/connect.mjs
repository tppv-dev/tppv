import { API_V5, MCP_HEALTH } from './constants.mjs';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Ping a worker endpoint. Any HTTP response (incl. 401/405) = reachable.
 */
export async function pingService(url, timeoutMs = 6000) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - t0;
    let detail = '';
    if (res.headers.get('content-type')?.includes('json')) {
      const json = await res.json().catch(() => ({}));
      detail = json.status || json.name || '';
    }
    const ok = res.status < 500;
    if (!detail && ok && res.status !== 200) {
      detail = 'live';
    }
    return {
      ok,
      ms,
      status: res.status,
      detail,
      label: url.replace(/^https:\/\//, ''),
    };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - t0,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
      label: url.replace(/^https:\/\//, ''),
    };
  }
}

export async function probeServices() {
  const [mcp, api] = await Promise.all([
    pingService(MCP_HEALTH),
    pingService(API_V5),
  ]);
  mcp.label = 'ai.tppvalidation.com/mcp';
  api.label = 'api.tppvalidation.com/v5';
  return { mcp, api };
}

/**
 * Animate CONNECTING phase while probing MCP + v5 in parallel.
 * Returns probe results after a short minimum dwell for readability.
 */
export async function probeWithAnimation({ minMs = 550, onFrame } = {}) {
  const started = Date.now();
  let results = null;
  const probeDone = probeServices().then((r) => {
    results = r;
    return r;
  });

  let frame = 0;
  while (true) {
    const elapsed = Date.now() - started;
    const ratio = results
      ? 1
      : Math.min(0.92, elapsed / (minMs + 400));

    onFrame?.({
      spinner: SPINNER[frame % SPINNER.length],
      ratio,
      elapsed,
      results,
    });
    frame++;

    if (results && elapsed >= minMs) break;
    await sleep(70);
  }

  return results ?? (await probeDone);
}