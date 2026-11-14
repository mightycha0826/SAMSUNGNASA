// node --test src/scan/grid.test.js
// The depth -> grid arithmetic, checked against three.js's own camera and ray maths (a separate
// implementation of the same projection), with the numbers the app really uses (SCAN).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SCAN } from './index.js';
import { createGrid, addDepthView, depthBufferToMeters, mergeLayers, PASSABLE, OBSTACLE, UNKNOWN } from './grid.js';

const COLS = Math.round(SCAN.sizeM / SCAN.cellM);
const ORIGIN = [-SCAN.sizeM / 2, -SCAN.sizeM / 2];
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

test('an obstacle that stays out of sight for forgetScans reads is forgotten; one in sight is kept', () => {
  const grid = newGrid();
  const many = SCAN.minPoints * 3;
  for (let i = 0; i < SCAN.setScans; i++) readCell(grid, many, 0);
  for (let i = 1; i < SCAN.forgetScans; i++) assert.equal(readCell(grid, 0, 0), OBSTACLE, `still there after ${i} reads out of sight`);
  assert.equal(readCell(grid, 0, 0), UNKNOWN); // whoever stood there may have walked away
  // It has to be seen setScans times again before it counts.
  for (let i = 1; i < SCAN.setScans; i++) assert.equal(readCell(grid, many, 0), UNKNOWN);
  assert.equal(readCell(grid, many, 0), OBSTACLE);
  for (let i = 0; i < SCAN.forgetScans * 2; i++) assert.equal(readCell(grid, many, 0), OBSTACLE); // in sight: kept
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
