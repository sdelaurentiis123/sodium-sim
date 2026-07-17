from __future__ import annotations

import pytest

from sodium_quenching import (
    mixture_quenching_rate_s,
    quenching_cross_section_a2,
    quenching_rate_coefficient_m3_s,
)


def test_primary_cross_sections_are_reproduced_at_measurement_endpoints() -> None:
    assert quenching_cross_section_a2("H2", 1500) == pytest.approx((9.3, True))
    assert quenching_cross_section_a2("H2", 2500) == pytest.approx((6.8, True))
    assert quenching_cross_section_a2("O2", 1720) == pytest.approx((39.0, True))
    assert quenching_cross_section_a2("O2", 2500) == pytest.approx((31.0, True))
    assert quenching_cross_section_a2("N2", 2000) == pytest.approx((22.0, True))
    assert quenching_cross_section_a2("H2O", 2000) == pytest.approx((2.2, True))


def test_out_of_range_cross_sections_clamp_and_report_extrapolation() -> None:
    assert quenching_cross_section_a2("H2", 1200) == pytest.approx((9.3, False))
    assert quenching_cross_section_a2("O2", 3000) == pytest.approx((31.0, False))


def test_2000_k_coefficients_have_measured_order_and_scale() -> None:
    coefficients = {
        name: float(quenching_rate_coefficient_m3_s(name, 2000)["coefficient_m3_s"])
        for name in ("H2", "O2", "N2", "H2O")
    }
    assert coefficients["O2"] > coefficients["N2"] > coefficients["H2"]
    assert coefficients["N2"] > 5 * coefficients["H2O"]
    assert coefficients["H2"] == pytest.approx(3.85e-16, rel=0.03)


def test_mixture_rate_is_linear_in_pressure_and_composition_is_normalized() -> None:
    composition = {"H2": 0.06, "O2": 0.04, "H2O": 0.52, "N2": 0.38}
    base = mixture_quenching_rate_s(temperature_k=2000, pressure_pa=1.4e5, composition=composition)
    doubled = mixture_quenching_rate_s(temperature_k=2000, pressure_pa=2.8e5, composition=composition)
    assert float(doubled["rate_s"]) == pytest.approx(2 * float(base["rate_s"]))
    assert float(base["rate_s"]) > 1e9
    assert base["within_measured_range"] is True
