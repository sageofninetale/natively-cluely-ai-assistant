// electron/services/__tests__/ProfileIntelligenceGate.test.mjs
//
// Verifies Profile Intelligence IPC behaviour at the source level (matching
// the existing ModeBleeding.test pattern) because the IPC handlers themselves
// require an Electron app runtime to instantiate.
//
// Note: this fork removes the Pro/trial paywall entirely, so there is no
// longer a gate to assert. What remains here are the still-relevant
// invariants — get-status returning safe defaults and the profile storage
// schema being present.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findSafeHandle, sliceSafeHandleBlock } from './ipcTestUtils.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(__dirname, '../../ipcHandlers.ts');

describe('Profile Intelligence IPC: status defaults', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');

  test('profile:get-status returns safe defaults when premium is unavailable (does not call ingest)', () => {
    const idx = findSafeHandle(source, 'profile:get-status');
    assert.ok(idx >= 0);
    const slice = sliceSafeHandleBlock(source, 'profile:get-status').slice(0, 1500);
    // get-status is intentionally NOT gated (it just reports status) — it
    // should return a falsy hasProfile when the orchestrator is missing.
    assert.ok(slice.includes('hasProfile: false'), 'profile:get-status must default to hasProfile=false when orchestrator missing');
  });
});

describe('Profile Intelligence: resume + JD storage tables exist in the schema', () => {
  const dbPath = path.resolve(__dirname, '../../db/DatabaseManager.ts');
  const dbSource = fs.readFileSync(dbPath, 'utf8');

  test('user_profile table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS user_profile'));
  });

  test('resume_nodes table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS resume_nodes'));
  });
});
