import assert from "node:assert/strict";
import test from "node:test";
import { engineBalance } from "../app/engine-balance.ts";

const base = {
  fuel: 10,
  recup: 0.9,
  stackShare: 0.28,
  shell: 0.06,
  visT: 0.9,
  irR: 0.9,
  survival: 0.9,
  leak: 0.05,
  gap: 1.85,
  quality: 0.75,
};
const atomic = { photonEV: 2.1043, linePowerKW: 9.5, pumpPowerKW: 10.1 };

test("coupled engine closes its fuel-energy ledger", () => {
  const result = engineBalance(base, atomic);
  assert.ok(Math.abs(result.residual) < 1e-12);
  assert.ok(result.efficiency > 0 && result.efficiency < 1);
  for (const key of ["electric", "cell", "optical", "cavity", "shell", "stack"])
    assert.ok(result[key] >= 0, `${key} is non-negative`);
});

test("ledger components match independently computed physics, not just the sum", () => {
  // The residual closes by construction, so anchor each mechanism to values
  // recomputed here from the raw inputs.
  const result = engineBalance(base, atomic);
  assert.ok(Math.abs(result.pvEta - 0.75 * 1.85 / 2.1043) < 1e-12);
  assert.ok(Math.abs(result.radiativeYield - 9.5 / 10.1) < 1e-12);
  const hot = 10 * (1 - 0.06 - 0.28 * (1 - 0.9));
  assert.ok(Math.abs(result.hot - hot) < 1e-12);
  assert.ok(Math.abs(result.shell - 10 * 0.06) < 1e-12);
  assert.ok(Math.abs(result.stack - 10 * 0.28 * (1 - 0.9)) < 1e-12);
  // With survival = 0 nothing recycles: gain must be exactly 1 and electric
  // output must equal the closed-form single-pass value.
  const single = engineBalance({ ...base, survival: 0 }, atomic);
  assert.ok(Math.abs(single.gain - 1) < 1e-12);
  const lineFraction = (9.5 / 10.1) * Math.min(1, 10.1 / hot);
  const singleElectric = hot * lineFraction * (1 - 0.05) * 0.9 * (0.75 * 1.85 / 2.1043);
  assert.ok(Math.abs(single.electric / singleElectric - 1) < 1e-12);
  // Recycling can only help: the recycled cavity must beat single-pass.
  assert.ok(result.gain > 1);
  assert.ok(result.electric > single.electric);
});

test("randomized physical controls remain conservative", () => {
  let state = 712367821;
  const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 500; i++) {
    const input = {
      fuel: 1 + 29 * random(), recup: 0.97 * random(), stackShare: 0.05 + 0.45 * random(),
      shell: 0.01 + 0.24 * random(), visT: 0.5 + 0.49 * random(), irR: 0.5 + 0.495 * random(),
      survival: 0.7 + 0.295 * random(), leak: 0.2 * random(), gap: 1.2 + random(),
      quality: 0.4 + 0.55 * random(),
    };
    const atom = { photonEV: 2.1043, linePowerKW: 20 * random(), pumpPowerKW: 0.1 + 30 * random() };
    assert.ok(Math.abs(engineBalance(input, atom).residual) < 1e-9);
  }
});

test("recuperation helps and above-line bandgaps reject sodium photons", () => {
  const cold = engineBalance({ ...base, recup: 0.1 }, atomic);
  const hot = engineBalance({ ...base, recup: 0.9 }, atomic);
  const rejected = engineBalance({ ...base, gap: 2.2 }, atomic);
  assert.ok(hot.electric > cold.electric);
  assert.equal(rejected.electric, 0);
});

test("atomic radiative yield, not a free slider, controls line share", () => {
  const efficient = engineBalance(base, { photonEV: 2.1043, linePowerKW: 9, pumpPowerKW: 10 });
  const quenched = engineBalance(base, { photonEV: 2.1043, linePowerKW: 1, pumpPowerKW: 10 });
  assert.ok(efficient.lineFraction > quenched.lineFraction);
  assert.ok(efficient.electric > quenched.electric);
});
