"""Measured sodium chemi-excitation channels used by the reference backend."""

from __future__ import annotations


KB_J_K = 1.380_649e-23

# Kaskan, 11th Symposium (International) on Combustion (1967), reported that
# Na + O + O -> Na(3p) + O2 contributes strongly in oxygen-atom-rich flames.
# The quoted approximate rate coefficient is in cm^6 molecule^-2 s^-1.
NA_O_O_CHEMI_EXCITATION_CM6_S = 1.0e-29


def oxygen_atom_density_cm3(
    *,
    temperature_k: float,
    pressure_pa: float,
    oxygen_atom_mole_fraction: float,
) -> float:
    if temperature_k <= 0 or pressure_pa < 0:
        raise ValueError("temperature must be positive and pressure non-negative")
    if not 0 <= oxygen_atom_mole_fraction <= 1:
        raise ValueError("oxygen_atom_mole_fraction must be between zero and one")
    total_density_m3 = pressure_pa / (KB_J_K * temperature_k)
    return oxygen_atom_mole_fraction * total_density_m3 / 1.0e6


def na_o_o_chemi_excitation_rate_per_na_s(
    *,
    temperature_k: float,
    pressure_pa: float,
    oxygen_atom_mole_fraction: float,
    rate_coefficient_cm6_s: float = NA_O_O_CHEMI_EXCITATION_CM6_S,
) -> float:
    """Return the measured partial pump rate per ground-state Na atom.

    This is one experimentally identified channel, not a complete sodium pump
    model.  It should be added to collisional and radiative excitation rates.
    """

    n_o = oxygen_atom_density_cm3(
        temperature_k=temperature_k,
        pressure_pa=pressure_pa,
        oxygen_atom_mole_fraction=oxygen_atom_mole_fraction,
    )
    return max(0.0, rate_coefficient_cm6_s) * n_o * n_o
