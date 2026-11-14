// 데이터 로더.
// public/data/ 의 layerset.json, *.bin, traverse.json, env.json을 읽어
//   - `layers:ready` 를 한 번 보내고
//   - `env:update` 를 config.envIntervalMs 마다 표본 하나씩 보낸다 (끝나면 처음부터).
// 형식은 INTERFACES 2장·3장. 목 모드(mock.data)에서는 파일 대신 mock/layers.js를 쓴다.
// It also adds one derived waypoint, `near`: a destination about 20 m from the base (?near=).

import { bus } from './bus.js';
import { config, mock, DATA_BASE } from './config.js';
import { nearbyWaypoint } from './waypoints.js';

const assetOverrides = new Map(); // 파일 이름 → blob 주소 (목 모드의 이미지)

/**
 * 레이어의 `file`을 불러올 주소로 바꾼다. 이미지 레이어를 읽을 때 쓴다.
 *   new THREE.TextureLoader().load(ctx.assetUrl(layer.file))
 * 목 모드에서는 가짜 이미지의 주소가 나온다.
 */
export function assetUrl(file) {
  return assetOverrides.get(file) ?? DATA_BASE + file;
}

// Vite 개발 서버는 없는 파일에도 index.html을 200으로 돌려주므로 content-type도 본다.
function isMissing(res) {
  return !res.ok || (res.headers.get('content-type') ?? '').includes('text/html');
}

async function fetchJson(file, { optional = false } = {}) {
  try {
    const res = await fetch(DATA_BASE + file);
    if (isMissing(res)) throw new Error(res.ok ? '파일 없음' : `HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (optional) {
      console.warn(`[loader] ${file} 없음 (${err.message}). 건너뜁니다.`);
      return null;
    }
    throw new Error(`${file} 을(를) 읽지 못했습니다: ${err.message}`);
  }
}

async function fetchGrid(layer, grid) {
  const res = await fetch(DATA_BASE + layer.file);
  if (isMissing(res)) throw new Error(`${layer.file}: ${res.ok ? '파일 없음' : `HTTP ${res.status}`}`);
  const buf = await res.arrayBuffer();
  const expected = grid.cols * grid.rows;
  if (buf.byteLength !== expected * 4) {
    throw new Error(`${layer.file}: 길이 ${buf.byteLength}바이트, 기대 ${expected * 4}바이트 (cols*rows*4)`);
  }
  // 리틀 엔디언 Float32 (INTERFACES 2.2). 현재 쓰는 기기는 모두 리틀 엔디언이다.
  return new Float32Array(buf);
}

async function loadReal() {
  const layerSet = await fetchJson('layerset.json');
  const grids = {};
  await Promise.all(
    layerSet.layers
      .filter((l) => l.format === 'float32')
      .map(async (l) => {
        try {
          grids[l.id] = await fetchGrid(l, layerSet.grid);
        } catch (err) {
          console.warn(`[loader] 숫자 격자 '${l.id}' 를 읽지 못했습니다:`, err.message);
        }
      }),
  );
  const traverse = (await fetchJson('traverse.json', { optional: true })) ?? { sourceUrl: '', points: [] };
  const env = await fetchJson('env.json', { optional: true });
  return { layerSet, grids, traverse, env };
}

function playEnv(env) {
  const samples = env?.samples ?? [];
  if (!samples.length) {
    console.warn('[loader] env.json에 표본이 없어 env:update를 보내지 않습니다.');
    return;
  }
  let i = 0;
  const next = () => {
    const s = samples[i % samples.length];
    i++;
    bus.emit('env:update', {
      sol: s.sol,
      localTime: s.localTime,
      radiationUGyPerDay: s.radiationUGyPerDay,
      radiationIsFixedValue: !!env.radiationIsFixedValue,
      pressurePa: s.pressurePa ?? null,
      airTempK: s.airTempK ?? null,
    });
  };
  next();
  setInterval(next, config.envIntervalMs / mock.speed);
}

/** 데이터를 읽고 이벤트를 보낸다. 모든 모듈의 init이 끝난 뒤에 부른다. */
export async function loadData() {
  let data;
  if (mock.data) {
    const { buildMockData } = await import('../mock/layers.js');
    data = await buildMockData();
    for (const [file, url] of Object.entries(data.assets)) assetOverrides.set(file, url);
  } else {
    data = await loadReal();
  }
  const { layerSet, grids, traverse, env } = data;
  // A destination close to the base, next to the two the data brings (core/waypoints.js).
  if (config.nearbyM > 0 && !layerSet.waypoints?.some((w) => w.id === 'near')) {
    const near = nearbyWaypoint(layerSet, config.nearbyM, grids.slope);
    if (near) layerSet.waypoints.push(near);
    else console.warn('[loader] no usable cell for the nearby destination at', config.nearbyM, 'm');
  }
  bus.emit('layers:ready', { layerSet, grids, traverse });
  playEnv(env);
  return data;
}
