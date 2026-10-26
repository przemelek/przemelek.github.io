import { Color, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import { ColorConverter } from 'three/addons/math/ColorConverter.js';

const WIDTH = { PositionInterpolator: 3, OrientationInterpolator: 4, ColorInterpolator: 3, ScalarInterpolator: 1 };
const INPUTS = {
  Transform: { translation: 'vec3', scale: 'vec3', rotation: 'rotation' },
  Viewpoint: { position: 'vec3', orientation: 'rotation', fieldOfView: 'number' },
  Material: { diffuseColor: 'color', emissiveColor: 'color', specularColor: 'color', transparency: 'number', shininess: 'number' },
  TimeSensor: { startTime: 'number', stopTime: 'number', cycleInterval: 'number', enabled: 'boolean', loop: 'boolean' }
};
const quaternion = values => {
  const axis = new Vector3().fromArray(values);
  return values[3] === 0 ? new Quaternion() : new Quaternion().setFromAxisAngle(axis.normalize(), values[3]);
};

function interpolate(node, fraction) {
  const keys = node.fields.key;
  const values = node.fields.keyValue;
  const width = WIDTH[node.type];
  let upper = keys.findIndex(key => key > fraction);
  if (upper < 0) upper = keys.length - 1;
  const lower = fraction <= keys[0] ? 0 : Math.max(0, upper - 1);
  const t = fraction >= keys.at(-1) ? 1 : upper === lower ? 0 : (fraction - keys[lower]) / (keys[upper] - keys[lower]);
  const a = values.slice(lower * width, (lower + 1) * width);
  const b = values.slice(upper * width, (upper + 1) * width);
  if (node.type === 'OrientationInterpolator') return quaternion(a).slerp(quaternion(b), t);
  if (node.type === 'ColorInterpolator') {
    const hsv = rgb => {
      const result = ColorConverter.getHSV(new Color().setRGB(...rgb), {});
      if (!Number.isFinite(result.s)) result.s = 0;
      return result;
    };
    const left = hsv(a), right = hsv(b);
    if (left.s === 0) left.h = right.h;
    if (right.s === 0) right.h = left.h;
    let hue = right.h - left.h;
    if (hue > 0.5) hue -= 1;
    if (hue < -0.5) hue += 1;
    const saturation = left.s + (right.s - left.s) * t;
    const value = left.v + (right.v - left.v) * t;
    return value === 0 ? [0, 0, 0] : ColorConverter.setHSV(new Color(), left.h + hue * t, saturation, value).toArray();
  }
  const value = a.map((component, index) => component + (b[index] - component) * t);
  return width === 1 ? value[0] : value;
}

export class VRMLAnimation {
  constructor(model) {
    this.model = model;
    const metadata = model.userData.vrmlAnimation || { nodes: {}, routes: [] };
    this.nodes = metadata.nodes;
    this.routes = [];
    this.timers = new Map();
    this.targets = new Map();
    this.warnings = [];
    this.animatedViewpoints = new Set();
    this.visited = new Set();
    this.pending = [];
    const invalid = new Set();
    const addTarget = target => {
      const id = target.userData?.vrmlId;
      if (id === undefined) return;
      if (!this.targets.has(id)) this.targets.set(id, new Set());
      this.targets.get(id).add(target);
    };
    model.traverse(object => {
      addTarget(object);
      for (const material of [].concat(object.material || [])) addTarget(material);
    });
    for (const [name, node] of Object.entries(this.nodes)) {
      if (node.type === 'TimeSensor') {
        const read = (field, fallback) => node.fields[field]?.[0] ?? fallback;
        const timer = {
          cycleInterval: read('cycleInterval', 1), enabled: read('enabled', true), loop: read('loop', false),
          startTime: read('startTime', 0), stopTime: read('stopTime', 0), cycle: -1, finished: false, active: false
        };
        if (![timer.cycleInterval, timer.startTime, timer.stopTime].every(Number.isFinite) || timer.cycleInterval <= 0) invalid.add(name);
        else this.timers.set(name, timer);
      }
      if (WIDTH[node.type]) {
        const keys = node.fields.key || [], values = node.fields.keyValue || [];
        if (!keys.length || values.length !== keys.length * WIDTH[node.type] ||
            ![...keys, ...values].every(Number.isFinite) || keys.some((key, index) => index && key < keys[index - 1]) ||
            (node.type === 'OrientationInterpolator' && keys.some((_, index) => values[index * 4 + 3] !== 0 && values.slice(index * 4, index * 4 + 3).every(value => value === 0)))) invalid.add(name);
      }
    }
    for (const route of metadata.routes) {
      const [source, rawOutput] = route.FROM.split('.');
      const [target, rawInput] = route.TO.split('.');
      const from = this.nodes[source], to = this.nodes[target];
      const output = WIDTH[from?.type] && rawOutput === 'value' ? 'value_changed' : rawOutput;
      const input = rawInput.replace(/^set_/, '');
      const outputType = from?.type === 'TimeSensor'
        ? ({ fraction_changed: 'number', cycleTime: 'number', time: 'number', isActive: 'boolean' })[output]
        : output === 'value_changed' ? ({ PositionInterpolator: 'vec3', OrientationInterpolator: 'rotation', ColorInterpolator: 'color', ScalarInterpolator: 'number' })[from?.type] : undefined;
      const inputType = WIDTH[to?.type] && input === 'fraction' ? 'number' : INPUTS[to?.type]?.[input];
      const hasTarget = to && (WIDTH[to.type] || to.type === 'TimeSensor' || this.targets.has(to.id));
      if (!outputType || inputType !== outputType || !hasTarget || invalid.has(source) || invalid.has(target)) {
        this.warnings.push(`Unsupported or invalid ROUTE: ${route.FROM} → ${route.TO}`);
        continue;
      }
      this.routes.push({ source, output, target, input });
      if (to.type === 'Viewpoint') this.animatedViewpoints.add(to.id);
    }
    for (const name of invalid) this.warnings.push(`Invalid animation data: ${name}`);
    const reachable = new Set(this.timers.keys());
    for (let pass = 0; pass < Object.keys(this.nodes).length; ++pass) {
      const previous = reachable.size;
      for (const route of this.routes) if (reachable.has(route.source)) reachable.add(route.target);
      if (reachable.size === previous) break;
    }
    this.hasAnimations = this.routes.some(route => reachable.has(route.source) && ['Transform', 'Material', 'Viewpoint'].includes(this.nodes[route.target].type));
  }

  emit(name, output, value) {
    this.pending.push({ name, output, value });
    if (this.delivering) return;
    this.delivering = true;
    try {
      while (this.pending.length) {
        const event = this.pending.shift();
        for (let index = 0; index < this.routes.length; ++index) {
          const route = this.routes[index];
          if (route.source !== event.name || route.output !== event.output || this.visited.has(index)) continue;
          // Deliver each ROUTE once per timestamp, preventing cyclic event cascades.
          this.visited.add(index);
          this.receive(route.target, route.input, event.value);
        }
      }
    } finally {
      this.delivering = false;
    }
  }

  receive(name, field, value) {
    const node = this.nodes[name];
    if (WIDTH[node.type]) {
      this.emit(name, 'value_changed', interpolate(node, Math.max(0, Math.min(1, value))));
      return;
    }
    const timer = this.timers.get(name);
    if (timer) {
      if (field === 'cycleInterval' && value <= 0) return;
      if (timer[field] === value) return;
      timer[field] = value;
      if (field === 'startTime') { timer.cycle = -1; timer.finished = false; }
      if (field === 'enabled' && value) timer.finished = false;
      return;
    }
    for (const target of this.targets.get(node.id) || []) {
      if (field === 'translation' || field === 'position') target.position.fromArray(value);
      else if (field === 'scale') target.scale.fromArray(value);
      else if (field === 'rotation' || field === 'orientation') target.quaternion.copy(value);
      else if (field === 'fieldOfView') {
        if (value > 0 && value < Math.PI) target.userData.vrmlFieldOfView = value;
      } else if (field.endsWith('Color')) {
        const property = { diffuseColor: 'color', emissiveColor: 'emissive', specularColor: 'specular' }[field];
        target[property]?.setRGB(...value, SRGBColorSpace);
      } else if (field === 'transparency') {
        target.opacity = 1 - Math.max(0, Math.min(1, value));
        if (target.transparent !== (target.opacity < 1)) {
          target.transparent = target.opacity < 1;
          target.needsUpdate = true;
        }
      } else if (field === 'shininess') target.shininess = Math.max(0, Math.min(1, value)) * 128;
    }
  }

  update(time) {
    if (!Number.isFinite(time) || time < 0) throw new Error('Animation time must be finite and non-negative.');
    this.visited.clear();
    // cycleTime routes initialize exported clocks before their fraction events are sampled.
    for (const [name, timer] of this.timers) {
      if (!timer.enabled || timer.finished || time < timer.startTime) continue;
      const end = Math.min(time, timer.stopTime > timer.startTime ? timer.stopTime : Infinity);
      const ratio = Math.max(0, end - timer.startTime) / timer.cycleInterval;
      if (!Number.isFinite(ratio)) {
        timer.finished = true;
        this.warnings.push(`TimeSensor range overflow: ${name}`);
        continue;
      }
      const cycle = timer.loop ? Math.floor(ratio) : 0;
      if (cycle !== timer.cycle) {
        timer.cycle = cycle;
        this.emit(name, 'cycleTime', timer.startTime + cycle * timer.cycleInterval);
      }
    }
    for (const [name, timer] of this.timers) {
      if (!timer.enabled || time < timer.startTime) {
        if (timer.active) this.emit(name, 'isActive', false);
        timer.active = false;
        continue;
      }
      if (timer.finished) continue;
      const stop = timer.stopTime > timer.startTime ? timer.stopTime : Infinity;
      const end = timer.loop ? stop : Math.min(stop, timer.startTime + timer.cycleInterval);
      const sampled = Math.min(time, end);
      const ratio = (sampled - timer.startTime) / timer.cycleInterval;
      const fraction = ratio > 0 && Math.abs(ratio - Math.round(ratio)) < 1e-9 ? 1 : ratio % 1;
      const active = time < end;
      if (active !== timer.active) this.emit(name, 'isActive', active);
      timer.active = active;
      this.emit(name, 'time', sampled);
      this.emit(name, 'fraction_changed', Math.max(0, Math.min(1, fraction)));
      timer.finished = !active;
    }
    this.model.updateWorldMatrix(true, true);
  }
}
