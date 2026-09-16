import pc from 'picocolors';

/** Orange → red brand gradient for ASCII logo art. */
const GRADIENT_START = [255, 149, 0]; // #FF9500
const GRADIENT_END = [220, 38, 38]; // #DC2626

const PALETTE_256 = [208, 214, 203, 202, 196];

export const LOGO_ART = [
  '████████╗██████╗ ██████╗',
  '╚══██╔══╝██╔══██╗██╔══██╗',
  '   ██║   ██████╔╝██████╔╝',
  '   ██║   ██╔═══╝ ██╔═══╝',
  '   ██║   ██║     ██║',
  '   ╚═╝   ╚═╝     ╚═╝',
  '██╗   ██╗ █████╗ ██╗     ██╗██████╗  █████╗ ████████╗██╗ ██████╗ ███╗   ██╗',
  '██║   ██║██╔══██╗██║     ██║██╔══██╗██╔══██╗╚══██╔══╝██║██╔═══██╗████╗  ██║',
  '██║   ██║███████║██║     ██║██║  ██║███████║   ██║   ██║██║   ██║██╔██╗ ██║',
  '╚██╗ ██╔╝██╔══██║██║     ██║██║  ██║██╔══██║   ██║   ██║██║   ██║██║╚██╗██║',
  ' ╚████╔╝ ██║  ██║███████╗██║██████╔╝██║  ██║   ██║   ██║╚██████╔╝██║ ╚████║',
  '  ╚═══╝  ╚═╝  ╚═╝╚══════╝╚═╝╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝ ╚═════╝ ╚═╝  ╚═══╝',
];

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function colorEnabled() {
  if (process.env.FORCE_COLOR === '0') return false;
  if (process.env.FORCE_COLOR || process.env.CLICOLOR_FORCE) return true;
  if (process.env.NO_COLOR !== undefined) return false;
  return !!process.stdout.isTTY;
}

function supportsTruecolor() {
  if (!colorEnabled()) return false;
  const term = process.env.COLORTERM || '';
  if (term === 'truecolor' || term === '24bit') return true;
  if (process.env.TERM_PROGRAM === 'vscode' || process.env.TERM_PROGRAM === 'iTerm.app') return true;
  if (process.env.WT_SESSION) return true;
  if (process.env.TERM?.includes('256color')) return true;
  return process.platform !== 'win32';
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function lerpRgb(start, end, t) {
  return [
    lerp(start[0], end[0], t),
    lerp(start[1], end[1], t),
    lerp(start[2], end[2], t),
  ];
}

function gradientStop(lineIndex, charIndex, lineLength, totalLines) {
  const tH = lineLength > 1 ? charIndex / (lineLength - 1) : 0;
  const tV = totalLines > 1 ? lineIndex / (totalLines - 1) : 0;
  return tV * 0.5 + tH * 0.5;
}

function paintTruecolor(line, lineIndex, totalLines) {
  let out = BOLD;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === ' ') {
      out += ch;
      continue;
    }
    const [r, g, b] = lerpRgb(GRADIENT_START, GRADIENT_END, gradientStop(lineIndex, i, line.length, totalLines));
    out += `\x1b[38;2;${r};${g};${b}m${ch}`;
  }
  return out + RESET;
}

function paint256(line, lineIndex, totalLines) {
  let out = BOLD;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === ' ') {
      out += ch;
      continue;
    }
    const t = gradientStop(lineIndex, i, line.length, totalLines);
    const idx = Math.min(PALETTE_256.length - 1, Math.round(t * (PALETTE_256.length - 1)));
    out += `\x1b[38;5;${PALETTE_256[idx]}m${ch}`;
  }
  return out + RESET;
}

function paintFallback(line, lineIndex, totalLines) {
  const t = totalLines > 1 ? lineIndex / (totalLines - 1) : 0;
  const paint =
    t < 0.34 ? pc.yellow : t < 0.67 ? (s) => pc.red(pc.yellow(s)) : pc.red;
  return pc.bold(paint(line));
}

/** Paint one logo line with an orange → red gradient (per character). */
export function paintAsciiGradientLine(line, lineIndex, totalLines = LOGO_ART.length) {
  if (!colorEnabled()) return line;
  if (supportsTruecolor()) return paintTruecolor(line, lineIndex, totalLines);
  if (process.env.TERM?.includes('256') || process.env.COLORTERM) return paint256(line, lineIndex, totalLines);
  return paintFallback(line, lineIndex, totalLines);
}