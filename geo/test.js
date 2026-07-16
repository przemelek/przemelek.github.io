// Assert-based self-check for smoothAngle, complementary filter, and moving average logic
const assert = require('assert');

function normalizeAngle(angle) {
  return (angle % 360 + 360) % 360;
}

function smoothAngle(current, target, alpha) {
  let diff = target - current;
  while (diff < -180) diff += 360;
  while (diff > 180) diff -= 360;
  return normalizeAngle(current + alpha * diff);
}

// Test 1: normalizeAngle
assert.strictEqual(normalizeAngle(360), 0);
assert.strictEqual(normalizeAngle(-90), 270);
assert.strictEqual(normalizeAngle(450), 90);

// Test 2: smoothAngle basic transition
assert.strictEqual(smoothAngle(10, 20, 0.5), 15);

// Test 3: smoothAngle wrap-around across 0/360 boundary
// transition from 350 to 10 degrees with alpha 0.5 should go clockwise (350 -> 0 -> 10) and yield 0
assert.strictEqual(smoothAngle(350, 10, 0.5), 0);
// transition from 10 to 350 degrees with alpha 0.5 should go counter-clockwise (10 -> 0 -> 350) and yield 0
assert.strictEqual(smoothAngle(10, 350, 0.5), 0);

// Test 4: Complementary filter simulation (flatness weighting)
// If device is flat, k is large (~0.082). If vertical, k is small (~0.002)
let referenceCorrection = null;

function updateFilter(beta, gamma, instantCorrection) {
  const betaRad = beta * Math.PI / 180;
  const gammaRad = gamma * Math.PI / 180;
  const flatness = Math.abs(Math.cos(betaRad) * Math.cos(gammaRad));
  const k = 0.002 + 0.08 * flatness * flatness;
  
  if (referenceCorrection === null) {
    referenceCorrection = normalizeAngle(instantCorrection);
  } else {
    referenceCorrection = smoothAngle(referenceCorrection, instantCorrection, k);
  }
  return k;
}

// 4.1 Initialize filter
updateFilter(0, 0, 45);
assert.strictEqual(referenceCorrection, 45);

// 4.2 Device remains flat, minor correction noise should be smoothed
const kFlat = updateFilter(0, 0, 50); // k = 0.082
assert.ok(kFlat > 0.08);
assert.ok(referenceCorrection > 45 && referenceCorrection < 46); // small update

// 4.3 Device goes vertical (beta = 90). The instantaneous correction jumps to 180 (huge noise).
// The filter weight k should be tiny, meaning the noise is almost completely ignored.
referenceCorrection = 45; // Reset to 45
const kVertical = updateFilter(90, 0, 180); // k = 0.002
assert.ok(kVertical < 0.003);
assert.ok(Math.abs(referenceCorrection - 45) < 0.3); // hardly moved despite 135 deg noise jump!


// Test 5: 15-sample vector moving average simulation
let headingHistory = null;

function processMovingAverage(heading) {
  const rad = heading * Math.PI / 180;
  if (!headingHistory) {
    headingHistory = Array(15).fill({ x: Math.cos(rad), y: Math.sin(rad) });
  } else {
    headingHistory.push({ x: Math.cos(rad), y: Math.sin(rad) });
    if (headingHistory.length > 15) {
      headingHistory.shift();
    }
  }

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < headingHistory.length; i++) {
    sumX += headingHistory[i].x;
    sumY += headingHistory[i].y;
  }
  return normalizeAngle(Math.atan2(sumY, sumX) * 180 / Math.PI);
}

// 5.1 Initialize with 350
let avg = processMovingAverage(350);
assert.strictEqual(Math.round(avg), 350);

// 5.2 Add single sample of 10 degrees. It should smooth wrap-around correctly.
// Since buffer has 14 samples of 350 and 1 sample of 10:
// Diff is +20 degrees (from 350 to 10 clockwise).
// Average should shift slightly clockwise from 350 (i.e. towards 351).
avg = processMovingAverage(10);
assert.ok(avg > 350 && avg < 352);

// 5.3 Verify that wrap-around is handled properly (no massive jump to 180 deg)
assert.ok(Math.abs(avg - 350) < 10);

console.log("All complementary filter, smoothAngle, and vector moving average tests passed successfully!");
