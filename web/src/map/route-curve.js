import { Curve, Vector3 } from 'three';

// Each TubeGeometry ring lands on a supplied point. Arc-length resampling or a
// spline would cut across corners in the collision-checked navigation polyline.
export class RouteCurve extends Curve {
  constructor(points) { super(); this.points = points; }
  getPoint(t, target = new Vector3()) {
    const s = Math.max(0, Math.min(1, t)) * (this.points.length - 1);
    const i = Math.min(Math.floor(s), this.points.length - 2);
    return target.copy(this.points[i]).lerp(this.points[i + 1], s - i);
  }
  getPointAt(t, target) { return this.getPoint(t, target); }
  getTangentAt(t, target) { return this.getTangent(t, target); }
}
