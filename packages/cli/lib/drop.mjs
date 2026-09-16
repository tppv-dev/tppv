import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { resolveCert, normalizePem } from './cert.mjs';
import { beginDropMode, endDropMode } from './splash.mjs';

/**
 * Normalize terminal drop/paste: quoted paths, file:// URIs, trailing slashes.
 */
export function cleanDropInput(raw) {
  let s = (raw || '').trim();
  if (!s) return '';

  // Multi-line paste — keep full PEM blocks; otherwise use first line only
  if (s.includes('\n') && !/-----BEGIN [A-Z0-9 ]+-----/.test(s)) {
    const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    s = lines[0] || s;
  }

  // Strip surrounding quotes (Explorer / Terminal drag-drop)
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }

  if (s.toLowerCase().startsWith('file://')) {
    try {
      s = decodeURIComponent(new URL(s).pathname);
      if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(s)) {
        s = s.slice(1);
      }
    } catch {
      s = s.replace(/^file:\/\//i, '').replace(/\//g, path.sep);
    }
  }

  return s.trim();
}

export function classifyDropInput(raw) {
  const input = cleanDropInput(raw);
  if (!input) return { kind: 'empty', value: '' };

  if (/^https?:\/\//i.test(input)) {
    return { kind: 'url', value: input };
  }

  if (
    /-----BEGIN [A-Z0-9 ]+-----/.test(input) ||
    (input.startsWith('MI') && input.replace(/\s+/g, '').length > 100)
  ) {
    return { kind: 'pem', value: input };
  }

  // Windows/Unix path with cert extension, or path that exists on disk
  const looksLikePath =
    /^([A-Za-z]:\\|\\\\|\/|\.{1,2}[\\/])/.test(input) ||
    /\.(pem|cer|crt|der)$/i.test(input);

  if (looksLikePath || fs.existsSync(input)) {
    return { kind: 'file', value: path.resolve(input) };
  }

  return { kind: 'unknown', value: input };
}

export function describeDrop(classified) {
  switch (classified.kind) {
    case 'url':
      return `URL → ${classified.value}`;
    case 'file':
      return `FILE → ${classified.value}`;
    case 'pem':
      return `PEM → ${classified.value.slice(0, 48).replace(/\s+/g, ' ')}…`;
    default:
      return classified.value;
  }
}

export async function resolveFromDrop(raw) {
  const enriched = await enrichDropInput(raw);
  const classified = classifyDropInput(enriched);
  switch (classified.kind) {
    case 'url':
      return { pem: await resolveCert({ url: classified.value }), classified };
    case 'file':
      return { pem: await resolveCert({ file: classified.value }), classified };
    case 'pem':
      return { pem: await resolveCert({ pem: classified.value }), classified };
    case 'empty':
      throw new Error('Nothing to validate — drop a .pem, paste a URL, or type a path');
    default:
      throw new Error(
        `Could not recognise input. Drop a .pem file, paste an https:// URL, or PEM body.\n  Got: ${classified.value.slice(0, 60)}`,
      );
  }
}

function pemBlocksBalanced(text) {
  const begins = (text.match(/-----BEGIN [A-Z0-9 ]+-----/g) || []).length;
  const ends = (text.match(/-----END [A-Z0-9 ]+-----/g) || []).length;
  return begins > 0 && begins === ends;
}

/** Continue reading lines when PEM was pasted one line at a time. */
async function readPemContinuation(firstLine) {
  const lines = [firstLine];
  const rl = readline.createInterface({ input, output });

  return new Promise((resolve) => {
    const onLine = (line) => {
      lines.push(line);
      const text = lines.join('\n');
      if (pemBlocksBalanced(text)) {
        rl.off('line', onLine);
        rl.close();
        resolve(text);
      }
    };
    rl.on('line', onLine);
  });
}

/**
 * Normalize drop input — completes partial PEM pastes interactively.
 */
export async function enrichDropInput(raw) {
  let s = cleanDropInput(raw);
  if (/-----BEGIN/.test(s) && !/-----END/.test(s)) {
    p.log.info('PEM detected — paste remaining lines (finish with the last END CERTIFICATE block)');
    s = await readPemContinuation(s);
  }
  return s;
}

function dropInputReady(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  const c = classifyDropInput(trimmed);
  if (c.kind === 'file' || c.kind === 'url') return true;
  if (/-----BEGIN/.test(trimmed)) return pemBlocksBalanced(trimmed);
  if (c.kind === 'pem') return true;
  return false;
}

const PROMPT = pc.cyan('  › ');

function stripTerminalEscapes(s) {
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

/** Release Clack so the whole terminal window accepts drop & paste. */
function prepareStdinForDrop() {
  if (!process.stdin.isTTY) return;
  if (process.stdin.isPaused()) process.stdin.resume();
  process.stdin.setEncoding('utf8');
}

function shouldAutoAccept(text) {
  const cleaned = cleanDropInput(text);
  if (!cleaned) return false;
  const c = classifyDropInput(cleaned);
  if (c.kind === 'file') {
    return fs.existsSync(c.value) || /\.(pem|cer|crt|der)$/i.test(cleaned);
  }
  return false;
}

/**
 * Read drop input from the full terminal window.
 * Uses the alternate screen so drag-and-drop works anywhere (not just scrollback).
 */
export async function readDropFromTerminal() {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of input) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw.trim()) return null;
    return enrichDropInput(raw);
  }

  beginDropMode();
  prepareStdinForDrop();
  input.setRawMode?.(true);

  const lines = [];
  let currentLine = '';
  let settled = false;
  let idleTimer = null;

  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(idleTimer);
      input.removeListener('data', onData);
      input.setRawMode?.(false);
      endDropMode();
    };

    const finish = async (raw) => {
      if (settled) return;
      settled = true;
      cleanup();
      const text = (raw || '').trim();
      if (!text) {
        resolve(null);
        return;
      }
      try {
        resolve(await enrichDropInput(text));
      } catch (err) {
        p.log.error(err.message);
        resolve(null);
      }
    };

    const combinedText = () => {
      const parts = [...lines];
      if (currentLine.length) parts.push(currentLine);
      return parts.join('\n');
    };

    const scheduleAutoAccept = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const text = combinedText().trim();
        if (!text) return;
        if (shouldAutoAccept(text) || dropInputReady(text)) finish(text);
      }, 100);
    };

    const onData = (buf) => {
      if (settled) return;

      const str = stripTerminalEscapes(buf.toString());
      for (const ch of str) {
        if (ch === '\u0003' || ch === '\u0004') {
          finish(null);
          return;
        }

        if (ch === '\r' || ch === '\n') {
          if (!currentLine.trim() && lines.length > 0) {
            const text = lines.join('\n');
            if (dropInputReady(text)) {
              finish(text);
              return;
            }
            p.log.warn('Unrecognised input — drop a .pem, paste a PEM block, or type a path/URL');
            lines.length = 0;
            output.write('\n' + PROMPT);
            continue;
          }

          lines.push(currentLine);
          currentLine = '';
          output.write('\n' + PROMPT);

          const text = combinedText();
          if (dropInputReady(text)) {
            finish(text);
            return;
          }
          continue;
        }

        if (ch === '\u007f' || ch === '\b') {
          if (currentLine.length) {
            currentLine = currentLine.slice(0, -1);
            output.write('\b \b');
          }
          continue;
        }

        if (ch < ' ' && ch !== '\t') continue;

        currentLine += ch;
        output.write(ch);
      }

      scheduleAutoAccept();
    };

    input.on('data', onData);
    output.write(PROMPT);
  });
}

/** @deprecated Use readDropFromTerminal — kept as alias for callers. */
export async function promptDropInput() {
  return readDropFromTerminal();
}

/** True if argv looks like a dropped file path or cert URL (not a subcommand). */
export function isDropArgv(arg) {
  if (!arg || arg.startsWith('-')) return false;
  const subcommands = new Set(['validate', 'trial', 'config', 'status', 'help']);
  if (subcommands.has(arg.toLowerCase())) return false;
  const c = classifyDropInput(arg);
  return c.kind === 'url' || c.kind === 'file' || c.kind === 'pem';
}