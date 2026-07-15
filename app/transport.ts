export type Point = { x: number; y: number };
export type PhotonPath = { points: Point[]; escaped: boolean; detuning: number };
export type SimResult = {
  paths: PhotonPath[];
  escaped: number;
  quenched: number;
  meanScatters: number;
  meanDelay: number;
  escapeFactor: number;
  spectrum: number[];
};

export const BINS = 65;
export const X_MAX = 8;
export const PHOTONS = 3200;
const LIFETIME_NS = 16.2;

function mulberry32(seed: number) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random: () => number) {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export function sampleLine(random: () => number, broadening: number) {
  const lorentzWeight = broadening / (broadening + 0.38);
  if (random() < lorentzWeight) {
    const cauchy = Math.tan(Math.PI * (random() - 0.5));
    return Math.max(-12, Math.min(12, broadening * cauchy));
  }
  return normal(random);
}

export function lineOpacity(x: number, broadening: number) {
  const lorentzWeight = broadening / (broadening + 0.38);
  const width = Math.max(0.01, broadening);
  const gaussian = Math.exp(-x * x) / Math.sqrt(Math.PI);
  const lorentz = width / (Math.PI * (x * x + width * width));
  const profile = (1 - lorentzWeight) * gaussian + lorentzWeight * lorentz;
  const center =
    (1 - lorentzWeight) / Math.sqrt(Math.PI) +
    lorentzWeight / (Math.PI * width);
  return profile / center;
}

export function distanceToCircle(p: Point, dx: number, dy: number) {
  const projection = p.x * dx + p.y * dy;
  const discriminant = projection * projection + 1 - p.x * p.x - p.y * p.y;
  return -projection + Math.sqrt(Math.max(0, discriminant));
}

export function simulate(
  tau: number,
  broadening: number,
  quench: number,
  radiusMm: number,
  seed: number,
): SimResult {
  const random = mulberry32(seed);
  const paths: PhotonPath[] = [];
  const spectrum = Array(BINS).fill(0) as number[];
  let escaped = 0;
  let quenched = 0;
  let scatterSum = 0;
  let delaySum = 0;

  for (let n = 0; n < PHOTONS; n++) {
    const startRadius = 0.13 * Math.sqrt(random());
    const startAngle = 2 * Math.PI * random();
    let p = { x: startRadius * Math.cos(startAngle), y: startRadius * Math.sin(startAngle) };
    let x = sampleLine(random, broadening);
    let scatters = 0;
    let delayNs = 0;
    let alive = true;
    const points: Point[] = [{ ...p }];
    let didEscape = false;

    while (alive && scatters < 900) {
      const theta = 2 * Math.PI * random();
      const dx = Math.cos(theta);
      const dy = Math.sin(theta);
      const boundary = distanceToCircle(p, dx, dy);
      const opacity = Math.max(1e-8, tau * lineOpacity(x, broadening));
      const freePath = -Math.log(Math.max(random(), 1e-12)) / opacity;
      const travel = Math.min(freePath, boundary);
      delayNs += (travel * radiusMm * 1e-3) / 299792458 * 1e9;
      p = { x: p.x + dx * travel, y: p.y + dy * travel };

      if (n < 92 && points.length < 34) points.push({ ...p });

      if (freePath >= boundary - 1e-10) {
        escaped++;
        didEscape = true;
        const bin = Math.floor(((x + X_MAX) / (2 * X_MAX)) * BINS);
        if (bin >= 0 && bin < BINS) spectrum[bin]++;
        alive = false;
      } else {
        scatters++;
        delayNs += LIFETIME_NS;
        if (random() < quench) {
          quenched++;
          alive = false;
        } else {
          x = sampleLine(random, broadening);
        }
      }
    }

    if (alive) quenched++;
    scatterSum += scatters;
    delaySum += delayNs;
    if (n < 92) paths.push({ points, escaped: didEscape, detuning: x });
  }

  const meanScatters = scatterSum / PHOTONS;
  return {
    paths,
    escaped,
    quenched,
    meanScatters,
    meanDelay: delaySum / PHOTONS,
    escapeFactor: 1 / (meanScatters + 1),
    spectrum,
  };
}
