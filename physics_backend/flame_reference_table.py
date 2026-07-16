"""Generate small Cantera reference tables for the browser model.

The WebGPU solver remains a reduced, axisymmetric transport model.  These
tables give it two defensible anchors:

* an HP-equilibrium thermochemical ceiling over the operator's input range;
* a freely propagating premixed H2/O2/N2 flame-speed comparator.

The second quantity is not used as a closure for the non-premixed coaxial
flame.  It is reported as a reference velocity scale only.
"""

from __future__ import annotations

from dataclasses import asdict

from reference_chemistry import FlameInputs, equilibrium_reference_state, oxidizer_composition


EQUIVALENCE_RATIOS = (0.5, 0.75, 1.0, 1.25, 1.5, 2.0)
OXYGEN_FRACTIONS = (0.21, 0.38, 0.6, 1.0)
PRESSURES_BAR = (0.5, 1.4, 4.0, 8.0)

FLAME_SPEED_EQUIVALENCE_RATIOS = (0.7, 1.0, 1.3)
FLAME_SPEED_OXYGEN_FRACTIONS = OXYGEN_FRACTIONS
FLAME_SPEED_PRESSURES_BAR = (0.5, 1.4, 4.0, 8.0)


def free_flame_reference_state(
    *,
    equivalence_ratio: float,
    oxygen_fraction: float,
    pressure_bar: float,
    inlet_temperature_k: float = 320.0,
) -> dict:
    """Solve a 1D freely propagating flame with multicomponent transport.

    This is deliberately a comparator rather than a model of the coaxial
    burner.  The Lightcell geometry is non-premixed, strained, recirculating,
    wall-coupled, and sodium-seeded; a freely propagating flame is none of
    those things.
    """

    import cantera as ct

    inputs = FlameInputs(
        equivalence_ratio=float(equivalence_ratio),
        oxygen_fraction=float(oxygen_fraction),
        pressure_bar=float(pressure_bar),
        inlet_temperature_k=float(inlet_temperature_k),
    ).validated()

    gas = ct.Solution("h2o2.yaml")
    gas.TP = inputs.inlet_temperature_k, inputs.pressure_bar * 1.0e5
    oxidizer = oxidizer_composition(inputs.oxygen_fraction)
    gas.set_equivalence_ratio(inputs.equivalence_ratio, "H2:1", oxidizer)

    flame = ct.FreeFlame(gas, width=0.03)
    flame.transport_model = "multicomponent"
    flame.soret_enabled = True
    flame.set_refine_criteria(ratio=4.0, slope=0.15, curve=0.2, prune=0.03)
    flame.solve(loglevel=0, auto=True)

    return {
        "model": "Cantera h2o2.yaml / FreeFlame / multicomponent + Soret",
        "inputs": {
            **asdict(inputs),
            "oxidizer_assumption": oxidizer,
            "diluent_assumption": "N2",
        },
        "laminar_flame_speed_m_s": float(flame.velocity[0]),
        "maximum_temperature_k": float(max(flame.T)),
        "grid_points": int(len(flame.grid)),
        "scope": "Premixed free-flame comparator; not a coaxial burner closure",
    }

def build_browser_reference_data() -> dict:
    equilibrium = []
    for pressure_bar in PRESSURES_BAR:
        for oxygen_fraction in OXYGEN_FRACTIONS:
            for equivalence_ratio in EQUIVALENCE_RATIOS:
                state = equilibrium_reference_state(
                    equivalence_ratio=equivalence_ratio,
                    oxygen_fraction=oxygen_fraction,
                    pressure_bar=pressure_bar,
                    inlet_temperature_k=320.0,
                )
                equilibrium.append(
                    {
                        "phi": equivalence_ratio,
                        "oxygen_fraction": oxygen_fraction,
                        "pressure_bar": pressure_bar,
                        "adiabatic_temperature_k": state["adiabatic_temperature_k"],
                        "oxygen_atom_mole_fraction":
                            state["mole_fractions"].get("O", 0.0),
                        "hydrogen_atom_mole_fraction":
                            state["mole_fractions"].get("H", 0.0),
                        "hydroxyl_mole_fraction":
                            state["mole_fractions"].get("OH", 0.0),
                        "na_o_o_partial_pump_rate_per_na_s":
                            state["sodium_excitation_diagnostics"][
                                "na_o_o_partial_pump_rate_per_na_s"
                            ],
                    }
                )

    flame_speed = []
    for pressure_bar in FLAME_SPEED_PRESSURES_BAR:
        for oxygen_fraction in FLAME_SPEED_OXYGEN_FRACTIONS:
            for equivalence_ratio in FLAME_SPEED_EQUIVALENCE_RATIOS:
                state = free_flame_reference_state(
                    equivalence_ratio=equivalence_ratio,
                    oxygen_fraction=oxygen_fraction,
                    pressure_bar=pressure_bar,
                )
                flame_speed.append(
                    {
                        "phi": equivalence_ratio,
                        "oxygen_fraction": oxygen_fraction,
                        "pressure_bar": pressure_bar,
                        "laminar_flame_speed_m_s":
                            state["laminar_flame_speed_m_s"],
                        "maximum_temperature_k": state["maximum_temperature_k"],
                    }
                )

    return {
        "metadata": {
            "cantera_mechanism": "h2o2.yaml",
            "inlet_temperature_k": 320.0,
            "oxidizer": "O2/N2",
            "transport": "multicomponent + Soret for FreeFlame",
            "equilibrium_scope": "HP thermochemical ceiling",
            "flame_speed_scope":
                "premixed free-flame comparator, not coaxial-flame closure",
        },
        "equilibrium_axes": {
            "phi": EQUIVALENCE_RATIOS,
            "oxygen_fraction": OXYGEN_FRACTIONS,
            "pressure_bar": PRESSURES_BAR,
        },
        "flame_speed_axes": {
            "phi": FLAME_SPEED_EQUIVALENCE_RATIOS,
            "oxygen_fraction": FLAME_SPEED_OXYGEN_FRACTIONS,
            "pressure_bar": FLAME_SPEED_PRESSURES_BAR,
        },
        "equilibrium": equilibrium,
        "flame_speed": flame_speed,
    }
