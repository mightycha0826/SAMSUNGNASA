// Legacy events without frame metadata already contain map metres (INTERFACES.md).
// Explicitly local or foreign-map events must never change planetary guidance.
export const NAV_SOURCE = 'planetary-navigation';

export function acceptsMapEvent(event, frame) {
  return !!event && !!frame &&
    (event.frame === undefined || event.frame === 'map') &&
    (event.frameId === undefined || event.frameId === frame.frameId);
}

export function isMapPoint(point) {
  return Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
}
