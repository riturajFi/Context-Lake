import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import pino from 'pino';

import { createLogger } from '../src/index.ts';

test('redacts sensitive fields in structured logs', async () => {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'context-lake-logs-'));
  const destinationPath = path.join(tempDirectory, 'redaction.log');
  const destination = pino.destination({
    dest: destinationPath,
    sync: true,
  });
  const logger = createLogger('ingest-api', {
    level: 'info',
    destination,
  });

  logger.info({
    authorization: 'Bearer top-secret-token',
    payload: {
      email: 'user@example.com',
      full_name: 'Ada Lovelace',
    },
  });
  destination.flushSync();

  const logLine = await readFile(destinationPath, 'utf8');
  assert.doesNotMatch(logLine, /top-secret-token/);
  assert.doesNotMatch(logLine, /user@example.com/);
  assert.doesNotMatch(logLine, /Ada Lovelace/);
  assert.match(logLine, /\[REDACTED\]/);
});
