import assert from "node:assert/strict";
import test from "node:test";
import { distanceToCircle, lineOpacity, PHOTONS, simulate } from "../app/transport.ts";

test("center-to-wall distance is one normalized radius", () => {
  assert.equal(distanceToCircle({ x: 0, y: 0 }, 1, 0), 1);
  assert.equal(distanceToCircle({ x: 0, y: 0 }, 0, -1), 1);
});

test("line opacity is normalized at resonance and falls in the wings", () => {
  assert.ok(Math.abs(lineOpacity(0, 0.12) - 1) < 1e-12);
  assert.ok(lineOpacity(4, 0.12) < lineOpacity(1, 0.12));
});

test("every photon packet is accounted for", () => {
  const result = simulate(28, 0.12, 0.005, 12, 1904);
  assert.equal(result.escaped + result.quenched, PHOTONS);
  assert.ok(result.escapeFactor > 0 && result.escapeFactor <= 1);
  assert.ok(result.meanDelay >= 0);
});

test("greater optical depth increases trapping", () => {
  const thin = simulate(0.8, 0.08, 0, 12, 42);
  const medium = simulate(12, 0.08, 0, 12, 42);
  const thick = simulate(80, 0.08, 0, 12, 42);
  assert.ok(thin.meanScatters < medium.meanScatters);
  assert.ok(medium.meanScatters < thick.meanScatters);
  assert.ok(thin.escapeFactor > medium.escapeFactor);
  assert.ok(medium.escapeFactor > thick.escapeFactor);
});

test("thick Doppler transport follows the Holstein asymptotic trend", () => {
  for (const tau of [30, 100]) {
    const result = simulate(tau, 0, 0, 12, 123);
    const asymptotic = 1 / (tau * Math.sqrt(Math.log(tau)));
    const ratio = result.escapeFactor / asymptotic;
    assert.ok(ratio > 0.65 && ratio < 1.5, `tau=${tau}, ratio=${ratio}`);
  }
});

test("quenching converts trapped photons from escape to loss", () => {
  const lossless = simulate(45, 0.15, 0, 12, 73);
  const quenched = simulate(45, 0.15, 0.08, 12, 73);
  assert.equal(lossless.escaped, PHOTONS);
  assert.ok(quenched.escaped < lossless.escaped);
  assert.ok(quenched.quenched > 0);
});
