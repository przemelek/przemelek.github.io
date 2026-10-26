import { Box3, MathUtils } from 'three';

export function sceneBounds(model) {
  model.updateWorldMatrix(true, true);
  const bounds = new Box3();
  function visit(object) {
    // VRML backgrounds are an environment, not scene geometry used to frame the camera.
    if (object.userData.vrmlBackground) return;
    if (object.geometry) {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      bounds.union(object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    }
    for (const child of object.children) visit(child);
  }
  visit(model);
  return bounds;
}

export function verticalFieldOfView(minimumAngle, aspect) {
  return MathUtils.radToDeg(aspect >= 1 ? minimumAngle : 2 * Math.atan(Math.tan(minimumAngle / 2) / aspect));
}
