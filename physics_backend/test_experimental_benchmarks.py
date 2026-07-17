import pytest

from experimental_benchmarks import (
    NACL_ANTOINE,
    NAI_ANTOINE,
    antoine_vapor_pressure_bar,
    conversion_feasibility_benchmark,
    cylinder_lateral_area_m2,
    narrowband_lambertian_exitance_w_m2,
    photon_rate_for_power,
    public_experiment_benchmark,
    sodium_radical_cycle_diagnostic,
    sodium_3p_lte_fraction,
)


def test_public_brightness_numbers_cross_check_at_order_unity() -> None:
    exitance = narrowband_lambertian_exitance_w_m2(670_000)
    area = cylinder_lateral_area_m2(length_m=0.12, diameter_m=0.075)
    inferred_power = exitance * area

    assert 3_950 < exitance < 4_050
    assert 0.028 < area < 0.029
    assert 110 < inferred_power < 116


def test_100_w_of_sodium_light_has_expected_photon_rate() -> None:
    assert 2.9e20 < photon_rate_for_power(100) < 3.0e20


def test_salt_vapor_pressure_is_monotonic_and_flags_extrapolation() -> None:
    nacl_low = antoine_vapor_pressure_bar(1473.15, NACL_ANTOINE)
    nacl_high = antoine_vapor_pressure_bar(1673.15, NACL_ANTOINE)
    nai_high = antoine_vapor_pressure_bar(1673.15, NAI_ANTOINE)

    assert 0.10 < nacl_low["pressure_bar"] < 0.12
    assert 0.60 < nacl_high["pressure_bar"] < 0.65
    assert nacl_high["pressure_bar"] > nacl_low["pressure_bar"]
    assert nacl_high["inside_published_range"]
    assert not nai_high["inside_published_range"]


def test_full_lte_reference_includes_the_d1_d2_degeneracies() -> None:
    temperature_k = 2773.15
    simplified = sodium_3p_lte_fraction(
        temperature_k,
        include_fine_structure_degeneracy=False,
    )
    full = sodium_3p_lte_fraction(
        temperature_k,
        include_fine_structure_degeneracy=True,
    )
    assert 1.4e-4 < simplified < 1.7e-4
    assert 4.3e-4 < full < 5.0e-4
    assert 2.9 < full / simplified < 3.1


def test_public_report_includes_reference_chemistry_and_measurement_warning() -> None:
    report = public_experiment_benchmark()
    chemistry = report["thermochemistry_ceiling"]
    assert 2_750 < chemistry["adiabatic_temperature_k"] < 2_900
    assert chemistry["sodium_excitation_diagnostics"][
        "na_o_o_partial_pump_rate_per_na_s"
    ] > 1_000
    assert "2x" in report["reported"]["measurement_warning"]
    video = report["public_confinement_video"]
    assert video["duration_s"] == pytest.approx(159.25)
    assert video["median_clipped_core_width_fraction_of_chamber_window"] == pytest.approx(0.2)
    assert video["centerline_jitter_fraction_of_chamber_window"] < 0.005
    assert "No temperature" in video["scope"]


def test_public_video_runs_remain_separate_benchmark_cases() -> None:
    report = public_experiment_benchmark()
    confinement = report["public_confinement_video"]
    dynamic = report["public_dynamic_runs"]
    assert confinement["published_date"] == "2026-07-11"
    assert dynamic["2026_07_15_nacl_lowering"]["reported_absences"].startswith("no exhaust")
    assert "swirl" in dynamic["2026_07_16_alumina_swirl_torch"]["reported_configuration"]
    assert len({confinement["source"], *(run["source"] for run in dynamic.values())}) == 4


def test_wire_to_wire_target_exposes_required_fuel_to_light_burden() -> None:
    burden = conversion_feasibility_benchmark()
    assert burden["implied_hydrogen_to_electric_target"] == pytest.approx(0.5)
    scenarios = burden["scenarios"]
    assert scenarios["large_cell_public"][
        "required_fuel_to_pv_light_efficiency"
    ] == pytest.approx(0.5 / 0.35)
    assert not scenarios["large_cell_public"][
        "physically_possible_before_other_losses"
    ]
    assert not scenarios["small_laser_cell_public"][
        "physically_possible_before_other_losses"
    ]
    assert scenarios["future_cell"][
        "required_fuel_to_pv_light_efficiency"
    ] == pytest.approx(0.5 / 0.60)
    assert scenarios["future_cell"]["physically_possible_before_other_losses"]


def test_sodium_radical_cycle_is_catalytic_and_inventory_limited() -> None:
    inputs = {
        "temperature_k": 2000,
        "pressure_pa": 1.4e5,
        "hydrogen_atom_mole_fraction": 0.02,
        "hydroxyl_mole_fraction": 0.05,
        "nitrogen_mole_fraction": 0.3,
    }
    result = sodium_radical_cycle_diagnostic(
        sodium_mole_fraction=80e-6,
        **inputs,
    )
    assert 0 < result["naoh_pool_fraction"] < 1
    assert result["cycle_rate_per_sodium_s"] > 0
    assert result["cycle_time_s"] > 0
    assert result["hydrogen_inventory_time_s"] < result["hydroxyl_inventory_time_s"]

    doubled = sodium_radical_cycle_diagnostic(
        sodium_mole_fraction=160e-6,
        **inputs,
    )
    assert doubled["radical_sink_density_m3_s"] == pytest.approx(
        2 * result["radical_sink_density_m3_s"]
    )
    assert doubled["hydrogen_inventory_time_s"] == pytest.approx(
        result["hydrogen_inventory_time_s"] / 2
    )
