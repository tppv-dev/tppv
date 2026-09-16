import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';

import { TARGETS, findTarget, targetChoices, targetState } from './targets.mjs';
import { buildSpec, describeSpec, DEFAULTS, FAIL_MODES, CACHE_PRESETS, PSD2_ROLES } from './contract.mjs';
import { renderKong } from './renderers/kong.mjs';
import { renderContractOnly } from './renderers/contract-md.mjs';
import { parseJurisdictions } from '../jurisdictions.mjs';
import { DEFAULT_COUNTRIES } from '../constants.mjs';

const RENDERERS = {
  kong: renderKong,
};

function renderFor(spec) {
  const renderer = RENDERERS[spec.target.id];
  return renderer ? renderer(spec) : renderContractOnly(spec);
}

export function printTargets() {
  console.log('');
  console.log(pc.bold('  Supported gateways'));
  console.log('');
  // Colour after padding — padEnd() counts ANSI escapes as width otherwise.
  const BADGE = { verified: pc.green, untested: pc.yellow, contract: pc.dim };
  const indent = ' '.repeat(12);

  for (const t of TARGETS) {
    const state = targetState(t);
    console.log(`  ${BADGE[state](state.padEnd(9))} ${pc.bold(t.id.padEnd(16))} ${t.label}`);
    console.log(`${indent}${pc.dim(t.mechanism)}`);
    if (t.testedAgainst) console.log(`${indent}${pc.dim(t.testedAgainst)}`);
    console.log('');
  }
  console.log(pc.dim('  verified — generated output has passed its own test harness'));
  console.log(pc.dim('  untested — plugin renders, harness included, not yet executed'));
  console.log(pc.dim('  contract — enforcement spec + agent prompt; no code we have not run'));
  console.log('');
}

function conflictsIn(dir, files) {
  return files
    .map((f) => path.join(dir, f.path))
    .filter((abs) => fs.existsSync(abs));
}

function writeFiles(dir, files) {
  for (const file of files) {
    const abs = path.join(dir, file.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.contents, 'utf8');
    if (file.mode && process.platform !== 'win32') {
      try {
        fs.chmodSync(abs, file.mode);
      } catch {
        /* best-effort — the file is still usable via `bash smoke.sh` */
      }
    }
  }
}

function printSummary(spec, files, dir) {
  const rows = describeSpec(spec)
    .map(([k, v]) => `${pc.dim(k.padEnd(20))} ${v}`)
    .join('\n');
  p.note(rows, 'Integration');

  console.log('');
  for (const f of files) {
    console.log(`  ${pc.green('+')} ${path.join(dir, f.path)}`);
  }
  console.log('');
}

function nextSteps(spec, dir) {
  if (spec.target.status === 'template') {
    return [
      `cd ${dir}`,
      'export TPP_BEARER_TOKEN=<your token>',
      'docker compose -f docker-compose.test.yml up -d',
      './test/smoke.sh',
    ];
  }
  return [
    `cd ${dir}`,
    'read CONTRACT.md — it is the specification, not an implementation',
    'hand AGENT-PROMPT.md to your coding agent, or implement it yourself',
    'run all four test cases in CONTRACT.md before deploying',
  ];
}

function emit(spec, dir, { force }) {
  const files = renderFor(spec);
  const clashes = conflictsIn(dir, files);

  if (clashes.length && !force) {
    p.log.error(`Refusing to overwrite ${clashes.length} existing file(s):`);
    for (const c of clashes) console.log(`    ${pc.yellow(c)}`);
    p.log.info('Re-run with --force to overwrite. Generation is deterministic, so a clean diff means nothing changed.');
    return null;
  }

  writeFiles(dir, files);
  printSummary(spec, files, dir);

  const steps = nextSteps(spec, dir);
  p.note(steps.join('\n'), 'Next');

  if (spec.failMode === 'open') {
    p.log.warn(
      'fail_mode=open — a validator outage becomes an authorization bypass. ' +
        'Alert on the x-tpp-validation: bypassed header at your upstream.',
    );
  }
  const state = targetState(spec.target);
  if (state === 'contract') {
    p.log.warn(
      `No template for ${spec.target.label} yet — this is a specification, not an ` +
        'implementation. Nothing here has been executed against a running gateway.',
    );
  } else if (state === 'untested') {
    p.log.warn(
      `This plugin has not yet been executed against a running ${spec.target.label} ` +
        'instance. Run test/smoke.sh before it goes near production traffic.',
    );
  }

  return files;
}

/* ------------------------------------------------------------------ *
 * interactive
 * ------------------------------------------------------------------ */

export async function runIntegrationFlow(config) {
  const targetId = await p.select({
    message: 'API gateway',
    options: targetChoices(),
  });
  if (p.isCancel(targetId)) return;
  const target = findTarget(targetId);

  p.note(
    [
      `${pc.dim('mechanism  ')} ${target.mechanism}`,
      `${pc.dim('cert source')} ${target.certSource.expr}`,
      `${pc.dim('encoding   ')} ${target.certSource.encoding}`,
      `${pc.dim('requires   ')} ${target.certSource.requires}`,
    ].join('\n'),
    target.label,
  );

  const failMode = await p.select({
    message: 'When api.tppvalidation.com does not answer',
    initialValue: DEFAULTS.failMode,
    options: FAIL_MODES.map((f) => ({ value: f.value, label: f.label, hint: f.hint })),
  });
  if (p.isCancel(failMode)) return;

  if (failMode === 'open') {
    const sure = await p.confirm({
      message: 'Fail open turns our outage into your authorization bypass. Continue?',
      initialValue: false,
    });
    if (p.isCancel(sure) || !sure) return;
  }

  let graceTtl = 0;
  if (failMode === 'closed_grace') {
    const grace = await p.select({
      message: 'Grace window — how long may a stale verdict be reused during an outage',
      initialValue: DEFAULTS.graceTtl,
      options: [
        { value: 3600, label: '1 hour', hint: 'tight' },
        { value: 21600, label: '6 hours', hint: 'recommended' },
        { value: 86400, label: '24 hours', hint: 'survives a long incident' },
      ],
    });
    if (p.isCancel(grace)) return;
    graceTtl = grace;
  }

  const cacheTtl = await p.select({
    message: 'Cache a positive verdict for',
    initialValue: DEFAULTS.cacheTtl,
    options: CACHE_PRESETS.map((c) => ({ value: c.value, label: c.label, hint: c.hint })),
  });
  if (p.isCancel(cacheTtl)) return;

  const restrict = await p.confirm({
    message: 'Restrict this route to specific PSD2 roles?',
    initialValue: false,
  });
  if (p.isCancel(restrict)) return;

  let allowedRoles = [];
  if (restrict) {
    const roles = await p.multiselect({
      message: 'Roles permitted on this route',
      options: PSD2_ROLES,
      required: true,
    });
    if (p.isCancel(roles)) return;
    allowedRoles = roles;
  }

  const jurisdictions = config.jurisdictions || DEFAULT_COUNTRIES;

  const outDir = await p.text({
    message: 'Output directory',
    placeholder: `./tpp-${target.id}`,
    initialValue: `./tpp-${target.id}`,
    validate: (v) => (!v || !v.trim() ? 'Enter a path' : undefined),
  });
  if (p.isCancel(outDir)) return;

  const spec = buildSpec({
    target,
    jurisdictions,
    failMode,
    cacheTtl,
    graceTtl,
    allowedRoles,
  });

  const dir = path.resolve(outDir.trim());
  const files = renderFor(spec);
  printSummary(spec, files, dir);

  const go = await p.confirm({ message: `Write ${files.length} files?`, initialValue: true });
  if (p.isCancel(go) || !go) return;

  const clashes = conflictsIn(dir, files);
  let force = false;
  if (clashes.length) {
    p.log.warn(`${clashes.length} file(s) already exist in ${dir}`);
    const ow = await p.confirm({ message: 'Overwrite them?', initialValue: false });
    if (p.isCancel(ow) || !ow) return;
    force = true;
  }

  emit(spec, dir, { force });
}

/* ------------------------------------------------------------------ *
 * non-interactive
 * ------------------------------------------------------------------ */

function parseIntFlag(value, fallback, label) {
  if (value === undefined || value === true) return fallback;
  const n = Number.parseInt(String(value), 10);
  if (Number.isNaN(n) || n < 0) {
    p.log.error(`--${label} must be a non-negative integer`);
    process.exit(1);
  }
  return n;
}

export function cmdIntegration(flags, config) {
  if (flags.list) {
    printTargets();
    return;
  }

  const target = findTarget(flags.gateway);
  if (!target) {
    p.log.error(
      flags.gateway
        ? `Unknown gateway: ${flags.gateway}`
        : 'Pass --gateway <id>, or run `tppv integration` with no flags for the interactive flow.',
    );
    p.log.info(`Known: ${TARGETS.map((t) => t.id).join(', ')}`);
    process.exit(1);
  }

  const failMode = flags['fail-mode'] || DEFAULTS.failMode;
  if (!FAIL_MODES.some((f) => f.value === failMode)) {
    p.log.error(`--fail-mode must be one of: ${FAIL_MODES.map((f) => f.value).join(', ')}`);
    process.exit(1);
  }

  let jurisdictions = config.jurisdictions || DEFAULT_COUNTRIES;
  if (flags.cc && flags.cc !== true) {
    const parsed = parseJurisdictions(flags.cc);
    if (!parsed.ok) {
      p.log.error(parsed.error);
      process.exit(1);
    }
    jurisdictions = parsed.value;
  }

  let allowedRoles = [];
  if (flags.roles && flags.roles !== true) {
    allowedRoles = String(flags.roles)
      .split(',')
      .map((r) => r.trim().toUpperCase())
      .filter(Boolean);
    const known = PSD2_ROLES.map((r) => r.value);
    const bad = allowedRoles.filter((r) => !known.includes(r));
    if (bad.length) {
      p.log.error(`Unknown role(s): ${bad.join(', ')}. Known: ${known.join(', ')}`);
      process.exit(1);
    }
  }

  const spec = buildSpec({
    target,
    jurisdictions,
    failMode,
    cacheTtl: parseIntFlag(flags['cache-ttl'], DEFAULTS.cacheTtl, 'cache-ttl'),
    negativeCacheTtl: parseIntFlag(flags['negative-ttl'], DEFAULTS.negativeCacheTtl, 'negative-ttl'),
    graceTtl: parseIntFlag(flags['grace-ttl'], DEFAULTS.graceTtl, 'grace-ttl'),
    timeoutMs: parseIntFlag(flags.timeout, DEFAULTS.timeoutMs, 'timeout'),
    allowedRoles,
    injectHeaders: !flags['no-inject'],
  });

  const dir = path.resolve(
    flags.out && flags.out !== true ? String(flags.out) : `./tpp-${target.id}`,
  );

  const written = emit(spec, dir, { force: !!flags.force });
  process.exit(written ? 0 : 1);
}
