#!/usr/bin/env node
import http from 'node:http';
import https from 'node:https';
import process from 'node:process';
import { URL } from 'node:url';

function die(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

function usage() {
  return `
promptctl (client for promptd)

Flags:
  --url <http://127.0.0.1:9333>      (default: http://127.0.0.1:9333)
  --prompt <text>                    (required)
  --session-id <id>                  (optional)
  --auto-approve 0|1                 (optional)
  --dry-run 0|1                      (optional)
  --max-steps <n>                    (optional)

Examples:
  node scripts/promptctl.mjs --prompt "Show SC-Bridge info"
  node scripts/promptctl.mjs --auto-approve 1 --prompt "Join 0000intercomswapbtcusdt"
`.trim();
}

function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) flags.set(k, true);
    else {
      flags.set(k, next);
      i += 1;
    }
  }
  return flags;
}

function parseBoolFlag(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (value === true) return true;
  const s = String(value).trim().toLowerCase();
  if (!s) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(s);
}

function requestJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const data = JSON.stringify(body);
    const req = (isHttps ? https : http).request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(data),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve({ status: res.statusCode || 0, json: JSON.parse(text) });
          } catch (err) {
            reject(new Error(`Invalid JSON response: ${text.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.get('help') || flags.get('h') || process.argv.includes('--help')) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const base = String(flags.get('url') || 'http://127.0.0.1:9333').trim().replace(/\/+$/, '');
  const prompt = flags.get('prompt') ? String(flags.get('prompt')) : '';
  if (!prompt.trim()) die('Missing --prompt');

  const body = {
    prompt: String(prompt),
  };
  if (flags.get('session-id')) body.session_id = String(flags.get('session-id')).trim();
  if (flags.has('auto-approve')) body.auto_approve = parseBoolFlag(flags.get('auto-approve'), false);
  if (flags.has('dry-run')) body.dry_run = parseBoolFlag(flags.get('dry-run'), false);
  if (flags.get('max-steps')) body.max_steps = Number.parseInt(String(flags.get('max-steps')), 10);

  const { status, json } = await requestJson(`${base}/v1/run`, body);
  if (status >= 400) die(json?.error || `HTTP ${status}`);
  process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
}

main().catch((err) => die(err?.message ?? String(err)));

