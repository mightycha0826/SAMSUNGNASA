// 진입점. 코어를 만들고, 모듈을 init한 뒤, 데이터와 젯슨 연결을 시작한다.
// 순서가 중요하다: 모든 모듈이 init에서 bus.on을 건 다음에 첫 이벤트가 나간다.

import { bus } from './core/bus.js';
import { config, mock } from './core/config.js';
import { createXR } from './core/xr.js';
import { loadData, assetUrl } from './core/loader.js';
import { initLink } from './core/link.js';
import { initDebug } from './core/debug.js';
import { initRadiation } from './core/radiation.js';
import { MOCK_KEYS_HELP } from './mock/jetson.js';

import * as scan from './scan/index.js';
import * as map from './map/index.js';
import * as nav from './nav/index.js';
import * as hud from './hud/index.js';

const MODULES = { scan, map, nav, hud };

async function main() {
  const debugEl = document.getElementById('debug');
  if (!config.debug) debugEl.remove();
  initDebug({ el: config.debug ? debugEl : null, mock, keys: mock.link ? MOCK_KEYS_HELP : '' });

  const core = createXR({
    container: document.getElementById('app'),
    button: document.getElementById('xr-button'),
  });

  const ctx = {
    bus,
    scene: core.scene,
    camera: core.camera,
    renderer: core.renderer,
    xr: core.xr,
    mock,
    config,
    assetUrl,
  };

  for (const [name, mod] of Object.entries(MODULES)) {
    try {
      await mod.init?.(ctx);
      core.addModule(name, mod);
    } catch (err) {
      // 한 모듈이 깨져도 나머지는 뜬다.
      console.error(`[main] ${name}.init 실패. 이 모듈 없이 계속합니다.`, err);
    }
  }

  initRadiation();
  core.run();
  await initLink();
  try {
    await loadData();
  } catch (err) {
    console.error('[main] 데이터 로드 실패:', err.message, '— 실데이터가 아직 없으면 주소에 ?mock=1 을 붙이세요.');
  }
}

main();
