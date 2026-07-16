import assert from "node:assert/strict";
import test from "node:test";
import {
  atomicLineStates,
  gasDensities,
  nonEquilibriumPopulation,
  simulateAtomicTransport,
  voigtH,
  type AtomicInputs,
} from "../app/sodium-atomic-engine.ts";

const base: AtomicInputs = {
  temperatureK: 1500,
  sodiumMixingPpm: 100,
  bufferPressureTorr: 3,
  radiusMm: 12,
  lengthMm: 40,
  quenchCoefficientCm3s: 1e-11,
  pumpRateS: 1e8,
  sourceRadiusFraction: 0.35,
};

test("Humlicek Voigt agrees with Faddeeva reference values", () => {
  const references = [
    [0.03, 0, 0.9670287119698763],
    [0.03, 1, 0.3701371219647628],
    [0.03, 15, 0.00007573213261091712],
    [0.16, 0.5, 0.6842037425840191],
    [0.5, 8, 0.0044967053700597686],
    [2, 3, 0.09271076642644341],
  ];
  for (const [a, x, expected] of references)
    assert.ok(Math.abs(voigtH(a, x) / expected - 1) < 1e-4, `a=${a}, x=${x}`);
});

test("gas composition determines sodium and buffer densities", () => {
  const low = gasDensities(base);
  const doublePressure = gasDensities({ ...base, bufferPressureTorr: 6 });
  const doubleMixing = gasDensities({ ...base, sodiumMixingPpm: 200 });
  assert.ok(Math.abs(doublePressure.bufferDensityCm3 / low.bufferDensityCm3 - 2) < 1e-12);
  assert.ok(Math.abs(doubleMixing.sodiumDensityCm3 / low.sodiumDensityCm3 - 2) < 1e-12);
});

test("hyperfine aggregate preserves the D2 to D1 opacity hierarchy", () => {
  const [d2, d1] = atomicLineStates(base);
  assert.ok(d2.radialOpticalDepth / d1.radialOpticalDepth > 1.9);
  assert.ok(d2.radialOpticalDepth / d1.radialOpticalDepth < 2.2);
  assert.equal(d2.components.reduce((sum, component) => sum + component.strength, 0), 1);
  assert.equal(d1.components.reduce((sum, component) => sum + component.strength, 0), 1);
});

test("3D transport conserves packets and identifies both boundaries", () => {
  const result = simulateAtomicTransport(base, 1200, 91);
  assert.equal(result.escaped + result.quenched + result.truncated, 1200);
  assert.equal(result.radialEscapes + result.axialEscapes, result.escaped);
  assert.ok(result.radialEscapes > 0);
  assert.ok(result.axialEscapes > 0);
  assert.ok(result.escapeProbabilityPerEmission > 0 && result.escapeProbabilityPerEmission < 1);
});

test("quenching is derived from a rate coefficient and gas density", () => {
  const low = simulateAtomicTransport({ ...base, quenchCoefficientCm3s: 1e-13 }, 800, 33);
  const high = simulateAtomicTransport({ ...base, quenchCoefficientCm3s: 1e-10 }, 800, 33);
  assert.ok(high.quenchRateS > low.quenchRateS * 900);
  assert.ok(high.ultimateEscapeFraction < low.ultimateEscapeFraction);
});

test("non-equilibrium rate balance closes and exceeds Boltzmann when pumped", () => {
  const result = simulateAtomicTransport(base, 1200, 1904);
  const population = nonEquilibriumPopulation(base, result);
  assert.ok(Math.abs(population.pumpPowerKW - population.linePowerKW - population.quenchPowerKW) < 1e-12);
  assert.ok(population.upperFraction > population.boltzmannUpperFraction);
  assert.ok(population.enhancement > 1);
});
