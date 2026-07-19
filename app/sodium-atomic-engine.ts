export const C = 299_792_458;
export const H = 6.626_070_15e-34;
export const EV = 1.602_176_634e-19;
export const KB = 1.380_649e-23;
const U = 1.660_539_066_60e-27;
const MASS_NA = 22.989_769_28 * U;
const RE_CM = 2.817_940_326_2e-13;
const INTEGRATED_CROSS_SECTION = Math.PI * RE_CM * C * 100;
const SQRT_PI = Math.sqrt(Math.PI);
const AR_FWHM_450K_HZ_PER_TORR = 30.4e6;

export type HyperfineComponent = {
  lowerF: number;
  upperF: number;
  offsetMHz: number;
  strength: number;
};

export const SODIUM_LINES = [
  {
    id: "D2", wavelengthNm: 588.9950, oscillatorStrength: 0.641, A: 6.16e7, weight: 2,
    hyperfine: [
      { lowerF: 1, upperF: 0, offsetMHz: 1041.1688305, strength: 0.0625 },
      { lowerF: 1, upperF: 1, offsetMHz: 1056.9788305, strength: 0.15625 },
      { lowerF: 1, upperF: 2, offsetMHz: 1091.3228305, strength: 0.15625 },
      { lowerF: 2, upperF: 1, offsetMHz: -714.6472983, strength: 0.03125 },
      { lowerF: 2, upperF: 2, offsetMHz: -680.3032983, strength: 0.15625 },
      { lowerF: 2, upperF: 3, offsetMHz: -621.9772983, strength: 0.4375 },
    ],
  },
  {
    id: "D1", wavelengthNm: 589.5924, oscillatorStrength: 0.320, A: 6.14e7, weight: 1,
    hyperfine: [
      { lowerF: 1, upperF: 1, offsetMHz: 989.3307055, strength: 0.0625 },
      { lowerF: 1, upperF: 2, offsetMHz: 1178.0277055, strength: 0.3125 },
      { lowerF: 2, upperF: 1, offsetMHz: -782.2954233, strength: 0.3125 },
      { lowerF: 2, upperF: 2, offsetMHz: -593.5984233, strength: 0.3125 },
    ],
  },
] as const;

export type AtomicInputs = {
  temperatureK: number;
  sodiumMixingPpm: number;
  bufferPressureTorr: number;
  radiusMm: number;
  lengthMm: number;
  quenchCoefficientCm3s: number;
  pumpRateS: number;
  sourceRadiusFraction: number;
};

export type AtomicLineState = (typeof SODIUM_LINES)[number] & {
  frequencyHz: number;
  dopplerWidthHz: number;
  lorentzHwhmHz: number;
  voigtA: number;
  collisionFwhmHz: number;
  crdProbability: number;
  components: Array<HyperfineComponent & { offsetX: number }>;
  centerCrossSectionCm2: number;
  radialOpticalDepth: number;
};

export type AtomicTransportResult = {
  lines: AtomicLineState[];
  escaped: number;
  quenched: number;
  truncated: number;
  radialEscapes: number;
  axialEscapes: number;
  emissions: number;
  meanScatters: number;
  meanResidenceNs: number;
  escapeProbabilityPerEmission: number;
  ultimateEscapeFraction: number;
  bufferDensityCm3: number;
  sodiumDensityCm3: number;
  quenchRateS: number;
  quenchProbability: number;
  wavelengthsNm: number[];
  paths: Array<{
    points: Array<{ x: number; y: number }>;
    escaped: boolean;
    surface: "radial" | "axial" | "quenched" | "truncated";
  }>;
};

type Complex = { re: number; im: number };
const complex = (re: number, im = 0): Complex => ({ re, im });
const add = (a: Complex, b: Complex): Complex => complex(a.re + b.re, a.im + b.im);
const sub = (a: Complex, b: Complex): Complex => complex(a.re - b.re, a.im - b.im);
const mul = (a: Complex, b: Complex): Complex => complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const scale = (a: Complex, x: number): Complex => complex(a.re * x, a.im * x);
const div = (a: Complex, b: Complex): Complex => {
  const d = b.re * b.re + b.im * b.im;
  return complex((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const expc = (z: Complex): Complex => {
  const e = Math.exp(z.re);
  return complex(e * Math.cos(z.im), e * Math.sin(z.im));
};
const alternatingHorner = (u: Complex, coefficients: number[]) => {
  let value = complex(coefficients[coefficients.length - 1]);
  for (let i = coefficients.length - 2; i >= 0; i--)
    value = sub(complex(coefficients[i]), mul(u, value));
  return value;
};

// Humlicek W4 approximation to Re[w(x+ia)]; relative error is typically < 1e-4.
export function voigtH(a: number, x: number) {
  const y = Math.max(a, 1e-10);
  const t = complex(y, -x);
  const u = mul(t, t);
  const s = Math.abs(x) + y;
  let w: Complex;
  if (s >= 15) {
    w = div(scale(t, 0.5641896), add(complex(0.5), u));
  } else if (s >= 5.5) {
    w = div(mul(t, add(complex(1.410474), scale(u, 0.5641896))), add(complex(0.75), mul(u, add(complex(3), u))));
  } else if (y >= 0.195 * Math.abs(x) - 0.176) {
    const num = add(complex(16.4955), mul(t, add(complex(20.20933), mul(t, add(complex(11.96482), mul(t, add(complex(3.778987), scale(t, 0.5642236))))))));
    const den = add(complex(16.4955), mul(t, add(complex(38.82363), mul(t, add(complex(39.27121), mul(t, add(complex(21.69274), mul(t, add(complex(6.699398), t)))))))));
    w = div(num, den);
  } else {
    const un = alternatingHorner(u, [36183.31, 3321.99, 1540.787, 219.031, 35.7668, 1.320522, 0.56419]);
    const ud = alternatingHorner(u, [32066.6, 24322.8, 9022.23, 2186.18, 364.219, 61.5704, 1.84144, 1]);
    w = sub(expc(u), mul(t, div(un, ud)));
  }
  return Math.max(0, w.re);
}

export function gasDensities(inputs: AtomicInputs) {
  const bufferDensityCm3 = inputs.bufferPressureTorr * 133.322368 /
    (KB * inputs.temperatureK) / 1e6;
  return {
    bufferDensityCm3,
    sodiumDensityCm3: bufferDensityCm3 * inputs.sodiumMixingPpm * 1e-6,
  };
}

export function atomicLineStates(inputs: AtomicInputs): AtomicLineState[] {
  const { sodiumDensityCm3 } = gasDensities(inputs);
  return SODIUM_LINES.map((line) => {
    const frequencyHz = C / (line.wavelengthNm * 1e-9);
    const dopplerWidthHz = frequencyHz / C * Math.sqrt(2 * KB * inputs.temperatureK / MASS_NA);
    const collisionFwhmHz = AR_FWHM_450K_HZ_PER_TORR * inputs.bufferPressureTorr *
      Math.sqrt(450 / inputs.temperatureK);
    const lorentzHwhmHz = line.A / (4 * Math.PI) + collisionFwhmHz / 2;
    const voigtA = lorentzHwhmHz / dopplerWidthHz;
    const collisionRateS = Math.PI * collisionFwhmHz;
    const crdProbability = collisionRateS / (collisionRateS + line.A);
    const components = line.hyperfine.map((component) => ({
      ...component,
      offsetX: component.offsetMHz * 1e6 / dopplerWidthHz,
    }));
    const aggregateCenter = components.reduce((sum, component) =>
      sum + component.strength * voigtH(voigtA, -component.offsetX), 0);
    const centerCrossSectionCm2 = INTEGRATED_CROSS_SECTION * line.oscillatorStrength *
      aggregateCenter / (SQRT_PI * dopplerWidthHz);
    return {
      ...line, frequencyHz, dopplerWidthHz, collisionFwhmHz, lorentzHwhmHz,
      voigtA, crdProbability, components, centerCrossSectionCm2,
      radialOpticalDepth: sodiumDensityCm3 * inputs.radiusMm / 10 * centerCrossSectionCm2,
    };
  });
}

function randomGenerator(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number) {
  return Math.sqrt(-Math.log(Math.max(random(), 1e-15))) * Math.cos(2 * Math.PI * random());
}

function chooseComponent(random: () => number, line: AtomicLineState) {
  let target = random();
  for (const component of line.components) {
    target -= component.strength;
    if (target <= 0) return component;
  }
  return line.components[line.components.length - 1];
}

function sampleVoigt(random: () => number, line: AtomicLineState, component = chooseComponent(random, line)) {
  return component.offsetX + gaussian(random) +
    line.voigtA * Math.tan(Math.PI * (random() - 0.5));
}

function componentAtAbsorption(random: () => number, line: AtomicLineState, x: number) {
  const weights = line.components.map((component) =>
    component.strength * voigtH(line.voigtA, x - component.offsetX));
  let target = random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    target -= weights[i];
    if (target <= 0) return line.components[i];
  }
  return line.components[line.components.length - 1];
}

function samplePartialRedistribution(
  random: () => number,
  line: AtomicLineState,
  absorbedX: number,
  component: AtomicLineState["components"][number],
) {
  const x = absorbedX - component.offsetX;
  let velocity = Math.max(-5, Math.min(5, x));
  const logTarget = (u: number) => -u * u - Math.log((x - u) ** 2 + line.voigtA ** 2);
  let logP = logTarget(velocity);
  for (let i = 0; i < 7; i++) {
    const trial = velocity + 0.7 * gaussian(random);
    const trialLogP = logTarget(trial);
    if (Math.log(Math.max(random(), 1e-15)) < trialLogP - logP) {
      velocity = trial;
      logP = trialLogP;
    }
  }
  const mu = 2 * random() - 1;
  const transverseVelocity = gaussian(random);
  const projectedVelocity = mu * velocity + Math.sqrt(Math.max(0, 1 - mu * mu)) * transverseVelocity;
  return component.offsetX + projectedVelocity +
    line.voigtA * Math.tan(Math.PI * (random() - 0.5));
}

function opacityCm(line: AtomicLineState, sodiumDensityCm3: number, x: number) {
  const profile = line.components.reduce((sum, component) =>
    sum + component.strength * voigtH(line.voigtA, x - component.offsetX), 0);
  return sodiumDensityCm3 * INTEGRATED_CROSS_SECTION * line.oscillatorStrength *
    profile / (SQRT_PI * line.dopplerWidthHz);
}

function isotropicDirection(random: () => number) {
  const z = 2 * random() - 1;
  const phi = 2 * Math.PI * random();
  const radial = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: radial * Math.cos(phi), y: radial * Math.sin(phi), z };
}

function distanceToBoundary(
  p: { x: number; y: number; z: number },
  d: { x: number; y: number; z: number },
  radiusCm: number,
  halfLengthCm: number,
) {
  const aa = d.x * d.x + d.y * d.y;
  let radial = Infinity;
  if (aa > 1e-14) {
    const b = p.x * d.x + p.y * d.y;
    radial = (-b + Math.sqrt(Math.max(0, b * b + aa * (radiusCm * radiusCm - p.x * p.x - p.y * p.y)))) / aa;
  }
  let axial = Infinity;
  if (d.z > 1e-14) axial = (halfLengthCm - p.z) / d.z;
  else if (d.z < -1e-14) axial = (-halfLengthCm - p.z) / d.z;
  return radial < axial ? { distance: radial, surface: "radial" as const } :
    { distance: axial, surface: "axial" as const };
}

export function simulateAtomicTransport(
  inputs: AtomicInputs,
  packets = 2400,
  seed = 1904,
): AtomicTransportResult {
  const random = randomGenerator(seed);
  const lines = atomicLineStates(inputs);
  const profileLimit = 50, profileStep = 0.01;
  const profileTables = lines.map((line) => {
    const values = new Float64Array(Math.round(2 * profileLimit / profileStep) + 1);
    for (let i = 0; i < values.length; i++) {
      const x = -profileLimit + i * profileStep;
      values[i] = line.components.reduce((sum, component) =>
        sum + component.strength * voigtH(line.voigtA, x - component.offsetX), 0);
    }
    return values;
  });
  const { bufferDensityCm3, sodiumDensityCm3 } = gasDensities(inputs);
  const quenchRateS = inputs.quenchCoefficientCm3s * bufferDensityCm3;
  const averageA = (2 * lines[0].A + lines[1].A) / 3;
  const quenchProbability = quenchRateS / (averageA + quenchRateS);
  const radiusCm = inputs.radiusMm / 10;
  const halfLengthCm = inputs.lengthMm / 20;
  const wavelengthsNm: number[] = [];
  const paths: AtomicTransportResult["paths"] = [];
  let escaped = 0, quenched = 0, truncated = 0, radialEscapes = 0, axialEscapes = 0;
  let emissions = 0, scatterTotal = 0, residenceTotal = 0;

  for (let n = 0; n < packets; n++) {
    const lineIndex = random() < 2 / 3 ? 0 : 1;
    const line = lines[lineIndex];
    const sourceRadius = radiusCm * inputs.sourceRadiusFraction * Math.sqrt(random());
    const sourceAngle = 2 * Math.PI * random();
    const p = {
      x: sourceRadius * Math.cos(sourceAngle),
      y: sourceRadius * Math.sin(sourceAngle),
      z: (2 * random() - 1) * halfLengthCm,
    };
    let x = sampleVoigt(random, line);
    let scatterings = 0, residenceNs = 0;
    let alive = true;
    const points = [{ x: p.x / radiusCm, y: p.y / radiusCm }];
    let finalSurface: AtomicTransportResult["paths"][number]["surface"] = "truncated";
    emissions++;
    while (alive && scatterings < 4000) {
      const direction = isotropicDirection(random);
      const boundary = distanceToBoundary(p, direction, radiusCm, halfLengthCm);
      let profile: number;
      if (x <= -profileLimit || x >= profileLimit) {
        profile = line.components.reduce((sum, component) =>
          sum + component.strength * voigtH(line.voigtA, x - component.offsetX), 0);
      } else {
        const position = (x + profileLimit) / profileStep;
        const index = Math.floor(position), fraction = position - index;
        const table = profileTables[lineIndex];
        profile = table[index] * (1 - fraction) + table[index + 1] * fraction;
      }
      const alpha = Math.max(1e-30, sodiumDensityCm3 * INTEGRATED_CROSS_SECTION *
        line.oscillatorStrength * profile / (SQRT_PI * line.dopplerWidthHz));
      const freePathCm = -Math.log(Math.max(random(), 1e-15)) / alpha;
      const travelCm = Math.min(freePathCm, boundary.distance);
      residenceNs += travelCm / (C * 100) * 1e9;
      p.x += direction.x * travelCm;
      p.y += direction.y * travelCm;
      p.z += direction.z * travelCm;
      if (n < 78 && points.length < 40)
        points.push({ x: p.x / radiusCm, y: p.y / radiusCm });
      if (freePathCm >= boundary.distance - 1e-10) {
        escaped++;
        if (boundary.surface === "radial") radialEscapes++; else axialEscapes++;
        wavelengthsNm.push(C / (line.frequencyHz + x * line.dopplerWidthHz) * 1e9);
        finalSurface = boundary.surface;
        alive = false;
      } else {
        scatterings++;
        residenceNs += 1 / (line.A + quenchRateS) * 1e9;
        if (random() < quenchRateS / (line.A + quenchRateS)) {
          quenched++;
          finalSurface = "quenched";
          alive = false;
        } else {
          emissions++;
          if (random() < line.crdProbability) x = sampleVoigt(random, line);
          else {
            const component = componentAtAbsorption(random, line, x);
            x = samplePartialRedistribution(random, line, x, component);
          }
        }
      }
    }
    if (alive) truncated++;
    scatterTotal += scatterings;
    residenceTotal += residenceNs;
    if (n < 78) paths.push({ points, escaped: finalSurface === "radial" || finalSurface === "axial", surface: finalSurface });
  }
  return {
    lines, escaped, quenched, truncated, radialEscapes, axialEscapes, emissions,
    meanScatters: scatterTotal / packets,
    meanResidenceNs: residenceTotal / packets,
    escapeProbabilityPerEmission: emissions ? escaped / emissions : 0,
    ultimateEscapeFraction: escaped / packets,
    bufferDensityCm3, sodiumDensityCm3, quenchRateS, quenchProbability,
    wavelengthsNm, paths,
  };
}

export function nonEquilibriumPopulation(inputs: AtomicInputs, result: AtomicTransportResult) {
  const averageA = (2 * result.lines[0].A + result.lines[1].A) / 3;
  const photonEV = (2 * H * C / (result.lines[0].wavelengthNm * 1e-9) +
    H * C / (result.lines[1].wavelengthNm * 1e-9)) / (3 * EV);
  const effectiveRadiativeRateS = averageA * result.escapeProbabilityPerEmission;
  // A non-inverted 3s/3p manifold saturates at g(3p)/(g(3s)+g(3p)) = 6/8.
  // Population inversion is deliberately excluded until a specific pump mechanism is supplied.
  const upperFraction = Math.min(0.75, inputs.pumpRateS /
    (inputs.pumpRateS + effectiveRadiativeRateS + result.quenchRateS));
  const volumeCm3 = Math.PI * (inputs.radiusMm / 10) ** 2 * (inputs.lengthMm / 10);
  const atomCount = result.sodiumDensityCm3 * volumeCm3;
  const linePowerKW = atomCount * upperFraction * effectiveRadiativeRateS * photonEV * EV / 1000;
  const quenchPowerKW = atomCount * upperFraction * result.quenchRateS * photonEV * EV / 1000;
  // Convert the g-weighted Boltzmann ratio n_up/n_low into the same
  // n_up/(n_up+n_low) fraction that upperFraction reports.
  const boltzmannRatio = 3 * Math.exp(-photonEV * EV / (KB * inputs.temperatureK));
  const boltzmannUpperFraction = boltzmannRatio / (1 + boltzmannRatio);
  return {
    photonEV, effectiveRadiativeRateS, upperFraction, boltzmannUpperFraction,
    enhancement: upperFraction / Math.max(boltzmannUpperFraction, 1e-30),
    volumeCm3, atomCount, linePowerKW, quenchPowerKW,
    pumpPowerKW: linePowerKW + quenchPowerKW,
  };
}
