from flame_reference_table import free_flame_reference_state


def test_free_flame_reference_is_physical_and_oxygen_enrichment_raises_speed():
    air = free_flame_reference_state(
        equivalence_ratio=1.0,
        oxygen_fraction=0.21,
        pressure_bar=1.4,
    )
    enriched = free_flame_reference_state(
        equivalence_ratio=1.0,
        oxygen_fraction=0.38,
        pressure_bar=1.4,
    )

    assert 2.0 < air["laminar_flame_speed_m_s"] < 2.7
    assert enriched["laminar_flame_speed_m_s"] > air["laminar_flame_speed_m_s"]
    assert 2700.0 < enriched["maximum_temperature_k"] < 2900.0
    assert "not a coaxial burner closure" in enriched["scope"]
