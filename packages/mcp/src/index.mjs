#!/usr/bin/env node
/**
 * Local stdio MCP server. Talks to the public TPP Validation API.
 * Token: TPPV_TOKEN, or the same config file as the tppv CLI.
 *
 * Do not write to stdout — MCP uses it for JSON-RPC.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadToken } from './config.mjs';
import { validateCertificate, auditChain, searchEntity } from './client.mjs';

function text(payload) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text: body }] };
}

function err(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

const server = new McpServer({
  name: 'tppv',
  version: '0.1.0',
});

server.tool(
  'validate_certificate',
  'Validate an eIDAS/PSD2 TPP certificate (QSealC/QWAC) against the TPP Validation API for requested jurisdictions.',
  {
    certificate_pem: z.string().describe('PEM-encoded certificate or chain'),
    countries: z
      .string()
      .describe("Comma-separated ISO country codes, e.g. 'SE,FI,DK'"),
  },
  async ({ certificate_pem, countries }) => {
    const token = loadToken();
    if (!token) {
      return err(
        'No API token. Set TPPV_TOKEN or run: tppv config token <jwt>',
      );
    }
    try {
      const result = await validateCertificate(token, countries, certificate_pem);
      return text(result);
    } catch (e) {
      return err(`Validation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

server.tool(
  'audit_chain',
  'Verify that a previous TPP validation response is authentic using its timestamp and x-tpp-identifier.',
  {
    timestamp: z.string().describe('Unix timestamp in milliseconds from the validation response'),
    identifier: z
      .string()
      .describe('x-tpp-identifier: 64-char hash or 20-char LEI'),
  },
  async ({ timestamp, identifier }) => {
    const token = loadToken();
    if (!token) {
      return err(
        'No API token. Set TPPV_TOKEN or run: tppv config token <jwt>',
      );
    }
    try {
      const result = await auditChain(token, identifier, timestamp);
      if (!result.ok && result.status === 404) {
        return err(
          `Audit endpoint not found (${result.url}). Set TPPV_AUDIT_BASE if your tenant uses a dedicated audit host.`,
        );
      }
      return text(result);
    } catch (e) {
      return err(`Audit failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

server.tool(
  'search_entity',
  'Search the EBA registers: CIR (credit institutions) or PIR (PSD2 payment institutions) by name, country, or LEI.',
  {
    register: z.enum(['CIR', 'PIR']).describe('CIR = banks, PIR = payment institutions'),
    name: z.string().optional().describe('Entity name (partial match)'),
    country: z.string().optional().describe("Two-letter country code, e.g. 'SE'"),
    lei: z.string().optional().describe('20-character LEI for exact lookup'),
  },
  async ({ register, name, country, lei }) => {
    try {
      const result = await searchEntity(register, { name, country, lei });
      if (!result.ok) return err(result.error || 'Search failed');
      return text(result);
    } catch (e) {
      return err(`Search failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
