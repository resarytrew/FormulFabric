import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(path) && !path.endsWith('.test.ts') ? [path] : [];
  });
}

test('runtime imports within src are acyclic', async () => {
  const files = sourceFiles(sourceRoot);
  const known = new Set(files);
  const edges = new Map<string, string[]>();
  for (const file of files) {
    const source = await transform(readFileSync(file, 'utf8'), { loader: extname(file) === '.tsx' ? 'tsx' : 'ts', format: 'esm' });
    const dependencies: string[] = [];
    for (const match of source.code.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.[^"']+)["']/g)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const base = resolve(dirname(file), specifier);
      const target = [base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')].find(path => known.has(path));
      if (target) dependencies.push(target);
    }
    edges.set(file, dependencies);
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  function visit(file: string, chain: string[]) {
    assert.ok(!active.has(file), `Import cycle: ${[...chain, file].join(' -> ')}`);
    if (visited.has(file)) return;
    active.add(file);
    for (const dependency of edges.get(file) ?? []) visit(dependency, [...chain, file]);
    active.delete(file);
    visited.add(file);
  }
  for (const file of files) visit(file, []);
});
