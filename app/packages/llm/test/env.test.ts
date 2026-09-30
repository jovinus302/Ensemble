import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnv } from '../src/env.ts';

it('loads the explicit worktree env file and preserves existing process values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ensemble-env-'));
  const original = process.env.ENSEMBLE_ENV_FILE;
  const file = join(dir, 'test.env');
  writeFileSync(file, 'ENSEMBLE_TEST_KEEP=file\nENSEMBLE_TEST_NEW=loaded\n');
  process.env.ENSEMBLE_ENV_FILE = file;
  process.env.ENSEMBLE_TEST_KEEP = 'existing';
  try {
    expect(loadEnv(dir)).toBe(file);
    expect(process.env.ENSEMBLE_TEST_KEEP).toBe('existing');
    expect(process.env.ENSEMBLE_TEST_NEW).toBe('loaded');
  } finally {
    if (original === undefined) delete process.env.ENSEMBLE_ENV_FILE; else process.env.ENSEMBLE_ENV_FILE = original;
    delete process.env.ENSEMBLE_TEST_KEEP; delete process.env.ENSEMBLE_TEST_NEW;
    rmSync(dir, { recursive: true });
  }
});
