export const TOOL_ID = 'browser-support-budget';
export const LIMITS = Object.freeze({ matrixBytes: 262144, inventoryBytes: 1048576, depth: 16, browsers: 20, features: 1000, usages: 5000, milliseconds: 5000 });
export const RULES = Object.freeze({
  'matrix-invalid': 'warning', 'inventory-invalid': 'warning', 'dataset-invalid': 'warning',
  'inventory-incomplete': 'warning', 'unsupported-feature': 'error',
  'compatibility-unknown': 'warning', 'polyfill-uncertain': 'warning',
  'dynamic-import-uncertain': 'warning', 'limit-exceeded': 'warning',
  'no-evidence': 'warning', 'input-unreadable': 'warning', 'duplicate-key': 'warning'
});
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const id = s => typeof s === 'string' && /^[a-z][a-z0-9.-]{0,79}$/.test(s);
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const safePath = s => typeof s === 'string' && s.length > 0 && s.length <= 240 && !s.startsWith('/') && !s.split('/').some(x => x === '..' || x === '.') && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\\]/u.test(s);
function depth(value) {
  const stack = [[value, 0, new Set()]];
  let maximum = 0;
  while (stack.length) {
    const [item, level, ancestors] = stack.pop();
    if (level > LIMITS.depth) return level;
    maximum = Math.max(maximum, level);
    if (item && typeof item === 'object') {
      if (ancestors.has(item)) return LIMITS.depth + 1;
      const branch = new Set(ancestors);
      branch.add(item);
      for (const child of Object.values(item)) stack.push([child, level + 1, branch]);
    }
  }
  return maximum;
}

export function evaluateBudget(matrix, inventory, dataset, { now = Date.now, deadline = now() + LIMITS.milliseconds } = {}) {
  const findings = [];
  const add = (ruleId, file, pointer, message) => {
    if (!Object.hasOwn(RULES, ruleId)) throw new Error('unknown rule');
    findings.push({ ruleId, severity: RULES[ruleId], message, location: { file, pointer } });
  };
  const finish = checked => {
    findings.sort((a, b) => cmp(a.location.file, b.location.file) || cmp(a.location.pointer, b.location.pointer) || cmp(a.ruleId, b.ruleId) || cmp(a.message, b.message));
    const incomplete = findings.some(f => f.severity === 'warning');
    return { schemaVersion: '1', tool: TOOL_ID, status: incomplete ? 'incomplete' : findings.length ? 'fail' : 'pass', summary: { checked, errors: findings.filter(f => f.severity === 'error').length, warnings: findings.filter(f => f.severity === 'warning').length }, findings };
  };
  if (depth(matrix) > LIMITS.depth || depth(inventory) > LIMITS.depth || depth(dataset) > LIMITS.depth) { add('limit-exceeded', '@input', '', 'JSON depth limit exceeded'); return finish(0); }
  if (!isObject(matrix) || matrix.schemaVersion !== '1' || !Array.isArray(matrix.browsers) || matrix.browsers.length > LIMITS.browsers || matrix.browsers.some(x => !isObject(x) || !id(x.browser) || !Number.isSafeInteger(x.version) || x.version < 1) || new Set(matrix.browsers.map(x => x.browser)).size !== matrix.browsers.length) { add('matrix-invalid', '@matrix', '', 'Browser matrix is invalid or exceeds browser limit'); return finish(0); }
  if (!isObject(inventory) || inventory.schemaVersion !== '1' || typeof inventory.complete !== 'boolean' || !Array.isArray(inventory.features) || inventory.features.length > LIMITS.features) { add('inventory-invalid', '@inventory', '', 'Feature inventory is invalid or exceeds feature limit'); return finish(0); }
  if (!isObject(dataset) || dataset.schemaVersion !== '1' || !id(dataset.datasetId) || !isObject(dataset.features)) { add('dataset-invalid', '@dataset', '', 'Pinned compatibility dataset is invalid'); return finish(0); }
  let uses = 0;
  for (let i = 0; i < inventory.features.length; i++) {
    const f = inventory.features[i];
    if (!isObject(f) || !id(f.feature) || !Array.isArray(f.usages) || f.usages.length === 0 || f.usages.some(u => !isObject(u) || !safePath(u.file) || (u.pointer !== undefined && (typeof u.pointer !== 'string' || u.pointer.length > 160))) || (f.polyfill !== undefined && f.polyfill !== 'declared') || (f.load !== undefined && !['static', 'dynamic'].includes(f.load))) { add('inventory-invalid', '@inventory', `/features/${i}`, 'Feature usage is invalid'); return finish(0); }
    uses += f.usages.length;
    if (uses > LIMITS.usages) { add('limit-exceeded', '@inventory', '', 'Usage record limit exceeded'); return finish(0); }
  }
  if (matrix.browsers.length === 0 || inventory.features.length === 0) { add('no-evidence', '@inventory', '', 'Browser targets and observed features are required'); return finish(0); }
  if (!inventory.complete) add('inventory-incomplete', '@inventory', '/complete', 'Inventory declares partial coverage');
  let checked = 0;
  for (let i = 0; i < inventory.features.length; i++) {
    const f = inventory.features[i];
    for (let j = 0; j < matrix.browsers.length; j++) {
      if (now() > deadline) { add('limit-exceeded', '@input', '', 'Evaluation time limit exceeded'); return finish(checked); }
      const b = matrix.browsers[j];
      const pointer = `/features/${i}/usages/0`;
      checked++;
      if (f.load === 'dynamic') { add('dynamic-import-uncertain', '@inventory', pointer, `Target ${j + 1}: dynamic load coverage is unproven`); continue; }
      if (f.polyfill === 'declared') { add('polyfill-uncertain', '@inventory', pointer, `Target ${j + 1}: declared polyfill coverage is unproven`); continue; }
      const row = Object.hasOwn(dataset.features, f.feature) ? dataset.features[f.feature] : undefined;
      const min = isObject(row) && Object.hasOwn(row, b.browser) ? row[b.browser] : undefined;
      if (min === undefined || min === null || (min !== false && (!Number.isSafeInteger(min) || min < 1))) { add('compatibility-unknown', '@inventory', pointer, `Target ${j + 1}: compatibility evidence is unknown`); continue; }
      if (min === false || b.version < min) add('unsupported-feature', '@inventory', pointer, `Target ${j + 1}: observed feature is unsupported`);
    }
  }
  return finish(checked);
}
