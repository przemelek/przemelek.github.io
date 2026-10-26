import { Matrix3, Raycaster, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);
const STEP = 0.4;
const EPSILON = 0.00001;

export class GroundNavigator {
  constructor(model) {
    this.meshes = [];
    this.eyeHeight = null;
    this.ray = new Raycaster();
    const visit = object => {
      if (object.userData.vrmlBackground) return;
      if (object.isMesh) this.meshes.push(object);
      for (const child of object.children) visit(child);
    };
    model.updateWorldMatrix(true, true);
    visit(model);
  }

  ground(position, ceiling, range) {
    this.ray.set(new Vector3(position.x, ceiling, position.z), new Vector3(0, -1, 0));
    this.ray.far = range;
    return this.ray.intersectObjects(this.meshes, false).find(hit => {
      const normal = hit.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
      return normal.dot(UP) >= 0.7;
    });
  }

  blocked(from, to) {
    const direction = to.clone().sub(from);
    const length = direction.length();
    if (length < EPSILON) return false;
    direction.divideScalar(length);
    this.ray.far = length + EPSILON;
    this.ray.set(from, direction);
    if (this.ray.intersectObjects(this.meshes, false).length) return true;
    // Check the reverse side too: VRML walls can be single-sided meshes.
    this.ray.set(to, direction.negate());
    return this.ray.intersectObjects(this.meshes, false).length > 0;
  }

  move(position, displacement) {
    const current = position.clone();
    if (this.eyeHeight === null) {
      const floor = this.ground(current, current.y - EPSILON, Infinity);
      if (!floor) return current;
      this.eyeHeight = current.y - floor.point.y;
    }
    const horizontal = displacement.clone().setY(0);
    const count = Math.ceil(horizontal.length() / 0.05);
    if (!count) return current;
    horizontal.divideScalar(count);
    for (let i = 0; i < count; ++i) {
      const feet = current.y - this.eyeHeight;
      const next = current.clone().add(horizontal);
      const floor = this.ground(next, feet + STEP + EPSILON, STEP * 2 + EPSILON * 2);
      if (!floor || Math.abs(floor.point.y - feet) > STEP + EPSILON) break;
      next.y = floor.point.y + this.eyeHeight;
      const base = Math.max(feet, floor.point.y);
      // shortcut: three body rays, use capsule collision for thin obstacles between the rays.
      const heights = [STEP + EPSILON, Math.max(STEP + EPSILON, this.eyeHeight / 2), this.eyeHeight];
      if (heights.some(height => this.blocked(
        new Vector3(current.x, base + height, current.z),
        new Vector3(next.x, base + height, next.z)
      ))) break;
      if (this.blocked(new Vector3(next.x, current.y, next.z), next)) break;
      current.copy(next);
    }
    return current;
  }
}
