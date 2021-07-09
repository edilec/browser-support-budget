export function inspectJsonKeys(text, maxDepth) {
  let i = 0;
  const whitespace = () => { while (/[\u0020\t\r\n]/u.test(text[i] ?? '')) i++; };
  const string = () => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') return JSON.parse(text.slice(start, i));
    }
    return '';
  };
  const value = level => {
    if (level > maxDepth) return 'depth';
    whitespace();
    if (text[i] === '{') {
      i++; whitespace();
      const keys = new Set();
      if (text[i] === '}') { i++; return null; }
      while (i < text.length) {
        const key = string();
        if (keys.has(key)) return 'duplicate';
        keys.add(key); whitespace(); i++;
        const problem = value(level + 1);
        if (problem) return problem;
        whitespace();
        if (text[i++] === '}') return null;
        whitespace();
      }
    }
    if (text[i] === '[') {
      i++; whitespace();
      if (text[i] === ']') { i++; return null; }
      while (i < text.length) {
        const problem = value(level + 1);
        if (problem) return problem;
        whitespace();
        if (text[i++] === ']') return null;
      }
    }
    if (text[i] === '"') { string(); return null; }
    while (i < text.length && !/[\u0020\t\r\n,}\]]/u.test(text[i])) i++;
    return null;
  };
  return value(0);
}
