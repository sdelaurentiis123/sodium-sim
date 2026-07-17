"""Public experimental and first-principles benchmarks for the Lightcell model.

These functions convert reported observables into quantities that the browser
simulation can be tested against. They deliberately keep assumptions visible:
the photometric conversion assumes narrowband 589 nm Lambertian emission, and
the salt vapor-pressure fits are only valid inside their published ranges.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from math import exp, pi

from reference_chemistry import equilibrium_reference_state


H_J_S = 6.626_070_15e-34
C_M_S = 299_792_458.0
KB_J_K = 1.380_649e-23
EV_J = 1.602_176_634e-19

SODIUM_D_WAVELENGTH_M = 589.0e-9
SODIUM_D_ENERGY_EV = 2.1035

# CIE 018:2019 photopic spectral luminous efficiency at 589 nm.
CIE_V_589 = 0.769_154_7
MAX_PHOTOPIC_LUMINOUS_EFFICACY_LM_W = 683.0

# Public component results and targets. They remain separate because the
# reported optical, electrical, and cell-efficiency peaks were not simultaneous.
PUBLIC_LARGE_CELL_PV_EFFICIENCY = 0.35
PUBLIC_SMALL_LASER_CELL_PV_EFFICIENCY = 0.44
ASPIRATIONAL_PV_EFFICIENCY = 0.60
TARGET_WIRE_TO_WIRE_EFFICIENCY = 0.40
REFERENCE_ELECTROLYZER_EFFICIENCY = 0.80

PUBLIC_CONFINEMENT_VIDEO = {
    "source": "https://x.com/DanielleFong/status/2075742083605028898",
    "published_date": "2026-07-11",
    "reported_configuration": "hydrogen flame confinement; salt identity not stated",
    "duration_s": 159.25,
    "analysis_window_s": [10.0, 150.0],
    "sampled_frames": 141,
    "median_clipped_core_width_fraction_of_chamber_window": 0.200,
    "clipped_core_width_fraction_p10_p90": [0.1697, 0.2182],
    "centerline_jitter_fraction_of_chamber_window": 0.00449,
    "median_axial_coverage_fraction": 1.0,
    "scope": (
        "fixed-ROI camera morphology; all-RGB >=245 clipped core. "
        "The luminous column crosses the analysis window, so length is censored. "
        "No temperature, radiance, line power, or sodium concentration is inferred."
    ),
}

# Distinct public runs. Do not combine their observables into one implied rig.
PUBLIC_DYNAMIC_RUNS = {
    "2026_07_15_nacl_lowering": {
        "source": "https://x.com/DanielleFong/status/2077515313911042150",
        "published_date": "2026-07-15",
        "duration_s": 15.541,
        "reported_configuration": (
            "NaCl radiative-efficiency demonstration; an assembly is lowered "
            "into the chamber at fixed hydrogen fuel rate"
        ),
        "reported_absences": "no exhaust-to-oxidizer or salt recuperation",
        "scope": (
            "qualitative insertion/diversion transient; clipped camera response "
            "is not radiometry and dimensions are not disclosed"
        ),
    },
    "2026_07_16_alumina_swirl_torch": {
        "source": "https://x.com/DanielleFong/status/2077657333476602240",
        "published_date": "2026-07-16",
        "duration_s": 12.0,
        "reported_configuration": (
            "fully alumina torch with exhaust recuperation, preheated outer "
            "annulus, and swept/twirled compound nozzle for swirl stabilization"
        ),
        "scope": "separate burner architecture; no public calibrated flow or radiometry",
    },
    "2026_07_16_improvised_diversion": {
        "source": "https://x.com/DanielleFong/status/2077657331211673775",
        "published_date": "2026-07-16",
        "duration_s": 6.041,
        "reported_configuration": "improvised hydrogen-flame emitter with additional exhaust diversion",
        "scope": "separate hardware run; not the July 15 insertion or July 11 confinement run",
    },
}

# Gomez Martin et al., J. Phys. Chem. A 121 (2017) 7667--7674.
# The termolecular value is specific to N2 as the third body. Unit conversion:
# cm3 -> 1e-6 m3 and cm6 -> 1e-12 m6.
NAOH_H_RATE_M3_MOLECULE_S = 3.8e-17
NA_OH_N2_RATE_300K_M6_MOLECULE2_S = 2.7e-41


@dataclass(frozen=True)
class AntoineFit:
    species: str
    minimum_temperature_k: float
    maximum_temperature_k: float
    a: float
    b: float
    c: float
    source: str


NACL_ANTOINE = AntoineFit(
    species="NaCl",
    minimum_temperature_k=1138.0,
    maximum_temperature_k=1738.0,
    a=5.07184,
    b=8388.497,
    c=-82.638,
    source="NIST Chemistry WebBook / Stull 1947",
)

NAI_ANTOINE = AntoineFit(
    species="NaI",
    minimum_temperature_k=1040.0,
    maximum_temperature_k=1577.0,
    a=5.03702,
    b=7405.912,
    c=-104.186,
    source="NIST Chemistry WebBook / Stull 1947",
)


def sodium_d_photon_energy_j() -> float:
    return H_J_S * C_M_S / SODIUM_D_WAVELENGTH_M


def photon_rate_for_power(power_w: float) -> float:
    if power_w < 0:
        raise ValueError("power_w must be non-negative")
    return power_w / sodium_d_photon_energy_j()


def narrowband_lambertian_exitance_w_m2(
    luminance_cd_m2: float,
    *,
    photopic_efficiency: float = CIE_V_589,
) -> float:
    """Convert 589 nm luminance to hemispherical radiant exitance.

    L_v = 683 V(lambda) L_e and M_e = pi L_e for a Lambertian emitter.
    This is not valid for a strongly directional or spectrally broad source.
    """

    if luminance_cd_m2 < 0:
        raise ValueError("luminance_cd_m2 must be non-negative")
    if not 0 < photopic_efficiency <= 1:
        raise ValueError("photopic_efficiency must be between zero and one")
    radiance_w_m2_sr = (
        luminance_cd_m2
        / (MAX_PHOTOPIC_LUMINOUS_EFFICACY_LM_W * photopic_efficiency)
    )
    return pi * radiance_w_m2_sr


def cylinder_lateral_area_m2(*, length_m: float, diameter_m: float) -> float:
    if length_m <= 0 or diameter_m <= 0:
        raise ValueError("cylinder dimensions must be positive")
    return pi * diameter_m * length_m


def antoine_vapor_pressure_bar(
    temperature_k: float,
    fit: AntoineFit,
) -> dict:
    if temperature_k <= 0:
        raise ValueError("temperature_k must be positive")
    pressure_bar = 10 ** (fit.a - fit.b / (temperature_k + fit.c))
    return {
        "species": fit.species,
        "temperature_k": temperature_k,
        "pressure_bar": pressure_bar,
        "inside_published_range": (
            fit.minimum_temperature_k
            <= temperature_k
            <= fit.maximum_temperature_k
        ),
        "fit": asdict(fit),
    }


def sodium_3p_lte_fraction(
    temperature_k: float,
    *,
    include_fine_structure_degeneracy: bool = True,
) -> float:
    """Return a detached LTE comparison for Na(3p), never a model closure."""

    if temperature_k <= 0:
        raise ValueError("temperature_k must be positive")
    degeneracy_ratio = 3.0 if include_fine_structure_degeneracy else 1.0
    ratio = degeneracy_ratio * exp(
        -(SODIUM_D_ENERGY_EV * EV_J) / (KB_J_K * temperature_k)
    )
    return ratio / (1.0 + ratio)


def conversion_feasibility_benchmark(
    *,
    wire_to_wire_target: float = TARGET_WIRE_TO_WIRE_EFFICIENCY,
    electrolyzer_efficiency: float = REFERENCE_ELECTROLYZER_EFFICIENCY,
) -> dict:
    """Expose the fuel-to-PV-light burden implied by the public target."""

    if not 0 < wire_to_wire_target <= 1:
        raise ValueError("wire_to_wire_target must be between zero and one")
    if not 0 < electrolyzer_efficiency <= 1:
        raise ValueError("electrolyzer_efficiency must be between zero and one")

    generator_target = wire_to_wire_target / electrolyzer_efficiency

    def scenario(name: str, pv_efficiency: float) -> dict:
        required = generator_target / pv_efficiency
        return {
            "name": name,
            "pv_efficiency": pv_efficiency,
            "required_fuel_to_pv_light_efficiency": required,
            "physically_possible_before_other_losses": required <= 1,
        }

    return {
        "wire_to_wire_target": wire_to_wire_target,
        "electrolyzer_efficiency": electrolyzer_efficiency,
        "implied_hydrogen_to_electric_target": generator_target,
        "scenarios": {
            "large_cell_public": scenario(
                "public 2 cm large-cell result",
                PUBLIC_LARGE_CELL_PV_EFFICIENCY,
            ),
            "small_laser_cell_public": scenario(
                "public 1 mm laser-cell result",
                PUBLIC_SMALL_LASER_CELL_PV_EFFICIENCY,
            ),
            "future_cell": scenario(
                "aspirational future cell",
                ASPIRATIONAL_PV_EFFICIENCY,
            ),
        },
    }


def sodium_radical_cycle_diagnostic(
    *,
    temperature_k: float,
    pressure_pa: float,
    sodium_mole_fraction: float,
    hydrogen_atom_mole_fraction: float,
    hydroxyl_mole_fraction: float,
    nitrogen_mole_fraction: float,
) -> dict:
    """Screen the measured Na/NaOH catalytic radical-removal cycle.

    The two reactions are Na + OH + N2 -> NaOH + N2 and
    NaOH + H -> Na + H2O. Radical fractions should come from an independent
    detailed-chemistry reference; they are not fed back into the flame solve.
    """

    if temperature_k <= 0 or pressure_pa <= 0:
        raise ValueError("temperature and pressure must be positive")
    fractions = (
        sodium_mole_fraction,
        hydrogen_atom_mole_fraction,
        hydroxyl_mole_fraction,
        nitrogen_mole_fraction,
    )
    if any(value < 0 or value > 1 for value in fractions):
        raise ValueError("mole fractions must be between zero and one")

    number_density_m3 = pressure_pa / (KB_J_K * temperature_k)
    hydrogen_density_m3 = hydrogen_atom_mole_fraction * number_density_m3
    hydroxyl_density_m3 = hydroxyl_mole_fraction * number_density_m3
    nitrogen_density_m3 = nitrogen_mole_fraction * number_density_m3
    sodium_pool_density_m3 = sodium_mole_fraction * number_density_m3
    na_to_naoh_rate_s = (
        NA_OH_N2_RATE_300K_M6_MOLECULE2_S
        * (300.0 / temperature_k) ** 1.2
        * hydroxyl_density_m3
        * nitrogen_density_m3
    )
    naoh_to_na_rate_s = NAOH_H_RATE_M3_MOLECULE_S * hydrogen_density_m3
    rate_sum = na_to_naoh_rate_s + naoh_to_na_rate_s
    naoh_pool_fraction = na_to_naoh_rate_s / rate_sum if rate_sum else 0.0
    cycle_rate_per_sodium_s = (
        na_to_naoh_rate_s * naoh_to_na_rate_s / rate_sum if rate_sum else 0.0
    )
    radical_sink_density_m3_s = sodium_pool_density_m3 * cycle_rate_per_sodium_s

    def inventory_time(inventory_m3: float) -> float:
        return inventory_m3 / radical_sink_density_m3_s if radical_sink_density_m3_s else float("inf")

    return {
        "number_density_m3": number_density_m3,
        "na_to_naoh_rate_s": na_to_naoh_rate_s,
        "naoh_to_na_rate_s": naoh_to_na_rate_s,
        "naoh_pool_fraction": naoh_pool_fraction,
        "cycle_rate_per_sodium_s": cycle_rate_per_sodium_s,
        "cycle_time_s": 1.0 / cycle_rate_per_sodium_s if cycle_rate_per_sodium_s else float("inf"),
        "radical_sink_density_m3_s": radical_sink_density_m3_s,
        "hydrogen_inventory_time_s": inventory_time(hydrogen_density_m3),
        "hydroxyl_inventory_time_s": inventory_time(hydroxyl_density_m3),
        "scope": (
            "N2 third-body channel with unperturbed reference H/OH; "
            "burden screen only, not a coupled inhibited-flame prediction"
        ),
    }


def public_experiment_benchmark() -> dict:
    """Assemble the current public-data benchmark at the reported peak."""

    luminance_cd_m2 = 670_000.0
    reported_integrated_power_w = 100.0
    reported_exitance_w_m2 = 6_700.0
    patent_length_m = 0.12
    patent_diameter_m = 0.075

    inferred_exitance = narrowband_lambertian_exitance_w_m2(luminance_cd_m2)
    patent_area = cylinder_lateral_area_m2(
        length_m=patent_length_m,
        diameter_m=patent_diameter_m,
    )

    return {
        "reported": {
            "peak_luminance_cd_m2": luminance_cd_m2,
            "peak_exitance_w_m2": reported_exitance_w_m2,
            "integrated_line_power_w": reported_integrated_power_w,
            "wall_temperature_c_range": [1400.0, 1600.0],
            "salt": "NaI for brightest reported run; NaCl for salt-cycle work",
            "measurement_warning":
                "Public post says flow and point-light measurements may each be off by about 2x.",
        },
        "photometric_cross_check": {
            "assumption": "narrowband 589 nm Lambertian sidewall",
            "cie_v_589": CIE_V_589,
            "inferred_exitance_w_m2": inferred_exitance,
            "patent_reference_lateral_area_m2": patent_area,
            "inferred_power_over_patent_area_w": inferred_exitance * patent_area,
            "reported_exitance_power_over_patent_area_w":
                reported_exitance_w_m2 * patent_area,
            "reported_100w_photon_rate_s":
                photon_rate_for_power(reported_integrated_power_w),
        },
        "thermochemistry_ceiling": equilibrium_reference_state(
            equivalence_ratio=1.0,
            oxygen_fraction=0.38,
            pressure_bar=1.4,
            inlet_temperature_k=320.0,
        ),
        "conversion_feasibility": conversion_feasibility_benchmark(),
        "public_confinement_video": PUBLIC_CONFINEMENT_VIDEO,
        "public_dynamic_runs": PUBLIC_DYNAMIC_RUNS,
        "salt_vapor_pressure": {
            "at_1200_c": {
                "NaCl": antoine_vapor_pressure_bar(1473.15, NACL_ANTOINE),
                "NaI": antoine_vapor_pressure_bar(1473.15, NAI_ANTOINE),
            },
            "at_1400_c": {
                "NaCl": antoine_vapor_pressure_bar(1673.15, NACL_ANTOINE),
                "NaI": antoine_vapor_pressure_bar(1673.15, NAI_ANTOINE),
            },
            "at_1600_c": {
                "NaCl": antoine_vapor_pressure_bar(1873.15, NACL_ANTOINE),
                "NaI": antoine_vapor_pressure_bar(1873.15, NAI_ANTOINE),
            },
        },
    }
