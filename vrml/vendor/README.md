# Bundled viewer dependencies

Files from the npm package `three@0.180.0`, distributed under the MIT license in `three/LICENSE`. Includes the WebGL module, its core module, OrbitControls, VRMLLoader the HSV ColorConverter utility, and the loader’s bundled Chevrotain dependency (license notice included in that file).

Only the files required by this viewer are included. Keep the release consistent when updating.

Local changes to `VRMLLoader.js`:

- Resolve USE against the most recent preceding DEF, preserving source order in mixed node/USE lists. This prevents later reused names from replacing earlier library walls with large floors.
- Build Viewpoint cameras with authored position, axis-angle orientation, description, and field of view.
- Mark Background groups so the viewer excludes environment spheres from geometry bounds.

- Match longer node names first and prioritize ROUTE identifiers, fixing interpolator names and endpoints such as Viewpoint2.set_position.
- Preserve animation node fields, ROUTEs and DEF identities; propagate material identities into appearance instances for the external runtime.

The other bundled files remain unmodified. Preserve these loader fixes when updating Three.js.
