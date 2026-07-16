# Lightcell reference-physics backend

The browser solver should remain interactive, but its chemistry closures must
come from a slower reference model rather than adjustable reaction constants.

`reference_chemistry.py` contains the locally testable physics.
`flame_reference_table.py` generates the HP-equilibrium and multicomponent
free-flame comparator grid consumed by the browser.
`generate_browser_reference.py` writes that deterministic grid to
`sodium-lamp/reference-data.js`.
`experimental_benchmarks.py` converts the public Lightcell measurements into
explicit radiometric, thermochemical, salt-pressure, and photon-rate checks.
`modal_app.py` exposes the same implementation as an ephemeral Modal function.
The first smoke test runs Cantera's detailed hydrogen/oxygen mechanism and
returns an adiabatic reference state.
Implemented reference layers:

1. HP-equilibrium temperature and radical checks over pressure, oxygen
   enrichment, and equivalence ratio;
2. multicomponent + Soret freely propagating flame-speed comparators;
3. public brightness, line-power, wall-temperature, and salt-pressure checks;
4. a resolved two-layer non-LTE D1/D2 line-shape diagnostic in the browser.

The next backend stages are:

1. strained diffusion-flame validation cases;
2. a diffusion-flamelet table over pressure, oxygen enrichment, preheat,
   ratio, and strain;
3. NaCl/NaI phase and sodium-speciation tables;
4. a non-LTE collisional-radiative reference solve;
5. mixture-specific broadening and redistribution data for the D1/D2 model.

The numerical acceptance ladder and the measurements needed to validate each
layer are in `BENCHMARK_LADDER.md`.

Run the current ephemeral smoke test with:

```sh
.venv-modal/bin/modal run physics_backend/modal_app.py
```

No persistent web endpoint is deployed by this command.

Run the reference tests locally with:

```sh
PYTHONPATH=physics_backend .venv-modal/bin/pytest -q physics_backend
```

Regenerate the static Cantera table after changing its grid with:

```sh
.venv-modal/bin/python physics_backend/generate_browser_reference.py
```
