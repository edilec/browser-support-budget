import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBudget, TOOL_ID } from '../src/index.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataset = { schemaVersion: '1', datasetId: 'compat-2026-09-26', features: { 'fetch': { chrome: 42, firefox: 39 }, 'css.grid': { chrome: 57, firefox: 52 } } };
const matrix = { schemaVersion: '1', browsers: [{ browser: 'chrome', version: 120 }, { browser: 'firefox', version: 120 }] };
const inventory = { schemaVersion: '1', complete: true, features: [{ feature: 'fetch', usages: [{ file: 'src/app.js', pointer: '/calls/0' }] }] };

test('supported observed feature passes with pinned compatibility evidence', () => {
  assert.equal(TOOL_ID, 'browser-support-budget');
  const report = evaluateBudget(matrix, inventory, dataset);
  assert.equal(report.status, 'pass');
  assert.equal(report.summary.checked, 2);
});

test('unsupported feature is traced to source usage', () => {
  const report = evaluateBudget({ ...matrix, browsers: [{ browser: 'chrome', version: 40 }] }, inventory, dataset);
  assert.equal(report.status, 'fail');
  assert.equal(report.findings[0].ruleId, 'unsupported-feature');
  assert.equal(report.findings[0].location.pointer, '/features/0/usages/0');
});

test('polyfills and dynamic imports retain uncertainty', () => {
  for (const feature of [{ ...inventory.features[0], polyfill: 'declared' }, { ...inventory.features[0], load: 'dynamic' }]) {
    const report = evaluateBudget(matrix, { ...inventory, features: [feature] }, dataset);
    assert.equal(report.status, 'incomplete');
  }
});

test('unknown feature and incomplete inventory cannot pass', () => {
  assert.equal(evaluateBudget(matrix, { ...inventory, features: [{ feature: 'unknown', usages: inventory.features[0].usages }] }, dataset).status, 'incomplete');
  assert.equal(evaluateBudget(matrix, { ...inventory, complete: false }, dataset).status, 'incomplete');
});

test('record N and N+1 plus depth N and N+1', () => {
  const many = n => ({ ...inventory, features: Array.from({ length: n }, () => inventory.features[0]) });
  assert.equal(evaluateBudget(matrix, many(1000), dataset).status, 'pass');
  assert.equal(evaluateBudget(matrix, many(1001), dataset).status, 'incomplete');
  const nested = n => { const d = structuredClone(dataset); let p = d; for (let i = 0; i < n; i++) { p.extra = {}; p = p.extra; } return d; };
  assert.equal(evaluateBudget(matrix, inventory, nested(16)).status, 'pass');
  assert.equal(evaluateBudget(matrix, inventory, nested(17)).status, 'incomplete');
});

test('injected deadline N and N+1', () => {
  assert.equal(evaluateBudget(matrix, inventory, dataset, { now: () => 5000, deadline: 5000 }).status, 'pass');
  assert.equal(evaluateBudget(matrix, inventory, dataset, { now: () => 5001, deadline: 5000 }).status, 'incomplete');
});

test('CLI has report for unreadable subject but not invalid configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-test-'));
  writeFileSync(join(root, 'matrix.json'), JSON.stringify(matrix));
  const run = (...args) => spawnSync(process.execPath, ['bin/browser-support-budget.mjs', '--root', root, ...args], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  const usage = run('--unknown');
  assert.equal(usage.status, 2);
  assert.equal(usage.stdout, '');
  const unreadable = run('--matrix', 'matrix.json', '--inventory', 'missing.json');
  assert.equal(unreadable.status, 2);
  assert.equal(JSON.parse(unreadable.stdout).status, 'incomplete');
  const outside = mkdtempSync(join(tmpdir(), 'budget-out-'));
  writeFileSync(join(outside, 'inventory.json'), JSON.stringify(inventory));
  symlinkSync(join(outside, 'inventory.json'), join(root, 'link.json'));
  const escape = run('--matrix', 'matrix.json', '--inventory', 'link.json');
  assert.equal(escape.status, 2);
  assert.equal(escape.stdout, '');
});

test('target and usage N/N+1 limits reject excess evidence', () => {
  const targets = n => ({ ...matrix, browsers: Array.from({ length: n }, (_, i) => ({ browser: `b${i}`, version: 1 })) });
  assert.equal(evaluateBudget(targets(20), inventory, dataset).status, 'incomplete');
  assert.equal(evaluateBudget(targets(21), inventory, dataset).findings[0].ruleId, 'matrix-invalid');
  const usages = n => ({ ...inventory, features: [{ feature: 'fetch', usages: Array.from({ length: n }, () => ({ file: 'src/app.js' })) }] });
  assert.equal(evaluateBudget(matrix, usages(5000), dataset).status, 'pass');
  assert.equal(evaluateBudget(matrix, usages(5001), dataset).status, 'incomplete');
});

test('invalid evidence cannot leak source text or pass', () => {
  const secret = 'canary-PRIVATE-12345';
  const report = evaluateBudget(matrix, { ...inventory, features: [{ feature: secret, usages: [{ file: secret }] }] }, dataset);
  assert.equal(report.status, 'incomplete');
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test('cyclic or deeply nested input is incomplete, not a crash', () => {
  const bad = structuredClone(inventory);
  bad.extra = bad;
  assert.equal(evaluateBudget(matrix, bad, dataset).status, 'incomplete');
});

test('CLI enforces matrix byte N and N+1 without truncation', () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-bytes-'));
  const plain = JSON.stringify(matrix);
  writeFileSync(join(root, 'inventory.json'), JSON.stringify(inventory));
  const run = () => spawnSync(process.execPath, ['bin/browser-support-budget.mjs', '--root', root, '--matrix', 'matrix.json', '--inventory', 'inventory.json'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  writeFileSync(join(root, 'matrix.json'), plain + ' '.repeat(262144 - Buffer.byteLength(plain)));
  assert.equal(run().status, 0);
  writeFileSync(join(root, 'matrix.json'), plain + ' '.repeat(262145 - Buffer.byteLength(plain)));
  const over = run();
  assert.equal(over.status, 2);
  assert.equal(JSON.parse(over.stdout).findings[0].ruleId, 'limit-exceeded');
});

test('duplicate inventory completeness keys, including escaped spelling, never pass', () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-duplicate-'));
  writeFileSync(join(root, 'matrix.json'), JSON.stringify(matrix));
  const clean = JSON.stringify(inventory);
  const run = () => spawnSync(process.execPath, ['bin/browser-support-budget.mjs', '--root', root, '--matrix', 'matrix.json', '--inventory', 'inventory.json'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  for (const raw of [clean.replace('"complete":true', '"complete":false,"complete":true'), clean.replace('"complete":true', '"com\\u0070lete":false,"complete":true')]) {
    writeFileSync(join(root, 'inventory.json'), raw);
    const result = run();
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).findings[0].ruleId, 'duplicate-key');
  }
});

test('duplicate matrix configuration keys are invalid usage with empty stdout', () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-matrix-duplicate-'));
  writeFileSync(join(root, 'matrix.json'), '{"schemaVersion":"0","schemaVersion":"1","browsers":[{"browser":"chrome","version":120}]}');
  writeFileSync(join(root, 'inventory.json'), JSON.stringify(inventory));
  const result = spawnSync(process.execPath, ['bin/browser-support-budget.mjs', '--root', root, '--matrix', 'matrix.json', '--inventory', 'inventory.json'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
});
