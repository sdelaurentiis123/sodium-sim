import assert from "node:assert/strict";
import test from "node:test";
import { lineStates, simulatePhysical } from "../app/sodium-transport.ts";

const base = {
  temperatureK: 1500,
  sodiumDensityCm3: 1e12,
  argonPressureTorr: 3,
  radiusMm: 12,
  quenchProbability: 0.003,
};

test("D2 is approximately twice as optically thick as D1", () => {
  const [d2, d1] = lineStates(base);
  assert.ok(d2.opticalDepth / d1.opticalDepth > 1.9);
  assert.ok(d2.opticalDepth / d1.opticalDepth < 2.1);
});

test("optical depth scales linearly with sodium density and radius", () => {
  const tau = lineStates(base)[0].opticalDepth;
  const dense = lineStates({ ...base, sodiumDensityCm3: 2e12 })[0].opticalDepth;
  const wide = lineStates({ ...base, radiusMm: 24 })[0].opticalDepth;
  assert.ok(Math.abs(dense / tau - 2) < 1e-12);
  assert.ok(Math.abs(wide / tau - 2) < 1e-12);
});

test("Doppler width scales as square root of temperature", () => {
  const low = lineStates(base)[0].dopplerWidthHz;
  const high = lineStates({ ...base, temperatureK: 3000 })[0].dopplerWidthHz;
  assert.ok(Math.abs(high / low - Math.sqrt(2)) < 1e-12);
});

test("argon pressure increases Lorentz width", () => {
  const low = lineStates({ ...base, argonPressureTorr: 0 })[0];
  const high = lineStates({ ...base, argonPressureTorr: 20 })[0];
  assert.ok(high.lorentzHwhmHz > low.lorentzHwhmHz);
});

test("physical doublet Monte Carlo conserves photon packets", () => {
  const result = simulatePhysical(base, 800, 77);
  assert.equal(result.escaped + result.quenched + result.truncated, 800);
  assert.ok(result.wavelengthsNm.some((value) => value < 589.2));
  assert.ok(result.wavelengthsNm.some((value) => value > 589.3));
});
