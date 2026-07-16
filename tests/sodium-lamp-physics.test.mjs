import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSTANTS,
  coupledExcitationResidenceTime,
  checkRateBalance,
  departureCoefficient,
  erfcxPositive,
  excitationTemperatureK,
  fineStructureRateBalance,
  lineModeDensity,
  lteFineStructureFractions,
  opticalDepths,
  opticalBoundary,
  p1BoundaryLeakageSpeed,
  photonRecyclingEstimate,
  reducedNonLteState,
  neutralSodiumFraction,
  speciesResolvedQuench,
  slabEscapeProbability,
  hydrogenNozzleState,
  oxidizerCoflowState,
  annularReturnState,
  openAirHydrogenFlameLength,
  flameCellAssessment,
  normalizedVoigtApproxHz,
  resolvedSodiumSpectrum,
  canteraOperatingReference,
  coaxialShearRateProxy,
  sapphireThermalAssessment,
  burnerLipFlameHolderActivity,
  reducedBurnerCellStep,
} from '../sodium-lamp/physics.js';

test('metered hydrogen flow produces conservative nozzle and LHV diagnostics', () => {
  const base=hydrogenNozzleState({flowSLPM:56,nozzleDiameterM:.004,pressurePa:1.4e5,temperatureK:320});
  const narrow=hydrogenNozzleState({flowSLPM:56,nozzleDiameterM:.002,pressurePa:1.4e5,temperatureK:320});
  const doubled=hydrogenNozzleState({flowSLPM:112,nozzleDiameterM:.004,pressurePa:1.4e5,temperatureK:320});
  assert.ok(base.velocityMS > 40 && base.velocityMS < 70);
  assert.ok(base.reynolds > 1000 && base.reynolds < 10000);
  assert.ok(base.mach < .1);
  assert.ok(base.lowerHeatingValueW > 9900 && base.lowerHeatingValueW < 10300);
  assert.ok(Math.abs(narrow.velocityMS/base.velocityMS-4) < 1e-12);
  assert.ok(Math.abs(doubled.reynolds/base.reynolds-2) < 1e-12);
});

test('coflow and open-air comparison respond monotonically to build inputs', () => {
  const a=oxidizerCoflowState({flowSLPM:74,coreRadiusM:.020,nozzleDiameterM:.004,oxidizerOuterDiameterM:.008,pressurePa:1.4e5});
  const b=oxidizerCoflowState({flowSLPM:148,coreRadiusM:.020,nozzleDiameterM:.004,oxidizerOuterDiameterM:.008,pressurePa:1.4e5});
  const wide=oxidizerCoflowState({flowSLPM:74,coreRadiusM:.020,nozzleDiameterM:.004,oxidizerOuterDiameterM:.016,pressurePa:1.4e5});
  const nozzle=hydrogenNozzleState({flowSLPM:56,nozzleDiameterM:.004,pressurePa:1.4e5});
  const free=openAirHydrogenFlameLength({massFlowKgS:nozzle.massFlowKgS,nozzleDiameterM:.004});
  assert.ok(a.velocityMS > 20 && a.velocityMS < 35);
  assert.ok(Math.abs(b.velocityMS/a.velocityMS-2) < 1e-12);
  assert.ok(wide.velocityMS < a.velocityMS);
  assert.ok(Math.abs(a.annularAreaM2-Math.PI*(.008**2-.004**2)/4) < 1e-16);
  assert.ok(free > .1 && free > .105);
});

test('return-annulus velocity is derived from metered volume and both sapphire walls', () => {
  const fuel=hydrogenNozzleState({flowSLPM:56,nozzleDiameterM:.004,pressurePa:1.4e5});
  const oxidizer=oxidizerCoflowState({flowSLPM:74,coreRadiusM:.020,nozzleDiameterM:.004,oxidizerOuterDiameterM:.008,pressurePa:1.4e5});
  const state=annularReturnState({fuelActualVolumeM3s:fuel.actualVolumeM3s,oxidizerActualVolumeM3s:oxidizer.actualVolumeM3s,coreRadiusM:.020,wallThicknessM:.003,outerRadiusM:.038});
  assert.ok(state.velocityMS > .7 && state.velocityMS < 1);
  assert.ok(Math.abs(state.actualVolumeM3s-state.areaM2*state.velocityMS) < 1e-15);
  assert.ok(Math.abs(state.innerRadiusM-.023) < 1e-15);
  assert.ok(Math.abs(state.outerGasRadiusM-.035) < 1e-15);
});

test('flame confinement assessment reports geometry and material limits without inventing risk probability', () => {
  const confined=flameCellAssessment({nozzleVelocityMS:50,reynolds:2500,mach:.04,flameBaseM:.006,flameTipM:.085,flameRadiusM:.012,coreRadiusM:.020,cellLengthM:.099,maxReaction:.8,wallTemperatureK:1400});
  const impinging=flameCellAssessment({nozzleVelocityMS:50,reynolds:2500,mach:.04,flameBaseM:.006,flameTipM:.099,flameRadiusM:.0195,coreRadiusM:.020,cellLengthM:.099,maxReaction:.8,wallTemperatureK:1400});
  assert.equal(confined.state,'CONFINED');
  assert.ok(Math.abs(confined.flameLengthM-.079) < 1e-12);
  assert.ok(Math.abs(confined.wallClearanceM-.008) < 1e-12);
  assert.equal(impinging.state,'IMPINGEMENT PROXY');
});

test('species-resolved quenching reacts to composition, pressure, and uncertainty', () => {
  const h2 = speciesResolvedQuench({temperatureK:1800,pressurePa:1.4e5,composition:{H2:1},scale:1});
  const n2 = speciesResolvedQuench({temperatureK:1800,pressurePa:1.4e5,composition:{N2:1},scale:1});
  const high = speciesResolvedQuench({temperatureK:1800,pressurePa:2.8e5,composition:{H2:1},scale:2});
  assert.ok(h2.rateS > 10 * n2.rateS);
  assert.ok(Math.abs(high.rateS / h2.rateS - 4) < 1e-12);
  assert.ok(h2.rateS > CONSTANTS.lines.D2.A);
});

test('neutral sodium closure conserves inventory and responds to temperature and rich gas', () => {
  const cold = neutralSodiumFraction({temperatureK:700,equivalenceRatio:1,salt:'NaCl'});
  const hotLean = neutralSodiumFraction({temperatureK:1700,equivalenceRatio:.5,salt:'NaCl'});
  const hotRich = neutralSodiumFraction({temperatureK:1700,equivalenceRatio:1.3,salt:'NaCl'});
  assert.ok(cold >= 0 && hotRich <= 1);
  assert.ok(hotLean > cold);
  assert.ok(hotRich > hotLean);
});

test('optical boundary closes probability and coupled residence includes excited atoms', () => {
  const boundary = opticalBoundary({lineReflectance:.08,pvAbsorptance:.84});
  assert.ok(Math.abs(boundary.reflectance + boundary.pvAbsorptance + boundary.parasiticAbsorptance - 1) < 1e-14);
  assert.ok(Math.abs(p1BoundaryLeakageSpeed(0) / CONSTANTS.c - .5) < 1e-14);
  assert.ok(p1BoundaryLeakageSpeed(.9) < p1BoundaryLeakageSpeed(.1));
  assert.ok(p1BoundaryLeakageSpeed(.999999) < 1e3);
  const photonOnly = coupledExcitationResidenceTime({photonCount:10,excitedAtomCount:0,escapeRateS:5});
  const coupled = coupledExcitationResidenceTime({photonCount:10,excitedAtomCount:90,escapeRateS:5});
  assert.equal(photonOnly, 2);
  assert.equal(coupled, 20);
});

test('detached LTE diagnostic has the correct sodium excitation scale and D2 degeneracy', () => {
  const low = lteFineStructureFractions(1000);
  const flame = lteFineStructureFractions(2000);
  assert.ok(low.total > 1e-12 && low.total < 1e-9);
  assert.ok(flame.total > 1e-6 && flame.total < 1e-4);
  assert.ok(flame.total > low.total);
  assert.ok(flame.D2 / flame.D1 > 1.9 && flame.D2 / flame.D1 < 2.1);
  assert.ok(Math.abs(flame.lower + flame.D1 + flame.D2 - 1) < 1e-14);
});

test('D1 and D2 mode densities and pressure broadening are positive', () => {
  for (const line of Object.values(CONSTANTS.lines)) {
    const a = lineModeDensity(1800, 1e5, line);
    const b = lineModeDensity(1800, 5e5, line);
    assert.ok(a.nu > 5e14 && a.nu < 5.2e14);
    assert.ok(a.width > 0 && a.modesPerM3 > 0);
    assert.ok(b.width > a.width);
  }
});

test('Voigt-center helper recovers Gaussian and Lorentz asymptotes', () => {
  assert.ok(Math.abs(erfcxPositive(0) - 1) < 2e-7);
  const x = 20;
  assert.ok(Math.abs(erfcxPositive(x) * Math.sqrt(Math.PI) * x - 1) < 0.01);
});

test('radiation drives both fine-structure levels without changing the diagnostic reference', () => {
  const T = 1800, pressurePa = 1.4e5;
  const m1 = lineModeDensity(T, pressurePa, CONSTANTS.lines.D1).modesPerM3;
  const m2 = lineModeDensity(T, pressurePa, CONSTANTS.lines.D2).modesPerM3;
  const dark = fineStructureRateBalance({temperatureK:T,pressurePa,upperD1:3e-6,upperD2:6e-6,photonDensityD1:0,photonDensityD2:0,reaction:0,pumpMax:0,quenchCoefficient:1e-16});
  const bright = fineStructureRateBalance({temperatureK:T,pressurePa,upperD1:3e-6,upperD2:6e-6,photonDensityD1:m1*.1,photonDensityD2:m2*.1,reaction:0,pumpMax:0,quenchCoefficient:1e-16});
  assert.equal(dark.absorption, 0);
  assert.ok(bright.perLine.D1.absorption > bright.perLine.D1.spontaneous);
  assert.ok(bright.perLine.D2.absorption > bright.perLine.D2.spontaneous);
  assert.deepEqual(bright.lte, dark.lte);
});

test('fine-structure steady state closes the explicit non-LTE rate equation', () => {
  const T=1900, pressurePa=1.4e5, reaction=.7, pumpMax=2e7, quenchCoefficient=1e-16, occ1=.02, occ2=.04;
  const q=quenchCoefficient*pressurePa/(CONSTANTS.kB*T);
  const r1=(pumpMax*reaction/3+CONSTANTS.lines.D1.degeneracyRatio*CONSTANTS.lines.D1.A*occ1)/(CONSTANTS.lines.D1.A*(1+occ1)+q);
  const r2=(2*pumpMax*reaction/3+CONSTANTS.lines.D2.degeneracyRatio*CONSTANTS.lines.D2.A*occ2)/(CONSTANTS.lines.D2.A*(1+occ2)+q);
  const lower=1/(1+r1+r2), upperD1=r1*lower, upperD2=r2*lower;
  const rates=fineStructureRateBalance({temperatureK:T,pressurePa,upperD1,upperD2,photonDensityD1:lineModeDensity(T,pressurePa,CONSTANTS.lines.D1).modesPerM3*occ1,photonDensityD2:lineModeDensity(T,pressurePa,CONSTANTS.lines.D2).modesPerM3*occ2,reaction,pumpMax,quenchCoefficient});
  assert.ok(checkRateBalance(rates).relativeResidual < 1e-12);
  assert.ok(Math.abs(rates.lower + upperD1 + upperD2 - 1) < 1e-14);
});

test('optical depth scales with sodium and D2 is thicker than D1', () => {
  const base=opticalDepths({temperatureK:1700,pressurePa:1.4e5,sodiumMixingFraction:80e-6,pathLengthM:.038});
  const doubled=opticalDepths({temperatureK:1700,pressurePa:1.4e5,sodiumMixingFraction:160e-6,pathLengthM:.038});
  assert.ok(base.D2 > base.D1);
  assert.ok(Math.abs(doubled.D2/base.D2-2) < 1e-12);
});

test('trapping raises the solved population without creating an LTE closure', () => {
  const common={temperatureK:1500,pressurePa:1.4e5,pumpRate:2e7,reaction:.8,quenchCoefficient:1e-16};
  const thin=reducedNonLteState({...common,opticalDepthD1:.01,opticalDepthD2:.02});
  const thick=reducedNonLteState({...common,opticalDepthD1:500,opticalDepthD2:1000});
  assert.ok(thick.total > thin.total);
  assert.ok(thick.departure > thin.departure);
  assert.equal(thick.departure, departureCoefficient(common.temperatureK, thick.total));
  assert.ok(excitationTemperatureK(thick.total) > common.temperatureK);
});

test('escape and recycling estimates remain bounded and respond to optical depth', () => {
  assert.ok(slabEscapeProbability(100) < slabEscapeProbability(.1));
  const thin=photonRecyclingEstimate({opticalDepthD1:.1,opticalDepthD2:.2,pressurePa:1e5,temperatureK:1800,quenchCoefficient:1e-16});
  const thick=photonRecyclingEstimate({opticalDepthD1:100,opticalDepthD2:200,pressurePa:1e5,temperatureK:1800,quenchCoefficient:1e-16});
  assert.ok(thick.meanReabsorptions > thin.meanReabsorptions);
  assert.ok(thick.trappedLifetimeS > thin.trappedLifetimeS);
  assert.ok(thick.beta > 0 && thick.beta < 1);
});

test('generated Cantera table interpolates physical operating references', () => {
  const air=canteraOperatingReference({equivalenceRatio:1,oxygenFraction:.21,pressureBar:1.4});
  const enriched=canteraOperatingReference({equivalenceRatio:1,oxygenFraction:.38,pressureBar:1.4});
  assert.ok(air.operating.adiabatic_temperature_k > 2300);
  assert.ok(enriched.operating.adiabatic_temperature_k > air.operating.adiabatic_temperature_k);
  assert.ok(enriched.freeFlame.laminar_flame_speed_m_s > air.freeFlame.laminar_flame_speed_m_s);
  assert.ok(enriched.operating.na_o_o_partial_pump_rate_per_na_s > 0);
});

test('resolved line profile is normalized and a cool sodium shell self-reverses D2', () => {
  const line=CONSTANTS.lines.D2,T=1800,p=1.4e5;
  const mode=lineModeDensity(T,p,line);
  const width=30*mode.width;
  const points=20001,step=2*width/(points-1);
  let integral=0;
  for(let index=0;index<points;index++){
    const offset=-width+index*step;
    const weight=(index===0||index===points-1) ? .5 : 1;
    integral+=weight*normalizedVoigtApproxHz(offset,T,p,line)*step;
  }
  assert.ok(integral > .95 && integral < 1.01);

  const spectrum=resolvedSodiumSpectrum({
    pressurePa:p,
    core:{temperatureK:2200,sodiumMixingFraction:80e-6,upperD1:2e-4,upperD2:4e-4,pathLengthM:.02},
    shell:{temperatureK:1000,sodiumMixingFraction:80e-6,upperD1:1e-12,upperD2:2e-12,pathLengthM:.012},
    points:900,
  });
  assert.ok(spectrum.D2.centerOpticalDepthShell > 1);
  assert.ok(spectrum.D2.reversalDepth > .1);
  assert.equal(spectrum.wavelengthsNM.length,900);
});

test('coaxial shear and sapphire screening expose physical scales without claiming failure probability', () => {
  const shear=coaxialShearRateProxy({fuelVelocityMS:60,oxidizerVelocityMS:25,fuelNozzleDiameterM:.004,oxidizerOuterDiameterM:.008});
  assert.ok(shear > 1e4);
  const wall=sapphireThermalAssessment({peakTemperatureK:1700,outerSkinTemperatureK:1200,maximumThroughWallDeltaK:300,wallThicknessM:.003,maximumHeatFluxWM2:2e5});
  assert.equal(wall.state,'CREEP / FLAW DATA REQUIRED');
  assert.ok(wall.meltMarginK > 0);
  assert.ok(wall.gradientKM > 5e4);
  assert.match(wall.scope,/no contact, flaw, creep-life/);
});

test('stabilized flame holder is localized at the burner lip and disappears in transient mode', () => {
  const common={fuelNozzleDiameterM:.004,nozzleInsertionM:.006};
  const lip=burnerLipFlameHolderActivity({...common,radiusM:.002,axialPositionM:.0078});
  const adjacentCell=burnerLipFlameHolderActivity({...common,radiusM:.0026,axialPositionM:.0078});
  const far=burnerLipFlameHolderActivity({...common,radiusM:.012,axialPositionM:.04});
  const disabled=burnerLipFlameHolderActivity({...common,radiusM:.002,axialPositionM:.0078,enabled:false});
  assert.ok(lip > .99);
  assert.ok(adjacentCell > .45, 'holder support must span more than one radial GPU cell');
  assert.ok(far < 1e-20);
  assert.equal(disabled,0);
});

test('stabilized burner cell crosses ignition using consumed reactants, not imposed heat', () => {
  const geometry={radiusM:.00208,axialPositionM:.00703,fuelNozzleDiameterM:.004,nozzleInsertionM:.006};
  const initial={temperatureK:520,fuelFraction:.38,stoichiometricOxidizerFraction:.55,pressurePa:1.4e5,...geometry};
  const unheld=reducedBurnerCellStep({...initial,stabilized:false});
  assert.equal(unheld.reactedFraction,0);
  assert.equal(unheld.chemicalPowerDensityWM3,0);
  assert.equal(unheld.nextTemperatureK,initial.temperatureK);

  const first=reducedBurnerCellStep({...initial,stabilized:true});
  const second=reducedBurnerCellStep({
    ...initial,
    temperatureK:first.nextTemperatureK,
    fuelFraction:first.fuelFraction,
    stoichiometricOxidizerFraction:first.stoichiometricOxidizerFraction,
    stabilized:true,
  });
  assert.ok(first.reactedFraction > 0);
  assert.ok(first.chemicalPowerDensityWM3 > 0);
  assert.ok(second.nextTemperatureK > 1120, 'resolved holder cell must reach self-sustaining thermal activation');
  assert.ok(second.fuelFraction < initial.fuelFraction);
  assert.ok(second.stoichiometricOxidizerFraction < initial.stoichiometricOxidizerFraction);
});
