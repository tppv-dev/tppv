export const JURISDICTION_COUNT = 30;

export const API_V5 = 'https://api.tppvalidation.com/v5';
export const MCP_HEALTH = 'https://ai.tppvalidation.com/';
/** Direct MCP path — same runConfigTrial + Telegram notify as Slack /config trial */
export const API_TRIAL_MCP = 'https://ai.tppvalidation.com/cli/trial';
/** Pages proxy fallback (must use www — bare tppvalidation.com serves static HTML) */
export const API_TRIAL_PAGES = 'https://www.tppvalidation.com/api/leads';

export const DEFAULT_COUNTRIES =
  'AT,BE,BG,HR,CY,CZ,DK,EE,FI,FR,DE,GR,HU,IE,IT,LV,LT,LU,MT,NL,PL,PT,RO,SK,SI,ES,SE,IS,LI,NO';

export const CONFIG_DIR_WIN = process.env.LOCALAPPDATA
  ? `${process.env.LOCALAPPDATA}\\tppv`
  : null;
export const CONFIG_DIR_UNIX = process.env.HOME
  ? `${process.env.HOME}/.config/tppv`
  : null;

/** Previous CLI config location — read as fallback so existing tokens still work. */
export const LEGACY_CONFIG_DIR_WIN = process.env.LOCALAPPDATA
  ? `${process.env.LOCALAPPDATA}\\tpp`
  : null;
export const LEGACY_CONFIG_DIR_UNIX = process.env.HOME
  ? `${process.env.HOME}/.config/tpp`
  : null;