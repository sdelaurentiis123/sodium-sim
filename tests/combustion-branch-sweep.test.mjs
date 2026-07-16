import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SWEEP_CASES,
  branchSweepFailures,
  runBranchCase,
  runCombustionBranchSweep,
  runLocalSourceCase,
} from '../scripts/combustion-branch-sweep.mjs';

test('stable and transient advection-reaction sweep satisfies branch invariants',()=>{
  const results=runCombustionBranchSweep();
  assert.equal(results.length,SWEEP_CASES.length*3);
  assert.deepEqual(branchSweepFailures(results),[]);
});

test('neither branch can release combustion heat without both reactants',()=>{
  const baseline=SWEEP_CASES[0];
  for(const branch of ['stable','transient-hot']){
    const noFuel=runBranchCase(baseline,{branch,fuelEnabled:false,steps:200});
    const noOxidizer=runBranchCase(baseline,{branch,oxidizerEnabled:false,steps:200});
    assert.equal(noFuel.everReactedFraction,0);
    assert.equal(noOxidizer.everReactedFraction,0);
  }
});

test('pressure scales local volumetric power but not ideal-gas source temperature rise',()=>{
  const low=runLocalSourceCase(SWEEP_CASES.find((item)=>item.name==='low-pressure'));
  const high=runLocalSourceCase(SWEEP_CASES.find((item)=>item.name==='high-pressure'));
  assert.ok(high.chemicalPowerDensityWM3>low.chemicalPowerDensityWM3*7.9);
  assert.ok(Math.abs(high.nextTemperatureK-low.nextTemperatureK)<1e-9);
});
