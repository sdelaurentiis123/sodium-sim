# Sodium Lamp

An interactive WebGPU reduced-order model of a hydrogen/oxygen sodium-emission
cell. It is designed to make the central non-equilibrium hypothesis inspectable:
trapped Na D-line radiation can maintain a 3p excited-state population far above
the local Boltzmann prediction.

## Live model

The static research artifact is deployed from [`sodium-lamp/`](sodium-lamp/).
It includes:

- axisymmetric coaxial H2/oxidizer transport, finite-rate heat release, and
  solved heat conduction through inner and outer sapphire walls;
- rate-solved non-LTE Na 3s/3p fine-structure populations—Boltzmann is a
  detached comparison and never closes the solver;
- six-group D1/D2 P1 photon transport with absorption, stimulated and
  spontaneous emission, quenching, reflection, escape, and PV absorption;
- a 720-point two-layer Voigt spectrum tied to the transported GPU power;
- Cantera thermochemical/flame-speed reference tables, wall safety diagnostics,
  and a directly integrated energy ledger;
- stabilized-reference and ignition/blowoff branches.

The model and its assumptions are documented in
[`sodium-lamp/PHYSICS_AUDIT.md`](sodium-lamp/PHYSICS_AUDIT.md). It is a research
and experiment-planning model, not design-certification CFD.

## Run locally

WebGPU requires HTTPS or a localhost origin:

```bash
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000/sodium-lamp/` in a current WebGPU browser.

## Verify

```bash
npm install
npm test
```

The Python reference backend and its benchmark ladder live in
[`physics_backend/`](physics_backend/).
