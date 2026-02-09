import test from 'node:test';
import assert from 'node:assert/strict';

import { ToolExecutor } from '../src/prompt/executor.js';

test('env_get: reports config and classifies test env (regtest + local validator)', async () => {
  const ex = new ToolExecutor({
    scBridge: { url: 'ws://127.0.0.1:1', token: 'x' },
    peer: { keypairPath: '' },
    ln: { impl: 'cln', backend: 'cli', network: 'regtest' },
    solana: { rpcUrls: 'http://127.0.0.1:8899', commitment: 'confirmed', programId: '' },
    receipts: { dbPath: 'onchain/receipts/test/swap-maker.sqlite' },
  });

  const out = await ex.execute('intercomswap_env_get', {}, { autoApprove: false, dryRun: false });
  assert.equal(out.type, 'env');
  assert.equal(out.env_kind, 'test');
  assert.equal(out.ln.network, 'regtest');
  assert.equal(out.solana.classify.kind, 'local');
  assert.equal(out.receipts.db, 'onchain/receipts/test/swap-maker.sqlite');
  assert.equal(typeof out.app.app_hash, 'string');
  assert.ok(out.app.app_hash.length > 0);
});

test('env_get: classifies mixed env (LN mainnet + Solana devnet)', async () => {
  const ex = new ToolExecutor({
    scBridge: { url: 'ws://127.0.0.1:1', token: 'x' },
    peer: { keypairPath: '' },
    ln: { impl: 'cln', backend: 'cli', network: 'bitcoin' },
    solana: { rpcUrls: 'https://api.devnet.solana.com', commitment: 'confirmed', programId: '' },
    receipts: { dbPath: 'onchain/receipts/mixed.sqlite' },
  });

  const out = await ex.execute('intercomswap_env_get', {}, { autoApprove: false, dryRun: false });
  assert.equal(out.type, 'env');
  assert.equal(out.env_kind, 'mixed');
  assert.equal(out.ln.classify.kind, 'mainnet');
  assert.equal(out.solana.classify.kind, 'devnet');
});

