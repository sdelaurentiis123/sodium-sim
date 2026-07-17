"""Measured Na(3p) collisional-quenching rates in flame gases.

The source papers report effective quenching cross sections.  This module
converts those measurements to bimolecular rate coefficients with the mean
relative thermal speed.  Values outside the experimental temperature window
are clamped to the nearest measured endpoint rather than silently extrapolated.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import pi, sqrt


AMU_KG = 1.660_539_066_60e-27
KB_J_K = 1.380_649e-23
SODIUM_MASS_AMU = 22.989_769_28


@dataclass(frozen=True)
class Quencher:
    molecular_mass_amu: float
    low_temperature_k: float
    high_temperature_k: float
    low_cross_section_a2: float
    high_cross_section_a2: float
    source_doi: str


QUENCHERS = {
    # Lijnse & van der Maas, JQSRT 13 (1973) 741-746.
    "H2": Quencher(2.015_88, 1500.0, 2500.0, 9.3, 6.8, "10.1016/0022-4073(73)90115-5"),
    "O2": Quencher(31.998_8, 1720.0, 2500.0, 39.0, 31.0, "10.1016/0022-4073(73)90115-5"),
    # Lijnse & Elsenaar, JQSRT 12 (1972) 1115-1128.
    "N2": Quencher(28.013_4, 1500.0, 2500.0, 22.0, 22.0, "10.1016/0022-4073(72)90014-3"),
    "H2O": Quencher(18.015_28, 1500.0, 2500.0, 2.2, 2.2, "10.1016/0022-4073(72)90014-3"),
}


def quenching_cross_section_a2(species: str, temperature_k: float) -> tuple[float, bool]:
    """Return measured/interpolated cross section and in-range status."""

    if temperature_k <= 0:
        raise ValueError("temperature must be positive")
    try:
        quencher = QUENCHERS[species]
    except KeyError as error:
        raise ValueError(f"unsupported quencher: {species}") from error
    bounded = min(max(temperature_k, quencher.low_temperature_k), quencher.high_temperature_k)
    span = quencher.high_temperature_k - quencher.low_temperature_k
    fraction = 0.0 if span == 0 else (bounded - quencher.low_temperature_k) / span
    cross_section = quencher.low_cross_section_a2 + fraction * (
        quencher.high_cross_section_a2 - quencher.low_cross_section_a2
    )
    return cross_section, quencher.low_temperature_k <= temperature_k <= quencher.high_temperature_k


def mean_relative_speed_m_s(species: str, temperature_k: float) -> float:
    if temperature_k <= 0:
        raise ValueError("temperature must be positive")
    try:
        partner_mass_amu = QUENCHERS[species].molecular_mass_amu
    except KeyError as error:
        raise ValueError(f"unsupported quencher: {species}") from error
    reduced_mass_kg = (
        SODIUM_MASS_AMU * partner_mass_amu / (SODIUM_MASS_AMU + partner_mass_amu)
    ) * AMU_KG
    return sqrt(8.0 * KB_J_K * temperature_k / (pi * reduced_mass_kg))


def quenching_rate_coefficient_m3_s(species: str, temperature_k: float) -> dict[str, float | bool | str]:
    cross_section_a2, within_measured_range = quenching_cross_section_a2(species, temperature_k)
    relative_speed_m_s = mean_relative_speed_m_s(species, temperature_k)
    return {
        "cross_section_a2": cross_section_a2,
        "relative_speed_m_s": relative_speed_m_s,
        "coefficient_m3_s": cross_section_a2 * 1.0e-20 * relative_speed_m_s,
        "within_measured_range": within_measured_range,
        "source_doi": QUENCHERS[species].source_doi,
    }


def mixture_quenching_rate_s(
    *,
    temperature_k: float,
    pressure_pa: float,
    composition: dict[str, float],
) -> dict[str, object]:
    if pressure_pa < 0:
        raise ValueError("pressure must be non-negative")
    fractions = {name: max(0.0, float(composition.get(name, 0.0))) for name in QUENCHERS}
    total = sum(fractions.values())
    if total <= 0:
        raise ValueError("composition must contain a supported quencher")
    fractions = {name: value / total for name, value in fractions.items()}
    number_density_m3 = pressure_pa / (KB_J_K * temperature_k)
    per_species = {}
    for name, fraction in fractions.items():
        coefficient = quenching_rate_coefficient_m3_s(name, temperature_k)
        per_species[name] = {
            **coefficient,
            "mole_fraction": fraction,
            "rate_s": fraction * number_density_m3 * float(coefficient["coefficient_m3_s"]),
        }
    return {
        "number_density_m3": number_density_m3,
        "effective_coefficient_m3_s": sum(
            float(item["mole_fraction"]) * float(item["coefficient_m3_s"])
            for item in per_species.values()
        ),
        "rate_s": sum(float(item["rate_s"]) for item in per_species.values()),
        "per_species": per_species,
        "within_measured_range": all(
            bool(item["within_measured_range"])
            for item in per_species.values()
            if float(item["mole_fraction"]) > 0
        ),
    }
