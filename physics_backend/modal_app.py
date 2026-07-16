"""Modal-hosted reference chemistry for the Lightcell browser simulator.

This module is intentionally separate from the WebGPU solver.  It produces
validated thermochemical reference states and, later, flamelet tables that the
interactive browser model can interpolate.  It is not called once per render
frame.
"""

from __future__ import annotations

import modal

from reference_chemistry import equilibrium_reference_state


APP_NAME = "lightcell-physics-reference"

image = (
    modal.Image.micromamba(python_version="3.11")
    .micromamba_install(
        "cantera=3.1.*",
        "numpy",
        channels=["conda-forge"],
    )
)

app = modal.App(APP_NAME)


@app.function(image=image, timeout=300)
def equilibrium_reference(
    equivalence_ratio: float = 1.0,
    oxygen_fraction: float = 0.38,
    pressure_bar: float = 1.4,
    inlet_temperature_k: float = 320.0,
) -> dict:
    """Compute a constant-pressure, adiabatic H2/O2/N2 reference state."""

    return equilibrium_reference_state(
        equivalence_ratio=equivalence_ratio,
        oxygen_fraction=oxygen_fraction,
        pressure_bar=pressure_bar,
        inlet_temperature_k=inlet_temperature_k,
    )


@app.local_entrypoint()
def main(
    equivalence_ratio: float = 1.0,
    oxygen_fraction: float = 0.38,
    pressure_bar: float = 1.4,
    inlet_temperature_k: float = 320.0,
) -> None:
    import json

    result = equilibrium_reference.remote(
        equivalence_ratio=equivalence_ratio,
        oxygen_fraction=oxygen_fraction,
        pressure_bar=pressure_bar,
        inlet_temperature_k=inlet_temperature_k,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
