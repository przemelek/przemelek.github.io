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

const state = {
  currentPos: null,          // { latitude, longitude, accuracy }
  rawHeading: 0,             // Raw sensor compass degrees (0-360)
  smoothedHeading: 0,        // Smoothed compass degrees for drawing
  savedPlaces: [],           // Array of { id, name, lat, lng, active }
  primaryTargetId: null,     // ID of the currently focused target
  gpsStatus: "LOCKING",      // LOCKING, ACTIVE, ERROR
  compassStatus: "OFF",      // OFF, CALIBRATING, ACTIVE, MANUAL
  activeTab: "tab-radar",    // tab-radar, tab-saved, tab-search
  isSimulatorActive: false,  // If manual heading slider is visible
  activeKeys: {},
  canvasDrag: { isDragging: false, startX: 0, startHeading: 0 }
};

// Compass smoothing coefficient (lower = smoother, higher = faster response)
const SMOOTHING_ALPHA = 0.08;

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
    } else {
      // Load presets as initial data
      state.savedPlaces = [...DEFAULT_PRESETS];
      state.primaryTargetId = "p1";
      saveState();
    }
  } catch (err) {
    console.error("Failed to load state from localStorage:", err);
    state.savedPlaces = [...DEFAULT_PRESETS];
    state.primaryTargetId = "p1";
  }
}

function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({
      savedPlaces: state.savedPlaces,
      primaryTargetId: state.primaryTargetId
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

let modalLocationPending = null;

// Initialize Navigation Tabs
elNavButtons.forEach(button => {
  button.addEventListener("click", () => {
    const targetTab = button.getAttribute("data-tab");
    
    // Toggle Nav Buttons
    elNavButtons.forEach(btn => btn.classList.remove("active"));
    button.classList.add("active");
    
    // Toggle Panels
    elTabPanels.forEach(panel => panel.classList.remove("active"));
    const activePanel = document.getElementById(targetTab);
    activePanel.classList.add("active");
    
    state.activeTab = targetTab;
    
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
    elCompassStatus.querySelector(".status-label").textContent = `COMPASS: ON`;
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

// Device Orientation Handling
function onOrientation(event) {
  let heading = null;

  // iOS True North heading
  if (event.webkitCompassHeading !== undefined) {
    heading = event.webkitCompassHeading;
    state.compassStatus = "ACTIVE";
  } 
  // Standard Absolute alpha orientation
  else if (event.absolute === true && event.alpha !== null) {
    heading = (360 - event.alpha) % 360;
    state.compassStatus = "ACTIVE";
  }
  // Standard orientation fallback
  else if (event.alpha !== null) {
    heading = (360 - event.alpha) % 360;
    if (state.compassStatus === "OFF") {
      state.compassStatus = "CALIBRATING";
    }
  }

  if (heading !== null) {
    state.rawHeading = heading;
    updateStatusUI();
  }
}

function initCompass() {
  // Check iOS Webkit Compass Permission Requirements
  const requiresPermission = 
    typeof DeviceOrientationEvent !== 'undefined' && 
    typeof DeviceOrientationEvent.requestPermission === 'function';

  if (requiresPermission) {
    elPermissionBanner.classList.remove("hidden");
    
    elRequestPermissionBtn.onclick = () => {
      DeviceOrientationEvent.requestPermission()
        .then(response => {
          if (response === 'granted') {
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
    }, 1500);
  }
}

function activateManualCompass() {
  state.compassStatus = "MANUAL";
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
window.addEventListener("resize", resizeCanvas);
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
  if (state.activeTab === "tab-radar") {
    // Smooth the compass headings using the Low-Pass Filter
    state.smoothedHeading = smoothAngle(state.smoothedHeading, state.rawHeading, SMOOTHING_ALPHA);
    
    // Clear and draw
    drawRadar();
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

  // Update current heading readout
  const formattedHeading = `${Math.round(state.rawHeading).toString().padStart(3, '0')}°`;
  elHudHeading.textContent = formattedHeading;

  if (primaryTarget && state.currentPos) {
    const lat1 = state.currentPos.latitude;
    const lon1 = state.currentPos.longitude;
    
    const distance = calculateDistance(lat1, lon1, primaryTarget.lat, primaryTarget.lng);
    const bearing = calculateBearing(lat1, lon1, primaryTarget.lat, primaryTarget.lng);
    
    // Relative pointer rotate
    const relativeAngle = (bearing - state.rawHeading + 360) % 360;

    elHudCard.classList.add("active-nav");
    elHudTargetName.textContent = primaryTarget.name.toUpperCase();
    elHudTargetCoords.textContent = `Lat: ${primaryTarget.lat.toFixed(5)}, Lng: ${primaryTarget.lng.toFixed(5)}`;
    
    elHudDistance.textContent = formatDistance(distance);
    elHudBearing.textContent = `${Math.round(bearing).toString().padStart(3, '0')}°`;
    elHudRelativeAngle.textContent = getRelativeDirectionText(bearing, state.rawHeading);
    
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
  
  // Register PWA service worker if supported
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js")
        .then(reg => console.log("[PWA] Service Worker registered successfully:", reg.scope))
        .catch(err => console.error("[PWA] Service Worker registration failed:", err));
    });
  }
}

// Kick off initialization
init();
