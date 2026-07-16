from __future__ import annotations

import pytest

from reference_chemistry import equilibrium_reference_state, oxidizer_composition


def test_oxidizer_composition_exposes_nitrogen_assumption() -> None:
    assert oxidizer_composition(1.0) == "O2:1,N2:0"
    assert oxidizer_composition(0.5) == "O2:1,N2:1"
    with pytest.raises(ValueError):
        oxidizer_composition(0.0)


def test_equilibrium_reference_closes_enthalpy_and_contains_radicals() -> None:
    result = equilibrium_reference_state()
    assert result["model"].startswith("Cantera")
    assert abs(result["enthalpy_closure_j_kg"]) < 1e-5
    assert result["adiabatic_temperature_k"] > 2000
    assert result["mole_fractions"]["H2O"] > 0
    assert result["mole_fractions"]["OH"] > 0


def test_oxygen_enrichment_raises_stoichiometric_adiabatic_temperature() -> None:
    air = equilibrium_reference_state(oxygen_fraction=0.21)
    enriched = equilibrium_reference_state(oxygen_fraction=0.38)
    assert enriched["adiabatic_temperature_k"] > air["adiabatic_temperature_k"]


def test_stoichiometric_state_is_hotter_than_strongly_off_stoichiometric_states() -> None:
    lean = equilibrium_reference_state(equivalence_ratio=0.35)
    stoich = equilibrium_reference_state(equivalence_ratio=1.0)
    rich = equilibrium_reference_state(equivalence_ratio=3.0)
    assert stoich["adiabatic_temperature_k"] > lean["adiabatic_temperature_k"]
    assert stoich["adiabatic_temperature_k"] > rich["adiabatic_temperature_k"]
