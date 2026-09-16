import pc from 'picocolors';
import { JURISDICTION_COUNT } from './constants.mjs';
import { probeWithAnimation } from './connect.mjs';
import { loadConfig } from './config.mjs';
import { analyzeToken } from './token.mjs';
import { LOGO_ART, paintAsciiGradientLine } from './gradient.mjs';
import { validationCheckFooterLines } from './response.mjs';

const G = pc.green;
const G2 = (s) => pc.green(pc.bold(s));
const C = pc.cyan;
const M = pc.magenta;
const Y = pc.yellow;
const W = pc.white;
const D = pc.dim;
const R = pc.red;

/** Horizontal ═ count between ╔/╗; inner row is `║ ` + content + ` ║` (2 padding chars). */
const BOX_W = 79;
const INNER_W = BOX_W - 2;

/** Clear terminal and move cursor to top-left. */
export function clearScreen() {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1b[2J\x1b[H\x1b[3J');
}

function visibleLen(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function padLine(inner, width = INNER_W) {
  const pad = Math.max(0, width - visibleLen(inner));
  return inner + D(' '.repeat(pad));
}

function boxRow(content = '') {
  return D('  ║ ') + padLine(content) + D(' ║');
}

function splitBoxRow(left, right = '') {
  if (!right) return boxRow(left);
  const gap = Math.max(2, INNER_W - visibleLen(left) - visibleLen(right));
  return boxRow(left + D(' '.repeat(gap)) + right);
}

function taglineRow() {
  return (
    W('VALIDATES eIDAS CERT ACCORDING TO') +
    D(' · ') +
    W('PSD2/3 & PSR') +
    D(' · FOR ') +
    Y(String(JURISDICTION_COUNT)) +
    W(' JURISDICTIONS')
  );
}

function peakProbeMs(results) {
  const times = [results?.mcp?.ms, results?.api?.ms].filter((ms) => typeof ms === 'number');
  return times.length ? Math.max(...times) : null;
}

function gatewayStatusRight(results) {
  const allUp = results?.mcp?.ok && results?.api?.ok;
  const peakMs = peakProbeMs(results);

  if (allUp) {
    const ms = peakMs != null ? D('  ·  ') + G(`${peakMs}ms`) : '';
    return G('gateway reachable') + ms;
  }

  if (results && peakMs != null) {
    return D(`${peakMs}ms`);
  }

  return '';
}

function serviceStatusParts(svc, waitingLabel) {
  if (!svc) {
    return {
      left: waitingLabel ? D(`   ${waitingLabel}`) : D('   awaiting probe…'),
      right: '',
    };
  }
  if (svc.ok) {
    const tag = svc.detail ? D(` · ${svc.detail}`) : D(' · online');
    return {
      left: G('● ONLINE  ') + W(svc.label) + tag,
      right: '',
    };
  }
  const why = svc.error ? D(` · ${svc.error}`) : D(` · HTTP ${svc.status}`);
  return {
    left: R('○ OFFLINE ') + D(svc.label) + why,
    right: '',
  };
}

function renderConnectingFrame({ spinner, ratio, results }) {
  clearScreen();
  const bar = ratio >= 1 && results
    ? pc.green('█'.repeat(14))
    : Y('█'.repeat(Math.min(14, Math.round(ratio * 14)))) +
      D('░'.repeat(14 - Math.min(14, Math.round(ratio * 14))));

  console.log('');
  console.log(D('  ╔' + '═'.repeat(BOX_W) + '╗'));
  const headLeft =
    (results ? G('●') : Y(spinner)) +
    (results ? G(' LINK UP  ') : D(' CONNECTING ')) +
    bar;
  const headRight = results ? gatewayStatusRight(results) : '';
  console.log(splitBoxRow(headLeft, headRight));

  const mcp = serviceStatusParts(results?.mcp, 'pinging ai.tppvalidation.com/mcp …');
  const api = serviceStatusParts(results?.api, 'pinging api.tppvalidation.com/v5 …');
  console.log(splitBoxRow(mcp.left, mcp.right));
  console.log(splitBoxRow(api.left, api.right));
  console.log(D('  ╚' + '═'.repeat(BOX_W) + '╝'));
}

function printLogo() {
  for (let i = 0; i < LOGO_ART.length; i++) {
    console.log(boxRow(paintAsciiGradientLine(LOGO_ART[i], i)));
  }
}

function credentialBadge(cred) {
  if (!cred.hasToken) return Y('○ NOT SET');
  if (!cred.valid || cred.expired) return R(`✕ ${cred.label}`);
  if (cred.tier === 'trial') {
    return (cred.remainingDays !== null && cred.remainingDays <= 5 ? Y : G)(`● ${cred.label}`);
  }
  if (cred.tier === 'production' || cred.tier === 'enterprise') {
    return C(`● ${cred.label}`);
  }
  return G(`● ${cred.label}`);
}

function credentialStatusText(cred) {
  if (cred.expired) return R(cred.hint);
  if (cred.tier === 'trial' && cred.remainingDays !== null && cred.remainingDays <= 5) return Y(cred.hint);
  return W(cred.hint);
}

function credentialRows(config) {
  const cred = analyzeToken(config.bearerToken);

  if (!cred.hasToken) {
    return [boxRow(Y('○ NOT SIGNED IN  ') + D(cred.hint))];
  }

  const who =
    cred.client ||
    (cred.subject ? cred.subject.replace(/^(Trial|Subscription) - /i, '') : '') ||
    config.email ||
    '';

  const line =
    credentialBadge(cred) +
    (who ? D('  ·  ') + W(who) : '') +
    D('  ·  ') +
    credentialStatusText(cred);

  return [boxRow(line)];
}

function connectionHeader(results) {
  const allUp = results?.mcp?.ok && results?.api?.ok;
  const headLeft = allUp
    ? G('● LINK UP  ') + D('TLS 1.3  ·  mTLS')
    : R('● DEGRADED ') + D('one or more endpoints unreachable');
  const mcp = serviceStatusParts(results?.mcp, 'pinging ai.tppvalidation.com/mcp …');
  const api = serviceStatusParts(results?.api, 'pinging api.tppvalidation.com/v5 …');

  return [
    splitBoxRow(headLeft, gatewayStatusRight(results)),
    splitBoxRow(mcp.left, mcp.right),
    splitBoxRow(api.left, api.right),
  ];
}

function renderFullSplash(results, { compact = false, config } = {}) {
  clearScreen();
  console.log('');
  console.log(D('  ╔' + '═'.repeat(BOX_W) + '╗'));

  for (const row of connectionHeader(results)) {
    console.log(row);
  }

  console.log(D('  ╠' + '═'.repeat(BOX_W) + '╣'));
  for (const row of credentialRows(config || loadConfig())) {
    console.log(row);
  }

  console.log(D('  ╠' + '═'.repeat(BOX_W) + '╣'));
  console.log(boxRow(''));
  printLogo();
  console.log(boxRow(''));

  console.log(D('  ╠' + '═'.repeat(BOX_W) + '╣'));
  console.log(boxRow(taglineRow()));
  const [checksA, checksB] = validationCheckFooterLines();
  console.log(boxRow(D(checksA)));
  console.log(boxRow(D(checksB)));
  console.log(D('  ╚' + '═'.repeat(BOX_W) + '╝'));
  console.log('');

  if (!compact) {
    console.log(
      D('  ') +
        G('drag') +
        D(' .pem  ') +
        C('│') +
        D('  ') +
        Y('paste') +
        D(' URL/PEM  ') +
        C('│') +
        D('  ') +
        M('drop') +
        D(' path — choose ') +
        W('Drop & validate') +
        D(' in menu'),
    );
    console.log('');
  }
}

/** Enter alternate screen so the whole window is live input (not scrollback). */
export function beginDropMode() {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
  console.log('');
  console.log('  ' + G2('LISTENING') + D('  —  entire terminal window is the drop target'));
  console.log('');
  console.log('  ' + W('Drop') + D(' .pem ') + C('anywhere') + D(' in this window'));
  console.log('  ' + W('Paste') + D(' PEM block  ') + C('·') + D('  type ') + W('path') + D(' or ') + W('https://') + D(' URL'));
  console.log('  ' + D('Empty line + Enter finishes PEM  ·  Ctrl+C cancel'));
  console.log('');
  console.log(D('  ' + '─'.repeat(60)));
  console.log('');
}

/** Restore main screen after drop mode. */
export function endDropMode() {
  if (!process.stdout.isTTY) return;
  process.stdout.write('\x1b[?1049l');
}

/** @deprecated Use beginDropMode — readDropFromTerminal calls it automatically. */
export function printDropZone() {
  beginDropMode();
}

export async function printSplash({ compact = false, skipProbe = false, config } = {}) {
  const cfg = config || loadConfig();
  const canAnimate = process.stdout.isTTY && !skipProbe;

  if (!canAnimate) {
    renderFullSplash(
      skipProbe ? null : await probeWithAnimation({ minMs: 0, onFrame: () => {} }),
      { compact, config: cfg },
    );
    return;
  }

  const results = await probeWithAnimation({
    minMs: compact ? 280 : 550,
    onFrame: renderConnectingFrame,
  });

  renderFullSplash(results, { compact, config: cfg });
}

