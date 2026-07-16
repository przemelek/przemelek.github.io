/* ==========================================================================
   GEOCAMPASS NAVIGATOR - CORE APPLICATION LOGIC
   ========================================================================== */

// --------------------------------------------------------------------------
// 1. Initial State & Configuration Presets
// --------------------------------------------------------------------------

const STATE_KEY = "geocompass_state_v1";

const DEFAULT_PRESETS = [
  { id: "p1", name: "🗼 Eiffel Tower, Paris", lat: 48.8584, lng: 2.2945, active: true },
  { id: "p2", name: "🗽 Statue of Liberty, NY", lat: 40.6892, lng: -74.0445, active: true },
  { id: "p3", name: "🕰️ Big Ben, London", lat: 51.5007, lng: -0.1246, active: false }
];

// Portrait horizontal fields of view for the full 4:3 camera image. These are
// device-profile estimates; the visible FOV is refined at runtime for stream
// and CSS cropping, hardware zoom, and the user's calibration adjustment.
const CAMERA_PROFILES = {
  "iphone-17-pro-max": {
    name: "iPhone 17 Pro Max",
    defaultLens: "main",
    lenses: {
      ultrawide: { name: "0.5× Ultra-wide", portraitFov: 90 },
      main: { name: "1× Main", portraitFov: 57 },
      telephoto: { name: "4× Telephoto", portraitFov: 15 }
    }
  },
  "pixel-8-pro": {
    name: "Pixel 8 Pro",
    defaultLens: "main",
    lenses: {
      ultrawide: { name: "0.5× Ultra-wide", portraitFov: 96 },
      main: { name: "1× Main", portraitFov: 55 },
      telephoto: { name: "5× Telephoto", portraitFov: 13 }
    }
  },
  generic: {
    name: "Generic phone",
    defaultLens: "main",
    lenses: {
      main: { name: "Rear Main", portraitFov: 57 }
    }
  }
};

const state = {
  currentPos: null,          // { latitude, longitude, accuracy }
  rawHeading: 0,             // Raw sensor compass degrees (0-360)
  headingOffset: 0,          // Calibration offset in degrees (-180 to 180)
  keepOffset: true,          // Persistent offset across reloads
  smoothedHeading: 0,        // Smoothed compass degrees for drawing
  referenceCorrection: null, // Smoothed absolute-to-relative frame offset (degrees)
  headingHistory: null,      // Rolling history of compass vectors for moving average
  savedPlaces: [],           // Array of { id, name, lat, lng, active }
  primaryTargetId: null,     // ID of the currently focused target
  gpsStatus: "LOCKING",      // LOCKING, ACTIVE, ERROR
  compassStatus: "OFF",      // OFF, CALIBRATING, ACTIVE, MANUAL
  compassAccuracy: null,     // Estimated heading error in degrees when supplied by the platform
  compassSource: null,       // "ios", "absolute", or "manual"
  activeTab: "tab-radar",    // tab-radar, tab-saved, tab-search
  isSimulatorActive: false,  // If manual heading slider is visible
  cameraProfile: "iphone-17-pro-max",
  cameraLens: "main",       // Assumed lens; browsers do not reliably identify physical lenses
  cameraFovScale: 1,         // User calibration multiplier (0.8-1.2)
  cameraCenterOffset: 0,     // Camera optical-center correction in degrees
  cameraZoom: 1,             // Actual track zoom when the browser exposes it
  activeKeys: {},
  canvasDrag: { isDragging: false, startX: 0, startHeading: 0 }
};

// Compass smoothing coefficient (lower = smoother, higher = faster response)
const SMOOTHING_ALPHA = 0.08;
let compassPermissionGranted = false;

// --------------------------------------------------------------------------
// 2. Geodesic Calculations & Mathematics
// --------------------------------------------------------------------------

/**
 * Computes the geodesic distance in meters between two coordinates using the Haversine formula.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's mean radius in meters
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

/**
 * Computes the True North bearing angle in degrees [0, 360) from coordinate A to B.
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const lambda1 = lon1 * Math.PI / 180;
  const lambda2 = lon2 * Math.PI / 180;

  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) -
            Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
            
  let bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Normalizes an angle to the range [0, 360).
 */
function normalizeAngle(angle) {
  return (angle % 360 + 360) % 360;
}

/**
 * Smooths transitioning angles using a low pass filter with wrap-around correction.
 */
function smoothAngle(current, target, alpha) {
  let diff = target - current;
  
  // Wrap difference to [-180, 180]
  while (diff < -180) diff += 360;
  while (diff > 180) diff -= 360;
  
  return normalizeAngle(current + alpha * diff);
}

/**
 * Formats a distance value into a readable string (meters or kilometers).
 */
function formatDistance(meters) {
  if (meters === null || isNaN(meters)) return "--.- km";
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

/**
 * Translates relative angular differences into dynamic navigation text.
 */
function getRelativeDirectionText(bearing, heading) {
  let diff = bearing - heading;
  while (diff < -180) diff += 360;
  while (diff > 180) diff -= 360;
  
  const absDiff = Math.abs(diff);
  if (absDiff < 4) return "🏆 DIRECTLY AHEAD";
  if (absDiff > 176) return "↩️ DIRECTLY BEHIND";
  
  if (diff > 0) {
    if (absDiff < 45) return "↗️ SLIGHTLY RIGHT";
    if (absDiff < 135) return "➡️ TO YOUR RIGHT";
    return "↘️ SHARPLY RIGHT";
  } else {
    if (absDiff < 45) return "↖️ SLIGHTLY LEFT";
    if (absDiff < 135) return "⬅️ TO YOUR LEFT";
    return "↙️ SHARPLY LEFT";
  }
}

// --------------------------------------------------------------------------
// 3. State Management & Storage
// --------------------------------------------------------------------------

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.savedPlaces = parsed.savedPlaces || [];
      state.primaryTargetId = parsed.primaryTargetId || null;
      state.keepOffset = parsed.keepOffset !== undefined ? parsed.keepOffset : true;
      state.headingOffset = state.keepOffset ? (parsed.headingOffset || 0) : 0;
      state.cameraProfile = CAMERA_PROFILES[parsed.cameraProfile]
        ? parsed.cameraProfile
        : "iphone-17-pro-max";
      const profile = CAMERA_PROFILES[state.cameraProfile];
      state.cameraLens = profile.lenses[parsed.cameraLens]
        ? parsed.cameraLens
        : profile.defaultLens;
      state.cameraFovScale = Number.isFinite(parsed.cameraFovScale)
        ? Math.min(1.2, Math.max(0.8, parsed.cameraFovScale))
        : 1;
      state.cameraCenterOffset = Number.isFinite(parsed.cameraCenterOffset)
        ? Math.min(15, Math.max(-15, parsed.cameraCenterOffset))
        : 0;
    } else {
      // Load presets as initial data
      state.savedPlaces = [...DEFAULT_PRESETS];
      state.primaryTargetId = "p1";
      state.headingOffset = 0;
      state.keepOffset = true;
      saveState();
    }
  } catch (err) {
    console.error("Failed to load state from localStorage:", err);
    state.savedPlaces = [...DEFAULT_PRESETS];
    state.primaryTargetId = "p1";
    state.headingOffset = 0;
    state.keepOffset = true;
  }
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      savedPlaces: state.savedPlaces,
      primaryTargetId: state.primaryTargetId,
      headingOffset: state.keepOffset ? state.headingOffset : 0,
      keepOffset: state.keepOffset,
      cameraProfile: state.cameraProfile,
      cameraLens: state.cameraLens,
      cameraFovScale: state.cameraFovScale,
      cameraCenterOffset: state.cameraCenterOffset
    }));
  } catch (err) {
    console.error("Failed to save state to localStorage:", err);
  }
}

// --------------------------------------------------------------------------
// 4. Interface Updates & DOM Elements
// --------------------------------------------------------------------------

const elGpsStatus = document.getElementById("gps-status");
const elCompassStatus = document.getElementById("compass-status");
const elPermissionBanner = document.getElementById("permission-banner");
const elRequestPermissionBtn = document.getElementById("request-permission-btn");

// Compass Tuning DOM Elements
const elCompassTuneBtn = document.getElementById("compass-tune-btn");
const elCompassTuneDrawer = document.getElementById("compass-tune-drawer");
const elCloseTuneBtn = document.getElementById("close-tune-btn");
const elOffsetSlider = document.getElementById("offset-slider");
const elOffsetValueDisplay = document.getElementById("offset-value-display");
const elOffsetMinusBtn = document.getElementById("offset-minus-btn");
const elOffsetPlusBtn = document.getElementById("offset-plus-btn");
const elOffsetResetBtn = document.getElementById("offset-reset-btn");
const elOffsetKeepCheckbox = document.getElementById("offset-keep-checkbox");
const elRequestRecalibrateBtn = document.getElementById("request-recalibrate-btn");
const elCameraProfileSelect = document.getElementById("camera-profile-select");
const elCameraLensSelect = document.getElementById("camera-lens-select");
const elCameraFovSlider = document.getElementById("camera-fov-slider");
const elCameraFovValue = document.getElementById("camera-fov-value");
const elCameraCenterSlider = document.getElementById("camera-center-slider");
const elCameraCenterValue = document.getElementById("camera-center-value");
const elCameraZoomRow = document.getElementById("camera-zoom-row");
const elCameraZoomSlider = document.getElementById("camera-zoom-slider");
const elCameraZoomValue = document.getElementById("camera-zoom-value");
const elCameraFovStatus = document.getElementById("camera-fov-status");

const elHudCard = document.getElementById("hud-card");
const elHudTargetName = document.getElementById("hud-target-name");
const elHudTargetCoords = document.getElementById("hud-target-coords");
const elHudDistance = document.getElementById("hud-distance");
const elHudBearing = document.getElementById("hud-bearing");
const elHudHeading = document.getElementById("hud-heading");
const elHudRelativeAngle = document.getElementById("hud-relative-angle");
const elGpsAccuracy = document.getElementById("gps-accuracy");

const elHeadingSlider = document.getElementById("heading-slider");
const elHeadingSliderVal = document.getElementById("heading-slider-val");
const elManualRotationCard = document.getElementById("manual-rotation-card");

const elSavedList = document.getElementById("saved-list");
const elStoreCurrentBtn = document.getElementById("store-current-btn");

const elSearchInput = document.getElementById("search-input");
const elSearchClearBtn = document.getElementById("search-clear-btn");
const elSearchLoading = document.getElementById("search-loading");
const elSearchResults = document.getElementById("search-results");

const elManualCoordsForm = document.getElementById("manual-coords-form");
const elCoordName = document.getElementById("coord-name");
const elCoordLat = document.getElementById("coord-lat");
const elCoordLng = document.getElementById("coord-lng");

const elSaveModal = document.getElementById("save-modal");
const elSaveModalName = document.getElementById("save-modal-name");
const elSaveModalCoords = document.getElementById("save-modal-coords");
const elSaveModalCancel = document.getElementById("save-modal-cancel");
const elSaveModalConfirm = document.getElementById("save-modal-confirm");

const elNavButtons = document.querySelectorAll(".nav-item");
const elTabPanels = document.querySelectorAll(".tab-panel");

// Camera Mode DOM Elements
let cameraStream = null;
const elCameraPreview = document.getElementById("camera-preview");
const elCameraCanvas = document.getElementById("camera-canvas");
const ctxCamera = elCameraCanvas ? elCameraCanvas.getContext("2d") : null;
const elCameraError = document.getElementById("camera-error");
const elCameraErrorText = document.getElementById("camera-error-text");
const elCameraRetryBtn = document.getElementById("camera-retry-btn");
const elCameraHud = document.getElementById("camera-hud");
const elCamHudName = document.getElementById("cam-hud-name");
const elCamHudDistance = document.getElementById("cam-hud-distance");
const elCamHudRelative = document.getElementById("cam-hud-relative");

let modalLocationPending = null;

// Initialize Navigation Tabs
elNavButtons.forEach(button => {
  button.addEventListener("click", () => {
    const targetTab = button.getAttribute("data-tab");
    
    // Stop camera if leaving tab-camera
    if (state.activeTab === "tab-camera" && targetTab !== "tab-camera") {
      stopCamera();
    }
    
    // Toggle Nav Buttons
    elNavButtons.forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");
    
    // Toggle Panels
    elTabPanels.forEach(panel => panel.classList.remove("active"));
    const activePanel = document.getElementById(targetTab);
    activePanel.classList.add("active");
    
    state.activeTab = targetTab;
    
    // Start camera if entering tab-camera
    if (targetTab === "tab-camera") {
      startCamera();
    }
    
    // Re-draw canvas on switching back to radar
    if (targetTab === "tab-radar") {
      resizeCanvas();
    }
  });
});

// Update Header Telemetry Status Displays
function updateStatusUI() {
  // GPS Indicator
  if (state.gpsStatus === "ACTIVE" && state.currentPos) {
    elGpsStatus.className = "status-pill status-active";
    elGpsStatus.querySelector(".status-label").textContent = `GPS: LOCK`;
    elGpsAccuracy.textContent = `Accuracy: ${Math.round(state.currentPos.accuracy)}m`;
  } else if (state.gpsStatus === "ERROR") {
    elGpsStatus.className = "status-pill status-inactive";
    elGpsStatus.querySelector(".status-label").textContent = `GPS: ERROR`;
    elGpsAccuracy.textContent = "GPS Unavailable";
  } else {
    elGpsStatus.className = "status-pill status-calibrating";
    elGpsStatus.querySelector(".status-label").textContent = `GPS: LOCKING`;
    elGpsAccuracy.textContent = "GPS Syncing...";
  }

  // Compass Indicator
  if (state.compassStatus === "ACTIVE") {
    elCompassStatus.className = "status-pill status-active";
    const accuracy = Number.isFinite(state.compassAccuracy)
      ? ` ±${Math.round(state.compassAccuracy)}°`
      : "";
    elCompassStatus.querySelector(".status-label").textContent = `COMPASS: ON${accuracy}`;
    elManualRotationCard.classList.add("hidden");
  } else if (state.compassStatus === "MANUAL") {
    elCompassStatus.className = "status-pill status-manual";
    elCompassStatus.querySelector(".status-label").textContent = `SIMULATOR`;
    elManualRotationCard.classList.remove("hidden");
  } else if (state.compassStatus === "CALIBRATING") {
    elCompassStatus.className = "status-pill status-calibrating";
    elCompassStatus.querySelector(".status-label").textContent = `COMPASS: CAL`;
    elManualRotationCard.classList.add("hidden");
  } else {
    elCompassStatus.className = "status-pill status-inactive";
    elCompassStatus.querySelector(".status-label").textContent = `COMPASS: OFF`;
    elManualRotationCard.classList.remove("hidden");
  }
}

// --------------------------------------------------------------------------
// 5. GPS & Sensor Core Integration
// --------------------------------------------------------------------------

function initGPS() {
  if (!navigator.geolocation) {
    state.gpsStatus = "ERROR";
    updateStatusUI();
    return;
  }

  navigator.geolocation.watchPosition(
    (position) => {
      state.gpsStatus = "ACTIVE";
      state.currentPos = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      };
      
      updateStatusUI();
      renderSavedPlacesList(); // Re-calculate dynamic list distances!
    },
    (err) => {
      console.warn("GPS tracking error:", err);
      if (!state.currentPos) {
        state.gpsStatus = "ERROR";
        updateStatusUI();
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

/**
 * Returns an earth-referenced heading for the direction the user/camera faces.
 * This is the tilt-compensated algorithm from the Device Orientation spec.
 * When the phone is flat, its top edge is used as the facing direction.
 */
function calculateCompassHeading(alpha, beta, gamma) {
  if (![alpha, beta, gamma].every(Number.isFinite)) return null;

  const degToRad = Math.PI / 180;
  const x = beta * degToRad;
  const y = gamma * degToRad;
  const z = alpha * degToRad;
  const cX = Math.cos(x);
  const cY = Math.cos(y);
  const cZ = Math.cos(z);
  const sX = Math.sin(x);
  const sY = Math.sin(y);
  const sZ = Math.sin(z);

  const vX = -cZ * sY - sZ * sX * cY;
  const vY = -sZ * sY + cZ * sX * cY;

  // With the screen almost horizontal, the camera-facing vector has no useful
  // horizontal projection. In that posture, use the top edge of the phone.
  // ponytail: Increase threshold from 0.01 (~0.5 deg tilt) to 0.6 (~37 deg tilt)
  // to avoid using the extremely noisy camera-facing vector when phone is flat-ish.
  if (Math.hypot(vX, vY) < 0.6) {
    return normalizeAngle(360 - alpha + getScreenOrientationAngle());
  }

  return normalizeAngle(Math.atan2(vX, vY) * 180 / Math.PI);
}

function getScreenOrientationAngle() {
  if (screen.orientation && Number.isFinite(screen.orientation.angle)) {
    return screen.orientation.angle;
  }
  return Number.isFinite(window.orientation) ? window.orientation : 0;
}

function acceptCompassHeading(heading, source, accuracy = null) {
  if (!Number.isFinite(heading)) return;

  const wasInactive = state.compassStatus !== "ACTIVE";

  // ponytail: Apply a rolling vector moving average to smooth out high-frequency magnetometer noise.
  const rad = heading * Math.PI / 180;
  if (!state.headingHistory || wasInactive) {
    state.headingHistory = Array(15).fill({ x: Math.cos(rad), y: Math.sin(rad) });
  } else {
    state.headingHistory.push({ x: Math.cos(rad), y: Math.sin(rad) });
    if (state.headingHistory.length > 15) {
      state.headingHistory.shift();
    }
  }

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < state.headingHistory.length; i++) {
    sumX += state.headingHistory[i].x;
    sumY += state.headingHistory[i].y;
  }
  const avgHeading = normalizeAngle(Math.atan2(sumY, sumX) * 180 / Math.PI);

  state.rawHeading = avgHeading;
  state.compassSource = source;
  state.compassAccuracy = Number.isFinite(accuracy) ? accuracy : null;
  state.compassStatus = "ACTIVE";

  // Avoid animating all the way from north when the first real reading arrives.
  if (wasInactive) state.smoothedHeading = state.rawHeading;
  updateStatusUI();
}

// Device Orientation Handling
function onOrientation(event) {
  // Safari/iOS exposes a north-referenced compass value directly. A negative
  // accuracy means the magnetometer is not calibrated and must not be trusted.
  if (Number.isFinite(event.webkitCompassHeading)) {
    const accuracy = Number.isFinite(event.webkitCompassAccuracy)
      ? event.webkitCompassAccuracy
      : null;
    if (accuracy !== null && accuracy < 0) {
      state.compassStatus = "CALIBRATING";
      state.compassAccuracy = null;
      updateStatusUI();
      return;
    }

    const nativeHeading = normalizeAngle(
      event.webkitCompassHeading + getScreenOrientationAngle()
    );
    let heading = nativeHeading;

    // webkitCompassHeading supplies the reliable north reference on iOS.
    // Anchor the full Euler calculation to it so an upright/tilted phone uses
    // the camera-facing vector instead of only the device's top edge.
    const tiltHeading = calculateCompassHeading(event.alpha, event.beta, event.gamma);
    if (tiltHeading !== null) {
      const uncorrectedTopHeading = normalizeAngle(
        360 - event.alpha + getScreenOrientationAngle()
      );
      let instantCorrection = nativeHeading - uncorrectedTopHeading;
      if (instantCorrection > 180) instantCorrection -= 360;
      if (instantCorrection < -180) instantCorrection += 360;

      if (state.referenceCorrection === null) {
        state.referenceCorrection = normalizeAngle(instantCorrection);
      } else {
        const betaRad = event.beta * Math.PI / 180;
        const gammaRad = event.gamma * Math.PI / 180;
        const flatness = Math.abs(Math.cos(betaRad) * Math.cos(gammaRad));
        // ponytail: Dynamic low-pass complementary filter to handle iPhone vertical (camera mode) gimbal lock.
        // Magnetometer (webkitCompassHeading) is highly unstable when phone is vertical because its top edge points
        // to the sky. We heavily filter/average the yaw correction factor when vertical, relying on stable gyro integration.
        const k = 0.002 + 0.08 * flatness * flatness;
        state.referenceCorrection = smoothAngle(state.referenceCorrection, instantCorrection, k);
      }
      heading = normalizeAngle(tiltHeading + state.referenceCorrection);
    }

    acceptCompassHeading(heading, "ios", accuracy);
    return;
  }

  // Pixel/Chrome supplies absolute alpha/beta/gamma. Relative events have an
  // arbitrary origin and are deliberately ignored for navigation.
  if (event.absolute === true) {
    const heading = calculateCompassHeading(event.alpha, event.beta, event.gamma);
    acceptCompassHeading(heading, "absolute");
  }
}

function initCompass() {
  // Check iOS Webkit Compass Permission Requirements
  const requiresPermission = 
    typeof DeviceOrientationEvent !== 'undefined' && 
    typeof DeviceOrientationEvent.requestPermission === 'function';

  if (requiresPermission) {
    if (compassPermissionGranted) {
      elPermissionBanner.classList.add("hidden");
      window.addEventListener("deviceorientation", onOrientation, true);
      state.compassStatus = "CALIBRATING";
      updateStatusUI();
      return;
    }

    elPermissionBanner.classList.remove("hidden");
    
    elRequestPermissionBtn.onclick = () => {
      DeviceOrientationEvent.requestPermission()
        .then(response => {
          if (response === 'granted') {
            compassPermissionGranted = true;
            elPermissionBanner.classList.add("hidden");
            window.addEventListener("deviceorientation", onOrientation, true);
            state.compassStatus = "CALIBRATING";
            updateStatusUI();
          } else {
            alert("Compass permission denied. Activating manual simulator fallback.");
            activateManualCompass();
          }
        })
        .catch(err => {
          console.error("Compass authorization error:", err);
          activateManualCompass();
        });
    };
  } else {
    // Normal browser sensor binding
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', onOrientation, true);
      // Some Chromium versions expose the absolute handler but deliver the
      // usable earth-referenced reading through deviceorientation instead.
      window.addEventListener('deviceorientation', onOrientation, true);
    } else if ('ondeviceorientation' in window) {
      window.addEventListener('deviceorientation', onOrientation, true);
    } else {
      activateManualCompass();
    }
    
    // Start with a brief delay, if no orientations event triggers, activate manual controls
    setTimeout(() => {
      if (state.compassStatus === "OFF") {
        activateManualCompass();
      }
    }, 2500);
  }
}

function activateManualCompass() {
  state.compassStatus = "MANUAL";
  state.compassSource = "manual";
  state.compassAccuracy = null;
  state.rawHeading = parseFloat(elHeadingSlider.value);
  state.smoothedHeading = state.rawHeading;
  updateStatusUI();
}

// Simulator Slider Bindings
elHeadingSlider.addEventListener("input", (e) => {
  if (state.compassStatus === "MANUAL") {
    const val = parseInt(e.target.value);
    state.rawHeading = val;
    elHeadingSliderVal.textContent = `${val}° (${getCompassCardinal(val)})`;
  }
});

function getCompassCardinal(deg) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round(deg / 45) % 8;
  return directions[index];
}

// --------------------------------------------------------------------------
// 6. Tactical Radar Canvas Renderer
// --------------------------------------------------------------------------

const canvas = document.getElementById("radar-canvas");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  const container = canvas.parentElement;
  const size = Math.min(container.clientWidth, container.clientHeight, 400);
  
  // Set scaling factor for high-DPI/Retina screens
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  
  ctx.scale(dpr, dpr);
}

// Handle resizing dynamically
window.addEventListener("resize", () => {
  resizeCanvas();
  if (state.activeTab === "tab-camera") {
    resizeCameraCanvas();
  }
});
document.addEventListener("DOMContentLoaded", () => {
  resizeCanvas();
  requestAnimationFrame(renderLoop);
});

// Canvas Drag/Swipe rotation for manual simulator mode
canvas.addEventListener("mousedown", (e) => {
  if (state.compassStatus !== "MANUAL") return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left - rect.width/2;
  const y = e.clientY - rect.top - rect.height/2;
  
  state.canvasDrag.isDragging = true;
  state.canvasDrag.startAngle = Math.atan2(y, x) * 180 / Math.PI;
  state.canvasDrag.startHeading = state.rawHeading;
});

window.addEventListener("mousemove", (e) => {
  if (!state.canvasDrag.isDragging) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left - rect.width/2;
  const y = e.clientY - rect.top - rect.height/2;
  
  const currentAngle = Math.atan2(y, x) * 180 / Math.PI;
  const diff = currentAngle - state.canvasDrag.startAngle;
  
  // Rotate heading based on swipe direction
  state.rawHeading = normalizeAngle(state.canvasDrag.startHeading - diff);
  elHeadingSlider.value = Math.round(state.rawHeading);
  elHeadingSliderVal.textContent = `${Math.round(state.rawHeading)}° (${getCompassCardinal(state.rawHeading)})`;
});

window.addEventListener("mouseup", () => {
  state.canvasDrag.isDragging = false;
});

// Mobile Touch Gestures for radar dragging
canvas.addEventListener("touchstart", (e) => {
  if (state.compassStatus !== "MANUAL" || e.touches.length === 0) return;
  const rect = canvas.getBoundingClientRect();
  const touch = e.touches[0];
  const x = touch.clientX - rect.left - rect.width/2;
  const y = touch.clientY - rect.top - rect.height/2;
  
  state.canvasDrag.isDragging = true;
  state.canvasDrag.startAngle = Math.atan2(y, x) * 180 / Math.PI;
  state.canvasDrag.startHeading = state.rawHeading;
});

canvas.addEventListener("touchmove", (e) => {
  if (!state.canvasDrag.isDragging || e.touches.length === 0) return;
  const rect = canvas.getBoundingClientRect();
  const touch = e.touches[0];
  const x = touch.clientX - rect.left - rect.width/2;
  const y = touch.clientY - rect.top - rect.height/2;
  
  const currentAngle = Math.atan2(y, x) * 180 / Math.PI;
  const diff = currentAngle - state.canvasDrag.startAngle;
  
  state.rawHeading = normalizeAngle(state.canvasDrag.startHeading - diff);
  elHeadingSlider.value = Math.round(state.rawHeading);
  elHeadingSliderVal.textContent = `${Math.round(state.rawHeading)}° (${getCompassCardinal(state.rawHeading)})`;
  e.preventDefault(); // Stop screen bouncing/dragging
}, { passive: false });

canvas.addEventListener("touchend", () => {
  state.canvasDrag.isDragging = false;
});

/**
 * Main Dynamic Render Loop (Running via requestAnimationFrame)
 */
function renderLoop() {
  // Apply offset to raw sensor reading, except in simulator MANUAL mode which is directly set
  const targetHeading = state.compassStatus === "MANUAL"
    ? state.rawHeading
    : normalizeAngle(state.rawHeading + (state.headingOffset || 0));

  if (state.activeTab === "tab-radar") {
    // Smooth the compass headings using the Low-Pass Filter
    state.smoothedHeading = smoothAngle(state.smoothedHeading, targetHeading, SMOOTHING_ALPHA);
    
    // Clear and draw
    drawRadar();
    updateHUD();
  } else if (state.activeTab === "tab-camera") {
    state.smoothedHeading = smoothAngle(state.smoothedHeading, targetHeading, SMOOTHING_ALPHA);
    drawCameraView();
    updateHUD();
  }
  
  requestAnimationFrame(renderLoop);
}

function drawRadar() {
  const size = canvas.width / (window.devicePixelRatio || 1);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.42;

  ctx.clearRect(0, 0, size, size);

  // 1. Draw Concentric Radar Grid Rings
  ctx.strokeStyle = "rgba(6, 182, 212, 0.08)";
  ctx.lineWidth = 1;
  [0.33, 0.66, 1.0].forEach(percent => {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * percent, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Crosshairs
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();

  // Save state for rotating dial
  ctx.save();
  ctx.translate(cx, cy);
  // Course Up rotation: Rotate entire coordinate system by -smoothedHeading
  ctx.rotate(-state.smoothedHeading * Math.PI / 180);

  // 2. Draw Rotating Compass outer dial
  ctx.strokeStyle = "rgba(6, 182, 212, 0.25)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Degree ticks every 10 degrees, labeled every 30 degrees
  for (let angle = 0; angle < 360; angle += 10) {
    const angleRad = angle * Math.PI / 180;
    const isMajor = angle % 30 === 0;
    const tickLen = isMajor ? 8 : 4;
    
    const startX = Math.sin(angleRad) * (radius - tickLen);
    const startY = -Math.cos(angleRad) * (radius - tickLen);
    const endX = Math.sin(angleRad) * radius;
    const endY = -Math.cos(angleRad) * radius;

    ctx.strokeStyle = isMajor ? "rgba(6, 182, 212, 0.4)" : "rgba(6, 182, 212, 0.15)";
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    if (isMajor) {
      ctx.save();
      ctx.translate(startX * 0.93, startY * 0.93);
      ctx.rotate(angleRad); // Rotate text outwards
      ctx.fillStyle = "rgba(148, 163, 184, 0.6)";
      ctx.font = "8px 'Orbitron', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(angle.toString(), 0, 0);
      ctx.restore();
    }
  }

  // Cardinal labels (N, E, S, W)
  const cardinals = [
    { label: "N", angle: 0, color: "#f43f5e" }, // Red North indicator
    { label: "E", angle: 90, color: "#f8fafc" },
    { label: "S", angle: 180, color: "#f8fafc" },
    { label: "W", angle: 270, color: "#f8fafc" }
  ];

  cardinals.forEach(item => {
    const angleRad = item.angle * Math.PI / 180;
    const x = Math.sin(angleRad) * (radius - 16);
    const y = -Math.cos(angleRad) * (radius - 16);

    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = item.color;
    ctx.font = "bold 13px 'Orbitron', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(item.label, 0, 0);
    ctx.restore();
  });

  // Restore rotation back to absolute orientation
  ctx.restore();

  // 3. Draw Selected Navigation Targets
  const activeTargets = state.savedPlaces.filter(t => t.active);
  const primaryTarget = activeTargets.find(t => t.id === state.primaryTargetId);

  // If GPS is locked, draw target pointers
  if (state.currentPos) {
    const lat1 = state.currentPos.latitude;
    const lon1 = state.currentPos.longitude;

    activeTargets.forEach(target => {
      const isPrimary = primaryTarget && target.id === primaryTarget.id;
      const distance = calculateDistance(lat1, lon1, target.lat, target.lng);
      const bearing = calculateBearing(lat1, lon1, target.lat, target.lng);

      // Relative angle to draw: bearing - smoothedHeading
      const drawAngle = (bearing - state.smoothedHeading) * Math.PI / 180;

      // Coordinate placement on the perimeter of the radar
      const arrowRadius = radius + 2;
      const x = cx + Math.sin(drawAngle) * arrowRadius;
      const y = cy - Math.cos(drawAngle) * arrowRadius;

      // Draw directional arrow on the perimeter
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(drawAngle);

      if (isPrimary) {
        // Large glowing active target arrow
        ctx.shadowColor = "rgba(6, 182, 212, 0.8)";
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#06b6d4";
        
        ctx.beginPath();
        ctx.moveTo(0, -10); // Tip
        ctx.lineTo(-7, 8);   // Bottom-left
        ctx.lineTo(0, 3);    // Center indent
        ctx.lineTo(7, 8);    // Bottom-right
        ctx.closePath();
        ctx.fill();

        // Pulsing radar sweeping dotted line towards target
        ctx.restore();
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(drawAngle);
        ctx.strokeStyle = "rgba(6, 182, 212, 0.15)";
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -radius);
        ctx.stroke();
      } else {
        // Smaller secondary targets arrows
        ctx.fillStyle = "rgba(59, 130, 246, 0.8)";
        
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(-4, 5);
        ctx.lineTo(0, 2);
        ctx.lineTo(4, 5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Dynamic text positioning to avoid overlap
      ctx.save();
      const textRadius = radius + (isPrimary ? 18 : 12);
      const tx = cx + Math.sin(drawAngle) * textRadius;
      const ty = cy - Math.cos(drawAngle) * textRadius;

      // Align text based on perimeter hemisphere
      const sin = Math.sin(drawAngle);
      if (sin > 0.2) {
        ctx.textAlign = "left";
      } else if (sin < -0.2) {
        ctx.textAlign = "right";
      } else {
        ctx.textAlign = "center";
      }

      ctx.textBaseline = "middle";
      ctx.font = isPrimary ? "bold 10px 'Inter', sans-serif" : "9px 'Inter', sans-serif";
      ctx.fillStyle = isPrimary ? "#06b6d4" : "#94a3b8";

      // Render name and distance text
      const targetLabel = target.name.split(",")[0]; // Use short name
      const distText = formatDistance(distance);
      ctx.fillText(`${targetLabel} (${distText})`, tx, ty);
      ctx.restore();
    });
  }

  // 4. Draw Center User/Navigator Marker
  ctx.save();
  ctx.translate(cx, cy);
  
  // Outer glowing pulse
  ctx.shadowColor = "rgba(255, 255, 255, 0.25)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#f8fafc";
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();

  // Inner core center dot
  ctx.fillStyle = "#080c14";
  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Updates the digital HUD metrics card based on current telemetry state
 */
function updateHUD() {
  const activeTargets = state.savedPlaces.filter(t => t.active);
  const primaryTarget = activeTargets.find(t => t.id === state.primaryTargetId);

  // Apply offset to display heading (unless manual simulator is active)
  // Use the same filtered heading as the radar/camera so visual and textual
  // directions cannot temporarily disagree while the sensor is moving.
  const displayHeading = state.smoothedHeading;

  // Update current heading readout
  const formattedHeading = `${Math.round(displayHeading).toString().padStart(3, '0')}°`;
  elHudHeading.textContent = formattedHeading;

  if (primaryTarget && state.currentPos) {
    const lat1 = state.currentPos.latitude;
    const lon1 = state.currentPos.longitude;
    
    const distance = calculateDistance(lat1, lon1, primaryTarget.lat, primaryTarget.lng);
    const bearing = calculateBearing(lat1, lon1, primaryTarget.lat, primaryTarget.lng);
    
    // Relative pointer rotate
    const relativeAngle = (bearing - displayHeading + 360) % 360;

    elHudCard.classList.add("active-nav");
    elHudTargetName.textContent = primaryTarget.name.toUpperCase();
    elHudTargetCoords.textContent = `Lat: ${primaryTarget.lat.toFixed(5)}, Lng: ${primaryTarget.lng.toFixed(5)}`;
    
    elHudDistance.textContent = formatDistance(distance);
    elHudBearing.textContent = `${Math.round(bearing).toString().padStart(3, '0')}°`;
    elHudRelativeAngle.textContent = getRelativeDirectionText(bearing, displayHeading);
    
    // Rotate target arrow inside card
    const cardArrow = elHudCard.querySelector(".target-indicator-arrow");
    cardArrow.style.transform = `rotate(${relativeAngle}deg)`;
  } else {
    // Reset HUD to inactive state
    elHudCard.classList.remove("active-nav");
    elHudTargetName.textContent = "NO ACTIVE TARGET";
    elHudTargetCoords.textContent = "Lat: --.----, Lng: --.----";
    elHudDistance.textContent = "--.- km";
    elHudBearing.textContent = "---°";
    elHudRelativeAngle.textContent = "SELECT TARGET ON PLACES TAB";
    
    const cardArrow = elHudCard.querySelector(".target-indicator-arrow");
    cardArrow.style.transform = `rotate(0deg)`;
  }

  // Update camera HUD overlay if active
  if (state.activeTab === "tab-camera") {
    if (primaryTarget && state.currentPos) {
      const lat1 = state.currentPos.latitude;
      const lon1 = state.currentPos.longitude;
      const distance = calculateDistance(lat1, lon1, primaryTarget.lat, primaryTarget.lng);
      const bearing = calculateBearing(lat1, lon1, primaryTarget.lat, primaryTarget.lng);
      
      elCameraHud.classList.remove("hidden");
      elCamHudName.textContent = primaryTarget.name.split(",")[0].toUpperCase();
      elCamHudDistance.textContent = formatDistance(distance);
      elCamHudRelative.textContent = getRelativeDirectionText(bearing, displayHeading);
    } else {
      elCameraHud.classList.add("hidden");
    }
  } else {
    if (elCameraHud) elCameraHud.classList.add("hidden");
  }
}

// --------------------------------------------------------------------------
// 7. Places Manager (Saved Places Screen)
// --------------------------------------------------------------------------

function renderSavedPlacesList() {
  elSavedList.innerHTML = "";
  
  if (state.savedPlaces.length === 0) {
    elSavedList.innerHTML = `
      <div class="list-placeholder">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" class="subtle-icon">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
        <p>No locations saved yet. Store your current coordinates or search for places to add them here.</p>
      </div>
    `;
    return;
  }

  state.savedPlaces.forEach(place => {
    const isPrimary = place.id === state.primaryTargetId;
    
    // Compute distance if GPS position is active
    let distanceStr = "";
    if (state.currentPos) {
      const dist = calculateDistance(state.currentPos.latitude, state.currentPos.longitude, place.lat, place.lng);
      distanceStr = `<span class="item-distance font-tech">${formatDistance(dist)}</span>`;
    }

    const card = document.createElement("div");
    card.className = `saved-item ${isPrimary ? 'is-primary' : ''}`;
    
    card.innerHTML = `
      <div class="item-left">
        <label class="checkbox-container" title="Show on Radar">
          <input type="checkbox" class="track-toggle" data-id="${place.id}" ${place.active ? 'checked' : ''}>
          <span class="checkmark"></span>
        </label>
        <div class="item-info">
          <div class="item-name-row">
            <span class="item-name" title="${place.name}">${place.name}</span>
            ${isPrimary ? '<span class="primary-badge">PRIMARY</span>' : ''}
          </div>
          <div class="item-meta">
            ${distanceStr}
            <span class="subtle-text">Lat: ${place.lat.toFixed(4)}, Lng: ${place.lng.toFixed(4)}</span>
          </div>
        </div>
      </div>
      <div class="item-right">
        <button class="btn-icon focus-btn" data-id="${place.id}" title="Set Primary Navigation Target" ${!place.active ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
          </svg>
        </button>
        <button class="btn-icon btn-delete delete-btn" data-id="${place.id}" title="Delete Location">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
      </div>
    `;

    // Event Bindings inside list
    
    // Toggle active tracking state
    card.querySelector(".track-toggle").addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-id");
      const targetPlace = state.savedPlaces.find(p => p.id === id);
      if (targetPlace) {
        targetPlace.active = e.target.checked;
        
        // If we untrack the primary target, unset it as primary
        if (!targetPlace.active && state.primaryTargetId === id) {
          state.primaryTargetId = state.savedPlaces.find(p => p.active)?.id || null;
        }
        
        saveState();
        renderSavedPlacesList();
      }
    });

    // Set as Primary Target
    card.querySelector(".focus-btn").addEventListener("click", () => {
      const id = place.id;
      state.primaryTargetId = id;
      saveState();
      renderSavedPlacesList();
      
      // Auto switch back to Radar tab for navigation!
      document.getElementById("nav-btn-radar").click();
    });

    // Delete bookmark location
    card.querySelector(".delete-btn").addEventListener("click", () => {
      if (confirm(`Remove "${place.name}"?`)) {
        state.savedPlaces = state.savedPlaces.filter(p => p.id !== place.id);
        
        if (state.primaryTargetId === place.id) {
          state.primaryTargetId = state.savedPlaces.find(p => p.active)?.id || null;
        }
        
        saveState();
        renderSavedPlacesList();
      }
    });

    elSavedList.appendChild(card);
  });
}

// --------------------------------------------------------------------------
// 8. Add Current Location Dialogs
// --------------------------------------------------------------------------

// Store current geolocation
elStoreCurrentBtn.addEventListener("click", () => {
  if (state.gpsStatus !== "ACTIVE" || !state.currentPos) {
    alert("Unable to obtain GPS lock. Wait for coordinates to sync first.");
    return;
  }
  
  const lat = state.currentPos.latitude;
  const lng = state.currentPos.longitude;
  
  // Show save dialog overlay modal
  modalLocationPending = { lat, lng };
  elSaveModalCoords.textContent = `Latitude: ${lat.toFixed(6)} | Longitude: ${lng.toFixed(6)}`;
  elSaveModalName.value = `Location ${state.savedPlaces.length + 1}`;
  elSaveModal.classList.remove("hidden");
  
  // Focus name field
  setTimeout(() => elSaveModalName.focus(), 150);
});

// Modal Confirm
elSaveModalConfirm.addEventListener("click", () => {
  const customName = elSaveModalName.value.trim();
  if (customName && modalLocationPending) {
    const newPlace = {
      id: "u_" + Date.now(),
      name: customName,
      lat: modalLocationPending.lat,
      lng: modalLocationPending.lng,
      active: true
    };
    
    state.savedPlaces.push(newPlace);
    state.primaryTargetId = newPlace.id; // Automatically set as primary
    
    saveState();
    renderSavedPlacesList();
    
    elSaveModal.classList.add("hidden");
    modalLocationPending = null;
    
    // Switch to Saved list tab
    document.getElementById("nav-btn-saved").click();
  }
});

// Modal Cancel
elSaveModalCancel.addEventListener("click", () => {
  elSaveModal.classList.add("hidden");
  modalLocationPending = null;
});

// Add Location manually via Coordinates Form
elManualCoordsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  
  const name = elCoordName.value.trim();
  const lat = parseFloat(elCoordLat.value);
  const lng = parseFloat(elCoordLng.value);

  if (name && !isNaN(lat) && !isNaN(lng)) {
    const newPlace = {
      id: "m_" + Date.now(),
      name: name,
      lat: lat,
      lng: lng,
      active: true
    };

    state.savedPlaces.push(newPlace);
    state.primaryTargetId = newPlace.id;

    saveState();
    renderSavedPlacesList();

    // Reset Form
    elManualCoordsForm.reset();

    // Go to Saved Tab
    document.getElementById("nav-btn-saved").click();
  }
});

// Preset items shortcut loads
document.querySelectorAll(".btn-preset").forEach(btn => {
  btn.addEventListener("click", () => {
    const name = btn.getAttribute("data-name");
    const lat = parseFloat(btn.getAttribute("data-lat"));
    const lng = parseFloat(btn.getAttribute("data-lng"));

    const newPlace = {
      id: "preset_" + Date.now(),
      name: name,
      lat: lat,
      lng: lng,
      active: true
    };

    state.savedPlaces.push(newPlace);
    state.primaryTargetId = newPlace.id;

    saveState();
    renderSavedPlacesList();

    // Switch to Saved Places view
    document.getElementById("nav-btn-saved").click();
  });
});

// --------------------------------------------------------------------------
// 9. OpenStreetMap Nominatim Geocoding Search
// --------------------------------------------------------------------------

let searchTimeout = null;

elSearchInput.addEventListener("input", (e) => {
  const query = e.target.value.trim();
  
  if (query.length > 0) {
    elSearchClearBtn.classList.remove("hidden");
  } else {
    elSearchClearBtn.classList.add("hidden");
    elSearchResults.classList.add("hidden");
  }
  
  // Debounce search requests (wait 600ms after user finishes typing)
  clearTimeout(searchTimeout);
  if (query.length > 2) {
    searchTimeout = setTimeout(() => performSearch(query), 600);
  }
});

// Clear Search input
elSearchClearBtn.addEventListener("click", () => {
  elSearchInput.value = "";
  elSearchClearBtn.classList.add("hidden");
  elSearchResults.classList.add("hidden");
  elSearchInput.focus();
});

async function performSearch(query) {
  elSearchLoading.classList.remove("hidden");
  elSearchResults.classList.add("hidden");
  
  try {
    // OSM Nominatim Geocoding Search Service
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5`;
    
    // Set user agent identification headers to follow OSM policies politely
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.status}`);
    }

    const data = await response.json();
    renderSearchResults(data);
  } catch (err) {
    console.error("Geocoding search failed:", err);
    elSearchResults.innerHTML = `
      <div class="search-result-item" style="cursor: default;">
        <span class="result-title" style="color: var(--accent-rose)">Search Failed</span>
        <span class="result-sub">Network error or search service limit hit. Enter coords manually below.</span>
      </div>
    `;
    elSearchResults.classList.remove("hidden");
  } finally {
    elSearchLoading.classList.add("hidden");
  }
}

function renderSearchResults(results) {
  elSearchResults.innerHTML = "";
  
  if (results.length === 0) {
    elSearchResults.innerHTML = `
      <div class="search-result-item" style="cursor: default;">
        <span class="result-title">No places found</span>
        <span class="result-sub">Try adjusting details or inputting exact coordinates manually.</span>
      </div>
    `;
    elSearchResults.classList.remove("hidden");
    return;
  }

  results.forEach(item => {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);
    const name = item.display_name;

    const row = document.createElement("div");
    row.className = "search-result-item";
    
    // Format descriptive parts
    const title = item.name || name.split(",")[0];
    const subtitle = name.split(",").slice(1).join(",").trim();

    row.innerHTML = `
      <span class="result-title">${title}</span>
      <span class="result-sub">${subtitle}</span>
    `;

    row.addEventListener("click", () => {
      const newPlace = {
        id: "search_" + Date.now(),
        name: name,
        lat: lat,
        lng: lng,
        active: true
      };

      state.savedPlaces.push(newPlace);
      state.primaryTargetId = newPlace.id;

      saveState();
      renderSavedPlacesList();

      // Reset Search field
      elSearchInput.value = "";
      elSearchClearBtn.classList.add("hidden");
      elSearchResults.classList.add("hidden");

      // Go to Saved Tab
      document.getElementById("nav-btn-saved").click();
    });

    elSearchResults.appendChild(row);
  });
  
  elSearchResults.classList.remove("hidden");
}

// --------------------------------------------------------------------------
// 9.5. Camera / AR Navigation Utilities
// --------------------------------------------------------------------------

async function startCamera() {
  stopCamera(); // Clean up existing
  if (elCameraError) elCameraError.classList.add("hidden");
  
  try {
    const constraints = {
      video: {
        facingMode: "environment", // Request back/rear camera for AR
        // Camera constraints describe the sensor stream, not how the user is
        // holding the phone. Forcing 9:16 makes iOS Safari crop a normal rear
        // camera stream and can look like an unintended ~3x zoom.
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };
    
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraStream = stream;
    configureCameraTrack(stream.getVideoTracks()[0]);
    if (elCameraPreview) {
      elCameraPreview.srcObject = stream;
      elCameraPreview.play();
      
      elCameraPreview.onloadedmetadata = () => {
        resizeCameraCanvas();
      };
    }
  } catch (err) {
    console.error("Camera access failed:", err);
    if (elCameraErrorText) {
      elCameraErrorText.textContent = "Camera access denied or unavailable. Please ensure camera permissions are granted.";
    }
    if (elCameraError) {
      elCameraError.classList.remove("hidden");
    }
  }
}

function configureCameraTrack(track) {
  if (!track) return;

  const capabilities = typeof track.getCapabilities === "function"
    ? track.getCapabilities()
    : {};
  const settings = typeof track.getSettings === "function"
    ? track.getSettings()
    : {};
  const zoom = capabilities.zoom;

  if (zoom && Number.isFinite(zoom.min) && Number.isFinite(zoom.max)) {
    const currentZoom = Number.isFinite(settings.zoom) ? settings.zoom : zoom.min;
    state.cameraZoom = currentZoom;
    elCameraZoomRow?.classList.remove("hidden");
    if (elCameraZoomSlider) {
      elCameraZoomSlider.min = zoom.min;
      elCameraZoomSlider.max = zoom.max;
      elCameraZoomSlider.step = zoom.step || 0.1;
      elCameraZoomSlider.value = currentZoom;
    }
    updateCameraTuningUI();
  } else {
    state.cameraZoom = 1;
    elCameraZoomRow?.classList.add("hidden");
  }
}

async function setCameraZoom(value) {
  const track = cameraStream?.getVideoTracks()[0];
  if (!track) return;

  const requestedZoom = Number(value);
  try {
    await track.applyConstraints({ advanced: [{ zoom: requestedZoom }] });
    const actualZoom = track.getSettings?.().zoom;
    state.cameraZoom = Number.isFinite(actualZoom) ? actualZoom : requestedZoom;
    updateCameraTuningUI();
  } catch (err) {
    console.warn("Camera zoom is not available:", err);
    showToast("This browser could not apply camera zoom.");
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  if (elCameraPreview) {
    elCameraPreview.srcObject = null;
  }
}

function resizeCameraCanvas() {
  if (!elCameraCanvas || !elCameraPreview) return;
  const width = elCameraPreview.clientWidth || elCameraCanvas.parentElement.clientWidth;
  const height = elCameraPreview.clientHeight || elCameraCanvas.parentElement.clientHeight;
  
  const dpr = window.devicePixelRatio || 1;
  elCameraCanvas.width = width * dpr;
  elCameraCanvas.height = height * dpr;
  elCameraCanvas.style.width = `${width}px`;
  elCameraCanvas.style.height = `${height}px`;
  
  if (ctxCamera) {
    ctxCamera.scale(dpr, dpr);
  }
}

function calculateVisibleFov(baseFov, streamCrop = 1, displayCrop = 1, zoom = 1, scale = 1) {
  let halfFovTangent = Math.tan(baseFov * Math.PI / 360);
  halfFovTangent *= Math.min(1, Math.max(0, streamCrop));
  halfFovTangent *= Math.min(1, Math.max(0, displayCrop));
  halfFovTangent /= Math.max(1, zoom);
  halfFovTangent *= scale;
  return 2 * Math.atan(halfFovTangent) * 180 / Math.PI;
}

function getVisibleCameraFov() {
  const profile = CAMERA_PROFILES[state.cameraProfile] || CAMERA_PROFILES.generic;
  const lens = profile.lenses[state.cameraLens] || profile.lenses[profile.defaultLens];
  let streamCrop = 1;
  let displayCrop = 1;

  // Lens presets describe a full 4:3 portrait frame. A narrower stream (often
  // 16:9 video) crops the short/portrait-horizontal sensor dimension.
  if (elCameraPreview?.videoWidth && elCameraPreview?.videoHeight) {
    const portraitAspect = Math.min(elCameraPreview.videoWidth, elCameraPreview.videoHeight) /
      Math.max(elCameraPreview.videoWidth, elCameraPreview.videoHeight);
    streamCrop = Math.min(1, portraitAspect / 0.75);

    // Account for the additional center crop made by object-fit: cover.
    const coverScale = Math.max(
      elCameraPreview.clientWidth / elCameraPreview.videoWidth,
      elCameraPreview.clientHeight / elCameraPreview.videoHeight
    );
    const visibleWidthFraction = (elCameraPreview.clientWidth / coverScale) /
      elCameraPreview.videoWidth;
    if (Number.isFinite(visibleWidthFraction)) displayCrop = Math.min(1, visibleWidthFraction);
  }

  return calculateVisibleFov(
    lens.portraitFov,
    streamCrop,
    displayCrop,
    state.cameraZoom || 1,
    state.cameraFovScale || 1
  );
}

function drawCameraView() {
  if (!elCameraCanvas || !ctxCamera) return;
  
  const width = elCameraCanvas.width / (window.devicePixelRatio || 1);
  const height = elCameraCanvas.height / (window.devicePixelRatio || 1);
  const cx = width / 2;
  const cy = height / 2;
  
  ctxCamera.clearRect(0, 0, width, height);
  
  const activeTargets = state.savedPlaces.filter(t => t.active);
  const primaryTarget = activeTargets.find(t => t.id === state.primaryTargetId);
  
  const FOV = getVisibleCameraFov();
  if (elCameraFovStatus) elCameraFovStatus.textContent = `VISIBLE FOV: ${FOV.toFixed(1)}°`;
  
  if (state.currentPos) {
    const lat1 = state.currentPos.latitude;
    const lon1 = state.currentPos.longitude;
    
    activeTargets.forEach(target => {
      const isPrimary = primaryTarget && target.id === primaryTarget.id;
      const distance = calculateDistance(lat1, lon1, target.lat, target.lng);
      const bearing = calculateBearing(lat1, lon1, target.lat, target.lng);
      
      // Calculate relative bearing wrapped to [-180, 180]
      let relAngle = bearing - state.smoothedHeading - state.cameraCenterOffset;
      while (relAngle < -180) relAngle += 360;
      while (relAngle > 180) relAngle -= 360;
      
      const inFOV = Math.abs(relAngle) <= FOV / 2;
      
      if (inFOV) {
        // Perspective projection onto the camera plane.
        const x = cx + Math.tan(relAngle * Math.PI / 180) /
          Math.tan(FOV * Math.PI / 360) * cx;
        
        // Vertical placement: higher for farther objects, lower for closer objects
        const maxDistEffect = 10000; // 10 km
        const distRatio = Math.min(distance / maxDistEffect, 1);
        const y = cy - 30 - (distRatio - 0.5) * 60;
        
        ctxCamera.save();
        
        // Glow effect
        ctxCamera.shadowColor = isPrimary ? "rgba(6, 182, 212, 0.8)" : "rgba(59, 130, 246, 0.6)";
        ctxCamera.shadowBlur = 8;
        
        // 1. Dotted height guideline to ground
        ctxCamera.strokeStyle = isPrimary ? "rgba(6, 182, 212, 0.4)" : "rgba(59, 130, 246, 0.25)";
        ctxCamera.lineWidth = isPrimary ? 2 : 1;
        ctxCamera.setLineDash([4, 4]);
        ctxCamera.beginPath();
        ctxCamera.moveTo(x, y + 10);
        ctxCamera.lineTo(x, height);
        ctxCamera.stroke();
        ctxCamera.setLineDash([]);
        
        // 2. Target Diamond pin
        ctxCamera.fillStyle = isPrimary ? "#06b6d4" : "#3b82f6";
        ctxCamera.beginPath();
        ctxCamera.moveTo(x, y - 10);
        ctxCamera.lineTo(x - 8, y);
        ctxCamera.lineTo(x, y + 10);
        ctxCamera.lineTo(x + 8, y);
        ctxCamera.closePath();
        ctxCamera.fill();
        
        ctxCamera.fillStyle = "#ffffff";
        ctxCamera.beginPath();
        ctxCamera.arc(x, y, 3, 0, Math.PI * 2);
        ctxCamera.fill();
        
        // 3. Label tag box
        const label = target.name.split(",")[0];
        const distLabel = formatDistance(distance);
        const text = `${label} (${distLabel})`;
        
        ctxCamera.font = isPrimary ? "bold 11px 'Inter', sans-serif" : "10px 'Inter', sans-serif";
        const textWidth = ctxCamera.measureText(text).width;
        const boxWidth = textWidth + 16;
        const boxHeight = 22;
        const boxX = x - boxWidth / 2;
        const boxY = y - 36;
        
        ctxCamera.fillStyle = isPrimary ? "rgba(15, 23, 42, 0.85)" : "rgba(15, 23, 42, 0.75)";
        ctxCamera.strokeStyle = isPrimary ? "#06b6d4" : "rgba(59, 130, 246, 0.5)";
        ctxCamera.lineWidth = 1;
        
        drawRoundedRect(ctxCamera, boxX, boxY, boxWidth, boxHeight, 6);
        ctxCamera.fill();
        ctxCamera.stroke();
        
        ctxCamera.fillStyle = "#ffffff";
        ctxCamera.textAlign = "center";
        ctxCamera.textBaseline = "middle";
        ctxCamera.fillText(text, x, boxY + boxHeight / 2);
        
        ctxCamera.restore();
      } else if (isPrimary) {
        // Draw off-screen helper arrow for primary target
        ctxCamera.save();
        
        const isRight = relAngle > 0;
        const arrowX = isRight ? width - 30 : 30;
        const arrowY = cy;
        
        ctxCamera.shadowColor = "rgba(6, 182, 212, 0.8)";
        ctxCamera.shadowBlur = 10;
        ctxCamera.fillStyle = "#06b6d4";
        
        ctxCamera.translate(arrowX, arrowY);
        if (!isRight) {
          ctxCamera.rotate(Math.PI);
        }
        
        ctxCamera.beginPath();
        ctxCamera.moveTo(10, 0);
        ctxCamera.lineTo(-6, -10);
        ctxCamera.lineTo(-2, 0);
        ctxCamera.lineTo(-6, 10);
        ctxCamera.closePath();
        ctxCamera.fill();
        
        ctxCamera.restore();
        
        // Add directions text label
        ctxCamera.save();
        ctxCamera.fillStyle = "#ffffff";
        ctxCamera.font = "bold 11px 'Orbitron', sans-serif";
        ctxCamera.textAlign = isRight ? "right" : "left";
        ctxCamera.textBaseline = "middle";
        
        const turnAngle = Math.round(Math.abs(relAngle));
        const directionText = isRight ? `TURN RIGHT ${turnAngle}°` : `TURN LEFT ${turnAngle}°`;
        const textX = isRight ? width - 50 : 50;
        
        ctxCamera.shadowColor = "rgba(0, 0, 0, 0.5)";
        ctxCamera.shadowBlur = 4;
        ctxCamera.fillText(directionText, textX, cy - 20);
        
        ctxCamera.font = "10px 'Inter', sans-serif";
        ctxCamera.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctxCamera.fillText(target.name.split(",")[0], textX, cy + 20);
        
        ctxCamera.restore();
      }
    });
  }
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// --------------------------------------------------------------------------
// 10. Startup Initialization sequence
// --------------------------------------------------------------------------

function init() {
  // Load local settings/bookmarks
  loadState();
  
  // Render initially loaded lists
  renderSavedPlacesList();
  
  // Initialize Geolocation listener
  initGPS();
  
  // Initialize Orientation / Compass listener
  initCompass();
  
  // Initialize Compass Tuning & Calibration Controls
  initCompassTuning();
  
  // Bind camera retry button
  if (elCameraRetryBtn) {
    elCameraRetryBtn.onclick = () => {
      startCamera();
    };
  }
  
  // Register PWA service worker if supported
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js")
        .then(reg => console.log("[PWA] Service Worker registered successfully:", reg.scope))
        .catch(err => console.error("[PWA] Service Worker registration failed:", err));
    });
  }
}

// --------------------------------------------------------------------------
// 11. Compass Calibration & Tuning Systems
// --------------------------------------------------------------------------

function initCompassTuning() {
  if (elOffsetSlider) {
    elOffsetSlider.value = state.headingOffset;
    elOffsetSlider.addEventListener("input", (e) => {
      updateOffset(e.target.value);
    });
  }
  
  if (elOffsetValueDisplay) {
    elOffsetValueDisplay.textContent = (state.headingOffset > 0 ? "+" : "") + state.headingOffset + "°";
  }
  
  if (elOffsetKeepCheckbox) {
    elOffsetKeepCheckbox.checked = state.keepOffset;
    elOffsetKeepCheckbox.addEventListener("change", (e) => {
      state.keepOffset = e.target.checked;
      saveState();
    });
  }
  
  if (elCompassTuneBtn) {
    elCompassTuneBtn.addEventListener("click", toggleTuneDrawer);
  }
  
  if (elCompassStatus) {
    elCompassStatus.addEventListener("click", toggleTuneDrawer);
  }
  
  if (elCloseTuneBtn) {
    elCloseTuneBtn.addEventListener("click", () => {
      elCompassTuneDrawer.classList.add("hidden");
    });
  }
  
  if (elOffsetMinusBtn) {
    elOffsetMinusBtn.addEventListener("click", () => {
      let val = state.headingOffset - 1;
      if (val < -180) val = 180;
      updateOffset(val);
    });
  }
  
  if (elOffsetPlusBtn) {
    elOffsetPlusBtn.addEventListener("click", () => {
      let val = state.headingOffset + 1;
      if (val > 180) val = -180;
      updateOffset(val);
    });
  }
  
  if (elOffsetResetBtn) {
    elOffsetResetBtn.addEventListener("click", () => {
      updateOffset(0);
    });
  }
  
  if (elRequestRecalibrateBtn) {
    elRequestRecalibrateBtn.addEventListener("click", recalibrateCompass);
  }

  initCameraTuning();
  
  // Listen to native compass needs calibration event
  window.addEventListener("compassneedscalibration", (event) => {
    event.preventDefault();
    state.compassStatus = "CALIBRATING";
    updateStatusUI();
    showToast("Compass calibration needed! Wave device in a figure-8 motion.");
  }, true);
}

function populateCameraLensOptions() {
  if (!elCameraLensSelect) return;
  const profile = CAMERA_PROFILES[state.cameraProfile] || CAMERA_PROFILES.generic;
  if (!profile.lenses[state.cameraLens]) state.cameraLens = profile.defaultLens;
  elCameraLensSelect.innerHTML = "";
  Object.entries(profile.lenses).forEach(([id, lens]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = lens.name;
    elCameraLensSelect.appendChild(option);
  });
  elCameraLensSelect.value = state.cameraLens;
}

function updateCameraTuningUI() {
  if (elCameraProfileSelect) elCameraProfileSelect.value = state.cameraProfile;
  if (elCameraFovSlider) elCameraFovSlider.value = Math.round(state.cameraFovScale * 100);
  if (elCameraFovValue) elCameraFovValue.textContent = `${Math.round(state.cameraFovScale * 100)}%`;
  if (elCameraCenterSlider) elCameraCenterSlider.value = state.cameraCenterOffset;
  if (elCameraCenterValue) {
    elCameraCenterValue.textContent = `${state.cameraCenterOffset > 0 ? "+" : ""}${state.cameraCenterOffset}°`;
  }
  if (elCameraZoomSlider) elCameraZoomSlider.value = state.cameraZoom;
  if (elCameraZoomValue) elCameraZoomValue.textContent = `${Number(state.cameraZoom).toFixed(1)}×`;
}

function initCameraTuning() {
  populateCameraLensOptions();
  updateCameraTuningUI();

  elCameraProfileSelect?.addEventListener("change", (event) => {
    state.cameraProfile = event.target.value;
    state.cameraLens = CAMERA_PROFILES[state.cameraProfile].defaultLens;
    populateCameraLensOptions();
    saveState();
  });
  elCameraLensSelect?.addEventListener("change", (event) => {
    state.cameraLens = event.target.value;
    saveState();
  });
  elCameraFovSlider?.addEventListener("input", (event) => {
    state.cameraFovScale = Number(event.target.value) / 100;
    updateCameraTuningUI();
    saveState();
  });
  elCameraCenterSlider?.addEventListener("input", (event) => {
    state.cameraCenterOffset = Number(event.target.value);
    updateCameraTuningUI();
    saveState();
  });
  elCameraZoomSlider?.addEventListener("input", (event) => setCameraZoom(event.target.value));
}

function toggleTuneDrawer() {
  if (elCompassTuneDrawer) {
    elCompassTuneDrawer.classList.toggle("hidden");
  }
}

function updateOffset(val) {
  state.headingOffset = parseInt(val);
  if (elOffsetSlider) {
    elOffsetSlider.value = state.headingOffset;
  }
  if (elOffsetValueDisplay) {
    elOffsetValueDisplay.textContent = (state.headingOffset > 0 ? "+" : "") + state.headingOffset + "°";
  }
  saveState();
}

function recalibrateCompass() {
  // ponytail: Web APIs cannot trigger native system-level magnetometer calibration directly.
  // We restart browser orientation listeners and display instructions to trigger figure-8 calibration.
  // Restart listeners
  window.removeEventListener("deviceorientation", onOrientation, true);
  window.removeEventListener("deviceorientationabsolute", onOrientation, true);
  
  state.compassStatus = "CALIBRATING";
  state.referenceCorrection = null;
  state.headingHistory = null;
  updateStatusUI();
  
  initCompass();
  
  showToast("Compass sensors re-initialized. Wave device in a figure-8 to calibrate.");
}

function showToast(message) {
  const existing = document.getElementById("app-toast");
  if (existing) existing.remove();
  
  const toast = document.createElement("div");
  toast.id = "app-toast";
  toast.className = "toast";
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add("show"), 50);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Kick off initialization
init();
