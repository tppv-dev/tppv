# tppv

Open-source **CLI** and **MCP server** for [TPP Validation](https://tppv.dev). Source: [github.com/tppv-dev/tppv](https://github.com/tppv-dev/tppv).

They talk to the hosted API (`api.tppvalidation.com/v5`). The validation engine itself stays a service — these packages are how you call it from a terminal or an agent.

Apache-2.0.

## Install

```bash
npm install -g @tppv/cli @tppv/mcp
```

or without npm global:

```bash
# macOS / Linux
curl -fsSL https://tppv.dev/cli/install.sh | bash

# Windows (PowerShell)
irm https://tppv.dev/cli/install.ps1 | iex
```

From this repo:

```bash
npm install
npx tppv --help
```

## CLI

```bash
tppv                              # interactive
tppv path/to/qsealc.pem           # drop-validate
tppv validate -f ./qsealc.pem --cc SE,FI
tppv trial --email dev@bank.com
tppv config token <jwt>
tppv integration --gateway kong --out ./gateway
```

Token is stored in `~/.config/tppv/config.json` (Windows: `%LOCALAPPDATA%\tppv\config.json`). Existing `~/.config/tpp` files are still read.

## MCP (local stdio)

Same three tools as the hosted server: `validate_certificate`, `audit_chain`, `search_entity`.

Token from `TPPV_TOKEN` or the CLI config file.

### Cursor / Claude Desktop

```json
{
  "mcpServers": {
    "tppv": {
      "command": "npx",
      "args": ["-y", "@tppv/mcp"],
      "env": {
        "TPPV_TOKEN": "your-jwt"
      }
    }
  }
}
```

Hosted alternative (no local process): `https://ai.tppvalidation.com/mcp`.

## Packages

| Package | What |
| ------- | ---- |
| [`@tppv/cli`](packages/cli) | `tppv` command |
| [`@tppv/mcp`](packages/mcp) | stdio MCP server |

## Not in this repo

The Rust validator, Slack/Teams bots, marketplace, and hosted MCP worker are the product. This repo is the client surface.

## License

Apache-2.0. See [LICENSE](LICENSE).
