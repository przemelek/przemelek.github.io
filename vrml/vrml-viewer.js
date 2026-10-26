import * as THREE from 'three';
import { VRMLAnimation } from './vrml-animation.js?v=animation-1';
import { GroundNavigator } from './walking.js?v=walk-1';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { sceneBounds, verticalFieldOfView } from './scene-utils.js';
import { VRMLLoader } from 'three/addons/loaders/VRMLLoader.js?v=animation-1';

const WALK_KEYS = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', KeyD: 'right', KeyQ: 'turn-left', ArrowLeft: 'turn-left',
  KeyE: 'turn-right', ArrowRight: 'turn-right'
};

export function parseVRML(text, baseURL = document.baseURI, manager) {
  if (!/^\uFEFF?#VRML V2\.0 utf8(?:\s|$)/.test(text)) {
    throw new Error('Expected a VRML 2.0 UTF-8 file (#VRML V2.0 utf8).');
  }
  // shortcut: static scene loading only; use a full VRML runtime for ROUTE, sensors or scripts.
  return new VRMLLoader(manager).parse(text.replace(/^\uFEFF/, ''), baseURL);
}

function disposeScene(scene) {
  const resources = new Set();
  scene.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    for (const material of [].concat(object.material || [])) {
      resources.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) resources.add(value);
      }
    }
  });
  for (const resource of resources) resource.dispose();
}

export class VRMLViewer extends HTMLElement {
  static observedAttributes = ['src'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = `
      <style>
        :host { display: block; position: relative; min-height: 240px; }
        canvas { display: block; width: 100%; height: 100%; touch-action: none; }
        p { position: absolute; bottom: 116px; left: 12px; right: 12px; margin: 0;
            padding: 8px; background: #182131e6; color: white; font: 14px system-ui; }
        p:empty { display: none; }
        nav { position:absolute; top:8px; left:12px; right:12px; display:flex; gap:8px; }
        select, button { max-width:75%; padding:6px; font:14px system-ui; }
        nav.walking { top:auto; bottom:12px; right:auto; display:grid; grid-template-columns:repeat(3,44px); }
        .walking button { max-width:none; min-height:40px; touch-action:none; }
        label { color:white; background:#182131e6; padding:4px; font:14px system-ui; }
      </style>
      <canvas tabindex="0" aria-label="3D VRML scene. Drag to orbit, scroll to zoom, WASD to walk, Q/E or left/right arrows to turn."></canvas>
      <nav aria-label="Scene views"><label>Viewpoint <select aria-label="Original viewpoints" disabled><option>No saved viewpoints</option></select></label><button type="button">Fit scene</button><button type="button" data-animation hidden>Pause animation</button></nav>
      <nav class="walking" aria-label="Walking controls. Hold a button to move; steps up to 40 centimetres.">
        <button type="button" data-walk="turn-left" aria-label="Turn left" title="Turn left" disabled>↶</button>
        <button type="button" data-walk="forward" aria-label="Walk forward" title="Walk forward" disabled>▲</button>
        <button type="button" data-walk="turn-right" aria-label="Turn right" title="Turn right" disabled>↷</button>
        <button type="button" data-walk="left" aria-label="Step left" title="Step left" disabled>◀</button>
        <button type="button" data-walk="back" aria-label="Walk backward" title="Walk backward" disabled>▼</button>
        <button type="button" data-walk="right" aria-label="Step right" title="Step right" disabled>▶</button>
      </nav>
      <p role="status" aria-live="polite"></p>`;
    this.canvas = this.shadowRoot.querySelector('canvas');
    this.status = this.shadowRoot.querySelector('p');
    this.generation = 0;
    this.viewSelect = this.shadowRoot.querySelector('select');
    this.viewSelect.onchange = () => this.showViewpoint(Number(this.viewSelect.value));
    this.shadowRoot.querySelector('button').onclick = () => this.fit();
    this.animationButton = this.shadowRoot.querySelector('[data-animation]');
    this.animationButton.onclick = () => this.toggleAnimation();
    this.walkButtons = [...this.shadowRoot.querySelectorAll('[data-walk]')];
    this.onWindowBlur = () => this.stopWalking();
    this.walkKeys = new Map();
    this.canvas.onpointerdown = () => this.canvas.focus();
    this.canvas.onkeydown = event => this.handleNavigationKey(event, true);
    this.canvas.onkeyup = event => this.handleNavigationKey(event, false);
    this.canvas.onblur = () => this.stopWalking();
    for (const button of this.walkButtons) {
      button.onpointerdown = event => {
        if (event.button !== 0) return;
        event.preventDefault();
        button.focus();
        button.setPointerCapture(event.pointerId);
        this.startWalking(button.dataset.walk);
      };
      button.onpointerup = button.onpointercancel = button.onlostpointercapture = () => this.stopWalking();
      button.onclick = event => {
        if (event.detail === 0) this.navigate(button.dataset.walk, 0.15);
      };
    }
  }

  connectedCallback() {
    window.addEventListener('blur', this.onWindowBlur);
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color('#172233');
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 0.6));
      const light = new THREE.DirectionalLight(0xffffff, 0.6);
      light.position.set(3, 5, 4);
      this.scene.add(light);
      this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
      this.camera.position.set(5, 3, 7);
      this.controls = new OrbitControls(this.camera, this.canvas);
      this.controls.addEventListener('change', () => this.render());
      this.controls.addEventListener('start', () => {
        this.followViewpoint = false;
        this.stopTransition();
        this.stopWalking();
        if (this.walker) this.walker.eyeHeight = null;
      });
      this.resizeObserver = new ResizeObserver(() => {
        const { width, height } = this.getBoundingClientRect();
        this.renderer.setSize(Math.max(width, 1), Math.max(height, 1), false);
        this.camera.aspect = Math.max(width, 1) / Math.max(height, 1);
        this.updateProjection();
        this.render();
      });
      this.resizeObserver.observe(this);
      if (this.hasAttribute('src')) this.load(this.getAttribute('src')).catch(() => {});
    } catch (error) {
      this.report(error);
    }
  }

  disconnectedCallback() {
    this.stopAnimation();
    this.animation = null;
    this.stopWalking();
    window.removeEventListener('blur', this.onWindowBlur);
    this.stopTransition();
    ++this.generation;
    this.request?.abort();
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    if (this.model) disposeScene(this.model);
    this.model = null;
    this.walker = null;
    for (const button of this.walkButtons) button.disabled = true;
    this.renderer?.dispose();
    this.renderer = null;
  }

  attributeChangedCallback(name, oldValue, value) {
    if (oldValue !== value && this.isConnected && this.renderer) {
      if (value !== null) this.load(value).catch(() => {});
    }
  }

  render() {
    if (!this.renderer) return;
    for (const background of this.backgrounds || []) background.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  report(error) {
    this.status.textContent = error.message;
    this.dispatchEvent(new CustomEvent('vrml-error', { detail: error }));
  }

  async load(url) {
    const generation = ++this.generation;
    this.request?.abort();
    const request = this.request = new AbortController();
    this.status.textContent = 'Loading scene…';
    let text, baseURL;
    try {
      const absolute = new URL(url, document.baseURI);
      if (!['http:', 'https:'].includes(absolute.protocol)) {
        throw new Error('Scene URLs must use HTTP or HTTPS. Use setSource() for local files.');
      }
      const response = await fetch(absolute, { signal: request.signal });
      if (!response.ok) throw new Error(`Could not load scene: HTTP ${response.status}.`);
      text = await response.text();
      baseURL = new URL('.', response.url || absolute).href;
    } catch (error) {
      if (generation !== this.generation) return;
      this.report(error);
      throw error;
    }
    if (generation !== this.generation) return;
    try {
      this.setSource(text, baseURL);
    } catch (error) {
      this.report(error);
      throw error;
    }
  }

  setSource(text, baseURL = document.baseURI) {
    if (!this.renderer) throw new Error('Attach the viewer to the page before loading a scene.');
    ++this.generation;
    this.request?.abort();
    // Parse first so a malformed replacement does not remove the current model.
    const manager = new THREE.LoadingManager(() => this.render());
    manager.onError = url => this.report(new Error(`Could not load scene asset: ${url}`));
    const model = parseVRML(text, baseURL, manager);
    const bounds = sceneBounds(model);
    if (bounds.isEmpty() || ![...bounds.min, ...bounds.max].every(Number.isFinite)) {
      disposeScene(model);
      throw new Error('The file contains no bounded, renderable geometry.');
    }
    this.stopAnimation();
    if (this.model) {
      this.scene.remove(this.model);
      disposeScene(this.model);
    }
    this.stopWalking();
    this.model = model;
    this.animation = new VRMLAnimation(model);
    this.animationTime = 0;
    this.animationPaused = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.animationButton.hidden = !this.animation.hasAnimations;
    this.animationButton.textContent = this.animationPaused ? 'Play animation' : 'Pause animation';
    this.walker = new GroundNavigator(model);
    for (const button of this.walkButtons) button.disabled = false;
    this.scene.add(model);
    this.scene.background = model.background || new THREE.Color('#172233');
    this.scene.fog = model.fog;
    this.bounds = bounds;
    this.radius = Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius, 0.001);
    this.viewpoints = [];
    this.backgrounds = [];
    model.traverse(object => {
      if (object.isPerspectiveCamera) this.viewpoints.push(object);
      if (object.userData.vrmlBackground) {
        object.scale.setScalar(this.radius * 4 / 10000);
        this.backgrounds.push(object);
      }
    });
    this.viewSelect.replaceChildren(...this.viewpoints.map((viewpoint, index) => {
      const option = document.createElement('option');
      option.value = index;
      option.textContent = viewpoint.userData.description || viewpoint.name || `View ${index + 1}`;
      return option;
    }));
    this.viewSelect.disabled = this.viewpoints.length === 0;
    if (!this.viewpoints.length) {
      const option = document.createElement('option');
      option.textContent = 'No saved viewpoints';
      this.viewSelect.append(option);
    }
    if (this.viewpoints.length) this.showViewpoint(0, false);
    else this.fit();
    this.status.textContent = '';
    this.startAnimation();
    this.dispatchEvent(new CustomEvent('vrml-load'));
  }

  stopAnimation() {
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }

  toggleAnimation() {
    if (!this.animation?.hasAnimations) return;
    this.animationPaused = !this.animationPaused;
    this.animationButton.textContent = this.animationPaused ? 'Play animation' : 'Pause animation';
    if (this.animationPaused) this.stopAnimation();
    else this.startAnimation();
  }

  startAnimation() {
    this.stopAnimation();
    if (!this.animation?.hasAnimations || this.animationPaused) return;
    let previous = performance.now();
    const step = now => {
      this.animationTime += Math.max(0, Math.min((now - previous) / 1000, 0.1));
      previous = now;
      this.animation.update(this.animationTime);
      const view = this.activeViewpoint;
      if (this.followViewpoint && view && !this.transitionFrame && this.animation.animatedViewpoints.has(view.userData.vrmlId)) {
        view.getWorldPosition(this.camera.position);
        view.getWorldQuaternion(this.camera.quaternion);
        this.fieldOfView = view.userData.vrmlFieldOfView;
        this.updateProjection();
        this.controls.target.copy(this.camera.position).add(this.camera.getWorldDirection(new THREE.Vector3()));
        this.controls.update();
      }
      this.render();
      this.animationFrame = requestAnimationFrame(step);
    };
    step(previous);
  }

  handleNavigationKey(event, pressed) {
    const action = WALK_KEYS[event.code];
    if (!action) return;
    if (!pressed) {
      this.walkKeys.delete(event.code);
      if (!this.walkKeys.size) this.stopWalking();
      event.preventDefault();
      return;
    }
    if (!this.walker || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (this.walkKeys.has(event.code)) return;
    if (!this.walkKeys.size) this.startWalking(() => new Set(this.walkKeys.values()));
    this.walkKeys.set(event.code, action);
  }

  stopWalking() {
    this.walkKeys?.clear();
    cancelAnimationFrame(this.walkFrame);
    this.walkFrame = null;
  }

  startWalking(action) {
    this.stopWalking();
    let previous = performance.now();
    const move = seconds => {
      for (const direction of typeof action === 'function' ? action() : [action]) this.navigate(direction, seconds);
    };
    move(0.05);
    const step = now => {
      move(Math.min((now - previous) / 1000, 0.05));
      previous = now;
      this.walkFrame = requestAnimationFrame(step);
    };
    this.walkFrame = requestAnimationFrame(step);
  }

  navigate(action, seconds) {
    if (!this.walker) return;
    this.followViewpoint = false;
    this.stopTransition();
    const up = new THREE.Vector3(0, 1, 0);
    if (action === 'turn-left' || action === 'turn-right') {
      const distance = this.camera.position.distanceTo(this.controls.target);
      const angle = seconds * (action === 'turn-left' ? 1 : -1);
      this.camera.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(up, angle));
      this.controls.target.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()), distance);
    } else {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).setY(0).normalize();
      const forward = new THREE.Vector3().crossVectors(up, right).normalize();
      const direction = (action === 'left' || action === 'right') ? right : forward;
      direction.multiplyScalar(seconds * 1.4 * (action === 'left' || action === 'back' ? -1 : 1));
      const next = this.walker.move(this.camera.position, direction);
      this.controls.target.add(next.clone().sub(this.camera.position));
      this.camera.position.copy(next);
    }
    this.controls.update();
    this.render();
  }

  updateProjection() {
    this.camera.fov = verticalFieldOfView(this.fieldOfView || Math.PI / 4, this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }

  stopTransition() {
    cancelAnimationFrame(this.transitionFrame);
    this.transitionFrame = null;
  }

  showViewpoint(index, animate = true) {
    const viewpoint = this.viewpoints?.[index];
    if (!viewpoint) return;
    this.activeViewpoint = viewpoint;
    this.followViewpoint = true;
    this.stopWalking();
    if (this.walker) this.walker.eyeHeight = null;
    this.stopTransition();
    this.model.updateWorldMatrix(true, true);
    const position = viewpoint.getWorldPosition(new THREE.Vector3());
    const orientation = viewpoint.getWorldQuaternion(new THREE.Quaternion());
    const fieldOfView = viewpoint.userData.vrmlFieldOfView;
    const startPosition = this.camera.position.clone();
    const startOrientation = this.camera.quaternion.clone();
    const startFieldOfView = this.fieldOfView || Math.PI / 4;
    const startDistance = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = Math.min(0.005, this.radius / 1000);
    this.camera.far = position.distanceTo(this.bounds.getCenter(new THREE.Vector3())) + this.radius * 10;
    this.controls.maxDistance = this.radius * 100;
    this.viewSelect.value = index;
    const started = performance.now();
    const duration = animate && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 800 : 0;
    const step = now => {
      const progress = duration ? Math.min((now - started) / duration, 1) : 1;
      const t = progress * progress * (3 - 2 * progress);
      this.camera.position.lerpVectors(startPosition, position, t);
      this.camera.quaternion.slerpQuaternions(startOrientation, orientation, t);
      this.fieldOfView = THREE.MathUtils.lerp(startFieldOfView, fieldOfView, t);
      this.updateProjection();
      const distance = THREE.MathUtils.lerp(startDistance, 1, t);
      this.controls.target.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()), distance);
      this.render();
      if (progress < 1) this.transitionFrame = requestAnimationFrame(step);
      else {
        this.transitionFrame = null;
        this.controls.update();
      }
    };
    step(started);
  }

  fit() {
    if (!this.model) return;
    this.followViewpoint = false;
    this.stopWalking();
    if (this.walker) this.walker.eyeHeight = null;
    this.stopTransition();
    const sphere = this.bounds.getBoundingSphere(new THREE.Sphere());
    this.fieldOfView = Math.PI / 4;
    this.updateProjection();
    const radius = Math.max(sphere.radius, 0.001);
    const vertical = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const horizontal = Math.atan(Math.tan(vertical) * this.camera.aspect);
    const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.15;
    this.camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.65, 1).normalize().multiplyScalar(distance));
    this.camera.near = Math.min(0.005, radius / 1000);
    this.camera.far = distance + radius * 10;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(sphere.center);
    this.controls.maxDistance = Math.max(distance * 2, radius * 100);
    this.controls.update();
    this.render();
  }
}

customElements.define('vrml-viewer', VRMLViewer);
