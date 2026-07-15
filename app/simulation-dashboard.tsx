"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BINS, PHOTONS, simulate, X_MAX } from "./transport";

function formatDelay(ns: number) {
  if (ns < 1000) return `${ns.toFixed(0)} ns`;
  return `${(ns / 1000).toFixed(2)} µs`;
}

const presets = {
  thin: { tau: 0.8, broadening: 0.04, quench: 0, radius: 6 },
  trapped: { tau: 28, broadening: 0.12, quench: 0.005, radius: 12 },
  quenched: { tau: 85, broadening: 0.3, quench: 0.055, radius: 18 },
};

export default function SimulationDashboard() {
  const [tau, setTau] = useState(28);
  const [broadening, setBroadening] = useState(0.12);
  const [quench, setQuench] = useState(0.005);
  const [radius, setRadius] = useState(12);
  const [run, setRun] = useState(1);
  const transportRef = useRef<HTMLCanvasElement>(null);
  const spectrumRef = useRef<HTMLCanvasElement>(null);

  const result = useMemo(
    () => simulate(tau, broadening, quench, radius, 1807 + run * 97),
    [tau, broadening, quench, radius, run],
  );

  const drawTransport = useCallback(() => {
    const canvas = transportRef.current;
    if (!canvas) return () => undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return () => undefined;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    ctx.scale(ratio, ratio);
    const w = rect.width;
    const h = rect.height;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.365;
    let frame = 0;
    let animation = 0;

    const render = () => {
      ctx.clearRect(0, 0, w, h);
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.35);
      bg.addColorStop(0, "rgba(255, 190, 52, .16)");
      bg.addColorStop(0.58, "rgba(249, 126, 20, .055)");
      bg.addColorStop(1, "rgba(8, 13, 22, 0)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      const vapor = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      vapor.addColorStop(0, "rgba(255, 192, 58, .12)");
      vapor.addColorStop(0.62, "rgba(255, 136, 25, .05)");
      vapor.addColorStop(1, "rgba(47, 183, 181, .035)");
      ctx.fillStyle = vapor;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

      const visibleSegments = Math.floor(frame / 1.7);
      result.paths.forEach((path, pathIndex) => {
        if (pathIndex > visibleSegments / 3 + 5) return;
        const count = Math.min(path.points.length - 1, Math.max(0, visibleSegments - pathIndex * 3));
        for (let i = 0; i < count; i++) {
          const a = path.points[i];
          const b = path.points[i + 1];
          const alpha = 0.1 + 0.34 * (i / Math.max(1, path.points.length - 1));
          ctx.beginPath();
          ctx.moveTo(cx + a.x * R, cy + a.y * R);
          ctx.lineTo(cx + b.x * R, cy + b.y * R);
          ctx.strokeStyle = path.escaped
            ? `rgba(255, 197, 61, ${alpha})`
            : `rgba(241, 104, 67, ${alpha})`;
          ctx.lineWidth = pathIndex < 14 ? 1.45 : 0.75;
          ctx.stroke();
        }
      });
      ctx.restore();

      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(131, 224, 218, .42)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, R + 7, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(131, 224, 218, .08)";
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,.48)";
      ctx.font = "10px var(--font-geist-mono), monospace";
      ctx.fillText("Na vapor boundary", 16, h - 18);
      ctx.textAlign = "right";
      ctx.fillText(`${radius.toFixed(0)} mm radius`, w - 16, h - 18);
      ctx.textAlign = "left";

      frame++;
      if (frame < 420) animation = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(animation);
  }, [result.paths, radius]);

  useEffect(() => drawTransport(), [drawTransport]);

  useEffect(() => {
    const canvas = spectrumRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    ctx.scale(ratio, ratio);
    const w = rect.width;
    const h = rect.height;
    const pad = { l: 38, r: 12, t: 14, b: 27 };
    const max = Math.max(1, ...result.spectrum);

    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = pad.t + ((h - pad.t - pad.b) * i) / 3;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
    }

    const gradient = ctx.createLinearGradient(pad.l, 0, w - pad.r, 0);
    gradient.addColorStop(0, "#d65c72");
    gradient.addColorStop(0.38, "#ff9b32");
    gradient.addColorStop(0.5, "#ffe26b");
    gradient.addColorStop(0.62, "#ff9b32");
    gradient.addColorStop(1, "#d65c72");
    ctx.beginPath();
    result.spectrum.forEach((value, i) => {
      const x = pad.l + (i / (BINS - 1)) * (w - pad.l - pad.r);
      const y = h - pad.b - (value / max) * (h - pad.t - pad.b);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.lineTo(w - pad.r, h - pad.b);
    ctx.lineTo(pad.l, h - pad.b);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 190, 55, .055)";
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,.42)";
    ctx.font = "10px var(--font-geist-mono), monospace";
    ctx.textAlign = "center";
    [-8, -4, 0, 4, 8].forEach((tick) => {
      const x = pad.l + ((tick + X_MAX) / (2 * X_MAX)) * (w - pad.l - pad.r);
      ctx.fillText(tick === 0 ? "line center" : `${tick > 0 ? "+" : ""}${tick}`, x, h - 9);
    });
    ctx.save();
    ctx.translate(11, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("escaped photons", 0, 0);
    ctx.restore();
  }, [result]);

  const applyPreset = (key: keyof typeof presets) => {
    const p = presets[key];
    setTau(p.tau);
    setBroadening(p.broadening);
    setQuench(p.quench);
    setRadius(p.radius);
    setRun((value) => value + 1);
  };

  const holsteinTrend = Math.min(
    1,
    1 / (Math.max(1, tau) * Math.sqrt(Math.max(1, Math.log(Math.max(Math.E, tau))))),
  );
  const accounting = ((result.escaped + result.quenched) / PHOTONS) * 100;

  return (
    <main>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">Na·D</span>
          <span className="brand-name">TRANSPORT LAB</span>
        </div>
        <div className="model-tag">
          <span className="pulse-dot" /> COMPLETE REDISTRIBUTION · 2D CYLINDER
        </div>
      </header>

      <section className="hero-copy">
        <div>
          <p className="eyebrow">RESONANCE RADIATION / MONTE CARLO 01</p>
          <h1>How long does a sodium photon stay trapped?</h1>
        </div>
        <p className="lede">
          Launch photons into an optically thick vapor. Every line is a sampled flight;
          every turn is a real absorption and re-emission event.
        </p>
      </section>

      <section className="dashboard-grid">
        <article className="panel transport-panel">
          <div className="panel-head">
            <div>
              <span className="panel-index">01</span>
              <h2>Photon trajectories</h2>
            </div>
            <div className="legend">
              <span><i className="legend-line escaped" /> escaped</span>
              <span><i className="legend-line quenched" /> quenched</span>
            </div>
          </div>
          <canvas ref={transportRef} className="transport-canvas" aria-label="Animated sodium photon trajectories" />
          <div className="metric-strip">
            <div><span>mean scatterings</span><strong>{result.meanScatters.toFixed(1)}</strong></div>
            <div><span>mean residence</span><strong>{formatDelay(result.meanDelay)}</strong></div>
            <div><span>escape fraction</span><strong>{((result.escaped / PHOTONS) * 100).toFixed(1)}%</strong></div>
          </div>
        </article>

        <aside className="panel controls-panel">
          <div className="panel-head">
            <div><span className="panel-index">02</span><h2>Vapor controls</h2></div>
            <button className="rerun" onClick={() => setRun((value) => value + 1)}>new sample ↻</button>
          </div>

          <div className="preset-row" aria-label="Simulation presets">
            <button onClick={() => applyPreset("thin")}>thin</button>
            <button className="active" onClick={() => applyPreset("trapped")}>trapped</button>
            <button onClick={() => applyPreset("quenched")}>quenched</button>
          </div>

          <label className="control">
            <span><b>Line-center optical depth</b><output>{tau.toFixed(1)}</output></span>
            <input
              type="range" min="-0.3" max="2.08" step="0.01"
              value={Math.log10(tau)}
              onChange={(event) => setTau(10 ** Number(event.target.value))}
            />
            <small>Mean opacity from center to wall at resonance.</small>
          </label>

          <label className="control">
            <span><b>Pressure broadening</b><output>a = {broadening.toFixed(2)}</output></span>
            <input type="range" min="0" max="0.6" step="0.01" value={broadening}
              onChange={(event) => setBroadening(Number(event.target.value))} />
            <small>Adds Lorentzian wings to the Doppler line.</small>
          </label>

          <label className="control">
            <span><b>Quench probability</b><output>{(quench * 100).toFixed(1)}%</output></span>
            <input type="range" min="0" max="0.15" step="0.001" value={quench}
              onChange={(event) => setQuench(Number(event.target.value))} />
            <small>Chance that an absorption ends as heat.</small>
          </label>

          <label className="control">
            <span><b>Cylinder radius</b><output>{radius.toFixed(0)} mm</output></span>
            <input type="range" min="2" max="30" step="1" value={radius}
              onChange={(event) => setRadius(Number(event.target.value))} />
            <small>Changes flight time while optical depth stays fixed.</small>
          </label>

          <div className="accounting">
            <span>packet accounting</span>
            <strong>{accounting.toFixed(3)}%</strong>
            <div><i style={{ width: `${accounting}%` }} /></div>
          </div>
        </aside>

        <article className="panel spectrum-panel">
          <div className="panel-head">
            <div><span className="panel-index">03</span><h2>Emergent line profile</h2></div>
            <span className="unit">detuning / Doppler widths</span>
          </div>
          <canvas ref={spectrumRef} className="spectrum-canvas" aria-label="Spectrum of escaped photons" />
        </article>

        <article className="panel readout-panel">
          <div className="panel-head">
            <div><span className="panel-index">04</span><h2>Transport readout</h2></div>
          </div>
          <div className="readout-main">
            <span>effective escape factor</span>
            <strong>{result.escapeFactor.toFixed(4)}</strong>
            <small>1 / (mean re-emissions + 1)</small>
          </div>
          <div className="readout-grid">
            <div><span>escaped</span><b>{result.escaped.toLocaleString()}</b></div>
            <div><span>quenched</span><b>{result.quenched.toLocaleString()}</b></div>
            <div><span>thick-line scaling</span><b>{holsteinTrend.toFixed(4)}</b></div>
          </div>
          <p className="method-note">
            Scaling reference: 1/[τ√ln(τ)]. Geometry sets the prefactor; this check tests the trend,
            not an exact slab solution.
          </p>
        </article>
      </section>

      <footer>
        <span>MODEL: SINGLE RESONANCE LINE · COMPLETE FREQUENCY REDISTRIBUTION · ISOTROPIC RE-EMISSION</span>
        <span>{PHOTONS.toLocaleString()} PHOTON PACKETS / RUN</span>
      </footer>
    </main>
  );
}
