import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

// The orchestrator modules must not import each other in a cycle (runtime imports; `import type` is erased).
// Shared helpers live in a module both sides import (op-validation.ts for the coordinator/sweep checks).
const src = fileURLToPath(new URL('../src/', import.meta.url));

function runtimeImports(file: string): string[] {
  const text = readFileSync(src + file, 'utf8');
  const found: string[] = [];
  for (const match of text.matchAll(/^(?:import|export)\s+(type\s+)?[^;]*?\s+from\s+'\.\/([^']+)';/gms)) {
    if (!match[1]) found.push(match[2]!);
  }
  return found;
}

it('has no import cycle between orchestrator modules', () => {
  const files = readdirSync(src).filter(f => f.endsWith('.ts'));
  const graph = new Map(files.map(f => [f, runtimeImports(f)]));
  const cycles: string[] = [];
  const visit = (file: string, path: string[]) => {
    for (const next of graph.get(file) ?? []) {
      const at = path.indexOf(next);
      if (at >= 0) cycles.push([...path.slice(at), next].join(' → '));
      else visit(next, [...path, next]);
    }
  };
  for (const file of files) visit(file, [file]);
  expect(cycles).toEqual([]);
});
