import { FLAME_REFERENCE_DATA } from './reference-data.js';

export const CONSTANTS = Object.freeze({
  c: 299792458,
  h: 6.62607015e-34,
  kB: 1.380649e-23,
  eV: 1.602176634e-19,
  electronRadius: 2.8179403262e-15,
  sodiumMass: 22.98976928 * 1.6605390666e-27,
  pressureFwhmHzPerTorrAt450K: 30.4e6,
  lines: Object.freeze({
    D1: Object.freeze({ id: 'D1', wavelength: 589.5924e-9, energyEV: 2.1023, A: 6.14e7, oscillatorStrength: 0.320, degeneracyRatio: 1, pumpWeight: 1 / 3 }),
    D2: Object.freeze({ id: 'D2', wavelength: 588.9950e-9, energyEV: 2.1044, A: 6.16e7, oscillatorStrength: 0.641, degeneracyRatio: 2, pumpWeight: 2 / 3 }),
  }),
});

export const PUBLIC_BENCHMARK = Object.freeze({
  lineExitanceWM2: 6700,
  integratedLinePowerW: 100,
  wallTemperatureKRange: Object.freeze([1673.15, 1873.15]),
  scope: 'Public peak report; NaI brightest run, with stated measurement uncertainty',
});

// Na(3p) de-excitation coefficients used by the browser model.  H2 is anchored
// to the 1500--2500 K flame measurements of Krause et al. (~7--9 A^2); the
// remaining coefficients are explicit engineering estimates until the actual
// Lightcell post-flame mixture is measured.  Keeping them separate is crucial:
// a single coefficient multiplied by total pressure is not a physical mixture.
export const QUENCH_SPECIES = Object.freeze({
  H2: Object.freeze({ coefficientM3s: 3.8e-16, evidence: 'measured' }),
  O2: Object.freeze({ coefficientM3s: 2.0e-16, evidence: 'estimate' }),
  H2O: Object.freeze({ coefficientM3s: 5.0e-16, evidence: 'estimate' }),
  N2: Object.freeze({ coefficientM3s: 2.0e-17, evidence: 'estimate' }),
});

export const DEFAULT_COMPOSITION = Object.freeze({ H2: 0.06, O2: 0.04, H2O: 0.52, N2: 0.38 });

export function normalizedComposition(composition = DEFAULT_COMPOSITION) {
  const raw = Object.fromEntries(Object.keys(QUENCH_SPECIES).map((key) => [key, Math.max(0, Number(composition[key]) || 0)]));
  const sum = Object.values(raw).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, value / sum]));
}

export function speciesResolvedQuench({ temperatureK, pressurePa, composition = DEFAULT_COMPOSITION, scale = 1 }) {
  const x = normalizedComposition(composition);
  const numberDensityM3 = pressurePa / (CONSTANTS.kB * temperatureK);
  const perSpecies = Object.fromEntries(Object.entries(x).map(([key, fraction]) => {
    const coefficientM3s = QUENCH_SPECIES[key].coefficientM3s * scale;
    return [key, { fraction, coefficientM3s, rateS: fraction * numberDensityM3 * coefficientM3s }];
  }));
  return {
    numberDensityM3,
    effectiveCoefficientM3s: Object.values(perSpecies).reduce((sum, item) => sum + item.fraction * item.coefficientM3s, 0),
    rateS: Object.values(perSpecies).reduce((sum, item) => sum + item.rateS, 0),
    perSpecies,
  };
}

// A deliberately compact NaCl/NaOH -> neutral-Na closure.  It conserves total
// sodium and exposes the unvalidated chemistry through one activity scale.  It
// is a replaceable stand-in for the planned Cantera/speciation table, not a
// claimed detailed kinetic mechanism.
export function neutralSodiumFraction({ temperatureK, equivalenceRatio = 1, salt = 'NaCl', activityScale = 1 }) {
  const midpoint = salt === 'NaI' ? 980 : 1180;
  const thermal = 1 / (1 + Math.exp(-(temperatureK - midpoint) / 125));
  const richBoost = 0.35 + 0.65 / (1 + Math.exp(-(equivalenceRatio - 0.9) / 0.16));
  return Math.max(0, Math.min(1, activityScale * thermal * richBoost));
}

export function thermalUpwardRate(downwardRateS, temperatureK, line = CONSTANTS.lines.D2) {
  return downwardRateS * line.degeneracyRatio * Math.exp(-(line.energyEV * CONSTANTS.eV) / (CONSTANTS.kB * temperatureK));
}

const lineList = () => [CONSTANTS.lines.D1, CONSTANTS.lines.D2];

export function lteFineStructureFractions(temperatureK) {
  const { eV, kB } = CONSTANTS;
  const ratios = lineList().map((line) => line.degeneracyRatio * Math.exp(-(line.energyEV * eV) / (kB * temperatureK)));
  const lower = 1 / (1 + ratios[0] + ratios[1]);
  return { lower, D1: ratios[0] * lower, D2: ratios[1] * lower, total: (ratios[0] + ratios[1]) * lower };
}

// Kept as a compact public diagnostic. It is never used by the GPU population update.
export function lteUpperFraction(temperatureK) {
  return lteFineStructureFractions(temperatureK).total;
}

export function lineModeDensity(temperatureK, pressurePa = 101325, line = CONSTANTS.lines.D2) {
  const { c, sodiumMass, kB, pressureFwhmHzPerTorrAt450K } = CONSTANTS;
  const nu = c / line.wavelength;
  const doppler = (nu / c) * Math.sqrt((2 * kB * temperatureK) / sodiumMass);
  const pressureFwhm = pressureFwhmHzPerTorrAt450K * (pressurePa / 133.322368) * Math.sqrt(450 / temperatureK);
  const width = Math.max(doppler, pressureFwhm);
  return { nu, doppler, pressureFwhm, width, modesPerM3: (8 * Math.PI * nu * nu * width) / (c * c * c) };
}

// Scaled complementary error function for x >= 0 (Numerical Recipes form).
// At line center H(a,0)=erfcx(a), so this gives the exact Voigt-center limit
// without multiplying exp(a²) and erfc(a) separately.
export function erfcxPositive(x) {
  const t = 1 / (1 + 0.5 * Math.max(0, x));
  return t * Math.exp(-1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
}

export function lineCenterCrossSection(temperatureK, pressurePa, line = CONSTANTS.lines.D2) {
  const { c, electronRadius } = CONSTANTS;
  const { doppler, pressureFwhm } = lineModeDensity(temperatureK, pressurePa, line);
  const lorentzHwhm = line.A / (4 * Math.PI) + pressureFwhm / 2;
  const voigtA = lorentzHwhm / Math.max(doppler, 1);
  const normalizedCenterHz = erfcxPositive(voigtA) / (Math.sqrt(Math.PI) * Math.max(doppler, 1));
  return Math.PI * electronRadius * c * line.oscillatorStrength * normalizedCenterHz;
}

// Integral-normalized pseudo-Voigt profile. The exact center is checked
// separately by lineCenterCrossSection; this approximation supplies a smooth,
// high-resolution diagnostic spectrum without pretending that the six GPU
// transport groups resolve frequency point by point.
export function normalizedVoigtApproxHz(
  frequencyOffsetHz,
  temperatureK,
  pressurePa,
  line = CONSTANTS.lines.D2,
) {
  const { doppler, pressureFwhm } = lineModeDensity(temperatureK, pressurePa, line);
  const gaussianFwhm = 2 * Math.sqrt(Math.log(2)) * doppler;
  const lorentzFwhm = 2 * (line.A / (4 * Math.PI) + pressureFwhm / 2);
  const voigtFwhm = (
    gaussianFwhm ** 5
    + 2.69269 * gaussianFwhm ** 4 * lorentzFwhm
    + 2.42843 * gaussianFwhm ** 3 * lorentzFwhm ** 2
    + 4.47163 * gaussianFwhm ** 2 * lorentzFwhm ** 3
    + 0.07842 * gaussianFwhm * lorentzFwhm ** 4
    + lorentzFwhm ** 5
  ) ** 0.2;
  const ratio = Math.min(1, lorentzFwhm / Math.max(voigtFwhm, 1));
  const eta = Math.max(0, Math.min(1,
    1.36603 * ratio - 0.47719 * ratio ** 2 + 0.11116 * ratio ** 3,
  ));
  const gaussian = 2 * Math.sqrt(Math.log(2)) /
    (Math.sqrt(Math.PI) * voigtFwhm) *
    Math.exp(-4 * Math.log(2) * (frequencyOffsetHz / voigtFwhm) ** 2);
  const halfWidth = voigtFwhm / 2;
  const lorentzian = halfWidth /
    (Math.PI * (frequencyOffsetHz ** 2 + halfWidth ** 2));
  return (1 - eta) * gaussian + eta * lorentzian;
}

export function lineCrossSectionAtFrequency(
  frequencyHz,
  temperatureK,
  pressurePa,
  line = CONSTANTS.lines.D2,
) {
  const lineFrequencyHz = CONSTANTS.c / line.wavelength;
  const profileHz = normalizedVoigtApproxHz(
    frequencyHz - lineFrequencyHz,
    temperatureK,
    pressurePa,
    line,
  );
  return Math.PI * CONSTANTS.electronRadius * CONSTANTS.c *
    line.oscillatorStrength * profileHz;
}

function nonLteLineSourceFunctionWm2SrHz({ lower, upper, line }) {
  if (!(upper > 0) || !(lower > 0)) return 0;
  const frequencyHz = CONSTANTS.c / line.wavelength;
  const denominator = line.degeneracyRatio * lower / upper - 1;
  if (!(denominator > 0)) return Number.POSITIVE_INFINITY;
  return 2 * CONSTANTS.h * frequencyHz ** 3 /
    (CONSTANTS.c ** 2 * denominator);
}

function transferLineThroughTwoLayers({ wavelengthsNM, pressurePa, core, shell, line }) {
  const coreLower = Math.max(0, 1 - core.upperD1 - core.upperD2);
  const shellLower = Math.max(0, 1 - shell.upperD1 - shell.upperD2);
  const coreUpper = line.id === 'D1' ? core.upperD1 : core.upperD2;
  const shellUpper = line.id === 'D1' ? shell.upperD1 : shell.upperD2;
  const coreDensity = pressurePa * Math.max(0, core.sodiumMixingFraction) /
    (CONSTANTS.kB * Math.max(core.temperatureK, 1));
  const shellDensity = pressurePa * Math.max(0, shell.sodiumMixingFraction) /
    (CONSTANTS.kB * Math.max(shell.temperatureK, 1));
  const coreSource = nonLteLineSourceFunctionWm2SrHz({
    lower: coreLower,
    upper: coreUpper,
    line,
  });
  const shellSource = nonLteLineSourceFunctionWm2SrHz({
    lower: shellLower,
    upper: shellUpper,
    line,
  });
  const source = new Float64Array(wavelengthsNM.length);
  const emergent = new Float64Array(wavelengthsNM.length);
  const tauCore = new Float64Array(wavelengthsNM.length);
  const tauShell = new Float64Array(wavelengthsNM.length);

  for (let index = 0; index < wavelengthsNM.length; index++) {
    const wavelengthM = wavelengthsNM[index] * 1e-9;
    const frequencyHz = CONSTANTS.c / wavelengthM;
    const coreProfile = normalizedVoigtApproxHz(
      frequencyHz - CONSTANTS.c / line.wavelength,
      core.temperatureK,
      pressurePa,
      line,
    );
    const shellProfile = normalizedVoigtApproxHz(
      frequencyHz - CONSTANTS.c / line.wavelength,
      shell.temperatureK,
      pressurePa,
      line,
    );
    const coreSigma = Math.PI * CONSTANTS.electronRadius * CONSTANTS.c *
      line.oscillatorStrength * coreProfile;
    const shellSigma = Math.PI * CONSTANTS.electronRadius * CONSTANTS.c *
      line.oscillatorStrength * shellProfile;
    const corePopulationDifference = Math.max(
      0,
      coreLower - coreUpper / line.degeneracyRatio,
    );
    const shellPopulationDifference = Math.max(
      0,
      shellLower - shellUpper / line.degeneracyRatio,
    );
    tauCore[index] = coreDensity * corePopulationDifference * coreSigma *
      Math.max(0, core.pathLengthM);
    tauShell[index] = shellDensity * shellPopulationDifference * shellSigma *
      Math.max(0, shell.pathLengthM);

    const coreTransmission = Math.exp(-Math.min(700, tauCore[index]));
    const shellTransmission = Math.exp(-Math.min(700, tauShell[index]));
    const coreEmergent = Number.isFinite(coreSource)
      ? coreSource * (1 - coreTransmission)
      : 0;
    const throughShell = coreEmergent * shellTransmission +
      (Number.isFinite(shellSource) ? shellSource * (1 - shellTransmission) : 0);
    const perNM = CONSTANTS.c / wavelengthM ** 2 * 1e-9;
    emergent[index] = Math.max(0, throughShell * perNM);

    const coreThin = CONSTANTS.h * frequencyHz / (4 * Math.PI) * line.A *
      coreDensity * coreUpper * coreProfile * Math.max(0, core.pathLengthM);
    const shellThin = CONSTANTS.h * frequencyHz / (4 * Math.PI) * line.A *
      shellDensity * shellUpper * shellProfile * Math.max(0, shell.pathLengthM);
    source[index] = Math.max(0, (coreThin + shellThin) * perNM);
  }

  const centerIndex = wavelengthsNM.reduce((best, wavelength, index) =>
    Math.abs(wavelength - line.wavelength * 1e9) <
    Math.abs(wavelengthsNM[best] - line.wavelength * 1e9) ? index : best, 0);
  const windowNM = 0.22;
  let localPeak = 0;
  for (let index = 0; index < wavelengthsNM.length; index++) {
    if (Math.abs(wavelengthsNM[index] - line.wavelength * 1e9) <= windowNM) {
      localPeak = Math.max(localPeak, emergent[index]);
    }
  }
  return {
    source,
    emergent,
    tauCore,
    tauShell,
    reversalDepth: localPeak > 0
      ? Math.max(0, Math.min(1, 1 - emergent[centerIndex] / localPeak))
      : 0,
    centerOpticalDepthCore: tauCore[centerIndex],
    centerOpticalDepthShell: tauShell[centerIndex],
  };
}

export function resolvedSodiumSpectrum({
  pressurePa,
  core,
  shell,
  wavelengthMinNM = 588.55,
  wavelengthMaxNM = 590.05,
  points = 720,
}) {
  const count = Math.max(120, Math.floor(points));
  const wavelengthsNM = Float64Array.from(
    { length: count },
    (_, index) => wavelengthMinNM +
      (wavelengthMaxNM - wavelengthMinNM) * index / (count - 1),
  );
  return {
    wavelengthsNM,
    D2: transferLineThroughTwoLayers({
      wavelengthsNM,
      pressurePa,
      core,
      shell,
      line: CONSTANTS.lines.D2,
    }),
    D1: transferLineThroughTwoLayers({
      wavelengthsNM,
      pressurePa,
      core,
      shell,
      line: CONSTANTS.lines.D1,
    }),
    scope:
      'Resolved non-LTE two-layer line transfer; scaled to the six-group GPU power',
  };
}

export function opticalDepths({ temperatureK, pressurePa, sodiumMixingFraction, pathLengthM }) {
  const sodiumDensityM3 = pressurePa * sodiumMixingFraction / (CONSTANTS.kB * temperatureK);
  return Object.fromEntries(lineList().map((line) => [line.id, sodiumDensityM3 * lineCenterCrossSection(temperatureK, pressurePa, line) * pathLengthM]));
}

export function fineStructureRateBalance({
  temperatureK,
  pressurePa,
  upperD1,
  upperD2,
  photonDensityD1,
  photonDensityD2,
  reaction,
  pumpMax,
  quenchCoefficient,
  composition,
  quenchScale = 1,
  fineMixingCoefficient = 0,
}) {
  const upper = { D1: Math.max(0, upperD1), D2: Math.max(0, upperD2) };
  const lower = Math.max(0, 1 - upper.D1 - upper.D2);
  const nBuffer = pressurePa / (CONSTANTS.kB * temperatureK);
  const mixtureQuench = composition ? speciesResolvedQuench({ temperatureK, pressurePa, composition, scale: quenchScale }) : null;
  const quenchRate = mixtureQuench?.rateS ?? quenchCoefficient * nBuffer;
  const mixDown = Math.max(0, fineMixingCoefficient) * nBuffer;
  const fineGapJ = (CONSTANTS.lines.D2.energyEV - CONSTANTS.lines.D1.energyEV) * CONSTANTS.eV;
  const mixUp = 2 * mixDown * Math.exp(-fineGapJ / (CONSTANTS.kB * temperatureK));
  const photons = { D1: Math.max(0, photonDensityD1), D2: Math.max(0, photonDensityD2) };
  const perLine = {};

  for (const line of lineList()) {
    const occupation = photons[line.id] / lineModeDensity(temperatureK, pressurePa, line).modesPerM3;
    perLine[line.id] = {
      occupation,
      pump: pumpMax * reaction * line.pumpWeight * lower,
      thermalExcitation: composition ? thermalUpwardRate(quenchRate, temperatureK, line) * lower : 0,
      absorption: line.degeneracyRatio * line.A * occupation * lower,
      spontaneous: line.A * upper[line.id],
      stimulated: line.A * occupation * upper[line.id],
      quench: quenchRate * upper[line.id],
    };
  }

  // Fine-structure transfer conserves the total 3p population but changes the
  // D2/D1 ratio.  At high collision rate it approaches detailed balance.
  const fineTransferD1 = mixDown * upper.D2 - mixUp * upper.D1;
  perLine.D1.fineTransfer = fineTransferD1;
  perLine.D2.fineTransfer = -fineTransferD1;

  const sum = (key) => perLine.D1[key] + perLine.D2[key];
  return {
    lower,
    perLine,
    occupation: (perLine.D1.occupation + 2 * perLine.D2.occupation) / 3,
    pump: sum('pump'),
    thermalExcitation: sum('thermalExcitation'),
    absorption: sum('absorption'),
    spontaneous: sum('spontaneous'),
    stimulated: sum('stimulated'),
    quench: sum('quench'),
    mixtureQuench,
    fineTransferD1,
    lte: lteFineStructureFractions(temperatureK),
  };
}

export function checkRateBalance(rates) {
  const gain = rates.pump + rates.thermalExcitation + rates.absorption;
  const loss = rates.spontaneous + rates.stimulated + rates.quench;
  return { gain, loss, relativeResidual: Math.abs(gain - loss) / Math.max(gain, loss, 1) };
}

export function excitationTemperatureK(upperFraction) {
  const upper = Math.max(1e-30, Math.min(0.749999999, upperFraction));
  const ratio = upper / (1 - upper);
  return (2.104 * CONSTANTS.eV) / (CONSTANTS.kB * Math.log(3 / ratio));
}

export function departureCoefficient(temperatureK, upperFraction) {
  return upperFraction / Math.max(lteUpperFraction(temperatureK), 1e-30);
}

export function slabEscapeProbability(opticalDepth) {
  const tau = Math.max(0, opticalDepth);
  if (tau < 1e-5) return 1 - tau / 2;
  return -Math.expm1(-tau) / tau;
}

// Homogeneous escape-factor diagnostic used only for the phase map. The spatial
// GPU solver above it transports D1 and D2 radiation explicitly with P1 moments.
export function reducedNonLteState({ temperatureK, pressurePa, pumpRate, reaction = 1, quenchCoefficient, opticalDepthD1, opticalDepthD2 }) {
  const nBuffer = pressurePa / (CONSTANTS.kB * temperatureK);
  const quenchRate = quenchCoefficient * nBuffer;
  const ratios = {};
  const betas = { D1: slabEscapeProbability(opticalDepthD1), D2: slabEscapeProbability(opticalDepthD2) };
  for (const line of lineList()) {
    ratios[line.id] = pumpRate * reaction * line.pumpWeight / (line.A * betas[line.id] + quenchRate);
  }
  const lower = 1 / (1 + ratios.D1 + ratios.D2);
  const D1 = ratios.D1 * lower;
  const D2 = ratios.D2 * lower;
  return { lower, D1, D2, total: D1 + D2, betas, quenchRate, departure: departureCoefficient(temperatureK, D1 + D2) };
}

export function photonRecyclingEstimate({ opticalDepthD1, opticalDepthD2, pressurePa, temperatureK, quenchCoefficient }) {
  const betaD1 = slabEscapeProbability(opticalDepthD1);
  const betaD2 = slabEscapeProbability(opticalDepthD2);
  const beta = (betaD1 + 2 * betaD2) / 3;
  const A = (CONSTANTS.lines.D1.A + 2 * CONSTANTS.lines.D2.A) / 3;
  const quenchRate = quenchCoefficient * pressurePa / (CONSTANTS.kB * temperatureK);
  return {
    beta,
    meanReabsorptions: Math.max(0, 1 / Math.max(beta, 1e-12) - 1),
    trappedLifetimeS: 1 / Math.max(A * beta + quenchRate, 1),
    radiativeEscapeFraction: A * beta / Math.max(A * beta + quenchRate, 1),
  };
}

export function opticalBoundary({ lineReflectance, pvAbsorptance }) {
  const reflectance = Math.max(0, Math.min(0.995, lineReflectance));
  const pv = Math.max(0, Math.min(1 - reflectance, pvAbsorptance));
  return { reflectance, pvAbsorptance: pv, parasiticAbsorptance: 1 - reflectance - pv };
}

// P1/partial-current (Marshak) boundary for an isotropic diffuse field:
// J_out = v (1-R) / [2(1+R)] n.  This is a Robin condition, not a
// Dirichlet ghost cell with n_ghost = R n.
export function p1BoundaryLeakageSpeed(reflectance, propagationSpeedMS = CONSTANTS.c) {
  const R = Math.max(0, Math.min(0.999999, reflectance));
  return Math.max(0, propagationSpeedMS) * (1 - R) / (2 * (1 + R));
}

// Residence of the coupled excitation, not merely photons in flight.  In an
// optically thick resonance line most stored quanta can reside in Na(3p), so
// omitting excited atoms can produce an apparent lifetime below 1/A.
export function coupledExcitationResidenceTime({ photonCount, excitedAtomCount, escapeRateS, quenchRateS = 0 }) {
  return (Math.max(0, photonCount) + Math.max(0, excitedAtomCount)) /
    Math.max(1, Math.max(0, escapeRateS) + Math.max(0, quenchRateS));
}

const HYDROGEN = Object.freeze({
  molarMassKgMol: 2.01588e-3,
  lowerHeatingValueJKg: 120e6,
  gamma: 1.405,
  viscosityPaSAt300K: 8.76e-6,
});

// Metered flows are standard litres per minute at 273.15 K and 1 atm. This
// conversion makes the operator-facing nozzle quantities independent of the
// arbitrary mesh resolution used by the browser solver.
export function standardFlowState({
  flowSLPM,
  molarMassKgMol,
  pressurePa,
  temperatureK,
  standardPressurePa = 101325,
  standardTemperatureK = 273.15,
}) {
  const standardVolumeM3s = Math.max(0, flowSLPM) * 1e-3 / 60;
  const molarFlowMolS = standardVolumeM3s * standardPressurePa / (8.314462618 * standardTemperatureK);
  const massFlowKgS = molarFlowMolS * molarMassKgMol;
  const actualVolumeM3s = molarFlowMolS * 8.314462618 * temperatureK / pressurePa;
  return { standardVolumeM3s, actualVolumeM3s, molarFlowMolS, massFlowKgS };
}

export function hydrogenNozzleState({ flowSLPM, nozzleDiameterM, pressurePa, temperatureK = 320 }) {
  const flow = standardFlowState({
    flowSLPM,
    molarMassKgMol: HYDROGEN.molarMassKgMol,
    pressurePa,
    temperatureK,
  });
  const diameterM = Math.max(1e-5, nozzleDiameterM);
  const areaM2 = Math.PI * diameterM * diameterM / 4;
  const densityKgM3 = pressurePa * HYDROGEN.molarMassKgMol / (8.314462618 * temperatureK);
  const viscosityPaS = 8.76e-6 * ((293 + 72) / (temperatureK + 72)) * (temperatureK / 293) ** 1.5;
  const velocityMS = flow.actualVolumeM3s / areaM2;
  const specificGasConstant = 8.314462618 / HYDROGEN.molarMassKgMol;
  const soundSpeedMS = Math.sqrt(HYDROGEN.gamma * specificGasConstant * temperatureK);
  return {
    ...flow,
    areaM2,
    densityKgM3,
    viscosityPaS,
    velocityMS,
    reynolds: densityKgM3 * velocityMS * diameterM / viscosityPaS,
    mach: velocityMS / soundSpeedMS,
    lowerHeatingValueW: flow.massFlowKgS * HYDROGEN.lowerHeatingValueJKg,
  };
}

// Molkov & Saffers (Fire Safety Science 10, 2011), dimensional correlation
// assembled from unconfined hydrogen jet-fire data. Units are kg/s and m. It
// is deliberately a reference comparator: it is not applied as the flame
// length inside the oxygen-enriched coaxial, recirculating Lightcell geometry.
export function openAirHydrogenFlameLength({ massFlowKgS, nozzleDiameterM }) {
  return 76 * Math.max(0, massFlowKgS * nozzleDiameterM) ** 0.347;
}

export function oxidizerCoflowState({ flowSLPM, coreRadiusM, nozzleDiameterM, oxidizerOuterDiameterM = 2 * coreRadiusM, pressurePa, temperatureK = 320 }) {
  // Treat oxidizer as air-like for the volume conversion. Ideal-gas volume is
  // composition independent at fixed molar flow; 28.97 g/mol is used only for
  // the returned density diagnostic.
  const flow = standardFlowState({flowSLPM,molarMassKgMol:28.97e-3,pressurePa,temperatureK});
  const outerDiameterM = Math.min(2 * coreRadiusM, Math.max(nozzleDiameterM + 2e-4, oxidizerOuterDiameterM));
  const annularAreaM2 = Math.max(1e-8, Math.PI * (outerDiameterM ** 2 - nozzleDiameterM ** 2) / 4);
  return {...flow,outerDiameterM,annularAreaM2,velocityMS:flow.actualVolumeM3s/annularAreaM2};
}

export function annularReturnState({ fuelActualVolumeM3s, oxidizerActualVolumeM3s, coreRadiusM, wallThicknessM, outerRadiusM }) {
  const innerRadiusM = Math.max(0, coreRadiusM + wallThicknessM);
  const outerGasRadiusM = Math.max(innerRadiusM + 1e-4, outerRadiusM - wallThicknessM);
  const areaM2 = Math.max(1e-8, Math.PI * (outerGasRadiusM ** 2 - innerRadiusM ** 2));
  const actualVolumeM3s = Math.max(0, fuelActualVolumeM3s) + Math.max(0, oxidizerActualVolumeM3s);
  return {innerRadiusM,outerGasRadiusM,areaM2,actualVolumeM3s,velocityMS:actualVolumeM3s/areaM2};
}

export function flameCellAssessment({
  nozzleVelocityMS,
  reynolds,
  mach,
  flameBaseM,
  flameTipM,
  flameRadiusM,
  coreRadiusM,
  cellLengthM,
  maxReaction = 0,
  wallTemperatureK = 0,
  meltReferenceK = 2323,
}) {
  const present = maxReaction > 0.02 && Number.isFinite(flameTipM) && flameTipM > flameBaseM;
  const wallClearanceM = Math.max(0, coreRadiusM - Math.max(0, flameRadiusM));
  const axialClearanceM = Math.max(0, cellLengthM - Math.max(0, flameTipM));
  let state = 'NO FLAME RESOLVED';
  if (present) {
    state = 'CONFINED';
    if (wallClearanceM < 1e-3 || axialClearanceM < 1e-3) state = 'IMPINGEMENT PROXY';
    else if (mach > 0.3) state = 'COMPRESSIBILITY WARNING';
    else if (reynolds < 500) state = 'LOW-RE JET';
    if (wallTemperatureK >= meltReferenceK) state = 'WALL LIMIT EXCEEDED';
  }
  return {
    present,
    state,
    flameLengthM: present ? flameTipM - flameBaseM : 0,
    wallClearanceM,
    axialClearanceM,
    residenceTimeS: present ? (flameTipM - flameBaseM) / Math.max(nozzleVelocityMS, 1e-9) : 0,
  };
}

const equilibriumReferenceMap = new Map(
  FLAME_REFERENCE_DATA.equilibrium.map((row) => [
    `${row.pressure_bar}|${row.oxygen_fraction}|${row.phi}`,
    row,
  ]),
);
const flameSpeedReferenceMap = new Map(
  FLAME_REFERENCE_DATA.flame_speed.map((row) => [
    `${row.pressure_bar}|${row.oxygen_fraction}|${row.phi}`,
    row,
  ]),
);

function interpolationBracket(axis, value) {
  const clamped = Math.max(axis[0], Math.min(axis[axis.length - 1], value));
  let high = axis.findIndex((item) => item >= clamped);
  if (high <= 0) return { low: axis[0], high: axis[0], fraction: 0, clamped };
  if (high < 0) high = axis.length - 1;
  const low = axis[high - 1];
  const upper = axis[high];
  return {
    low,
    high: upper,
    fraction: (clamped - low) / Math.max(upper - low, Number.EPSILON),
    clamped,
  };
}

function trilinearReference({ map, axes, equivalenceRatio, oxygenFraction, pressureBar, fields }) {
  const phi = interpolationBracket(axes.phi, equivalenceRatio);
  const oxygen = interpolationBracket(axes.oxygen_fraction, oxygenFraction);
  const pressure = interpolationBracket(axes.pressure_bar, pressureBar);
  const result = Object.fromEntries(fields.map((field) => [field, 0]));

  for (const [p, wp] of [[pressure.low, 1 - pressure.fraction], [pressure.high, pressure.fraction]]) {
    for (const [o, wo] of [[oxygen.low, 1 - oxygen.fraction], [oxygen.high, oxygen.fraction]]) {
      for (const [f, wf] of [[phi.low, 1 - phi.fraction], [phi.high, phi.fraction]]) {
        const weight = wp * wo * wf;
        if (weight === 0) continue;
        const row = map.get(`${p}|${o}|${f}`);
        if (!row) throw new Error(`Missing Cantera reference point ${p}|${o}|${f}`);
        for (const field of fields) result[field] += weight * row[field];
      }
    }
  }

  return {
    ...result,
    interpolationPoint: {
      equivalenceRatio: phi.clamped,
      oxygenFraction: oxygen.clamped,
      pressureBar: pressure.clamped,
    },
  };
}

export function canteraOperatingReference({
  equivalenceRatio,
  oxygenFraction,
  pressureBar,
}) {
  const equilibriumFields = [
    'adiabatic_temperature_k',
    'oxygen_atom_mole_fraction',
    'hydrogen_atom_mole_fraction',
    'hydroxyl_mole_fraction',
    'na_o_o_partial_pump_rate_per_na_s',
  ];
  const operating = trilinearReference({
    map: equilibriumReferenceMap,
    axes: FLAME_REFERENCE_DATA.equilibrium_axes,
    equivalenceRatio,
    oxygenFraction,
    pressureBar,
    fields: equilibriumFields,
  });
  const stoichiometric = trilinearReference({
    map: equilibriumReferenceMap,
    axes: FLAME_REFERENCE_DATA.equilibrium_axes,
    equivalenceRatio: 1,
    oxygenFraction,
    pressureBar,
    fields: equilibriumFields,
  });
  const freeFlame = trilinearReference({
    map: flameSpeedReferenceMap,
    axes: FLAME_REFERENCE_DATA.flame_speed_axes,
    equivalenceRatio,
    oxygenFraction,
    pressureBar,
    fields: ['laminar_flame_speed_m_s', 'maximum_temperature_k'],
  });
  return {
    operating,
    stoichiometric,
    freeFlame,
    metadata: FLAME_REFERENCE_DATA.metadata,
  };
}

export function coaxialShearRateProxy({
  fuelVelocityMS,
  oxidizerVelocityMS,
  fuelNozzleDiameterM,
  oxidizerOuterDiameterM,
}) {
  const radialGapM = Math.max(
    1e-5,
    (oxidizerOuterDiameterM - fuelNozzleDiameterM) / 2,
  );
  return Math.abs(fuelVelocityMS - oxidizerVelocityMS) / radialGapM;
}

export function burnerLipFlameHolderActivity({
  radiusM,
  axialPositionM,
  fuelNozzleDiameterM,
  nozzleInsertionM,
  radialCellSizeM = 0.038 / 64,
  axialCellSizeM = 0.105 / 112,
  enabled = true,
}) {
  if (!enabled) return 0;
  const lipRadiusM = fuelNozzleDiameterM / 2;
  // A sub-grid holder can disappear between cell centers. Resolve its radical
  // support over at least ~1.25 radial cells without adding heat directly.
  const radialWidthM = Math.max(
    0.00055,
    0.18 * fuelNozzleDiameterM,
    1.25 * radialCellSizeM,
  );
  const axialWidthM = Math.max(0.0028, 2.5 * axialCellSizeM);
  const radial = Math.exp(-(((radiusM - lipRadiusM) / radialWidthM) ** 2));
  const axial = Math.exp(
    -(((axialPositionM - (nozzleInsertionM + 0.0018)) / axialWidthM) ** 2),
  );
  return radial * axial;
}

// CPU mirror of the WGSL local combustion source. It deliberately excludes
// advection and conduction: this is the unit acceptance test for whether a
// mesh-resolved holder cell consumes real reactants and crosses the thermal
// ignition threshold without an imposed temperature or hidden heater.
export function reducedBurnerCellStep({
  temperatureK,
  fuelFraction,
  stoichiometricOxidizerFraction,
  pressurePa,
  radiusM,
  axialPositionM,
  fuelNozzleDiameterM,
  nozzleInsertionM,
  stabilized = true,
  timeStepS = 2e-5,
  chemistryRateS = 4e4,
  atomicPumpFraction = 0.01,
  thermochemistryCeilingK = 2850,
}) {
  const smoothstep = (low, high, value) => {
    const x = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return x * x * (3 - 2 * x);
  };
  const holder = burnerLipFlameHolderActivity({
    radiusM,
    axialPositionM,
    fuelNozzleDiameterM,
    nozzleInsertionM,
    enabled: stabilized,
  });
  const activation = Math.max(
    smoothstep(760, 1120, temperatureK),
    0.92 * holder,
  );
  const available = Math.min(
    Math.max(0, fuelFraction),
    Math.max(0, stoichiometricOxidizerFraction),
  );
  const reactionRateS = activation * available * chemistryRateS;
  const reactedFraction = Math.min(available, timeStepS * reactionRateS);
  const molarDensityM3 = pressurePa / (8.314462618 * Math.max(temperatureK, 300));
  const chemicalPowerDensityWM3 = molarDensityM3 * (reactedFraction / timeStepS) * 241800;
  const heatCapacityDensityJKM3 = pressurePa / (287 * Math.max(temperatureK, 300)) * 2400;
  const netThermalPowerDensityWM3 = (1 - atomicPumpFraction) * chemicalPowerDensityWM3;
  const nextTemperatureK = Math.min(
    thermochemistryCeilingK,
    temperatureK + timeStepS * netThermalPowerDensityWM3 / heatCapacityDensityJKM3,
  );
  return {
    holder,
    activation,
    reactionRateS,
    reactedFraction,
    chemicalPowerDensityWM3,
    nextTemperatureK,
    fuelFraction: Math.max(0, fuelFraction - reactedFraction),
    stoichiometricOxidizerFraction: Math.max(0, stoichiometricOxidizerFraction - reactedFraction),
  };
}

export function sapphireThermalAssessment({
  peakTemperatureK,
  outerSkinTemperatureK,
  maximumThroughWallDeltaK,
  wallThicknessM,
  maximumHeatFluxWM2,
  meltReferenceK = 2323,
  creepRelevantTemperatureK = 1173,
}) {
  const meltMarginK = meltReferenceK - peakTemperatureK;
  const gradientKM = maximumThroughWallDeltaK / Math.max(wallThicknessM, 1e-9);
  // Fully constrained elastic upper bound, not a solved stress. Hot sapphire
  // creeps, the geometry is not fully constrained, and flaws dominate failure.
  const elasticModulusPa = 350e9;
  const thermalExpansionK = 8e-6;
  const poisson = 0.25;
  const constrainedStressUpperBoundPa =
    elasticModulusPa * thermalExpansionK * maximumThroughWallDeltaK /
    (1 - poisson);
  let state = 'BELOW CREEP-RELEVANT RANGE';
  if (peakTemperatureK >= creepRelevantTemperatureK) {
    state = 'CREEP / FLAW DATA REQUIRED';
  }
  if (meltMarginK < 250) state = 'LOW MELT MARGIN';
  if (meltMarginK < 0) state = 'MELT REFERENCE EXCEEDED';
  return {
    state,
    meltMarginK,
    gradientKM,
    maximumThroughWallDeltaK,
    maximumHeatFluxWM2,
    constrainedStressUpperBoundPa,
    creepRelevant: peakTemperatureK >= creepRelevantTemperatureK,
    scope:
      'Thermal screening only; no contact, flaw, creep-life, or mechanical boundary-condition solve',
  };
}
