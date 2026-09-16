import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API_V5 = process.env.TPPV_API_BASE || 'https://api.tppvalidation.com/v5';
const AUDIT_BASE = process.env.TPPV_AUDIT_BASE || 'https://api.tppvalidation.com';

function configCandidates() {
  const home = os.homedir();
  const files = [];
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    files.push(path.join(process.env.LOCALAPPDATA, 'tppv', 'config.json'));
    files.push(path.join(process.env.LOCALAPPDATA, 'tpp', 'config.json'));
  }
  if (home) {
    files.push(path.join(home, '.config', 'tppv', 'config.json'));
    files.push(path.join(home, '.config', 'tpp', 'config.json'));
  }
  return files;
}

function readTokenFromDisk() {
  for (const file of configCandidates()) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const token = String(parsed.bearerToken || '').trim();
      if (token) return token.replace(/^Bearer\s+/i, '');
    } catch {
      /* skip unreadable config */
    }
  }
  return null;
}

export function loadToken() {
  const env = (process.env.TPPV_TOKEN || process.env.TPP_TOKEN || '').trim();
  if (env) return env.replace(/^Bearer\s+/i, '');
  return readTokenFromDisk();
}

export function apiV5() {
  return API_V5.replace(/\/$/, '');
}

export function auditBase() {
  return AUDIT_BASE.replace(/\/$/, '');
}
