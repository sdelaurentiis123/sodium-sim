import { nonEquilibriumPopulation, simulateAtomicTransport, type AtomicInputs, type AtomicTransportResult } from "./sodium-atomic-engine";
import {
  DEFAULT_PHYSICS, simulateReactor,
  type OptimizationResult, type ReactorDesign, type ReactorResult,
} from "./reactor-engine.ts";

const PACKETS = 2400;
const BINS = 180;
const WL_MIN = 588.75;
const WL_MAX = 589.85;
const presets: Record<string, [number, number, number, number, number, number, number, number]> = {
  spectroscopy: [1500, 2, 3, -11, 12, 40, 8, 0.35],
  reactor: [2000, 3, 50, -13, 30, 100, 9, 0.35],
  quenched: [2000, 3, 50, -11, 30, 100, 9, 0.35],
};
const $ = (id: string) => document.getElementById(id)!;
const physical = {
  temp: $("temp") as HTMLInputElement,
  density: $("density") as HTMLInputElement,
  pressure: $("pressure") as HTMLInputElement,
  quench: $("quench") as HTMLInputElement,
  radius: $("radius") as HTMLInputElement,
  length: $("length") as HTMLInputElement,
  pump: $("pump") as HTMLInputElement,
  source: $("source") as HTMLInputElement,
};
const referenceDesign: ReactorDesign = {
  coreRadiusMm: 40.94,
  coreLengthMm: 162.85,
  sapphireMm: 5,
  insulationMm: 4,
  reservoirTemperatureK: 934.25,
  bufferPressureTorr: 9.92,
  sourceRadiusFraction: 0.68,
};
let seed = 1904;
let latest: AtomicTransportResult | null = null;
let latestInputs: AtomicInputs | null = null;
let reactorResult: ReactorResult | null = null;
let optimizationResult: OptimizationResult | null = null;
let mapMode: "temperature" | "material" | "source" = "temperature";
let animation = 0;
let debounceTimer = 0;

function physicalValues(): AtomicInputs {
  return {
    temperatureK: Number(physical.temp.value),
    sodiumMixingPpm: 10 ** Number(physical.density.value),
    bufferPressureTorr: Number(physical.pressure.value),
    quenchCoefficientCm3s: 10 ** Number(physical.quench.value),
    radiusMm: Number(physical.radius.value),
    lengthMm: Number(physical.length.value),
    pumpRateS: 10 ** Number(physical.pump.value),
    sourceRadiusFraction: Number(physical.source.value),
  };
}

function fit(canvas: HTMLCanvasElement) {
  const ratio = devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  const context = canvas.getContext("2d")!;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return [context, rect.width, rect.height] as const;
}

function drawPaths(result: AtomicTransportResult, radiusMm: number) {
  cancelAnimationFrame(animation);
  const canvas = $("transport") as HTMLCanvasElement;
  const [context, width, height] = fit(canvas);
  const cx = width / 2, cy = height / 2, radius = Math.min(width, height) * 0.365;
  let frame = 0;
  function draw() {
    context.clearRect(0, 0, width, height);
    const glow = context.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.35);
    glow.addColorStop(0, "rgba(255,190,52,.16)");
    glow.addColorStop(0.6, "rgba(249,126,20,.05)");
    glow.addColorStop(1, "transparent");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
    context.save();
    context.beginPath();
    context.arc(cx, cy, radius, 0, 2 * Math.PI);
    context.clip();
    context.fillStyle = "rgba(255,170,35,.045)";
    context.fillRect(cx - radius, cy - radius, 2 * radius, 2 * radius);
    const visible = Math.floor(frame / 1.6);
    result.paths.forEach((path, pathIndex) => {
      if (pathIndex > visible / 3 + 5) return;
      const count = Math.min(path.points.length - 1, Math.max(0, visible - pathIndex * 3));
      for (let i = 0; i < count; i++) {
        const a = path.points[i], b = path.points[i + 1];
        context.beginPath();
        context.moveTo(cx + a.x * radius, cy + a.y * radius);
        context.lineTo(cx + b.x * radius, cy + b.y * radius);
        const base = path.surface === "quenched" ? "239,111,98" : path.surface === "axial" ? "95,210,202" : "255,197,61";
        context.strokeStyle = `rgba(${base},${0.1 + 0.35 * i / path.points.length})`;
        context.lineWidth = pathIndex < 12 ? 1.4 : 0.7;
        context.stroke();
      }
    });
    context.restore();
    context.beginPath();
    context.arc(cx, cy, radius, 0, 2 * Math.PI);
    context.strokeStyle = "rgba(131,224,218,.42)";
    context.stroke();
    context.fillStyle = "rgba(255,255,255,.45)";
    context.font = "10px ui-monospace,monospace";
    context.fillText("3D paths projected radially", 15, height - 17);
    context.textAlign = "right";
    context.fillText(`${radiusMm.toFixed(0)} mm radius`, width - 15, height - 17);
    context.textAlign = "left";
    frame++;
    if (frame < 300) animation = requestAnimationFrame(draw);
  }
  draw();
}

function histogram(wavelengths: number[]) {
  const bins = Array(BINS).fill(0) as number[];
  for (const wavelength of wavelengths) {
    const index = Math.floor((wavelength - WL_MIN) / (WL_MAX - WL_MIN) * BINS);
    if (index >= 0 && index < BINS) bins[index]++;
  }
  return bins;
}

function drawSpectrum(wavelengths: number[]) {
  const bins = histogram(wavelengths);
  const canvas = $("spectrum") as HTMLCanvasElement;
  const [context, width, height] = fit(canvas);
  const pad = { left: 43, right: 12, top: 14, bottom: 27 };
  const max = Math.max(1, ...bins);
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "rgba(255,255,255,.08)";
  for (let i = 0; i < 4; i++) {
    const y = pad.top + (height - pad.top - pad.bottom) * i / 3;
    context.beginPath(); context.moveTo(pad.left, y); context.lineTo(width - pad.right, y); context.stroke();
  }
  const gradient = context.createLinearGradient(pad.left, 0, width - pad.right, 0);
  gradient.addColorStop(0, "#f0a22e"); gradient.addColorStop(0.62, "#ffe26b"); gradient.addColorStop(1, "#5fd2ca");
  context.beginPath();
  bins.forEach((value, index) => {
    const x = pad.left + index / (BINS - 1) * (width - pad.left - pad.right);
    const y = height - pad.bottom - value / max * (height - pad.top - pad.bottom);
    if (index) context.lineTo(x, y); else context.moveTo(x, y);
  });
  context.strokeStyle = gradient; context.lineWidth = 2.2; context.stroke();
  context.fillStyle = "rgba(255,255,255,.42)"; context.font = "10px ui-monospace,monospace"; context.textAlign = "center";
  [589.0, 589.3, 589.6].forEach((tick) => context.fillText(`${tick.toFixed(1)} nm`, pad.left + (tick - WL_MIN) / (WL_MAX - WL_MIN) * (width - pad.left - pad.right), height - 9));
  [["D2", 588.995], ["D1", 589.5924]].forEach(([name, raw]) => {
    const wavelength = Number(raw), x = pad.left + (wavelength - WL_MIN) / (WL_MAX - WL_MIN) * (width - pad.left - pad.right);
    context.strokeStyle = "rgba(255,255,255,.16)"; context.beginPath(); context.moveTo(x, pad.top); context.lineTo(x, height - pad.bottom); context.stroke();
    context.fillStyle = "rgba(255,255,255,.45)"; context.fillText(String(name), x + 12, pad.top + 10);
  });
}

const power = (value: number) => value < 1 ? `${(value * 1000).toFixed(0)} W` : `${value.toFixed(2)} kW`;

function colorRamp(value: number) {
  const x = Math.max(0, Math.min(1, value));
  const stops = [
    [8, 20, 34], [24, 90, 99], [238, 151, 39], [245, 86, 55], [255, 226, 107],
  ];
  const position = x * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(position));
  const f = position - index;
  return `rgb(${stops[index].map((channel, c) => Math.round(channel * (1 - f) + stops[index + 1][c] * f)).join(",")})`;
}

function drawReactorMap(result: ReactorResult) {
  const canvas = $("reactorMap") as HTMLCanvasElement;
  const [context, width, height] = fit(canvas);
  const grid = result.grid;
  const pad = { left: 48, right: 18, top: 20, bottom: 34 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxTemperature = Math.max(...grid.temperaturesK);
  const maxSource = Math.max(...grid.heatSourceWm3, 1);
  context.clearRect(0, 0, width, height);
  for (let j = 0; j < grid.nz; j++) for (let side = 0; side < 2; side++) for (let i = 0; i < grid.nr; i++) {
    const index = j * grid.nr + i;
    const radial = side ? grid.nr + i : grid.nr - i - 1;
    const x = pad.left + radial / (2 * grid.nr) * plotWidth;
    const y = pad.top + (grid.nz - j - 1) / grid.nz * plotHeight;
    if (mapMode === "temperature") {
      const normalized = (grid.temperaturesK[index] - result.physics.ambientTemperatureK) /
        Math.max(1, maxTemperature - result.physics.ambientTemperatureK);
      context.fillStyle = colorRamp(normalized);
    } else if (mapMode === "material") {
      context.fillStyle = ["#d27b2d", "#5fd2ca", "#263642"][grid.materials[index]];
    } else {
      context.fillStyle = colorRamp(Math.sqrt(grid.heatSourceWm3[index] / maxSource));
    }
    context.fillRect(x, y, plotWidth / (2 * grid.nr) + 0.8, plotHeight / grid.nz + 0.8);
  }
  context.strokeStyle = "rgba(255,255,255,.25)";
  context.strokeRect(pad.left, pad.top, plotWidth, plotHeight);
  context.beginPath(); context.moveTo(pad.left + plotWidth / 2, pad.top); context.lineTo(pad.left + plotWidth / 2, pad.top + plotHeight); context.stroke();
  context.fillStyle = "rgba(255,255,255,.48)";
  context.font = "10px ui-monospace,monospace";
  context.textAlign = "center";
  context.fillText(`diameter ${(2 * grid.radiusM * 1000).toFixed(0)} mm`, pad.left + plotWidth / 2, height - 12);
  context.save(); context.translate(13, pad.top + plotHeight / 2); context.rotate(-Math.PI / 2);
  context.fillText(`length ${(2 * grid.halfLengthM * 1000).toFixed(0)} mm`, 0, 0); context.restore();
  $("mapLegend").textContent = mapMode === "temperature" ?
    `${result.physics.ambientTemperatureK.toFixed(0)} K → ${maxTemperature.toFixed(0)} K` :
    mapMode === "material" ? "gas · sapphire · insulation" : "normalized volumetric heating";
}

function drawPareto(points: OptimizationResult["points"], best: ReactorResult) {
  const canvas = $("pareto") as HTMLCanvasElement;
  const [context, width, height] = fit(canvas);
  const pad = { left: 46, right: 16, top: 22, bottom: 28 };
  context.clearRect(0, 0, width, height);
  const all = points.length ? points : [{ maximumTemperatureK: Math.max(best.maximumGasTemperatureK, best.maximumSapphireTemperatureK), electricPowerKW: best.electricPowerKW, feasible: best.feasible }];
  const temperatures = all.map((point) => point.maximumTemperatureK);
  const powers = all.map((point) => point.electricPowerKW);
  const minT = Math.min(1200, ...temperatures), maxT = Math.max(2700, ...temperatures);
  const maxP = Math.max(0.5, ...powers) * 1.12;
  context.strokeStyle = "rgba(255,255,255,.10)"; context.beginPath();
  context.moveTo(pad.left, pad.top); context.lineTo(pad.left, height - pad.bottom); context.lineTo(width - pad.right, height - pad.bottom); context.stroke();
  const xAt = (T: number) => pad.left + (T - minT) / Math.max(1, maxT - minT) * (width - pad.left - pad.right);
  const yAt = (P: number) => height - pad.bottom - P / maxP * (height - pad.top - pad.bottom);
  for (const point of all) {
    context.beginPath(); context.arc(xAt(point.maximumTemperatureK), yAt(point.electricPowerKW), 2.6, 0, 2 * Math.PI);
    context.fillStyle = point.feasible ? "rgba(95,210,202,.72)" : "rgba(239,111,98,.42)"; context.fill();
  }
  context.beginPath(); context.arc(xAt(Math.max(best.maximumGasTemperatureK, best.maximumSapphireTemperatureK)), yAt(best.electricPowerKW), 5, 0, 2 * Math.PI);
  context.strokeStyle = "#ffc43f"; context.lineWidth = 2; context.stroke();
  context.fillStyle = "rgba(255,255,255,.45)"; context.font = "9px ui-monospace,monospace";
  context.textAlign = "left"; context.fillText("candidate envelope · peak temperature →", pad.left, height - 9);
  context.save(); context.translate(11, height / 2); context.rotate(-Math.PI / 2); context.fillText("electric kW", 0, 0); context.restore();
}

function renderReactor(result: ReactorResult, robustWorstCaseKW: number, points: OptimizationResult["points"] = []) {
  reactorResult = result;
  $("netPower").textContent = power(result.electricPowerKW);
  $("wireEff").textContent = `${(result.efficiency * 100).toFixed(1)}%`;
  $("robustPower").textContent = robustWorstCaseKW > 0 ? power(robustWorstCaseKW) : "not feasible";
  $("designR").textContent = `${result.design.coreRadiusMm.toFixed(1)} mm`;
  $("designL").textContent = `${result.design.coreLengthMm.toFixed(1)} mm`;
  $("ratedFuel").textContent = power(result.physics.fuelPowerKW);
  $("designSap").textContent = `${result.design.sapphireMm.toFixed(1)} mm`;
  $("designIns").textContent = `${result.design.insulationMm.toFixed(1)} mm`;
  $("designReservoir").textContent = `${result.design.reservoirTemperatureK.toFixed(0)} K`;
  $("designPressure").textContent = `${result.design.bufferPressureTorr.toFixed(1)} Torr`;
  $("designTau").textContent = result.atomic.opticalDepthD2.toFixed(0);
  $("betaCheck").textContent = result.transportValidation ? result.transportValidation.monteCarloEscapeFactor.toFixed(5) : `${result.atomic.escapeFactor.toFixed(5)} corr.`;
  const constraints: Array<[string, string, number, number]> = [
    ["gasConstraint", "maxGas", result.maximumGasTemperatureK, result.physics.maximumGasTemperatureK],
    ["sapConstraint", "maxSap", result.maximumSapphireTemperatureK, result.physics.maximumSapphireTemperatureK],
  ];
  for (const [containerId, valueId, value, limit] of constraints) {
    $(valueId).textContent = `${value.toFixed(0)} K · ${(limit - value).toFixed(0)} K margin`;
    const container = $(containerId); container.classList.toggle("bad", value > limit);
    ((container.querySelector("i")) as HTMLElement).style.width = `${Math.min(100, 100 * value / limit)}%`;
  }
  const values = [result.electricPowerKW, result.cellHeatKW, result.lineLossKW, result.boundaryHeatKW];
  const names = ["Electric", "Cell", "Optical", "Boundary"];
  values.forEach((value, index) => {
    $("key" + names[index]).textContent = `${power(value)} · ${(100 * value / result.physics.fuelPowerKW).toFixed(1)}%`;
    (($("energyBar") as HTMLElement).children[index] as HTMLElement).style.width = `${100 * value / result.physics.fuelPowerKW}%`;
  });
  const residual = Math.abs(result.energyResidualKW);
  $("closure").textContent = `Energy residual: ${power(residual)}`;
  $("closure").className = residual < 0.02 * result.physics.fuelPowerKW ? "ok" : "bad";
  drawReactorMap(result);
  drawPareto(points, result);
}

function runOptimization() {
  const button = $("optimize") as HTMLButtonElement;
  const fuelPowerKW = Number(($("fuelTarget") as HTMLInputElement).value);
  button.disabled = true;
  $("optStatus").textContent = "Searching geometry and operating conditions; unsafe candidates are being rejected…";
  const source = (globalThis as typeof globalThis & { __REACTOR_WORKER_SOURCE__?: string }).__REACTOR_WORKER_SOURCE__;
  if (!source) {
    $("optStatus").textContent = "Optimizer worker is unavailable in this build.";
    button.disabled = false;
    return;
  }
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(url);
  worker.onmessage = (event) => {
    if (event.data.type === "result") {
      optimizationResult = event.data.result as OptimizationResult;
      renderReactor(optimizationResult.best, optimizationResult.robustWorstCaseKW, optimizationResult.points);
      $("optStatus").textContent = `Complete · ${optimizationResult.evaluations} coupled evaluations · rated ${optimizationResult.ratedFuelPowerKW.toFixed(1)} kW after uncertainty derating.`;
    } else $("optStatus").textContent = `Optimization failed: ${event.data.message}`;
    worker.terminate(); URL.revokeObjectURL(url); button.disabled = false;
  };
  worker.onerror = () => {
    $("optStatus").textContent = "Optimization worker failed. Reload and try again.";
    worker.terminate(); URL.revokeObjectURL(url); button.disabled = false;
  };
  worker.postMessage({ physics: { fuelPowerKW }, candidates: 12 });
}

function render(result: AtomicTransportResult, input: AtomicInputs) {
  const population = nonEquilibriumPopulation(input, result);
  physical.temp.value = String(input.temperatureK);
  $("tempOut").textContent = `${input.temperatureK.toFixed(0)} K`;
  $("densityOut").textContent = `${input.sodiumMixingPpm.toPrecision(3)} ppm · ${result.sodiumDensityCm3.toExponential(2)} cm⁻³`;
  $("pressureOut").textContent = `${input.bufferPressureTorr.toFixed(1)} Torr`;
  $("quenchOut").textContent = `${input.quenchCoefficientCm3s.toExponential(1)} cm³/s`;
  $("radiusOut").textContent = `${input.radiusMm.toFixed(0)} mm`;
  $("lengthOut").textContent = `${input.lengthMm.toFixed(0)} mm`;
  $("pumpOut").textContent = `${input.pumpRateS.toExponential(1)} s⁻¹`;
  $("sourceOut").textContent = `${(input.sourceRadiusFraction * 100).toFixed(0)}%`;
  $("mScat").textContent = result.meanScatters.toFixed(1);
  $("mTime").textContent = result.meanResidenceNs < 1000 ? `${result.meanResidenceNs.toFixed(0)} ns` : `${(result.meanResidenceNs / 1000).toFixed(2)} µs`;
  $("mEscape").textContent = `${(result.ultimateEscapeFraction * 100).toFixed(1)}%`;
  $("escapeFactor").textContent = result.escapeProbabilityPerEmission.toFixed(5);
  $("tauD2").textContent = result.lines[0].radialOpticalDepth.toFixed(1);
  $("tauD1").textContent = `${(population.upperFraction * 100).toFixed(3)}%`;
  $("widthAr").textContent = power(population.linePowerKW);
  $("packetAccount").textContent = `${((result.escaped + result.quenched + result.truncated) / PACKETS * 100).toFixed(3)}%`;
  $("physicsNote").textContent = `CRD ${(result.lines[0].crdProbability * 100).toFixed(1)}% / PRD ${(100 * (1 - result.lines[0].crdProbability)).toFixed(1)}%. Quench ${(result.quenchProbability * 100).toFixed(3)}% per excitation. 3p is ${population.enhancement.toExponential(2)}× Boltzmann; population is capped at the 75% non-inverted statistical limit. Radial/axial escapes: ${result.radialEscapes}/${result.axialEscapes}.${result.truncated ? ` ${result.truncated} packets reached the scatter cap.` : ""}`;
  drawPaths(result, input.radiusMm);
  drawSpectrum(result.wavelengthsNm);
}

function run() {
  const input = physicalValues();
  const result = simulateAtomicTransport(input, PACKETS, seed++);
  latest = result;
  latestInputs = input;
  render(result, input);
}

function setPreset(name: string) {
  const value = presets[name];
  [physical.temp.value, physical.density.value, physical.pressure.value, physical.quench.value, physical.radius.value, physical.length.value, physical.pump.value, physical.source.value] = value.map(String);
  document.querySelectorAll<HTMLButtonElement>(".presets button").forEach((button) => button.classList.toggle("on", button.dataset.preset === name));
  run();
}

Object.values(physical).forEach((input) => input.addEventListener("input", () => {
  document.querySelectorAll(".presets button").forEach((button) => button.classList.remove("on"));
  clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(run, 140);
}));
document.querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((button) => button.addEventListener("click", () => setPreset(button.dataset.preset!)));
$("rerun").addEventListener("click", run);
($("fuelTarget") as HTMLInputElement).addEventListener("input", (event) => {
  $("fuelTargetOut").textContent = `${Number((event.target as HTMLInputElement).value).toFixed(1)} kW`;
});
$("optimize").addEventListener("click", runOptimization);
(["Temp", "Material", "Source"] as const).forEach((name) => $("map" + name).addEventListener("click", () => {
  mapMode = name === "Temp" ? "temperature" : name === "Material" ? "material" : "source";
  (["Temp", "Material", "Source"] as const).forEach((other) => $("map" + other).classList.toggle("on", other === name));
  if (reactorResult) drawReactorMap(reactorResult);
}));
addEventListener("resize", () => {
  if (latest && latestInputs) {
    drawPaths(latest, latestInputs.radiusMm);
    drawSpectrum(latest.wavelengthsNm);
  }
  if (reactorResult) {
    drawReactorMap(reactorResult);
    drawPareto(optimizationResult?.points ?? [], reactorResult);
  }
});
setPreset("reactor");
const reference = simulateReactor(referenceDesign, { ...DEFAULT_PHYSICS, fuelPowerKW: 4.2 }, "fine", 0.00545);
reference.transportValidation = {
  packets: 1400,
  surrogateEscapeFactor: 0.00492,
  monteCarloEscapeFactor: 0.00545,
  packetResidual: 0,
};
renderReactor(reference, 0.42);
