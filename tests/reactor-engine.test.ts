import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DESIGN,
  DEFAULT_PHYSICS,
  materialConductivityWmK,
  optimizeReactor,
  reducedAtomicState,
  simulateReactor,
  sodiumVaporPressurePa,
} from "../app/reactor-engine.ts";

const safeDesign = {
  ...DEFAULT_DESIGN,
  coreRadiusMm: 48,
  coreLengthMm: 190,
  sapphireMm: 6,
  insulationMm: 4,
  sourceRadiusFraction: 0.7,
};

test("NIST sodium vapor-pressure fit is monotonic in its published range", () => {
  const p950 = sodiumVaporPressurePa(950);
  const p1000 = sodiumVaporPressurePa(1000);
  const p1080 = sodiumVaporPressurePa(1080);
  assert.ok(p950 > 0);
  assert.ok(p950 < p1000 && p1000 < p1080);
});

test("material closures remain positive and sapphire conducts better than insulation", () => {
  for (const temperature of [300, 1000, 2000]) {
    assert.ok(materialConductivityWmK(0, temperature) > 0);
    assert.ok(materialConductivityWmK(1, temperature) > materialConductivityWmK(2, temperature));
  }
});

test("neutral sodium density is derived from vapor pressure and activity", () => {
  const low = reducedAtomicState(safeDesign, DEFAULT_PHYSICS, 1800);
  const high = reducedAtomicState(safeDesign, { ...DEFAULT_PHYSICS, sodiumActivity: 2 * DEFAULT_PHYSICS.sodiumActivity }, 1800);
  assert.ok(Math.abs(high.sodiumDensityCm3 / low.sodiumDensityCm3 - 2) < 1e-12);
  assert.ok(high.opticalDepthD2 > low.opticalDepthD2);
});

test("coupled reactor closes energy and resolves all three material regions", () => {
  const result = simulateReactor(safeDesign, DEFAULT_PHYSICS, "coarse");
  assert.ok(Math.abs(result.energyResidualKW) < 0.02 * result.physics.fuelPowerKW);
  assert.ok(result.grid.materials.includes(0));
  assert.ok(result.grid.materials.includes(1));
  assert.ok(result.grid.materials.includes(2));
  assert.ok(result.maximumGasTemperatureK >= result.maximumSapphireTemperatureK);
  assert.ok(result.atomic.acceptedPumpKW <= result.physics.fuelPowerKW * result.physics.excitationFraction + 1e-9);
  assert.ok(result.electricPowerKW <= result.pvIncidentKW);
});

test("optimizer returns a thermally feasible, derated robust design", () => {
  const optimized = optimizeReactor(DEFAULT_PHYSICS, 3);
  assert.ok(optimized.best.feasible);
  assert.ok(optimized.best.electricPowerKW > 0);
  assert.ok(optimized.robustWorstCaseKW > 0);
  assert.ok(optimized.ratedFuelPowerKW <= DEFAULT_PHYSICS.fuelPowerKW);
  assert.equal(optimized.best.transportValidation?.packetResidual, 0);
  assert.ok((optimized.best.transportValidation?.monteCarloEscapeFactor ?? 0) > 0);
});
