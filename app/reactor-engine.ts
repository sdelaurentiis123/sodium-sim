import {
  atomicLineStates, EV, KB, simulateAtomicTransport, SODIUM_LINES,
  type AtomicInputs,
} from "./sodium-atomic-engine.ts";

const SIGMA = 5.670_374_419e-8;
const TORR_TO_PA = 133.322_368;
const BAR_TO_PA = 100_000;
const PHOTON_EV = 2.104;
const PHOTON_J = PHOTON_EV * EV;

export type ReactorDesign = {
  coreRadiusMm: number;
  coreLengthMm: number;
  sapphireMm: number;
  insulationMm: number;
  reservoirTemperatureK: number;
  bufferPressureTorr: number;
  sourceRadiusFraction: number;
};

export type ReactorPhysics = {
  fuelPowerKW: number;
  ambientTemperatureK: number;
  sodiumActivity: number;
  excitationFraction: number;
  quenchCoefficientCm3s: number;
  cellBandgapEV: number;
  cellEQE: number;
  cellVoltageFraction: number;
  cellFillFactor: number;
  cellCoverage: number;
  mirrorLineTransmission: number;
  cavityLineSurvival: number;
  externalConvectionWm2K: number;
  externalEmissivity: number;
  maximumGasTemperatureK: number;
  maximumSapphireTemperatureK: number;
};

export type ReactorGrid = {
  nr: number;
  nz: number;
  radiusM: number;
  halfLengthM: number;
  drM: number;
  dzM: number;
  temperaturesK: number[];
  materials: number[];
  heatSourceWm3: number[];
};

export type AtomicReactorState = {
  atomicInputs: AtomicInputs;
  sodiumVaporPressurePa: number;
  sodiumPartialPressurePa: number;
  sodiumDensityCm3: number;
  atomCount: number;
  pumpRateS: number;
  escapeFactor: number;
  quenchRateS: number;
  upperFraction: number;
  acceptedPumpKW: number;
  linePowerKW: number;
  quenchPowerKW: number;
  opticalDepthD2: number;
};

export type ReactorResult = {
  design: ReactorDesign;
  physics: ReactorPhysics;
  grid: ReactorGrid;
  atomic: AtomicReactorState;
  averageGasTemperatureK: number;
  maximumGasTemperatureK: number;
  maximumSapphireTemperatureK: number;
  maximumInsulationTemperatureK: number;
  linePowerKW: number;
  pvIncidentKW: number;
  electricPowerKW: number;
  cellHeatKW: number;
  lineLossKW: number;
  reactorHeatKW: number;
  boundaryHeatKW: number;
  energyResidualKW: number;
  efficiency: number;
  pvEfficiency: number;
  constraintMarginK: number;
  feasible: boolean;
  iterations: number;
  transportValidation?: {
    packets: number;
    surrogateEscapeFactor: number;
    monteCarloEscapeFactor: number;
    packetResidual: number;
  };
};

export type OptimizationPoint = {
  design: ReactorDesign;
  electricPowerKW: number;
  efficiency: number;
  maximumTemperatureK: number;
  feasible: boolean;
  robustPowerKW: number;
};

export type OptimizationResult = {
  best: ReactorResult;
  points: OptimizationPoint[];
  evaluations: number;
  robustWorstCaseKW: number;
  ratedFuelPowerKW: number;
};

export const DEFAULT_DESIGN: ReactorDesign = {
  coreRadiusMm: 28,
  coreLengthMm: 105,
  sapphireMm: 3,
  insulationMm: 18,
  reservoirTemperatureK: 980,
  bufferPressureTorr: 55,
  sourceRadiusFraction: 0.42,
};

export const DEFAULT_PHYSICS: ReactorPhysics = {
  fuelPowerKW: 10,
  ambientTemperatureK: 300,
  // Neutral Na activity relative to pure-liquid vapor pressure. This must be
  // replaced by a measured speciation/activity for the actual salt chemistry.
  sodiumActivity: 2e-4,
  // Fraction of chemical input initially delivered to the Na 3s→3p pump.
  // It is a calibration parameter, never a design variable.
  excitationFraction: 0.62,
  quenchCoefficientCm3s: 1e-12,
  cellBandgapEV: 1.80,
  cellEQE: 0.88,
  cellVoltageFraction: 0.82,
  cellFillFactor: 0.84,
  cellCoverage: 0.86,
  mirrorLineTransmission: 0.93,
  cavityLineSurvival: 0.92,
  externalConvectionWm2K: 12,
  externalEmissivity: 0.82,
  maximumGasTemperatureK: 2600,
  maximumSapphireTemperatureK: 2000,
};

export const DESIGN_BOUNDS: Record<keyof ReactorDesign, readonly [number, number]> = {
  coreRadiusMm: [14, 48],
  coreLengthMm: [55, 190],
  sapphireMm: [2, 6],
  insulationMm: [4, 30],
  // NIST Antoine fit used below is published for 924–1118 K.
  reservoirTemperatureK: [925, 1100],
  bufferPressureTorr: [8, 120],
  sourceRadiusFraction: [0.18, 0.82],
};

export function sodiumVaporPressurePa(temperatureK: number) {
  const T = Math.max(924, Math.min(1118, temperatureK));
  return BAR_TO_PA * 10 ** (2.46077 - 1873.728 / (T - 416.372));
}

export function materialConductivityWmK(material: number, temperatureK: number) {
  const T = Math.max(300, temperatureK);
  // The gas value is an effective conductivity for a vigorously mixed hot
  // zone. Replacing it with a Navier–Stokes closure is a high-fidelity upgrade.
  if (material === 0) return 8.5 * (T / 1500) ** 0.42;
  if (material === 1) return Math.max(4.5, 35 * (300 / T) ** 0.78); // sapphire engineering fit
  return 0.11 + 1.05e-4 * (T - 300); // porous high-temperature insulation
}

function harmonic(a: number, b: number) {
  return 2 * a * b / Math.max(1e-30, a + b);
}

function cellVolume(r0: number, r1: number, dz: number) {
  return Math.PI * (r1 * r1 - r0 * r0) * dz;
}

function classifyMaterial(r: number, z: number, design: ReactorDesign) {
  const rc = design.coreRadiusMm / 1000;
  const zh = design.coreLengthMm / 2000;
  const ts = design.sapphireMm / 1000;
  if (r < rc && Math.abs(z) < zh) return 0;
  if (r < rc + ts && Math.abs(z) < zh + ts) return 1;
  return 2;
}

function makeGrid(design: ReactorDesign, nr: number, nz: number, ambientK: number): ReactorGrid {
  const radiusM = (design.coreRadiusMm + design.sapphireMm + design.insulationMm) / 1000;
  const halfLengthM = (design.coreLengthMm / 2 + design.sapphireMm + design.insulationMm) / 1000;
  const drM = radiusM / nr;
  const dzM = 2 * halfLengthM / nz;
  const temperaturesK = new Array(nr * nz).fill(ambientK + 500);
  const materials = new Array(nr * nz).fill(2);
  const heatSourceWm3 = new Array(nr * nz).fill(0);
  for (let j = 0; j < nz; j++) {
    const z = -halfLengthM + (j + 0.5) * dzM;
    for (let i = 0; i < nr; i++) {
      const r = (i + 0.5) * drM;
      const index = j * nr + i;
      materials[index] = classifyMaterial(r, z, design);
      temperaturesK[index] = materials[index] === 0 ? ambientK + 1100 : ambientK + 550;
    }
  }
  return { nr, nz, radiusM, halfLengthM, drM, dzM, temperaturesK, materials, heatSourceWm3 };
}

function distributeCoreHeat(grid: ReactorGrid, design: ReactorDesign, powerW: number) {
  const weights = new Array(grid.nr * grid.nz).fill(0);
  let normalization = 0;
  const rc = design.coreRadiusMm / 1000;
  const zh = design.coreLengthMm / 2000;
  const sr = Math.max(0.08, design.sourceRadiusFraction) * rc;
  const sz = 0.72 * zh;
  for (let j = 0; j < grid.nz; j++) {
    const z = -grid.halfLengthM + (j + 0.5) * grid.dzM;
    for (let i = 0; i < grid.nr; i++) {
      const index = j * grid.nr + i;
      if (grid.materials[index] !== 0) continue;
      const r0 = i * grid.drM;
      const r1 = (i + 1) * grid.drM;
      const r = 0.5 * (r0 + r1);
      const weight = Math.exp(-((r / sr) ** 2) - (z / sz) ** 4);
      const volume = cellVolume(r0, r1, grid.dzM);
      weights[index] = weight;
      normalization += weight * volume;
    }
  }
  for (let i = 0; i < weights.length; i++)
    grid.heatSourceWm3[i] = normalization > 0 ? powerW * weights[i] / normalization : 0;
}

function boundaryCoefficient(temperatureK: number, physics: ReactorPhysics) {
  const Ta = physics.ambientTemperatureK;
  return physics.externalConvectionWm2K + physics.externalEmissivity * SIGMA *
    (temperatureK + Ta) * (temperatureK * temperatureK + Ta * Ta);
}

export function solveThermalField(
  design: ReactorDesign,
  physics: ReactorPhysics,
  reactorHeatKW: number,
  nr = 22,
  nz = 34,
  initial?: ReactorGrid,
) {
  const reused = Boolean(initial && initial.nr === nr && initial.nz === nz);
  const grid = reused ? initial! : makeGrid(design, nr, nz, physics.ambientTemperatureK);
  distributeCoreHeat(grid, design, Math.max(0, reactorHeatKW) * 1000);
  const { drM: dr, dzM: dz } = grid;
  const Ta = physics.ambientTemperatureK;
  if (!reused) {
    const area = 4 * Math.PI * grid.radiusM * grid.halfLengthM + 2 * Math.PI * grid.radiusM ** 2;
    const flux = Math.max(0, reactorHeatKW) * 1000 / Math.max(1e-9, area);
    let low = Ta, high = 3600;
    for (let n = 0; n < 45; n++) {
      const mid = 0.5 * (low + high);
      const rejected = physics.externalConvectionWm2K * (mid - Ta) +
        physics.externalEmissivity * SIGMA * (mid ** 4 - Ta ** 4);
      if (rejected < flux) low = mid; else high = mid;
    }
    const surface = 0.5 * (low + high);
    for (let index = 0; index < grid.temperaturesK.length; index++)
      grid.temperaturesK[index] = surface + (grid.materials[index] === 0 ? 420 : grid.materials[index] === 1 ? 180 : 40);
  }
  let maxDelta = Infinity;
  let iteration = 0;
  for (; iteration < 1200 && maxDelta > 0.025; iteration++) {
    maxDelta = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nr; i++) {
        const index = j * nr + i;
        const old = grid.temperaturesK[index];
        const k0 = materialConductivityWmK(grid.materials[index], old);
        const r0 = i * dr, r1 = (i + 1) * dr, rc = 0.5 * (r0 + r1);
        const volume = cellVolume(r0, r1, dz);
        let conductance = 0;
        let rhs = grid.heatSourceWm3[index] * volume;
        if (i > 0) {
          const n = index - 1;
          const g = harmonic(k0, materialConductivityWmK(grid.materials[n], grid.temperaturesK[n])) *
            2 * Math.PI * r0 * dz / dr;
          conductance += g; rhs += g * grid.temperaturesK[n];
        }
        if (i + 1 < nr) {
          const n = index + 1;
          const g = harmonic(k0, materialConductivityWmK(grid.materials[n], grid.temperaturesK[n])) *
            2 * Math.PI * r1 * dz / dr;
          conductance += g; rhs += g * grid.temperaturesK[n];
        } else {
          const area = 2 * Math.PI * r1 * dz;
          const g = boundaryCoefficient(old, physics) * area;
          conductance += g; rhs += g * Ta;
        }
        const axialArea = 2 * Math.PI * rc * dr;
        if (j > 0) {
          const n = index - nr;
          const g = harmonic(k0, materialConductivityWmK(grid.materials[n], grid.temperaturesK[n])) * axialArea / dz;
          conductance += g; rhs += g * grid.temperaturesK[n];
        } else {
          const g = boundaryCoefficient(old, physics) * axialArea;
          conductance += g; rhs += g * Ta;
        }
        if (j + 1 < nz) {
          const n = index + nr;
          const g = harmonic(k0, materialConductivityWmK(grid.materials[n], grid.temperaturesK[n])) * axialArea / dz;
          conductance += g; rhs += g * grid.temperaturesK[n];
        } else {
          const g = boundaryCoefficient(old, physics) * axialArea;
          conductance += g; rhs += g * Ta;
        }
        const solved = rhs / Math.max(1e-30, conductance);
        const next = old + 0.92 * (solved - old);
        grid.temperaturesK[index] = Math.max(Ta, Math.min(6500, next));
        maxDelta = Math.max(maxDelta, Math.abs(next - old));
      }
    }
  }
  let boundaryW = 0;
  for (let j = 0; j < nz; j++) {
    const index = j * nr + nr - 1;
    const T = grid.temperaturesK[index];
    boundaryW += boundaryCoefficient(T, physics) * 2 * Math.PI * grid.radiusM * dz * (T - Ta);
  }
  for (const j of [0, nz - 1]) for (let i = 0; i < nr; i++) {
    const index = j * nr + i;
    const T = grid.temperaturesK[index];
    const r0 = i * dr, r1 = (i + 1) * dr;
    boundaryW += boundaryCoefficient(T, physics) * Math.PI * (r1 * r1 - r0 * r0) * (T - Ta);
  }
  return { grid, boundaryHeatKW: boundaryW / 1000, iterations: iteration, maxDeltaK: maxDelta };
}

function fieldStatistics(grid: ReactorGrid) {
  let gasWeighted = 0, gasVolume = 0;
  let maxGas = 0, maxSapphire = 0, maxInsulation = 0;
  for (let j = 0; j < grid.nz; j++) for (let i = 0; i < grid.nr; i++) {
    const index = j * grid.nr + i;
    const T = grid.temperaturesK[index];
    const volume = cellVolume(i * grid.drM, (i + 1) * grid.drM, grid.dzM);
    if (grid.materials[index] === 0) {
      gasWeighted += T * volume; gasVolume += volume; maxGas = Math.max(maxGas, T);
    } else if (grid.materials[index] === 1) maxSapphire = Math.max(maxSapphire, T);
    else maxInsulation = Math.max(maxInsulation, T);
  }
  return {
    averageGasTemperatureK: gasWeighted / Math.max(1e-30, gasVolume),
    maximumGasTemperatureK: maxGas,
    maximumSapphireTemperatureK: maxSapphire,
    maximumInsulationTemperatureK: maxInsulation,
  };
}

function escapeCorrelation(tauRadial: number, tauAxial: number) {
  const effectiveTau = 1 / (1 / Math.max(1e-12, tauRadial) + 1 / Math.max(1e-12, tauAxial));
  // Calibrated only as a fast optimizer surrogate. The selected design is
  // independently checked by the packet transport engine.
  return 1 / (1 + 0.17 * effectiveTau * Math.sqrt(Math.max(1, Math.log1p(effectiveTau))));
}

export function reducedAtomicState(
  design: ReactorDesign,
  physics: ReactorPhysics,
  gasTemperatureK: number,
  escapeFactorOverride?: number,
): AtomicReactorState {
  const vapor = sodiumVaporPressurePa(design.reservoirTemperatureK);
  const sodiumPartialPressurePa = physics.sodiumActivity * vapor;
  const sodiumDensityCm3 = sodiumPartialPressurePa / (KB * gasTemperatureK) / 1e6;
  const bufferDensityCm3 = design.bufferPressureTorr * TORR_TO_PA / (KB * gasTemperatureK) / 1e6;
  const sodiumMixingPpm = 1e6 * sodiumDensityCm3 / Math.max(1e-30, bufferDensityCm3);
  const volumeCm3 = Math.PI * (design.coreRadiusMm / 10) ** 2 * (design.coreLengthMm / 10);
  const atomCount = sodiumDensityCm3 * volumeCm3;
  const excitationKW = physics.fuelPowerKW * physics.excitationFraction;
  const pumpRateS = excitationKW * 1000 / Math.max(1e-30, atomCount * PHOTON_J);
  const atomicInputs: AtomicInputs = {
    temperatureK: gasTemperatureK,
    sodiumMixingPpm,
    bufferPressureTorr: design.bufferPressureTorr,
    radiusMm: design.coreRadiusMm,
    lengthMm: design.coreLengthMm,
    quenchCoefficientCm3s: physics.quenchCoefficientCm3s,
    pumpRateS,
    sourceRadiusFraction: design.sourceRadiusFraction,
  };
  const lines = atomicLineStates(atomicInputs);
  const betas = lines.map((line) => escapeCorrelation(
    line.radialOpticalDepth,
    line.radialOpticalDepth * design.coreLengthMm / (2 * design.coreRadiusMm),
  ));
  const escapeFactor = escapeFactorOverride ?? (2 * betas[0] + betas[1]) / 3;
  const averageA = (2 * SODIUM_LINES[0].A + SODIUM_LINES[1].A) / 3;
  const quenchRateS = physics.quenchCoefficientCm3s * bufferDensityCm3;
  const decayRateS = averageA * escapeFactor + quenchRateS;
  const upperFraction = Math.min(0.75, pumpRateS / Math.max(1e-30, pumpRateS + decayRateS));
  const linePowerKW = atomCount * upperFraction * averageA * escapeFactor * PHOTON_J / 1000;
  const quenchPowerKW = atomCount * upperFraction * quenchRateS * PHOTON_J / 1000;
  return {
    atomicInputs, sodiumVaporPressurePa: vapor, sodiumPartialPressurePa,
    sodiumDensityCm3, atomCount, pumpRateS, escapeFactor, quenchRateS, upperFraction,
    acceptedPumpKW: linePowerKW + quenchPowerKW, linePowerKW, quenchPowerKW,
    opticalDepthD2: lines[0].radialOpticalDepth,
  };
}

function opticalAndPV(atomic: AtomicReactorState, physics: ReactorPhysics) {
  const capture = physics.cellCoverage * physics.mirrorLineTransmission;
  const recycle = (1 - capture) * physics.cavityLineSurvival;
  const eventualCapture = capture / Math.max(1e-12, 1 - recycle);
  const pvIncidentKW = atomic.linePowerKW * Math.min(1, eventualCapture);
  const lineLossKW = Math.max(0, atomic.linePowerKW - pvIncidentKW);
  const pvEfficiency = physics.cellBandgapEV <= PHOTON_EV ?
    physics.cellEQE * physics.cellVoltageFraction * physics.cellFillFactor *
      physics.cellBandgapEV / PHOTON_EV : 0;
  const electricPowerKW = pvIncidentKW * pvEfficiency;
  return {
    pvIncidentKW, lineLossKW, pvEfficiency, electricPowerKW,
    cellHeatKW: pvIncidentKW - electricPowerKW,
  };
}

export function simulateReactor(
  design: ReactorDesign,
  physics: ReactorPhysics = DEFAULT_PHYSICS,
  resolution: "coarse" | "fine" = "fine",
  escapeFactorOverride?: number,
): ReactorResult {
  const nr = resolution === "fine" ? 22 : 11;
  const nz = resolution === "fine" ? 34 : 18;
  let averageGasTemperatureK = 1700;
  let grid: ReactorGrid | undefined;
  let atomic = reducedAtomicState(design, physics, averageGasTemperatureK, escapeFactorOverride);
  let optical = opticalAndPV(atomic, physics);
  let thermal = solveThermalField(design, physics, physics.fuelPowerKW - atomic.linePowerKW, nr, nz, grid);
  let totalIterations = 0;
  for (let coupling = 0; coupling < 3; coupling++) {
    grid = thermal.grid;
    const stats = fieldStatistics(grid);
    averageGasTemperatureK = 0.55 * averageGasTemperatureK + 0.45 * stats.averageGasTemperatureK;
    atomic = reducedAtomicState(design, physics, averageGasTemperatureK, escapeFactorOverride);
    optical = opticalAndPV(atomic, physics);
    const reactorHeatKW = Math.max(0, physics.fuelPowerKW - atomic.linePowerKW);
    thermal = solveThermalField(design, physics, reactorHeatKW, nr, nz, grid);
    totalIterations += thermal.iterations;
    if (coupling >= 1 && (
      stats.maximumGasTemperatureK > physics.maximumGasTemperatureK + 1200 ||
      stats.maximumSapphireTemperatureK > physics.maximumSapphireTemperatureK + 1200
    )) break;
  }
  const stats = fieldStatistics(thermal.grid);
  const reactorHeatKW = Math.max(0, physics.fuelPowerKW - atomic.linePowerKW);
  const energyResidualKW = physics.fuelPowerKW - (
    optical.electricPowerKW + optical.cellHeatKW + optical.lineLossKW + thermal.boundaryHeatKW
  );
  const constraintMarginK = Math.min(
    physics.maximumGasTemperatureK - stats.maximumGasTemperatureK,
    physics.maximumSapphireTemperatureK - stats.maximumSapphireTemperatureK,
  );
  return {
    design, physics, grid: thermal.grid, atomic,
    ...stats, linePowerKW: atomic.linePowerKW, ...optical, reactorHeatKW,
    boundaryHeatKW: thermal.boundaryHeatKW, energyResidualKW,
    efficiency: optical.electricPowerKW / physics.fuelPowerKW,
    constraintMarginK,
    feasible: constraintMarginK >= 0 && Math.abs(energyResidualKW) < 0.08 * physics.fuelPowerKW,
    iterations: totalIterations,
  };
}

function halton(index: number, base: number) {
  let fraction = 1, value = 0, i = index;
  while (i > 0) {
    fraction /= base;
    value += fraction * (i % base);
    i = Math.floor(i / base);
  }
  return value;
}

function designFromUnit(values: number[]): ReactorDesign {
  const keys = Object.keys(DESIGN_BOUNDS) as Array<keyof ReactorDesign>;
  return Object.fromEntries(keys.map((key, index) => {
    const [low, high] = DESIGN_BOUNDS[key];
    return [key, low + values[index] * (high - low)];
  })) as ReactorDesign;
}

function score(result: ReactorResult) {
  const thermalPenalty = Math.max(0, -result.constraintMarginK) * 0.02;
  const closurePenalty = Math.max(0, Math.abs(result.energyResidualKW) - 0.02) * 2;
  return result.electricPowerKW - thermalPenalty - closurePenalty;
}

function robustEvaluation(design: ReactorDesign, physics: ReactorPhysics) {
  const cases = [
    {},
    { excitationFraction: physics.excitationFraction * 0.72 },
    { quenchCoefficientCm3s: physics.quenchCoefficientCm3s * 8 },
    { sodiumActivity: physics.sodiumActivity * 0.45 },
  ];
  for (const factor of [1, 0.76, 0.58, 0.42]) {
    const scenarioResults = cases.map((overrides) => simulateReactor(design, {
      ...physics, ...overrides, fuelPowerKW: physics.fuelPowerKW * factor,
    }, "coarse"));
    if (scenarioResults.every((result) => result.feasible)) return {
      robustPowerKW: Math.min(...scenarioResults.map((result) => result.electricPowerKW)),
      ratedFuelPowerKW: physics.fuelPowerKW * factor,
    };
  }
  return { robustPowerKW: -Infinity, ratedFuelPowerKW: physics.fuelPowerKW * 0.42 };
}

export function optimizeReactor(
  physics: ReactorPhysics = DEFAULT_PHYSICS,
  candidateCount = 56,
): OptimizationResult {
  const primes = [2, 3, 5, 7, 11, 13, 17];
  const coarse: Array<{ result: ReactorResult; score: number }> = [];
  const anchors: ReactorDesign[] = [
    DEFAULT_DESIGN,
    { ...DEFAULT_DESIGN, coreRadiusMm: 48, coreLengthMm: 190, sapphireMm: 6, insulationMm: 4, sourceRadiusFraction: 0.70 },
    { ...DEFAULT_DESIGN, coreRadiusMm: 44, coreLengthMm: 175, sapphireMm: 5, insulationMm: 4, reservoirTemperatureK: 950, bufferPressureTorr: 20, sourceRadiusFraction: 0.68 },
  ];
  for (const design of anchors) {
    const result = simulateReactor(design, physics, "coarse");
    coarse.push({ result, score: score(result) });
  }
  for (let n = 1; n <= candidateCount; n++) {
    const design = designFromUnit(primes.map((base) => halton(n + 7, base)));
    const result = simulateReactor(design, physics, "coarse");
    coarse.push({ result, score: score(result) });
  }
  coarse.sort((a, b) => b.score - a.score);
  const finalists = coarse.slice(0, 3).map(({ result }) => ({
    design: result.design,
    ...robustEvaluation(result.design, physics),
  })).sort((a, b) => b.robustPowerKW - a.robustPowerKW);
  let bestDesign = finalists[0].design;
  let bestRobust = finalists[0].robustPowerKW;
  let ratedFuelPowerKW = finalists[0].ratedFuelPowerKW;
  const keys: Array<keyof ReactorDesign> = [
    "coreRadiusMm", "coreLengthMm", "insulationMm",
    "reservoirTemperatureK", "bufferPressureTorr",
  ];
  for (let pass = 0; pass < 1; pass++) for (const key of keys) for (const sign of [-1, 1]) {
    const [low, high] = DESIGN_BOUNDS[key];
    const trial = { ...bestDesign, [key]: Math.max(low, Math.min(high,
      bestDesign[key] + sign * (high - low) * (pass ? 0.04 : 0.09))) };
    const robust = robustEvaluation(trial, physics);
    if (robust.robustPowerKW > bestRobust) {
      bestDesign = trial;
      bestRobust = robust.robustPowerKW;
      ratedFuelPowerKW = robust.ratedFuelPowerKW;
    }
  }
  const ratedPhysics = { ...physics, fuelPowerKW: ratedFuelPowerKW };
  const preliminary = simulateReactor(bestDesign, ratedPhysics, "fine");
  const transport = simulateAtomicTransport(preliminary.atomic.atomicInputs, 1400, 7811);
  const best = simulateReactor(
    bestDesign, ratedPhysics, "fine", transport.escapeProbabilityPerEmission,
  );
  best.transportValidation = {
    packets: 1400,
    surrogateEscapeFactor: preliminary.atomic.escapeFactor,
    monteCarloEscapeFactor: transport.escapeProbabilityPerEmission,
    packetResidual: 1400 - transport.escaped - transport.quenched - transport.truncated,
  };
  const points = coarse.map(({ result }) => ({
    design: result.design,
    electricPowerKW: result.electricPowerKW,
    efficiency: result.efficiency,
    maximumTemperatureK: Math.max(result.maximumGasTemperatureK, result.maximumSapphireTemperatureK),
    feasible: result.feasible,
    robustPowerKW: finalists.find((item) => item.design === result.design)?.robustPowerKW ?? result.electricPowerKW,
  }));
  return {
    best, points, evaluations: coarse.length + 3 * 16 + 10 * 16,
    robustWorstCaseKW: bestRobust,
    ratedFuelPowerKW,
  };
}

export function temperatureAt(grid: ReactorGrid, radialIndex: number, axialIndex: number) {
  return grid.temperaturesK[axialIndex * grid.nr + radialIndex];
}
