from __future__ import annotations

import pytest

from sodium_excitation import (
    na_o_o_chemi_excitation_rate_per_na_s,
    oxygen_atom_density_cm3,
)


def test_oxygen_density_follows_ideal_gas_scaling() -> None:
    base = oxygen_atom_density_cm3(
        temperature_k=2000,
        pressure_pa=100_000,
        oxygen_atom_mole_fraction=0.01,
    )
    assert oxygen_atom_density_cm3(
        temperature_k=2000,
        pressure_pa=200_000,
        oxygen_atom_mole_fraction=0.01,
    ) == pytest.approx(2 * base)
    assert oxygen_atom_density_cm3(
        temperature_k=4000,
        pressure_pa=100_000,
        oxygen_atom_mole_fraction=0.01,
    ) == pytest.approx(0.5 * base)


def test_na_o_o_pump_scales_with_square_of_oxygen_atom_density() -> None:
    low = na_o_o_chemi_excitation_rate_per_na_s(
        temperature_k=2000,
        pressure_pa=100_000,
        oxygen_atom_mole_fraction=0.01,
    )
    high = na_o_o_chemi_excitation_rate_per_na_s(
        temperature_k=2000,
        pressure_pa=100_000,
        oxygen_atom_mole_fraction=0.02,
    )
    assert high == pytest.approx(4 * low)
    assert low > 0
