import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  CONFIG_DIR_WIN,
  CONFIG_DIR_UNIX,
  LEGACY_CONFIG_DIR_WIN,
  LEGACY_CONFIG_DIR_UNIX,
} from './constants.mjs';
import { sanitizeStoredJurisdictions } from './jurisdictions.mjs';
import { normalizeBearerToken } from './token.mjs';

export function configDir() {
  if (process.platform === 'win32' && CONFIG_DIR_WIN) {
    return CONFIG_DIR_WIN;
  }
  if (CONFIG_DIR_UNIX) return CONFIG_DIR_UNIX;
  return path.join(os.homedir(), '.tppv');
}

function legacyConfigDir() {
  if (process.platform === 'win32' && LEGACY_CONFIG_DIR_WIN) {
    return LEGACY_CONFIG_DIR_WIN;
  }
  if (LEGACY_CONFIG_DIR_UNIX) return LEGACY_CONFIG_DIR_UNIX;
  return path.join(os.homedir(), '.tpp');
}

export function configPath() {
  return path.join(configDir(), 'config.json');
}

const DEFAULTS = {
  bearerToken: null,
  jurisdictions: null,
  email: null,
};

function readConfigFile(file) {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

export function loadConfig() {
  try {
    let parsed = readConfigFile(configPath());
    if (!parsed) {
      parsed = readConfigFile(path.join(legacyConfigDir(), 'config.json'));
    }
    if (!parsed) return { ...DEFAULTS };

    const merged = { ...DEFAULTS, ...parsed };
    if (merged.bearerToken) {
      merged.bearerToken = normalizeBearerToken(merged.bearerToken) || null;
    }
    const { value, corrupt } = sanitizeStoredJurisdictions(merged.jurisdictions);
    if (corrupt) {
      merged.jurisdictions = null;
      try {
        fs.mkdirSync(configDir(), { recursive: true });
        fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2) + '\n', 'utf8');
      } catch {
        /* best-effort repair */
      }
    } else {
      merged.jurisdictions = value;
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(patch) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  const next = { ...loadConfig(), ...patch };
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

export function maskToken(token) {
  if (!token || token.length < 12) return '••••••••';
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}