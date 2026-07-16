export type EngineInputs = {
  fuel: number;
  recup: number;
  stackShare: number;
  shell: number;
  visT: number;
  irR: number;
  survival: number;
  leak: number;
  gap: number;
  quality: number;
};

export type AtomicPowerModel = {
  photonEV: number;
  linePowerKW: number;
  pumpPowerKW: number;
};

export function engineBalance(v: EngineInputs, atomic: AtomicPowerModel) {
  const shellFraction = v.shell;
  const stackFraction = v.stackShare * (1 - v.recup);
  const hotFraction = 1 - shellFraction - stackFraction;
  const hot = v.fuel * hotFraction;
  const radiativeYield = atomic.pumpPowerKW > 0 ? atomic.linePowerKW / atomic.pumpPowerKW : 0;
  const pumpUtilization = hot > 0 ? Math.min(1, atomic.pumpPowerKW / hot) : 0;
  const lineFraction = Math.max(0, Math.min(0.98, radiativeYield * pumpUtilization));
  const pvEta = v.gap <= atomic.photonEV ?
    Math.min(0.9, v.quality * v.gap / atomic.photonEV) : 0;

  const cellCapture = (1 - v.leak) * v.visT;
  const lineReturn = (1 - v.leak) * (1 - v.visT) * v.survival;
  const lineLoss = 1 - cellCapture - lineReturn;
  const irReturn = v.irR * v.survival;

  const electric0 = lineFraction * cellCapture * pvEta;
  const cellHeat0 = lineFraction * cellCapture * (1 - pvEta);
  const opticalLoss0 = lineFraction * lineLoss;
  const cavityLoss0 = (1 - lineFraction) * (1 - irReturn);
  const retained = lineFraction * lineReturn + (1 - lineFraction) * irReturn;
  const gain = 1 / Math.max(1e-12, 1 - retained);
  const fractions = {
    electric: electric0 * gain,
    cell: cellHeat0 * gain,
    optical: opticalLoss0 * gain,
    cavity: cavityLoss0 * gain,
  };
  const out = {
    electric: hot * fractions.electric,
    cell: hot * fractions.cell,
    optical: hot * fractions.optical,
    cavity: hot * fractions.cavity,
    shell: v.fuel * shellFraction,
    stack: v.fuel * stackFraction,
  };
  const total = Object.values(out).reduce((sum, value) => sum + value, 0);
  return {
    ...out,
    hot,
    incident: hot * lineFraction * cellCapture * gain,
    lineThroughput: hot * lineFraction * gain,
    photonEV: atomic.photonEV,
    pvEta,
    lineFraction,
    radiativeYield,
    pumpUtilization,
    gain,
    efficiency: out.electric / v.fuel,
    residual: v.fuel - total,
    fractions,
  };
}
