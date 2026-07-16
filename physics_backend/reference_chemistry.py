"""Reference thermochemistry shared by local tests and Modal.

The functions here are deterministic and contain no Modal-specific code.  They
form the first trusted layer beneath the reduced browser solver.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from sodium_excitation import na_o_o_chemi_excitation_rate_per_na_s


@dataclass(frozen=True)
class FlameInputs:
    equivalence_ratio: float = 1.0
    oxygen_fraction: float = 0.38
    pressure_bar: float = 1.4
    inlet_temperature_k: float = 320.0

    def validated(self) -> "FlameInputs":
        if not 0.1 <= self.equivalence_ratio <= 5.0:
            raise ValueError("equivalence_ratio must be between 0.1 and 5")
        if not 0.05 <= self.oxygen_fraction <= 1.0:
            raise ValueError("oxygen_fraction must be between 0.05 and 1")
        if not 0.1 <= self.pressure_bar <= 20.0:
            raise ValueError("pressure_bar must be between 0.1 and 20")
        if not 200.0 <= self.inlet_temperature_k <= 1800.0:
            raise ValueError("inlet_temperature_k must be between 200 and 1800 K")
        return self


def oxidizer_composition(oxygen_fraction: float) -> str:
    """Return the provisional O2/N2 oxidizer composition for Cantera.

    The diluent in the actual experiment has not been confirmed.  Nitrogen is
    therefore surfaced in the result as an assumption rather than hidden.
    """

    x_o2 = float(oxygen_fraction)
    if not 0.05 <= x_o2 <= 1.0:
        raise ValueError("oxygen_fraction must be between 0.05 and 1")
    n2_per_o2 = (1.0 - x_o2) / x_o2
    return f"O2:1,N2:{n2_per_o2:.12g}"


def equilibrium_reference_state(
    equivalence_ratio: float = 1.0,
    oxygen_fraction: float = 0.38,
    pressure_bar: float = 1.4,
    inlet_temperature_k: float = 320.0,
) -> dict:
    """Compute a constant-pressure, adiabatic H2/O2/N2 reference state.

    This is not yet a flame: it has no spatial transport, strain, heat loss, or
    wall.  It is the thermochemical ceiling against which every reduced flame
    cell must be checked.
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
    initial_enthalpy = gas.enthalpy_mass
    gas.equilibrate("HP")

    tracked = ("H2", "O2", "H2O", "H", "O", "OH", "HO2", "H2O2", "N2")
    mole_fractions = {
        species: float(gas[species].X[0])
        for species in tracked
        if species in gas.species_names
    }

    return {
        "model": "Cantera h2o2.yaml / equilibrium HP",
        "cantera_version": ct.__version__,
        "inputs": {
            **asdict(inputs),
            "oxidizer_assumption": oxidizer,
            "diluent_assumption": "N2",
        },
        "adiabatic_temperature_k": float(gas.T),
        "pressure_pa": float(gas.P),
        "specific_enthalpy_j_kg": float(gas.enthalpy_mass),
        "enthalpy_closure_j_kg": float(gas.enthalpy_mass - initial_enthalpy),
        "mole_fractions": mole_fractions,
        "sodium_excitation_diagnostics": {
            "na_o_o_partial_pump_rate_per_na_s":
                na_o_o_chemi_excitation_rate_per_na_s(
                    temperature_k=float(gas.T),
                    pressure_pa=float(gas.P),
                    oxygen_atom_mole_fraction=mole_fractions["O"],
                ),
            "scope": "Measured Na + O + O channel only; not total excitation",
        },
    }
