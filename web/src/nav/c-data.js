// Node-only fixture loader for reproducible checks against C's committed assets.
import { readFileSync } from 'node:fs';
export function loadCData() {
  const root = new URL('../../public/data/', import.meta.url);
  const json = name => JSON.parse(readFileSync(new URL(name, root), 'utf8'));
  const grids = Object.fromEntries(['topo', 'slope'].map(id => {
    const b = readFileSync(new URL(`${id}.bin`, root));
    return [id, new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))];
  }));
  return { layerSet: json('layerset.json'), grids, traverse: json('traverse.json'), env: json('env.json') };
}
