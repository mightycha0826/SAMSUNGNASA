// node --test src/scan/grid.test.js
// The depth -> grid arithmetic, checked against three.js's own camera and ray maths (a separate
// implementation of the same projection), with the numbers the app really uses (SCAN).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SCAN } from './index.js';
import { createGrid, viewOf, addDepthView, depthBufferToMeters, mergeLayers, PASSABLE, OBSTACLE, UNKNOWN } from './grid.js';
import { TILES, moveWindow } from './tiles.js';

// A 16 m grid around the origin: the arithmetic is the same on the scan's larger window.
const SIZE_M = 16;
const COLS = Math.round(SIZE_M / SCAN.cellM);
const ORIGIN = [-SIZE_M / 2, -SIZE_M / 2];
const newGrid = () => createGrid(COLS, COLS, SCAN.cellM, ORIGIN, SCAN);
const cellOf = (x, z) => Math.floor((z - ORIGIN[1]) / SCAN.cellM) * COLS + Math.floor((x - ORIGIN[0]) / SCAN.cellM);

// A chair-sized box, where the mock obstacle stands (mock/hazard.js).
const CHAIR = new THREE.Box3(new THREE.Vector3(0.25, 0, -0.85), new THREE.Vector3(0.75, 0.5, -0.35));
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// A camera with an off-centre frustum, like one eye of a headset.
function eye() {
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 100);
  camera.setViewOffset(1000, 1000, 120, 60, 800, 900);
  camera.position.set(-0.3, 1.6, 1.4);
  camera.lookAt(0.3, 0.2, -0.6);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

// Stands in for the depth sensor: cast a ray through (u, v) and return the distance from the camera plane.
function depthSensor(camera, thing) {
  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();
  return (u, v) => {
    ray.origin.setFromMatrixPosition(camera.matrixWorld);
    ray.direction.set(2 * u - 1, 2 * v - 1, 0.5).unproject(camera).sub(ray.origin).normalize();
    const found = (thing && ray.intersectBox(thing, hit)) || ray.intersectPlane(FLOOR, hit);
    return found ? -hit.applyMatrix4(camera.matrixWorldInverse).z : 0;
  };
}

// One read of the floor with `thing` (a Box3) standing on it, or of the bare floor (null).
function read(grid, camera, thing) {
  addDepthView(grid, depthSensor(camera, thing), camera.projectionMatrix.elements, camera.matrixWorld.elements, SCAN);
  return grid.commit();
}

// The depth image of a Quest 3 eye (tangents left 1.376, right 0.839, up 0.966, down 1.428), at
// standing height, looking at the floor `ahead` metres in front.
function questEye(ahead) {
  const camera = new THREE.PerspectiveCamera();
  camera.projectionMatrix.makePerspective(-0.1376, 0.0839, 0.0966, -0.1428, 0.1, 100);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 0.3, -ahead);
  camera.updateMatrixWorld();
  return camera;
}

// One read of a single cell with the given numbers of obstacle-height and floor-height points.
function readCell(grid, obstaclePoints, floorPoints) {
  for (let k = 0; k < obstaclePoints; k++) grid.add(0.05, 0.5, 0.05);
  for (let k = 0; k < floorPoints; k++) grid.add(0.05, 0, 0.05);
  grid.commit();
  return grid.cells[cellOf(0.05, 0.05)];
}

test('a chair becomes obstacle cells once it has been seen setScans times; the floor around it is passable', () => {
  const grid = newGrid();
  const camera = eye();
  for (let i = 1; i < SCAN.setScans; i++) {
    assert.equal(read(grid, camera, CHAIR), true); // the floor is already known
    assert.ok(!grid.cells.includes(OBSTACLE), `no obstacle yet after ${i} read(s)`);
  }
  assert.equal(read(grid, camera, CHAIR), true);
  assert.equal(grid.cells[cellOf(0.5, -0.6)], OBSTACLE); // middle of the chair
  assert.equal(grid.cells[cellOf(0.3, -0.4)], OBSTACLE); // just inside its corner
  assert.equal(grid.cells[cellOf(-0.4, -0.6)], PASSABLE); // floor beside it
  assert.equal(grid.cells[cellOf(0.5, 0.1)], PASSABLE); // floor in front of it
  assert.equal(grid.cells[cellOf(-1.9, 1.9)], UNKNOWN); // out of view
  // Obstacle cells do not spill beyond the chair (one cell of margin).
  for (let row = 0; row < COLS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (grid.cells[row * COLS + col] !== OBSTACLE) continue;
      const x = ORIGIN[0] + (col + 0.5) * SCAN.cellM;
      const z = ORIGIN[1] + (row + 0.5) * SCAN.cellM;
      assert.ok(x > 0.15 && x < 0.85 && z > -0.95 && z < -0.25, `obstacle outside the chair at ${x}, ${z}`);
    }
  }
});

test('taking the chair away clears it after clearScans floor-only reads, not before', () => {
  const grid = newGrid();
  const camera = eye();
  for (let i = 0; i < SCAN.setScans; i++) read(grid, camera, CHAIR);
  for (let i = 1; i < SCAN.clearScans; i++) {
    read(grid, camera, null);
    assert.equal(grid.cells[cellOf(0.5, -0.6)], OBSTACLE, `still held after ${i} clear read(s)`);
  }
  assert.equal(read(grid, camera, null), true);
  assert.ok(!grid.cells.includes(OBSTACLE));
  assert.equal(grid.cells[cellOf(0.5, -0.6)], PASSABLE);
  assert.equal(read(grid, camera, null), false); // nothing changed: no new hazard:update
});

test('a cell that is not seen keeps its state', () => {
  const grid = newGrid();
  for (let i = 0; i < SCAN.setScans; i++) read(grid, eye(), CHAIR);
  const away = eye();
  away.lookAt(-3, 0.2, 3); // turn the back on the chair
  away.updateMatrixWorld();
  for (let i = 0; i < SCAN.clearScans + 2; i++) read(grid, away, null);
  assert.equal(grid.cells[cellOf(0.5, -0.6)], OBSTACLE);
});

test('with a headset eye: a chair near the end of the range is marked and cleared, one beyond it is left alone', () => {
  const chairAt = (z) => new THREE.Box3(new THREE.Vector3(-0.25, 0, -z - 0.25), new THREE.Vector3(0.25, 0.9, -z + 0.25));
  const grid = newGrid();
  const camera = questEye(2.2);
  const within = SCAN.depthRangeM - 0.4;
  for (let i = 0; i < SCAN.setScans; i++) read(grid, camera, chairAt(within));
  assert.equal(grid.cells[cellOf(0.05, -within)], OBSTACLE);
  for (let i = 0; i < SCAN.clearScans; i++) read(grid, camera, null);
  assert.ok(!grid.cells.includes(OBSTACLE), 'cleared by the floor under it');
  // A chair the far limit cuts through is marked only where the floor under it can clear it again.
  for (let i = 0; i < SCAN.setScans; i++) read(grid, camera, chairAt(SCAN.depthRangeM - 0.2));
  const marked = [...grid.cells.keys()].filter((i) => grid.cells[i] === OBSTACLE);
  assert.ok(marked.length > 0);
  for (const i of marked) {
    const x = ORIGIN[0] + ((i % COLS) + 0.5) * SCAN.cellM;
    const z = ORIGIN[1] + (Math.floor(i / COLS) + 0.5) * SCAN.cellM;
    assert.ok(Math.hypot(x, z) <= SCAN.depthRangeM - SCAN.cellM, `marked on the limit at ${x}, ${z}`);
  }
  for (let i = 0; i < SCAN.clearScans; i++) read(grid, camera, null);
  assert.ok(!grid.cells.includes(OBSTACLE), 'and cleared like the rest');
  // Its top is nearer to the eye than the floor under it: marking it there could never be undone.
  for (let i = 0; i <= SCAN.setScans; i++) read(grid, camera, chairAt(SCAN.depthRangeM + 0.5));
  assert.ok(!grid.cells.includes(OBSTACLE), 'out of range for marking, as it is for clearing');
});

test('something seen once and then gone (a passer-by, stray depth) never becomes an obstacle', () => {
  const grid = newGrid();
  const many = SCAN.minPoints * 3;
  for (let round = 0; round < 5; round++) {
    for (let i = 1; i < SCAN.setScans; i++) assert.notEqual(readCell(grid, many, 0), OBSTACLE);
    assert.equal(readCell(grid, 0, many), PASSABLE);
  }
});

test('sightings have to come in a row: two that are a read apart do not add up', () => {
  const grid = newGrid();
  const many = SCAN.minPoints * 3;
  for (let round = 0; round < 5; round++) {
    for (let i = 1; i < SCAN.setScans; i++) assert.notEqual(readCell(grid, many, 0), OBSTACLE);
    assert.notEqual(readCell(grid, 0, 0), OBSTACLE); // a read that does not see it: out of view, or nothing there
  }
  for (let i = 1; i < SCAN.setScans; i++) assert.notEqual(readCell(grid, many, 0), OBSTACLE);
  assert.equal(readCell(grid, many, 0), OBSTACLE);
});

test('a floor point lifted by depth error is not a thing: only points above thingMinM are', () => {
  const grid = newGrid();
  const many = SCAN.minPoints * 3;
  const cell = () => grid.cells[cellOf(0.05, 0.05)];
  const readAt = (y) => {
    for (let k = 0; k < many; k++) grid.add(0.05, y, 0.05);
    grid.commit();
  };
  // 4 % depth error at a 1.7 m eye lifts a floor point by 7 cm; with the floor 5 cm high that is 12 cm.
  for (let i = 0; i < SCAN.setScans + 2; i++) readAt(0.12);
  assert.equal(cell(), PASSABLE);
  for (let i = 0; i < SCAN.setScans + 2; i++) readAt(SCAN.thingMinM - 0.03); // neither floor nor thing
  assert.equal(cell(), PASSABLE);
  for (let i = 0; i < SCAN.setScans; i++) readAt(SCAN.thingMinM + 0.05);
  assert.equal(cell(), OBSTACLE);
});

test('an unclear read changes nothing: too few points, or floor with a little of something else', () => {
  const grid = newGrid();
  const many = SCAN.minPoints * 3;
  for (let i = 0; i < SCAN.setScans; i++) readCell(grid, many, 0);
  // The edge of a chair or a thin leg: mostly floor, a point or two of obstacle. Not cleared.
  for (let i = 0; i < SCAN.clearScans + 2; i++) assert.equal(readCell(grid, 1, many), OBSTACLE);
  for (let i = 0; i < SCAN.clearScans + 2; i++) assert.equal(readCell(grid, 0, SCAN.minPoints - 1), OBSTACLE);
  // And it does not count against the clearing either: clearScans clean reads still clear it.
  for (let i = 1; i < SCAN.clearScans; i++) assert.equal(readCell(grid, 0, many), OBSTACLE);
  assert.equal(readCell(grid, 0, many), PASSABLE);
});

test('an obstacle out of sight stays on the map, until clear floor is seen where it stood', () => {
  assert.equal(SCAN.forgetScans, 0); // the default: nothing is forgotten
  const grid = newGrid();
  const many = SCAN.minPoints * 3;
  for (let i = 0; i < SCAN.setScans; i++) readCell(grid, many, 0);
  for (let i = 0; i < 600; i++) assert.equal(readCell(grid, 0, 0), OBSTACLE, `still there after ${i} reads out of sight`); // 5 minutes
  for (let i = 1; i < SCAN.clearScans; i++) assert.equal(readCell(grid, 0, many), OBSTACLE);
  assert.equal(readCell(grid, 0, many), PASSABLE);
});

test('with forgetScans set, an obstacle that stays out of sight that long is forgotten; one in sight is kept', () => {
  const cfg = { ...SCAN, forgetScans: 40 };
  const grid = createGrid(COLS, COLS, SCAN.cellM, ORIGIN, cfg);
  const many = SCAN.minPoints * 3;
  for (let i = 0; i < SCAN.setScans; i++) readCell(grid, many, 0);
  for (let i = 1; i < cfg.forgetScans; i++) assert.equal(readCell(grid, 0, 0), OBSTACLE, `still there after ${i} reads out of sight`);
  assert.equal(readCell(grid, 0, 0), UNKNOWN); // whoever stood there may have walked away
  // It has to be seen setScans times again before it counts.
  for (let i = 1; i < SCAN.setScans; i++) assert.equal(readCell(grid, many, 0), UNKNOWN);
  assert.equal(readCell(grid, many, 0), OBSTACLE);
  for (let i = 0; i < cfg.forgetScans * 2; i++) assert.equal(readCell(grid, many, 0), OBSTACLE); // in sight: kept
});

test('live depth adds to the room scan and never removes structure from it', () => {
  const [O, P, U] = [OBSTACLE, PASSABLE, UNKNOWN];
  // every pairing of what the room scan says with what live depth says
  const room = Uint8Array.from([O, O, O, P, P, P, U, U, U]);
  const live = Uint8Array.from([O, P, U, O, P, U, O, P, U]);
  const merged = mergeLayers(room, live);
  assert.deepEqual([...merged.cells], [O, O, O, O, P, P, O, P, U]);
  assert.deepEqual([merged.obstacles, merged.floor, merged.depth], [5, 3, 3]);
  assert.deepEqual([...room], [O, O, O, P, P, P, U, U, U]); // the room scan itself is left as it was
});

test("the wearer's own hands and invalid depth are ignored", () => {
  const grid = newGrid();
  const camera = eye();
  // 0.3 m: a hand held up in front of the face
  for (const d of [0.3, 0, -1, NaN, Infinity]) {
    for (let i = 0; i < SCAN.setScans; i++) {
      addDepthView(grid, () => d, camera.projectionMatrix.elements, camera.matrixWorld.elements, SCAN);
      assert.equal(grid.commit(), false, `depth ${d}`);
    }
  }
  assert.ok(grid.cells.every((c) => c === UNKNOWN));
});

test('depth-buffer values convert to metres like the projection that wrote them', () => {
  const camera = new THREE.PerspectiveCamera(70, 1.2, 0.1, 50);
  for (const z of [0.3, 1, 2.5, 3.5]) {
    const b = (new THREE.Vector3(0, 0, -z).applyMatrix4(camera.projectionMatrix).z + 1) / 2;
    assert.ok(Math.abs(depthBufferToMeters(b, 0.1, 50) - z) < 1e-4, `finite far, ${z} m`);
    // Split into two bytes the way the shader in depth.js does, and back: within a centimetre.
    const hi = Math.floor(b * 255);
    const lo = Math.round((b * 255 - hi) * 255);
    assert.ok(Math.abs(depthBufferToMeters((hi + lo / 255) / 255, 0.1, 50) - z) < 0.01, `two bytes, ${z} m`);
    assert.ok(Math.abs(depthBufferToMeters(1 - 0.1 / z, 0.1, Infinity) - z) < 1e-9, `infinite far, ${z} m`);
  }
  // No far plane, however the browser says it: Infinity, 0, or nothing at all.
  for (const far of [Infinity, 0, undefined]) assert.ok(Math.abs(depthBufferToMeters(0.95, 0.1, far) - 2) < 1e-9, `far ${far}`);
  // No data (0, also what a texture that was not bound reads as), nothing there (1), nonsense.
  for (const b of [0, 1, 1.5, -0.2, NaN]) {
    assert.equal(depthBufferToMeters(b, 0.1, 50), 0);
    assert.equal(depthBufferToMeters(b, 0.1, Infinity), 0);
  }
});

// ---- settling: what has been read often enough is left alone ----

// A head at (x, z), eyes level, facing -z (the default) or the direction given.
function headAt(x, z, lookX = 0, lookZ = -1, lookY = 0) {
  const o = new THREE.Object3D();
  o.position.set(x, 1.6, z);
  o.lookAt(x - lookX, 1.6 - lookY, z - lookZ); // an Object3D's -z points away from its lookAt target
  o.updateMatrixWorld();
  return viewOf(o.matrixWorld.elements, SCAN.vantageM);
}
// One read of the cell at (x, z) as seen from `view`.
function readAt(grid, view, x, z, obstaclePoints, floorPoints) {
  grid.reopen(view);
  for (let k = 0; k < obstaclePoints; k++) grid.add(x, 0.5, z);
  for (let k = 0; k < floorPoints; k++) grid.add(x, 0, z);
  grid.commit(view);
  return grid.cells[cellOf(x, z)];
}

test('viewOf: where the head is and faces; sig changes with a step, a turn or a tilt', () => {
  const v = headAt(1, 2);
  assert.deepEqual([v.x, v.z], [1, 2]);
  assert.ok(Math.abs(v.dirX) < 1e-6 && Math.abs(v.dirZ + 1) < 1e-6, 'faces -z');
  assert.equal(headAt(1.1, 2.1).sig, v.sig, 'a small step is the same view');
  assert.notEqual(headAt(2.2, 2).sig, v.sig);
  assert.notEqual(headAt(1, 2, 1, 0).sig, v.sig, 'turned 90 degrees');
  assert.notEqual(headAt(1, 2, 0, -1, -0.8).sig, v.sig, 'looking down');
  const down = headAt(0, 0, 0, -0.01, -1);
  assert.deepEqual([down.dirX, down.dirZ], [0, 0], 'straight down: no facing direction');
});

test('a cell read settleScans times with the same answer is settled: later points are ignored', () => {
  const grid = newGrid();
  const many = SCAN.minPoints * 3;
  const view = headAt(0, 0);
  const [x, z] = [0.05, -1.55];
  for (let i = 0; i < SCAN.setScans; i++) readAt(grid, view, x, z, many, 0);
  assert.equal(grid.settledCount, 0);
  for (let i = 0; i < SCAN.settleScans; i++) assert.equal(readAt(grid, view, x, z, many, 0), OBSTACLE);
  assert.equal(grid.settledCount, 1);
  // The chair is carried off while the wearer stays near: the settled cell does not look again.
  for (let i = 0; i < SCAN.clearScans * 3; i++) assert.equal(readAt(grid, view, x, z, 0, many), OBSTACLE);
});

test('a settled cell is read again after the wearer has been leaveM away and come back', () => {
  const grid = newGrid();
  const many = SCAN.minPoints * 3;
  const near = headAt(0, 0);
  const [x, z] = [0.05, -1.55];
  for (let i = 0; i < SCAN.setScans + SCAN.settleScans; i++) readAt(grid, near, x, z, many, 0);
  assert.equal(grid.settledCount, 1);
  grid.reopen(headAt(0, 2)); // 3.5 m from the cell: not far enough
  grid.reopen(near);
  assert.equal(grid.settledCount, 1);
  grid.reopen(headAt(0, SCAN.leaveM)); // more than leaveM from the cell
  assert.equal(grid.settledCount, 1, 'still settled while away');
  assert.equal(grid.reopen(near), 1);
  assert.equal(grid.settledCount, 0);
  // Now the missing chair is noticed.
  for (let i = 1; i < SCAN.clearScans; i++) assert.equal(readAt(grid, near, x, z, 0, many), OBSTACLE);
  assert.equal(readAt(grid, near, x, z, 0, many), PASSABLE);
});

test('a cell still changing does not settle', () => {
  const grid = newGrid();
  const many = SCAN.minPoints * 3;
  const view = headAt(0, 0);
  const [x, z] = [0.05, -1.55];
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < SCAN.settleScans - 1; i++) readAt(grid, view, x, z, 0, many);
    for (let i = 0; i < SCAN.setScans; i++) readAt(grid, view, x, z, many, 0);
    assert.equal(grid.cells[cellOf(x, z)], OBSTACLE, `round ${round}: the cell still follows what is seen`);
  }
  // Still open: the floor is seen again and the obstacle clears.
  for (let i = 0; i < SCAN.clearScans; i++) readAt(grid, view, x, z, 0, many);
  assert.equal(grid.cells[cellOf(x, z)], PASSABLE);
});

test('nothing left to read in view: unsettledInView turns false, and true again for a new view', () => {
  const grid = newGrid();
  const view = headAt(0, 0);
  assert.equal(grid.unsettledInView(view), true); // nothing has been read yet
  // Reads that never give an answer anywhere (a blank wall beyond range, the ceiling).
  for (let i = 0; i < SCAN.giveUpScans; i++) {
    grid.reopen(view);
    grid.commit(view);
  }
  assert.equal(grid.unsettledInView(view), false, 'everything in view was given up on');
  assert.ok(grid.settledCount > 100);
  // Turn around: other cells, still open.
  const back = headAt(0, 0, 0, 1);
  assert.equal(grid.unsettledInView(back), true);
  // Same place, same heading, looking down now: the given-up cells are tried again.
  const down = headAt(0, 0, 0, -1, -0.9);
  assert.ok(grid.reopen(down) > 100);
  assert.equal(grid.unsettledInView(down), true);
});

test('with settleScans 0 nothing ever settles', () => {
  const grid = createGrid(COLS, COLS, SCAN.cellM, ORIGIN, { ...SCAN, settleScans: 0 });
  const view = headAt(0, 0);
  for (let i = 0; i < 40; i++) readAt(grid, view, 0.05, -1.55, SCAN.minPoints * 3, 0);
  assert.equal(grid.settledCount, 0);
  assert.equal(grid.unsettledInView(view), true);
});

// ---- the window moves: shift and restore (tiles.js) ----

const T = TILES.cells;
const WIN = T * TILES.window;
const TILE_M = T * SCAN.cellM;
// The scan's window as it starts: two tiles either side of the room origin.
const windowGrid = (cfg = SCAN) => createGrid(WIN, WIN, SCAN.cellM, [-2 * TILE_M, -2 * TILE_M], cfg);
// The cell of a window grid that holds the room position (x, z), wherever the window is now.
const at = (grid, x, z) => grid.cells[Math.floor((z - grid.originXZ[1]) / SCAN.cellM) * WIN + Math.floor((x - grid.originXZ[0]) / SCAN.cellM)];
// One read of the cell at (x, z) with the wearer at `view`, on a window grid. The read is
// folded in without the view, so the cells around it are not given up on along the way: these
// tests count settled cells.
function look(grid, view, x, z, obstaclePoints, floorPoints) {
  grid.reopen(view);
  for (let k = 0; k < obstaclePoints; k++) grid.add(x, 0.5, z);
  for (let k = 0; k < floorPoints; k++) grid.add(x, 0, z);
  grid.commit();
  return at(grid, x, z);
}
// Move a window grid from tile `from` to tile `to` the way the scan does, with the archive.
function move(grid, from, to, archive) {
  return moveWindow({ live: grid.cells }, from, to, archive, {
    live: {
      shift: (dCols, dRows) => grid.shift(dCols, dRows, [to[0] * TILE_M, to[1] * TILE_M]),
      paste: (col, row, tile) => grid.restore(col, row, T, tile),
    },
  });
}

test('shift: a cell that stays in the window keeps its state and what was counted for it', () => {
  const grid = windowGrid();
  const many = SCAN.minPoints * 3;
  const view = headAt(0, 0);
  const [x, z] = [0.05, -1.55]; // a thing being confirmed: seen once less than it takes
  const [fx, fz] = [1.05, -1.55]; // floor, read once less than it takes to settle
  const [sx, sz] = [-1.05, -1.55]; // an obstacle that has settled
  for (let i = 0; i < SCAN.setScans + SCAN.settleScans; i++) look(grid, view, sx, sz, many, 0);
  for (let i = 0; i < SCAN.settleScans; i++) look(grid, view, fx, fz, 0, many); // the first read makes it floor, the others confirm it
  for (let i = 1; i < SCAN.setScans; i++) assert.notEqual(look(grid, view, x, z, many, 0), OBSTACLE); // last: sightings count in a row
  assert.equal(grid.settledCount, 1);

  grid.shift(T, 0, [-TILE_M, -2 * TILE_M]); // the window moves one tile in +x
  assert.deepEqual(grid.originXZ, [-TILE_M, -2 * TILE_M]);
  assert.equal(at(grid, sx, sz), OBSTACLE, 'the same room position still holds the obstacle');
  assert.equal(at(grid, fx, fz), PASSABLE);
  assert.equal(grid.settledCount, 1, 'what was settled is still settled');
  // The sighting from before the move still counts: one more makes it an obstacle.
  assert.equal(look(grid, view, x, z, many, 0), OBSTACLE);
  // So does the count towards settling: one more read of the floor settles it.
  look(grid, view, fx, fz, 0, many);
  assert.equal(grid.settledCount, 2);
  // And the settled obstacle does not look again, as before the move.
  for (let i = 0; i < SCAN.clearScans * 2; i++) assert.equal(look(grid, view, sx, sz, 0, many), OBSTACLE);
});

test('shift: ground that comes in is unknown and open; a settled cell that leaves is no longer counted', () => {
  const grid = windowGrid();
  const many = SCAN.minPoints * 3;
  const far = [-2 * TILE_M + 1.05, 0.05]; // in the column of tiles that leaves
  const view = headAt(far[0], far[1] + 1.5);
  for (let i = 0; i < SCAN.setScans + SCAN.settleScans; i++) look(grid, view, far[0], far[1], many, 0);
  assert.equal(grid.settledCount, 1);
  grid.shift(T, 0, [-TILE_M, -2 * TILE_M]);
  assert.equal(grid.settledCount, 0);
  assert.ok(!grid.cells.includes(OBSTACLE), 'it left with its tile');
  // The same cell of the array now stands for ground a tile further on: nothing is known there,
  // and it takes the usual number of sightings to mark it.
  const fresh = [far[0] + WIN * SCAN.cellM, far[1]];
  assert.equal(at(grid, fresh[0], fresh[1]), UNKNOWN);
  const there = headAt(fresh[0], fresh[1] + 1.5);
  for (let i = 1; i < SCAN.setScans; i++) assert.notEqual(look(grid, there, fresh[0], fresh[1], many, 0), OBSTACLE);
  assert.equal(look(grid, there, fresh[0], fresh[1], many, 0), OBSTACLE);
});

test('a known cell that comes back into the window is settled and left alone until the wearer is back at it', () => {
  const grid = windowGrid();
  const archive = new Map();
  const many = SCAN.minPoints * 3;
  const chair = [-10.05, 0.05]; // in tile -2, the first column of the window
  const floor = [-10.55, 0.05];
  const beside = headAt(-10.05, 1.55); // 1.5 m from both
  for (let i = 0; i < SCAN.setScans; i++) look(grid, beside, chair[0], chair[1], many, 0);
  look(grid, beside, floor[0], floor[1], 0, many);
  assert.equal(at(grid, chair[0], chair[1]), OBSTACLE);
  assert.equal(grid.settledCount, 0, 'seen, but not often enough to be settled');

  // The wearer walks a tile on: the window follows and the chair's tile goes to the archive.
  move(grid, [-2, -2], [-1, -2], archive);
  assert.ok(!grid.cells.includes(OBSTACLE));
  assert.equal(archive.get('-2,0').live.filter((v) => v === OBSTACLE).length, 1);
  // And back by a tile: the window takes the tile in again, far from the wearer.
  move(grid, [-1, -2], [-2, -2], archive);
  assert.equal(at(grid, chair[0], chair[1]), OBSTACLE);
  assert.equal(at(grid, floor[0], floor[1]), PASSABLE);
  assert.equal(grid.settledCount, 2, 'both known cells came back settled; the unknown ones are open');

  // From 10 m away nothing is read into them, whatever the sensor says.
  const distant = headAt(0, 0);
  for (let i = 0; i < SCAN.clearScans * 2; i++) assert.equal(look(grid, distant, chair[0], chair[1], 0, many), OBSTACLE);
  assert.equal(grid.settledCount, 2);
  // Back within depth range they are opened, like any cell the wearer returns to.
  assert.equal(grid.reopen(beside), 2);
  assert.equal(grid.settledCount, 0);
  // The chair is gone by now: it takes the usual clearScans reads of bare floor to say so.
  for (let i = 1; i < SCAN.clearScans; i++) assert.equal(look(grid, beside, chair[0], chair[1], 0, many), OBSTACLE, `still held after ${i} clear read(s)`);
  assert.equal(look(grid, beside, chair[0], chair[1], 0, many), PASSABLE);
});
