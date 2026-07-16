export const C = 299_792_458;
const C_CM = C * 100;
const K_B = 1.380_649e-23;
const U = 1.660_539_066_60e-27;
const MASS_NA = 22.989_769_28 * U;
const R_E_CM = 2.817_940_326_2e-13;
const INTEGRATED_CROSS_SECTION = Math.PI * R_E_CM * C_CM;
const AR_FWHM_HZ_PER_TORR = 30.4e6;

export const SODIUM_LINES = [
  { id: "D2", wavelengthNm: 588.9950, oscillatorStrength: 0.641, A: 6.16e7, weight: 2 },
  { id: "D1", wavelengthNm: 589.5924, oscillatorStrength: 0.320, A: 6.14e7, weight: 1 },
] as const;

export type PhysicalInputs = {
  temperatureK: number;
  sodiumDensityCm3: number;
  argonPressureTorr: number;
  radiusMm: number;
  quenchProbability: number;
};

export type LineState = (typeof SODIUM_LINES)[number] & {
  frequencyHz: number;
  dopplerWidthHz: number;
  lorentzHwhmHz: number;
  voigtA: number;
  mixWeight: number;
  lineCenterCrossSectionCm2: number;
  opticalDepth: number;
};

export type PhysicalResult = {
  lines: LineState[];
  escaped: number;
  quenched: number;
  truncated: number;
  meanScatters: number;
  meanResidenceNs: number;
  escapeFactor: number;
  wavelengthsNm: number[];
};

function profileCenter(a: number, weight: number) {
  const width = Math.max(a, 1e-8);
  return (1 - weight) / Math.sqrt(Math.PI) + weight / (Math.PI * width);
}

export function lineStates(inputs: PhysicalInputs): LineState[] {
  const radiusCm = inputs.radiusMm / 10;
  return SODIUM_LINES.map((line) => {
    const wavelengthM = line.wavelengthNm * 1e-9;
    const frequencyHz = C / wavelengthM;
    const thermalSpeed = Math.sqrt((2 * K_B * inputs.temperatureK) / MASS_NA);
    const dopplerWidthHz = (frequencyHz / C) * thermalSpeed;
    const lorentzHwhmHz = line.A / (4 * Math.PI) +
      (AR_FWHM_HZ_PER_TORR * inputs.argonPressureTorr) / 2;
    const voigtA = lorentzHwhmHz / dopplerWidthHz;
    const mixWeight = voigtA / (voigtA + 0.38);
    const phiCenterPerHz = profileCenter(voigtA, mixWeight) / dopplerWidthHz;
    const lineCenterCrossSectionCm2 =
      INTEGRATED_CROSS_SECTION * line.oscillatorStrength * phiCenterPerHz;
    const opticalDepth = inputs.sodiumDensityCm3 * radiusCm * lineCenterCrossSectionCm2;
    return {
      ...line,
      frequencyHz,
      dopplerWidthHz,
      lorentzHwhmHz,
      voigtA,
      mixWeight,
      lineCenterCrossSectionCm2,
      opticalDepth,
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
  return Math.sqrt(-Math.log(Math.max(random(), 1e-12))) *
    Math.cos(2 * Math.PI * random());
}

function sampleDetuning(random: () => number, line: LineState) {
  if (random() < line.mixWeight) {
    return Math.max(-50, Math.min(50,
      line.voigtA * Math.tan(Math.PI * (random() - 0.5))));
  }
  return gaussian(random);
}

function relativeProfile(x: number, line: LineState) {
  const width = Math.max(line.voigtA, 1e-8);
  const gaussianPart = Math.exp(-x * x) / Math.sqrt(Math.PI);
  const lorentzPart = width / (Math.PI * (x * x + width * width));
  const profile = (1 - line.mixWeight) * gaussianPart + line.mixWeight * lorentzPart;
  return profile / profileCenter(line.voigtA, line.mixWeight);
}

function distanceToWall(x: number, y: number, dx: number, dy: number) {
  const projection = x * dx + y * dy;
  return -projection + Math.sqrt(Math.max(0,
    projection * projection + 1 - x * x - y * y));
}

export function simulatePhysical(
  inputs: PhysicalInputs,
  packets = 2400,
  seed = 1904,
): PhysicalResult {
  const lines = lineStates(inputs);
  const random = randomGenerator(seed);
  const wavelengthsNm: number[] = [];
  let escaped = 0;
  let quenched = 0;
  let truncated = 0;
  let scatteringTotal = 0;
  let residenceTotal = 0;

  for (let n = 0; n < packets; n++) {
    const line = random() < 2 / 3 ? lines[0] : lines[1];
    const startRadius = 0.13 * Math.sqrt(random());
    const startAngle = 2 * Math.PI * random();
    let px = startRadius * Math.cos(startAngle);
    let py = startRadius * Math.sin(startAngle);
    let detuning = sampleDetuning(random, line);
    let scatterings = 0;
    let residenceNs = 0;
    let alive = true;

    while (alive && scatterings < 1200) {
      const angle = 2 * Math.PI * random();
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      const boundary = distanceToWall(px, py, dx, dy);
      const opacity = Math.max(1e-12,
        line.opticalDepth * relativeProfile(detuning, line));
      const freePath = -Math.log(Math.max(random(), 1e-12)) / opacity;
      const travel = Math.min(boundary, freePath);
      residenceNs += (travel * inputs.radiusMm * 1e-3 / C) * 1e9;
      px += dx * travel;
      py += dy * travel;

      if (freePath >= boundary - 1e-10) {
        escaped++;
        const frequency = line.frequencyHz + detuning * line.dopplerWidthHz;
        wavelengthsNm.push((C / frequency) * 1e9);
        alive = false;
      } else {
        scatterings++;
        residenceNs += (1 / line.A) * 1e9;
        if (random() < inputs.quenchProbability) {
          quenched++;
          alive = false;
        } else {
          detuning = sampleDetuning(random, line);
        }
      }
    }

    if (alive) truncated++;
    scatteringTotal += scatterings;
    residenceTotal += residenceNs;
  }

  const meanScatters = scatteringTotal / packets;
  return {
    lines,
    escaped,
    quenched,
    truncated,
    meanScatters,
    meanResidenceNs: residenceTotal / packets,
    escapeFactor: 1 / (meanScatters + 1),
    wavelengthsNm,
  };
}
