#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { PromptRouter } from '../src/prompt/router.js';
import { ToolExecutor } from '../src/prompt/executor.js';
import { loadLlmConfigFromEnv } from '../src/prompt/config.js';
import { INTERCOMSWAP_TOOLS } from '../src/prompt/tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function die(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

function usage() {
  return `
promptd (local prompting router + tool executor)

Starts a local HTTP server that:
- calls an OpenAI-compatible LLM API
- executes tool calls via deterministic tooling / SC-Bridge safe RPCs
- writes an audit trail (jsonl) under onchain/

Env (LLM):
  INTERCOMSWAP_LLM_BASE_URL
  INTERCOMSWAP_LLM_API_KEY
  INTERCOMSWAP_LLM_MODEL
  INTERCOMSWAP_LLM_MAX_TOKENS
  INTERCOMSWAP_LLM_TEMPERATURE
  INTERCOMSWAP_LLM_TOP_P
  INTERCOMSWAP_LLM_TOP_K
  INTERCOMSWAP_LLM_MIN_P
  INTERCOMSWAP_LLM_REPETITION_PENALTY
  INTERCOMSWAP_LLM_TOOL_FORMAT=tools|functions

Env (Prompt Router):
  INTERCOMSWAP_PROMPT_HOST=127.0.0.1
  INTERCOMSWAP_PROMPT_PORT=9333
  INTERCOMSWAP_PROMPT_AUDIT_DIR=onchain/prompt/audit
  INTERCOMSWAP_PROMPT_AUTO_APPROVE=0|1     (server default; request can override)

Env (SC-Bridge):
  INTERCOMSWAP_SC_BRIDGE_URL=ws://127.0.0.1:49222
  INTERCOMSWAP_SC_BRIDGE_TOKEN=<token>
  INTERCOMSWAP_SC_BRIDGE_TOKEN_FILE=onchain/sc-bridge/<store>.token

Env (Receipts):
  INTERCOMSWAP_RECEIPTS_DB=onchain/receipts/<store>.sqlite

Env (Lightning ops):
  INTERCOMSWAP_LN_IMPL=cln|lnd
  INTERCOMSWAP_LN_BACKEND=cli|docker
  INTERCOMSWAP_LN_NETWORK=regtest|signet|testnet|mainnet
  INTERCOMSWAP_LN_COMPOSE_FILE=dev/ln-regtest/docker-compose.yml
  INTERCOMSWAP_LN_SERVICE=<docker service name>
  INTERCOMSWAP_LN_CLI_BIN=<path>
  INTERCOMSWAP_LND_RPCSERVER=<host:port>
  INTERCOMSWAP_LND_TLSCERT=<path>
  INTERCOMSWAP_LND_MACAROON=<path>
  INTERCOMSWAP_LND_DIR=<path>

Env (Solana ops):
  INTERCOMSWAP_SOLANA_RPC_URL=http://127.0.0.1:8899[,url2,...]
  INTERCOMSWAP_SOLANA_COMMITMENT=processed|confirmed|finalized
  INTERCOMSWAP_SOLANA_PROGRAM_ID=<base58>  (optional; default is built-in)
  INTERCOMSWAP_SOLANA_KEYPAIR=<path>       (required for signing tools)
  INTERCOMSWAP_SOLANA_CU_LIMIT=<units>     (optional)
  INTERCOMSWAP_SOLANA_CU_PRICE=<microLamports> (optional)

HTTP API:
  GET  /healthz
  GET  /v1/tools
  POST /v1/run   { prompt, session_id?, auto_approve?, dry_run?, max_steps? }

`.trim();
}

function parseBoolEnv(value, fallback = false) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(s);
}

function readTokenFromFile(filePath) {
  if (!filePath) return '';
  try {
    return String(fs.readFileSync(filePath, 'utf8') || '').trim();
  } catch (_e) {
    return '';
  }
}

function json(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (_e) {
    throw new Error('Invalid JSON body');
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('help')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const llmConfig = loadLlmConfigFromEnv();
  if (!llmConfig.baseUrl) die('Missing INTERCOMSWAP_LLM_BASE_URL');
  if (!llmConfig.model) die('Missing INTERCOMSWAP_LLM_MODEL');

  const host = String(process.env.INTERCOMSWAP_PROMPT_HOST || '127.0.0.1').trim();
  const port = Number.parseInt(String(process.env.INTERCOMSWAP_PROMPT_PORT || '9333'), 10);
  if (!Number.isFinite(port) || port <= 0) die('Invalid INTERCOMSWAP_PROMPT_PORT');

  const auditDir = String(process.env.INTERCOMSWAP_PROMPT_AUDIT_DIR || 'onchain/prompt/audit').trim();
  const defaultAutoApprove = parseBoolEnv(process.env.INTERCOMSWAP_PROMPT_AUTO_APPROVE, false);

  const scUrl = String(process.env.INTERCOMSWAP_SC_BRIDGE_URL || 'ws://127.0.0.1:49222').trim();
  const scToken =
    String(process.env.INTERCOMSWAP_SC_BRIDGE_TOKEN || '').trim() ||
    readTokenFromFile(String(process.env.INTERCOMSWAP_SC_BRIDGE_TOKEN_FILE || '').trim());
  if (!scToken) die('Missing SC-Bridge token (set INTERCOMSWAP_SC_BRIDGE_TOKEN or INTERCOMSWAP_SC_BRIDGE_TOKEN_FILE)');

  const receiptsDb = String(process.env.INTERCOMSWAP_RECEIPTS_DB || '').trim();

  const ln = {
    impl: String(process.env.INTERCOMSWAP_LN_IMPL || 'cln').trim(),
    backend: String(process.env.INTERCOMSWAP_LN_BACKEND || 'cli').trim(),
    network: String(process.env.INTERCOMSWAP_LN_NETWORK || 'regtest').trim(),
    composeFile: String(process.env.INTERCOMSWAP_LN_COMPOSE_FILE || path.join(repoRoot, 'dev/ln-regtest/docker-compose.yml')).trim(),
    service: String(process.env.INTERCOMSWAP_LN_SERVICE || '').trim(),
    cliBin: String(process.env.INTERCOMSWAP_LN_CLI_BIN || '').trim(),
    cwd: repoRoot,
    lnd: {
      rpcserver: String(process.env.INTERCOMSWAP_LND_RPCSERVER || '').trim(),
      tlscertpath: String(process.env.INTERCOMSWAP_LND_TLSCERT || '').trim(),
      macaroonpath: String(process.env.INTERCOMSWAP_LND_MACAROON || '').trim(),
      lnddir: String(process.env.INTERCOMSWAP_LND_DIR || '').trim(),
    },
  };

  const solana = {
    rpcUrls: String(process.env.INTERCOMSWAP_SOLANA_RPC_URL || 'http://127.0.0.1:8899').trim(),
    commitment: String(process.env.INTERCOMSWAP_SOLANA_COMMITMENT || 'confirmed').trim(),
    programId: String(process.env.INTERCOMSWAP_SOLANA_PROGRAM_ID || '').trim(),
    keypairPath: String(process.env.INTERCOMSWAP_SOLANA_KEYPAIR || '').trim(),
    computeUnitLimit: process.env.INTERCOMSWAP_SOLANA_CU_LIMIT ? Number.parseInt(String(process.env.INTERCOMSWAP_SOLANA_CU_LIMIT), 10) : null,
    computeUnitPriceMicroLamports: process.env.INTERCOMSWAP_SOLANA_CU_PRICE ? Number.parseInt(String(process.env.INTERCOMSWAP_SOLANA_CU_PRICE), 10) : null,
  };

  const executor = new ToolExecutor({
    scBridge: { url: scUrl, token: scToken },
    ln,
    solana,
    receipts: { dbPath: receiptsDb },
  });

  const router = new PromptRouter({
    llmConfig,
    toolExecutor: executor,
    auditDir,
  });

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method || 'GET';
      const url = String(req.url || '/');

      if (method === 'GET' && url === '/healthz') {
        json(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && url === '/v1/tools') {
        json(res, 200, { tools: INTERCOMSWAP_TOOLS });
        return;
      }

      if (method === 'POST' && url === '/v1/run') {
        const body = await readJsonBody(req);
        const prompt = String(body.prompt ?? '').trim();
        const sessionId = body.session_id ? String(body.session_id).trim() : null;
        const autoApprove =
          body.auto_approve === undefined || body.auto_approve === null
            ? defaultAutoApprove
            : Boolean(body.auto_approve);
        const dryRun = Boolean(body.dry_run);
        const maxSteps = body.max_steps !== undefined && body.max_steps !== null ? Number(body.max_steps) : null;

        const out = await router.run({ prompt, sessionId, autoApprove, dryRun, maxSteps });
        json(res, 200, out);
        return;
      }

      json(res, 404, { error: 'not_found' });
    } catch (err) {
      json(res, 400, { error: err?.message ?? String(err) });
    }
  });

  server.listen(port, host, () => {
    process.stdout.write(
      JSON.stringify(
        {
          type: 'promptd_listening',
          host,
          port,
          audit_dir: auditDir,
          llm: { base_url: llmConfig.baseUrl, model: llmConfig.model, tool_format: llmConfig.toolFormat },
        },
        null,
        2
      ) + '\n'
    );
  });
}

main().catch((err) => die(err?.message ?? String(err)));

