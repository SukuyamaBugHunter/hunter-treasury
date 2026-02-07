import fs from 'node:fs';
import path from 'node:path';

import { stableStringify } from '../util/stableStringify.js';
import { redactSensitive } from './redact.js';

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function nowMs() {
  return Date.now();
}

export class AuditLog {
  constructor({ dir, sessionId }) {
    if (!dir) throw new Error('AuditLog requires dir');
    if (!sessionId) throw new Error('AuditLog requires sessionId');
    this.dir = dir;
    this.sessionId = sessionId;
    mkdirp(dir);
    this.filePath = path.join(dir, `${sessionId}.jsonl`);
  }

  write(event, payload) {
    const entry = {
      ts: nowMs(),
      event,
      payload: redactSensitive(payload),
    };
    fs.appendFileSync(this.filePath, `${stableStringify(entry)}\n`);
  }
}

