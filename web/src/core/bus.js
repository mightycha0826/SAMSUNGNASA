// 이벤트 버스. 모듈끼리는 이 버스로만 대화한다 (README 9장 규칙 2).
// 이벤트 이름과 payload 형식은 docs/INTERFACES.md 3장이 계약이다.
//
//   import { bus } from '../core/bus.js';
//   bus.emit('layer:toggle', { id: 'thermal', visible: true });
//   const off = bus.on('layer:toggle', ({ id, visible }) => { ... });
//   off();                       // 또는 bus.off('layer:toggle', handler)
//
// 디버그용으로 bus.on('*', (name, payload) => ...) 를 쓰면 모든 이벤트를 본다.

const handlers = new Map(); // name -> Set<fn>

function on(name, fn) {
  if (!handlers.has(name)) handlers.set(name, new Set());
  handlers.get(name).add(fn);
  return () => off(name, fn);
}

function off(name, fn) {
  handlers.get(name)?.delete(fn);
}

function emit(name, payload) {
  // 받는 쪽 하나가 오류를 내도 나머지는 계속 받는다.
  for (const fn of [...(handlers.get(name) ?? [])]) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[bus] '${name}' 처리 중 오류`, err);
    }
  }
  for (const fn of [...(handlers.get('*') ?? [])]) {
    try {
      fn(name, payload);
    } catch (err) {
      console.error(`[bus] '*' 처리 중 오류`, err);
    }
  }
}

export const bus = { on, off, emit };
