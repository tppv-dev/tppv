import pc from 'picocolors';
import { toRows, toSummary, formatCheckDetail, validationCheckFooterLines } from './response.mjs';
import { analyzeToken } from './token.mjs';
import { LOGO_ART, paintAsciiGradientLine } from './gradient.mjs';

const SIGNAL = pc.green;
const FAIL = pc.red;
const WARN = pc.yellow;
const DIM = pc.dim;
const INK = (s) => s;
const SIGNAL_BOLD = (s) => pc.bold(SIGNAL(s));
const FAIL_BOLD = (s) => pc.bold(FAIL(s));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function iconFor(row) {
  if (row.skipped) return DIM('–');
  if (row.ok && row.warning) return WARN('!');
  if (row.ok) return SIGNAL('✓');
  return FAIL('✕');
}

function statusFor(row) {
  if (row.skipped) return DIM('skipped');
  if (row.ok && row.warning) return WARN('warn');
  if (row.ok) return SIGNAL('ok');
  return FAIL('fail');
}

export function printBanner() {
  console.log('');
  for (let i = 0; i < LOGO_ART.length; i++) {
    console.log('  ' + paintAsciiGradientLine(LOGO_ART[i], i));
  }
  console.log('');
  const [checksA, checksB] = validationCheckFooterLines();
  console.log(DIM(`  ${checksA}`));
  console.log(DIM(`  ${checksB}`));
  console.log('');
}

export function printStatus(config) {
  const cred = analyzeToken(config.bearerToken);
  console.log(pc.bold('Configuration'));

  if (!cred.hasToken) {
    console.log(`  API key:       ${DIM('not configured')}`);
    console.log(`  Hint:          ${DIM(cred.hint)}`);
  } else if (cred.expired) {
    console.log(`  API key:       ${FAIL(cred.label)} · ${cred.masked}`);
    console.log(`  Status:        ${FAIL(cred.hint)}`);
  } else {
    const tierColor = cred.tier === 'trial' ? (cred.remainingDays <= 5 ? WARN : SIGNAL) : pc.cyan;
    console.log(`  API key:       ${tierColor(cred.label)} · ${cred.masked}`);
    console.log(`  Status:        ${cred.hint}`);
    if (cred.client || cred.subject) {
      console.log(`  Identity:      ${cred.client || cred.subject}`);
    }
    if (cred.uid) console.log(`  Subscriber:    ${cred.uid}`);
  }

  const jLabel = config.jurisdictions
    ? config.jurisdictions
    : DIM('all EU/EEA (30 jurisdictions — default)');
  console.log(`  Jurisdictions: ${jLabel}`);
  console.log(`  Email:         ${config.email || DIM('—')}`);
  console.log(`  Config file:   ${pc.cyan(config._path || '—')}`);
  console.log('');
}

export async function printValidationResult(result, { animate = true } = {}) {
  if (!result.ok) {
    console.log(FAIL_BOLD('\n  ERROR'));
    if (result.status) console.log(`  HTTP ${result.status}`);
    console.log(`  ${result.error || 'Validation failed'}`);
    if (result.headers?.tppReason) {
      console.log(DIM(`  x-tpp-reason: ${result.headers.tppReason}`));
    }
    if (result.data && typeof result.data === 'object' && result.data.error) {
      console.log(DIM(`  detail: ${result.data.error}`));
    }
    console.log('');
    return;
  }

  const data = result.data;
  const summary = toSummary(data);
  const rows = toRows(data);

  console.log(DIM('\n  POST /v5'));
  console.log(`  provider  ${INK(summary.provider)}`);
  console.log(`  issuer    ${DIM(summary.issuer)}`);
  console.log('');

  let cumulative = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    cumulative += 8 + Math.floor(Math.random() * 12);

    if (animate) {
      process.stdout.write(DIM(`  ${String(cumulative).padStart(4)}ms  `) + DIM('⋯ ') + row.name + '\r');
      await sleep(120 + i * 40);
    }

    const plain = formatCheckDetail(row);
    const detail = row.skipped ? DIM(plain) : !row.ok && row.failReason ? FAIL(plain) : DIM(plain);

    console.log(
      `${DIM(String(cumulative).padStart(4) + 'ms')}  ${iconFor(row)}  ${pc.bold(row.name)}${DIM(' · ')}${detail}`,
    );
  }

  const verdictColor = summary.verdict === 'ALLOWED' ? SIGNAL_BOLD : FAIL_BOLD;
  console.log('');
  console.log(`  ${DIM('verdict')}  ${verdictColor(summary.verdict)}  ${DIM(summary.orgId)} · ${summary.roles} · ${summary.qualification}`);
  console.log(`  ${DIM('timing')}   ${result.durationMs}ms total`);
  if (result.headers?.tppIdentifier) {
    console.log(`  ${DIM('audit')}    ${result.headers.tppIdentifier}`);
  }
  console.log('');
}

export function printTrialResult(parsed) {
  const clean = parsed.message.replace(/`/g, '').replace(/\n+/g, '\n  ');
  console.log('');
  if (parsed.state === 'new' || parsed.state === 'pending' || parsed.state === 'active') {
    console.log(SIGNAL('  ' + clean.split('\n').join('\n  ')));
  } else {
    console.log(FAIL('  ' + clean.split('\n').join('\n  ')));
  }
  console.log('');
}

export function printHelp() {
  console.log(`
${pc.bold('tppv')} — TPP Validation CLI

${pc.bold('Usage')}
  tppv                          Interactive menu + ANSI splash (default)
  tppv <path.pem|https://…>     Drop validate — drag file onto terminal or shortcut
  tppv drop [path|url]          Drop zone validate
  tppv validate [options]       Validate a certificate
  tppv integration [options]    Generate an API gateway integration
  tppv trial --email <addr>     Request a 30-day trial
  tppv config token <bearer>    Save bearer token
  tppv config jurisdictions CC  Set default countries (e.g. SE,FI,DE)
  tppv status                   Show saved configuration

${pc.bold('Validate / drop options')}
  --file, -f <path>            Local .pem / .cer / .crt file
  --url,  -u <url>             Fetch PEM from https URL
  --pem,  -p <text>            Inline PEM or base64
  --cc <codes>                 Jurisdictions (comma-separated)
  --no-animate                 Skip progress animation
  --no-splash                  Skip ANSI startup screen

${pc.bold('Integration options')}
  --list                       List supported gateways
  --gateway <id>               kong, azure-apim, aws-apigw, envoy, nginx,
                               apigee, traefik, tyk, mulesoft-flex,
                               ibm-datapower, wso2
  --out <dir>                  Output directory (default ./tpp-<gateway>)
  --fail-mode <mode>           closed_grace (default) | closed | open
  --cache-ttl <s>              Positive verdict cache, seconds (default 3600)
  --negative-ttl <s>           Denied verdict cache, seconds (default 60)
  --grace-ttl <s>              Stale verdict reuse during outage (default 21600)
  --timeout <ms>               Validator call timeout (default 2000)
  --roles <list>               Restrict route: PSP_AI,PSP_PI,PSP_IC,PSP_AS
  --no-inject                  Do not stamp x-tpp-* headers upstream
  --force                      Overwrite existing files

${pc.bold('Install')}
  npm:          npm install -g @tppv/cli
  macOS/Linux:  curl -fsSL https://tppv.dev/cli/install.sh | bash
  Windows:      irm https://tppv.dev/cli/install.ps1 | iex

${pc.bold('Examples')}
  tppv validate -f ./qwac.pem --cc SE,FI,DE
  tppv validate -u https://bank.example/certs/tpp.pem
  tppv integration --list
  tppv integration --gateway kong --out ./gateway --roles PSP_AI,PSP_PI
  tppv trial --email dev@bank.com
  tppv config token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
`);
}