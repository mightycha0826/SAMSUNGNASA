// node --test src/scan/room.test.js
// The room layer fed with frames shaped like the ones WebXR gives: sets of meshes and planes, each
// in its own space with a pose. Expected places are worked out with three.js's own matrix maths.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SCAN } from './index.js';
import { createRoom } from './room.js';
import { PASSABLE, OBSTACLE, UNKNOWN } from './grid.js';

const COLS = Math.round(SCAN.sizeM / SCAN.cellM);
const ORIGIN = [-SCAN.sizeM / 2, -SCAN.sizeM / 2];
const newRoom = (cfg = SCAN) => createRoom(COLS, COLS, ORIGIN, cfg);
const REF = {};

// The room mesh of a headset: its own frame has +z up and is turned and shifted against the room.
const POSE = new THREE.Matrix4().makeTranslation(1, 0, 0.5).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 6)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
const cellAt = (room, local, pose = POSE) => {
  const p = new THREE.Vector3(...local).applyMatrix4(pose);
  return room.cells[Math.floor((p.z - ORIGIN[1]) / SCAN.cellM) * COLS + Math.floor((p.x - ORIGIN[0]) / SCAN.cellM)];
};

const mesh = (vertices, indices) => ({ meshSpace: {}, vertices: new Float32Array(vertices), indices: new Uint32Array(indices), lastChangedTime: 0 });
const plane = (points) => ({ planeSpace: {}, polygon: points.map(([x, z]) => ({ x, y: 0, z })), lastChangedTime: 0 });
// poses: a Map from a mesh or plane to the pose of its space (default POSE); null = cannot be located.
const frame = (meshes, planes = [], poses = new Map()) => ({
  detectedMeshes: new Set(meshes),
  detectedPlanes: new Set(planes),
  getPose: (space) => {
    const thing = [...meshes, ...planes].find((t) => (t.meshSpace ?? t.planeSpace) === space);
    const pose = poses.has(thing) ? poses.get(thing) : POSE;
    return pose && { transform: { matrix: new Float32Array(pose.elements) } };
  },
});
const scan = (room, f, time = 0) => {
  room.collect(f, REF, time);
  let changed = false;
  while (room.pending) changed = room.work() || changed;
  return changed;
};

// floor 4 m x 4 m (two triangles) and a wall 2.4 m high along its far side, in the mesh's own frame
const FLOOR_AND_WALL = [[-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0, -2, 2, 0, 2, 2, 0, 2, 2, 2.4, -2, 2, 2.4], [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]];

test('a room mesh in its own frame lands on the right cells: floor passable, wall blocked, the rest unknown', () => {
  const room = newRoom();
  assert.ok(room.cells.every((c) => c === UNKNOWN));
  assert.equal(scan(room, frame([mesh(...FLOOR_AND_WALL)])), true);
  assert.equal(cellAt(room, [0, 0, 0]), PASSABLE);
  assert.equal(cellAt(room, [-1.9, -1.9, 0]), PASSABLE); // a corner: large triangles are filled, not just their vertices
  assert.equal(cellAt(room, [0, 3, 0]), UNKNOWN); // beyond the wall
  // The blocked cells are the ones the wall stands in: all within a cell of its line, along its whole length.
  const a = new THREE.Vector3(-2, 2, 0).applyMatrix4(POSE);
  const b = new THREE.Vector3(2, 2, 0).applyMatrix4(POSE);
  const wall = new THREE.Line3(a.setY(0), b.setY(0));
  const along = [];
  const onWall = new THREE.Vector3();
  room.cells.forEach((cell, i) => {
    if (cell !== OBSTACLE) return;
    const centre = new THREE.Vector3(ORIGIN[0] + ((i % COLS) + 0.5) * SCAN.cellM, 0, ORIGIN[1] + (Math.floor(i / COLS) + 0.5) * SCAN.cellM);
    along.push(wall.closestPointToPointParameter(centre, true));
    assert.ok(wall.closestPointToPoint(centre, true, onWall).distanceTo(centre) < SCAN.cellM, `blocked cell off the wall at ${centre.x}, ${centre.z}`);
  });
  assert.ok(along.length >= 4 / SCAN.cellM, `${along.length} blocked cells for a 4 m wall`);
  assert.ok(Math.min(...along) < 0.02 && Math.max(...along) > 0.98, 'the wall is blocked from end to end');
  assert.deepEqual(room.counts, { meshes: 1, planes: 0 });
});

test('a floor that is located after the walls still counts as a change; the counts follow every frame', () => {
  const room = newRoom();
  const wall = mesh([-2, 2, 0, 2, 2, 0, 2, 2, 2.4, -2, 2, 2.4], [0, 1, 2, 0, 2, 3]);
  const floor = mesh([-2, -2, 0, 2, -2, 0, 2, 2, 0, -2, 2, 0], [0, 1, 2, 0, 2, 3]);
  room.collect(frame([]), REF, 0);
  assert.deepEqual(room.counts, { meshes: 0, planes: 0 }); // the sets are empty in a session's first frames
  assert.equal(scan(room, frame([wall]), 100), true);
  assert.deepEqual(room.counts, { meshes: 1, planes: 0 });
  assert.equal(scan(room, frame([wall, floor]), 200), true); // floor only: nothing new is blocked, the grid still changed
  assert.equal(cellAt(room, [0, 0, 0]), PASSABLE);
  assert.equal(scan(room, frame([wall, floor]), 300), false);
  // a browser without mesh or plane detection gives no sets at all
  room.collect({ getPose: () => null }, REF, 400);
  assert.deepEqual(room.counts, { meshes: 0, planes: 0 });
  assert.equal(room.work(), false);
});

test('surfaces above head height do not block, and structure is never taken away again', () => {
  const room = newRoom();
  const lamp = mesh([-1, -1, SCAN.headM + 0.1, 1, -1, SCAN.headM + 0.1, 0, 1, SCAN.headM + 0.1], [0, 1, 2]);
  const table = mesh([-0.5, -0.5, 0.75, 0.5, -0.5, 0.75, 0, 0.5, 0.75], [0, 1, 2]);
  scan(room, frame([lamp]));
  assert.equal(cellAt(room, [0, 0, 0]), UNKNOWN);
  scan(room, frame([table]));
  assert.equal(cellAt(room, [0, 0, 0]), OBSTACLE);
  assert.equal(scan(room, frame([mesh(...FLOOR_AND_WALL)])), true); // the floor under it shows up later
  assert.equal(cellAt(room, [0, 0, 0]), OBSTACLE);
  assert.equal(cellAt(room, [1.5, 0, 0]), PASSABLE);
});

test('a plane is a polygon in its own x-z plane; a repeated first point or too few points do no harm', () => {
  const room = newRoom();
  const top = new THREE.Matrix4().makeTranslation(-2.03, 0.75, 1.04); // a table top, lying flat at 0.75 m
  const table = plane([[-0.4, -0.3], [0.4, -0.3], [0.4, 0.3], [-0.4, 0.3], [-0.4, -0.3]]);
  const sliver = plane([[0, 0], [1, 0]]);
  scan(room, frame([], [table, sliver], new Map([[table, top], [sliver, top]])));
  // both halves of the rectangle are filled
  for (const probe of [[0, 0, 0], [0.3, 0, -0.2], [-0.3, 0, 0.2], [0.35, 0, 0.25], [-0.35, 0, -0.25]]) assert.equal(cellAt(room, probe, top), OBSTACLE, `at ${probe}`);
  assert.equal(cellAt(room, [0.75, 0, 0], top), UNKNOWN);
  assert.deepEqual(room.counts, { meshes: 0, planes: 2 });
  // a polygon with more corners is filled to its middle: its triangles fan out from its first point
  const hexagon = plane([0, 1, 2, 3, 4, 5].map((k) => [0.5 * Math.cos((k * Math.PI) / 3), 0.5 * Math.sin((k * Math.PI) / 3)]));
  const aside = new THREE.Matrix4().makeTranslation(2.03, 0.75, -1.04);
  scan(room, frame([], [hexagon], new Map([[hexagon, aside]])));
  for (const probe of [[0, 0, 0], [0.4, 0, 0], [-0.4, 0, 0], [0.2, 0, 0.35], [-0.2, 0, -0.35]]) assert.equal(cellAt(room, probe, aside), OBSTACLE, `hexagon at ${probe}`);
});

test('a large mesh is rasterised over several frames, trianglesPerFrame at a time', () => {
  const room = newRoom({ ...SCAN, trianglesPerFrame: 1 });
  room.collect(frame([mesh(...FLOOR_AND_WALL)]), REF, 0);
  assert.equal(room.pending, 1);
  for (let done = 1; done <= 3; done++) {
    room.work();
    assert.equal(room.pending, 1, `still waiting after ${done} of 4 triangles`);
  }
  room.work();
  assert.equal(room.pending, 0);
  assert.equal(room.work(), false); // nothing left to do: nothing changed
});

test('a mesh that keeps saying it changed is looked at again only after rescanMs, and rasterised again only when its shape or place really changed', () => {
  const room = newRoom();
  const m = mesh(...FLOOR_AND_WALL);
  const lost = new Map([[m, null]]);
  room.collect(frame([m], [], lost), REF, 0);
  assert.equal(room.pending, 0); // its space cannot be located yet: it is tried again
  room.collect(frame([m]), REF, 100);
  assert.equal(room.pending, 1);
  while (room.pending) room.work();
  for (const time of [200, 100 + SCAN.rescanMs / 2, 100 + SCAN.rescanMs - 1]) {
    m.lastChangedTime = time; // a headset may move this every frame although nothing changed
    room.collect(frame([m]), REF, time);
    assert.equal(room.pending, 0, `not again at ${time} ms`);
  }
  // rescanMs later it is looked at again: the same shape in the same place is not rasterised again
  let t = 100 + SCAN.rescanMs;
  m.lastChangedTime = t;
  room.collect(frame([m]), REF, t);
  assert.equal(room.pending, 0);
  // a vertex moved: rasterised again, but not sooner than rescanMs after the last look
  m.vertices = Float32Array.from(m.vertices, (v, i) => (i === 0 ? v - 0.5 : v));
  m.lastChangedTime = t + 1;
  room.collect(frame([m]), REF, t + 1);
  assert.equal(room.pending, 0, 'too soon after the last look');
  t += SCAN.rescanMs;
  m.lastChangedTime = t;
  room.collect(frame([m]), REF, t);
  assert.equal(room.pending, 1);
  while (room.pending) room.work();
  // the same shape somewhere else (its space moved): rasterised again
  t += SCAN.rescanMs;
  m.lastChangedTime = t;
  room.collect(frame([m], [], new Map([[m, new THREE.Matrix4().copy(POSE).setPosition(2, 0, 0.5)]])), REF, t);
  assert.equal(room.pending, 1);
  while (room.pending) room.work();
  room.collect(frame([m]), REF, t + 3 * SCAN.rescanMs); // it stopped saying it changed: never again
  assert.equal(room.pending, 0);
});

test('a plane follows the same rules: tried again when its space cannot be located, looked at again only after rescanMs, rasterised again only when its polygon or place changed', () => {
  const room = newRoom();
  const top = new THREE.Matrix4().makeTranslation(-2.03, 0.75, 1.04);
  const p = plane([[-0.4, -0.3], [0.4, -0.3], [0.4, 0.3], [-0.4, 0.3]]);
  const at = new Map([[p, top]]);
  room.collect(frame([], [p], new Map([[p, null]])), REF, 0);
  assert.equal(room.pending, 0); // its space cannot be located yet: it is tried again
  room.collect(frame([], [p], at), REF, 100);
  assert.equal(room.pending, 1);
  while (room.pending) room.work();
  p.lastChangedTime = 200;
  room.collect(frame([], [p], at), REF, 200);
  assert.equal(room.pending, 0, 'not again before rescanMs');
  let t = 100 + SCAN.rescanMs;
  p.lastChangedTime = t;
  room.collect(frame([], [p], at), REF, t);
  assert.equal(room.pending, 0, 'the same polygon in the same place');
  assert.equal(cellAt(room, [-0.8, 0, -0.29], top), UNKNOWN);
  p.polygon = p.polygon.map((q, i) => (i === 0 ? { ...q, x: q.x - 0.5 } : q));
  p.lastChangedTime = t + 1;
  room.collect(frame([], [p], at), REF, t + 1);
  assert.equal(room.pending, 0, 'too soon after the last look');
  t += SCAN.rescanMs;
  p.lastChangedTime = t;
  room.collect(frame([], [p], at), REF, t);
  assert.equal(room.pending, 1, 'a corner moved');
  while (room.pending) room.work();
  assert.equal(cellAt(room, [-0.8, 0, -0.29], top), OBSTACLE); // only the moved corner reaches here
  t += SCAN.rescanMs;
  p.lastChangedTime = t;
  room.collect(frame([], [p], new Map([[p, new THREE.Matrix4().makeTranslation(-1.03, 0.75, 1.04)]])), REF, t);
  assert.equal(room.pending, 1, 'its space moved');
});
