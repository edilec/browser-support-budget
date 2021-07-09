import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateBudget, LIMITS, RULES, TOOL_ID } from './index.mjs';
import { inspectJsonKeys } from './json-keys.mjs';

const source = fileURLToPath(new URL('../data/compatibility.json', import.meta.url));
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const inside = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel); };
const errorReport = (role, message, ruleId = 'input-unreadable') => ({ schemaVersion: '1', tool: TOOL_ID, status: 'incomplete', summary: { checked: 0, errors: 0, warnings: 1 }, findings: [{ ruleId, severity: RULES[ruleId], message, location: { file: role, pointer: '' } }] });

export function runCli(args, { stdout = process.stdout, stderr = process.stderr, now = Date.now } = {}) {
  const invalid = message => { stderr.write(`${message}\n`); return 2; };
  if (args.length !== 6 || args.some((v, i) => i % 2 === 0 && !['--root', '--matrix', '--inventory'].includes(v))) return invalid('Usage: --root DIR --matrix FILE --inventory FILE');
  const flags = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (flags.has(args[i])) return invalid('Duplicate option');
    flags.set(args[i], args[i + 1]);
  }
  if (flags.size !== 3 || [...flags.values()].some(v => typeof v !== 'string' || v.length === 0)) return invalid('Missing option value');
  let root;
  try { root = realpathSync(flags.get('--root')); if (!statSync(root).isDirectory()) return invalid('Root must be a directory'); }
  catch { return invalid('Invalid root directory'); }
  const paths = [];
  for (const key of ['--matrix', '--inventory']) {
    const value = flags.get(key);
    if (isAbsolute(value) || value.split('/').some(x => x === '..' || x === '.') || /[\u0000-\u001f\u007f-\u009f\\]/u.test(value)) return invalid('Input path must be relative and confined');
    const lexical = resolve(root, value);
    if (!inside(root, lexical)) return invalid('Input path escapes root');
    try { const actual = realpathSync(lexical); if (!inside(root, actual)) return invalid('Input path escapes root'); paths.push(actual); }
    catch (error) { if (error.code === 'ENOENT') paths.push(lexical); else return invalid('Invalid input path'); }
  }
  const read = (path, max, role) => {
    try {
      const bytes = readFileSync(path);
      if (bytes.length > max) return { error: errorReport(role, 'Input byte limit exceeded', 'limit-exceeded') };
      const text = decode(bytes);
      const value = JSON.parse(text);
      const problem = inspectJsonKeys(text, LIMITS.depth);
      if (problem === 'duplicate' && role === '@matrix') return { invalid: true };
      if (problem) return { error: errorReport(role, problem === 'duplicate' ? 'Input contains duplicate JSON keys' : 'JSON depth limit exceeded', problem === 'duplicate' ? 'duplicate-key' : 'limit-exceeded') };
      return { value };
    } catch { return { error: errorReport(role, 'Input could not be read, decoded, or parsed') }; }
  };
  const m = read(paths[0], LIMITS.matrixBytes, '@matrix');
  if (m.invalid) return invalid('Matrix contains duplicate JSON keys');
  const i = read(paths[1], LIMITS.inventoryBytes, '@inventory');
  const c = read(source, 262144, '@dataset');
  const report = m.error || i.error || c.error || evaluateBudget(m.value, i.value, c.value, { now });
  stdout.write(`${JSON.stringify(report)}\n`);
  return report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 2;
}
