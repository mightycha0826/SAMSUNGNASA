// 가짜 데이터 레이어 (?mock=1 또는 ?mock=data).
// C의 실제 파일(web/public/data/)과 형식이 같다 (INTERFACES 2장).
// 지형은 완만한 언덕이고, 화성 데이터가 아니다. 화면이나 발표에 실데이터처럼 쓰지 않는다.

const COLS = 512;
const ROWS = 512;
const CELL_M = 4.0;

function buildTopo() {
  const topo = new Float32Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = col / COLS;
      const y = row / ROWS;
      // 남서(0,0)에서 북동으로 서서히 오르는 비탈 + 언덕 몇 개 + 가운데를 지나는 얕은 골
      let h = -3760 + 90 * (0.6 * x + 0.4 * y);
      h += 18 * Math.sin(x * 6.3) * Math.cos(y * 4.9);
      h += 9 * Math.sin(x * 15.1 + 1.3) * Math.sin(y * 12.7);
      h += 35 * Math.exp(-((x - 0.7) ** 2 + (y - 0.3) ** 2) / 0.012); // 가파른 봉우리
      h -= 12 * Math.exp(-((x - y) ** 2) / 0.004); // 골
      topo[row * COLS + col] = h;
    }
  }
  return topo;
}

function buildSlope(topo) {
  const slope = new Float32Array(COLS * ROWS);
  const at = (c, r) => topo[Math.min(ROWS - 1, Math.max(0, r)) * COLS + Math.min(COLS - 1, Math.max(0, c))];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const dx = (at(col + 1, row) - at(col - 1, row)) / (2 * CELL_M);
      const dy = (at(col, row + 1) - at(col, row - 1)) / (2 * CELL_M);
      slope[row * COLS + col] = (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
    }
  }
  return slope;
}

function range(arr) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of arr) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return [Math.round(min * 100) / 100, Math.round(max * 100) / 100];
}

// 회색조 PNG를 만들어 blob 주소로 돌려준다. 위쪽이 북쪽(row가 큰 쪽)이다 (INTERFACES 2.3).
async function grayImage(size, valueAt) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const img = g.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const v = Math.max(0, Math.min(255, valueAt(px / size, 1 - py / size)));
      const i = (py * size + px) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  return URL.createObjectURL(blob);
}

export async function buildMockData() {
  const topo = buildTopo();
  const slope = buildSlope(topo);
  const [tMin, tMax] = range(topo);
  const [sMin, sMax] = range(slope);
  const sample = (arr, x, y) =>
    arr[Math.min(ROWS - 1, Math.floor(y * ROWS)) * COLS + Math.min(COLS - 1, Math.floor(x * COLS))];

  // 이미지 레이어의 file 이름 → blob 주소. main.js가 ctx.assetUrl()에 연결한다.
  const assets = {
    // 광학: 경사 음영 비슷한 회색조
    'optical.png': await grayImage(512, (x, y) => 150 - sample(slope, x, y) * 5 + 20 * Math.sin(x * 90) * Math.sin(y * 70)),
    // 열: 81m/픽셀을 흉내 낸 거친 덩어리 (25×25칸)
    'thermal.png': await grayImage(512, (x, y) => {
      const bx = Math.floor(x * 25) / 25;
      const by = Math.floor(y * 25) / 25;
      return 128 + 90 * Math.sin(bx * 5.1 + 0.4) * Math.cos(by * 4.2);
    }),
  };

  const MOCK_URL = 'mock://not-nasa-data';
  const layerSet = {
    mock: true,
    site: {
      name: 'MOCK — Gediz Vallis channel, Mount Sharp, Gale Crater',
      scienceGoal: '황이 든 돌 조사',
      lat: -4.78681191,
      lon: 137.4075342,
      bounds: { west: 137.39026, east: 137.42481, south: -4.80409, north: -4.76954 },
      geologicUnit: { code: 'Htu', name: 'Hesperian transition undivided unit', source: 'USGS SIM 3292' },
    },
    grid: { cols: COLS, rows: ROWS, cellSizeM: CELL_M },
    layers: [
      { id: 'topo', kind: 'topographic', mission: 'MOCK', instrument: 'MOCK', file: 'topo.bin', format: 'float32', unit: 'm', min: tMin, max: tMax, label: '지형 높이 (가짜)', sourceUrl: MOCK_URL },
      { id: 'slope', kind: 'derived', mission: 'MOCK', instrument: 'MOCK', file: 'slope.bin', format: 'float32', unit: 'deg', min: sMin, max: sMax, label: '경사도 (가짜)', sourceUrl: MOCK_URL },
      { id: 'optical', kind: 'optical', mission: 'MOCK', instrument: 'MOCK', file: 'optical.png', format: 'image', label: '광학 영상 (가짜)', sourceUrl: MOCK_URL },
      { id: 'thermal', kind: 'thermal', mission: 'MOCK', instrument: 'MOCK', file: 'thermal.png', format: 'image', label: '열 영상 (가짜)', sourceUrl: MOCK_URL },
    ],
    waypoints: [
      { id: 'base', label: '기지', cell: [0, 0] },
      { id: 'site1', label: '황 암석 지대', cell: [256, 256] },
    ],
    demo: { regionCells: [246, 246, 266, 266], roomSizeM: [4, 4] },
  };

  // 가짜 주행 경로: 남서쪽에서 기준점(256,256)까지 굽은 길
  const points = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const col = Math.round(150 + 106 * t + 18 * Math.sin(t * Math.PI * 2));
    const row = Math.round(170 + 86 * t - 14 * Math.sin(t * Math.PI * 1.5) * (1 - t));
    points.push({
      sol: 4098 + Math.round(214 * t),
      rmc: `mock_${i}`,
      lon: 137.39026 + ((col + 0.5) / COLS) * (137.42481 - 137.39026),
      lat: -4.80409 + ((row + 0.5) / ROWS) * (-4.76954 - -4.80409),
      elevM: Math.round(topo[row * COLS + col] * 100) / 100,
      tiltDeg: null,
      cell: [col, row],
    });
  }
  points[points.length - 1].cell = [256, 256];
  const traverse = { mock: true, sourceUrl: MOCK_URL, points };

  const env = {
    mock: true,
    sourceUrls: [MOCK_URL],
    radiationIsFixedValue: false,
    samples: [200, 205, 198, 212, 220, 208].map((r, i) => ({
      sol: 4312,
      localTime: `${String(12 + i).padStart(2, '0')}:00`,
      radiationUGyPerDay: r,
      pressurePa: null,
      airTempK: null,
    })),
  };

  return { layerSet, grids: { topo, slope }, traverse, env, assets };
}
