#!/usr/bin/env node

import * as p from '@clack/prompts';
import pc from 'picocolors';
import { loadConfig, saveConfig, maskToken, configPath } from '../lib/config.mjs';
import { analyzeToken, normalizeBearerToken, isJwtShape } from '../lib/token.mjs';
import { resolveCert } from '../lib/cert.mjs';
import { requestTrial, parseTrialMessage, validateCertificate } from '../lib/api.mjs';
import { DEFAULT_COUNTRIES } from '../lib/constants.mjs';
import { parseJurisdictions, countriesForValidation } from '../lib/jurisdictions.mjs';
import { resolveFromDrop, isDropArgv, describeDrop, readDropFromTerminal } from '../lib/drop.mjs';
import { printSplash } from '../lib/splash.mjs';
import { isAllowed } from '../lib/verdict.mjs';
import { runIntegrationFlow, cmdIntegration } from '../lib/integrations/index.mjs';
import {
  printHelp,
  printStatus,
  printTrialResult,
  printValidationResult,
} from '../lib/render.mjs';

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      args.flags.help = true;
      continue;
    }
    if (a === '--no-splash') {
      args.flags['no-splash'] = true;
      continue;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        args.flags[key] = next;
        i++;
      } else {
        args.flags[key] = true;
      }
      continue;
    }
    if (a.startsWith('-') && a.length === 2) {
      const map = { f: 'file', u: 'url', p: 'pem', h: 'help' };
      const key = map[a[1]] || a[1];
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        args.flags[key] = next;
        i++;
      } else {
        args.flags[key] = true;
      }
      continue;
    }
    args._.push(a);
  }
  return args;
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function runValidation({ token, countries, pem, animate = true }) {
  const spinner = p.spinner();
  spinner.start('Validating…');
  spinner.message(`POST api.tppvalidation.com/v5 · ${countries.split(',').length} jurisdictions`);
  const result = await validateCertificate({ token, countries, pem });
  spinner.stop(result.ok ? pc.green('Done') : pc.red(`HTTP ${result.status}`));
  await printValidationResult(result, { animate });
  return result;
}

async function cmdValidate(flags, config, { exit = true } = {}) {
  const token = config.bearerToken;
  if (!token) {
    p.log.error('No bearer token configured. Request a trial or run: tppv config token <token>');
    if (exit) process.exit(1);
    return null;
  }

  const countries = countriesForValidation(config, flags.cc);
  const spinner = p.spinner();
  spinner.start('Loading certificate…');

  let pem;
  try {
    pem = await resolveCert({
      file: flags.file,
      url: flags.url,
      pem: flags.pem,
    });
  } catch (err) {
    spinner.stop(pc.red('Failed'));
    p.log.error(err.message);
    if (exit) process.exit(1);
    return null;
  }

  spinner.stop(pc.green('Loaded'));
  const result = await runValidation({ token, countries, pem, animate: !flags['no-animate'] });
  if (exit) process.exit(result.ok && isAllowed(result.data) ? 0 : 1);
  return result;
}

async function cmdValidateDrop(dropInput, flags, config, { exit = true } = {}) {
  const token = config.bearerToken;
  if (!token) {
    p.log.error('No bearer token configured. Request a trial or run: tppv config token <token>');
    if (exit) process.exit(1);
    return null;
  }

  const countries = countriesForValidation(config, flags.cc);
  const spinner = p.spinner();
  spinner.start('Reading drop…');

  let pem;
  let classified;
  try {
    const resolved = await resolveFromDrop(dropInput);
    pem = resolved.pem;
    classified = resolved.classified;
  } catch (err) {
    spinner.stop(pc.red('Failed'));
    p.log.error(err.message);
    if (exit) process.exit(1);
    return null;
  }

  spinner.stop(pc.green(describeDrop(classified)));
  const result = await runValidation({ token, countries, pem, animate: !flags['no-animate'] });
  if (exit) process.exit(result.ok && isAllowed(result.data) ? 0 : 1);
  return result;
}

async function cmdTrial(flags) {
  const email = (flags.email || '').trim().toLowerCase();
  if (!isEmail(email)) {
    p.log.error('Provide --email <work@company.com>');
    process.exit(1);
  }

  const spinner = p.spinner();
  spinner.start('Submitting trial request…');
  const res = await requestTrial(email, 'CLI User');
  spinner.stop(res.ok ? pc.green('Submitted') : pc.red(`HTTP ${res.status}`));

  const parsed = parseTrialMessage(res.body);
  printTrialResult(parsed);
  saveConfig({ email });
  process.exit(res.ok ? 0 : 1);
}

function cmdConfig(sub, rest) {
  if (sub === 'token') {
    const token = normalizeBearerToken(rest.join(' '));
    if (!token) {
      p.log.error('Usage: tppv config token <bearer>');
      process.exit(1);
    }
    if (!isJwtShape(token)) {
      p.log.error('Token does not look like a JWT (expected three dot-separated parts)');
      process.exit(1);
    }
    const cred = analyzeToken(token);
    if (cred.expired) {
      p.log.warn(`Token is expired (${cred.hint})`);
    }
    saveConfig({ bearerToken: token });
    p.log.success(`${cred.label} saved (${cred.masked}) — ${cred.hint}`);
    return;
  }

  if (sub === 'jurisdictions') {
    const raw = rest.join('').trim();
    if (!raw) {
      saveConfig({ jurisdictions: null });
      p.log.success(`Default jurisdictions: all EU/EEA (${DEFAULT_COUNTRIES.split(',').length} codes)`);
      return;
    }
    const parsed = parseJurisdictions(raw);
    if (!parsed.ok) {
      p.log.error(parsed.error);
      process.exit(1);
    }
    saveConfig({ jurisdictions: parsed.isDefault ? null : parsed.value });
    p.log.success(`Default jurisdictions: ${parsed.value}`);
    return;
  }

  p.log.error('Unknown config command. Use: token, jurisdictions');
  process.exit(1);
}

async function cmdStatus(config) {
  await printSplash({ compact: true, config });
  printStatus({ ...config, _path: configPath() });
}

async function resolveCountriesIfNeeded(config) {
  if (config.jurisdictions) return config.jurisdictions;

  const cc = await p.text({
    message: 'Jurisdictions (Enter = all 30 EU/EEA)',
    placeholder: 'SE,FI,DE',
    initialValue: '',
    validate: (v) => {
      if (!v || !v.trim()) return undefined;
      const parsed = parseJurisdictions(v);
      return parsed.ok ? undefined : parsed.error;
    },
  });
  if (p.isCancel(cc)) return null;

  const parsed = parseJurisdictions(cc);
  const countries = parsed.ok ? parsed.value : DEFAULT_COUNTRIES;
  if (cc?.trim() && parsed.ok && !parsed.isDefault) {
    saveConfig({ jurisdictions: parsed.value });
  }
  return countries;
}

async function promptDropAndValidate(config) {
  const fresh = loadConfig();
  if (!fresh.bearerToken) {
    p.log.warn('No bearer token yet. Request trial or set token first.');
    return;
  }

  const drop = await readDropFromTerminal();
  if (!drop) return;

  const countries = await resolveCountriesIfNeeded(fresh);
  if (!countries) return;

  await cmdValidateDrop(drop, { cc: countries }, fresh, { exit: false });
}

async function runInteractiveMenu() {
  const config = loadConfig();

  const action = await p.select({
    message: 'Main menu',
    initialValue: 'drop',
    options: [
      { value: 'drop', label: 'Drop & validate', hint: 'drag .pem · paste URL · path' },
      { value: 'integration', label: 'Generate gateway integration', hint: 'Kong · APIM · Envoy · 8 more' },
      { value: 'trial', label: 'Request trial', hint: '30-day sandbox' },
      { value: 'token', label: 'Set bearer token', hint: 'from approval email' },
      { value: 'jurisdictions', label: 'Set default jurisdictions', hint: 'SE,FI,DE' },
      { value: 'status', label: 'Show configuration' },
      { value: 'exit', label: 'Exit' },
    ],
  });

  if (p.isCancel(action) || action === 'exit') {
    p.outro(pc.dim('73 — tppv.dev'));
    return;
  }

  if (action === 'drop') {
    await promptDropAndValidate(config);
    return runInteractiveMenu();
  }

  if (action === 'integration') {
    await runIntegrationFlow(config);
    return runInteractiveMenu();
  }

  if (action === 'status') {
    printStatus({ ...config, _path: configPath() });
    return runInteractiveMenu();
  }

  if (action === 'trial') {
    const email = await p.text({
      message: 'Work email',
      placeholder: 'dev@bank.com',
      validate: (v) => (!isEmail(v) ? 'Enter a valid email' : undefined),
    });
    if (p.isCancel(email)) return runInteractiveMenu();

    const spinner = p.spinner();
    spinner.start('Submitting trial request…');
    const res = await requestTrial(email, 'CLI User');
    spinner.stop(res.ok ? pc.green('Submitted') : pc.red(`HTTP ${res.status}`));
    printTrialResult(parseTrialMessage(res.body));
    saveConfig({ email });
    return runInteractiveMenu();
  }

  if (action === 'token') {
    const token = await p.password({
      message: 'Bearer token (from email)',
      validate: (v) => {
        const t = normalizeBearerToken(v);
        if (t.length < 20) return 'Token looks too short';
        if (!isJwtShape(t)) return 'Expected JWT format (header.payload.signature)';
        return undefined;
      },
    });
    if (p.isCancel(token)) return runInteractiveMenu();
    const normalized = normalizeBearerToken(token);
    const cred = analyzeToken(normalized);
    saveConfig({ bearerToken: normalized });
    p.log.success(`${cred.label} saved (${cred.masked}) — ${cred.hint}`);
    return runInteractiveMenu();
  }

  if (action === 'jurisdictions') {
    const codes = await p.text({
      message: 'Default jurisdictions (empty = all 30 EU/EEA)',
      placeholder: 'SE,FI,DE',
      initialValue: config.jurisdictions || '',
      validate: (v) => {
        if (!v || !v.trim()) return undefined;
        const parsed = parseJurisdictions(v);
        return parsed.ok ? undefined : parsed.error;
      },
    });
    if (p.isCancel(codes)) return runInteractiveMenu();
    const parsed = parseJurisdictions(codes);
    if (!parsed.ok) {
      p.log.error(parsed.error);
      return runInteractiveMenu();
    }
    saveConfig({ jurisdictions: parsed.isDefault ? null : parsed.value });
    p.log.success(
      parsed.isDefault
        ? `Using all EU/EEA (${DEFAULT_COUNTRIES.split(',').length} jurisdictions)`
        : `Saved: ${parsed.value}`,
    );
    return runInteractiveMenu();
  }
}

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  let cmd = _[0];

  if (flags.help) {
    printHelp();
    return;
  }

  const config = loadConfig();

  // Drag file onto `tppv` or `tppv path.pem` / `tppv https://...`
  if (cmd && isDropArgv(cmd)) {
    if (!flags['no-splash']) await printSplash({ compact: true });
    await cmdValidateDrop(cmd, flags, config);
    return;
  }

  if (!cmd) {
    if (!flags['no-splash']) await printSplash();
    await runInteractiveMenu();
    return;
  }

  if (cmd === 'validate') {
    if (!flags['no-splash']) await printSplash({ compact: true });
    await cmdValidate(flags, config);
    return;
  }

  if (cmd === 'drop') {
    if (!flags['no-splash']) await printSplash({ compact: true });
    const input = _[1] || flags.input;
    if (!input) {
      await promptDropAndValidate(config);
      return;
    }
    await cmdValidateDrop(input, flags, config);
    return;
  }

  if (cmd === 'integration') {
    if (!flags.gateway && !flags.list) {
      if (!flags['no-splash']) await printSplash({ compact: true });
      await runIntegrationFlow(config);
      return;
    }
    cmdIntegration(flags, config);
    return;
  }

  if (cmd === 'trial') {
    await cmdTrial(flags);
    return;
  }

  if (cmd === 'config') {
    cmdConfig(_[1], _.slice(2));
    return;
  }

  if (cmd === 'status') {
    await cmdStatus(config);
    return;
  }

  if (cmd === 'help') {
    printHelp();
    return;
  }

  p.log.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(pc.red(err.stack || err.message));
  process.exit(1);
});