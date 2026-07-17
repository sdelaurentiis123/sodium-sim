# Literature and validation matrix

## Decision the simulator must support

The useful question is not “does sodium look bright?” It is whether a measured
hydrogen input can produce enough **PV-absorbed sodium D-line power** while the
flame remains stable, the salt is recovered, and the transparent cell survives.

The causal chain is:

1. metered H2 and oxidizer mix and react;
2. the salt vaporizes and partitions among NaCl/NaI, NaOH, neutral Na, and other
   sodium-bearing species;
3. chemical reactions, collisions, and trapped radiation populate Na 3p;
4. D1/D2 photons are emitted, quenched, reabsorbed, redistributed, and escape;
5. the real optical boundary sends some line power to the PV and the rest to
   reflection or heat;
6. the recuperator, wall, cooling, exhaust, and salt cycle close the system
   energy and material balances.

Every stage needs either a measurement, a primary-literature closure, or an
explicit uncertainty band. A visually plausible flame cannot substitute for
that chain.

## Source-to-model matrix

| Physical question | Primary evidence | Direct constraint | What it does **not** establish | Current model status |
| --- | --- | --- | --- | --- |
| Which reactions chemically excite Na 3p? | [Carabetta & Kaskan (1967)](https://doi.org/10.1016/S0082-0784(67)80156-5) | `Na + O + O -> Na(3p) + O2`, approximately `1e-29 cm6 molecule-2 s-1`; weaker evidence for `Na + H + H`, approximately `4e-31` | Total fraction of flame power entering D lines in the Lightcell geometry | O+O rate is a diagnostic; fixed 1% power fraction remains unvalidated |
| How fast is Na 3p quenched? | [Lijnse & Elsenaar (1972)](https://doi.org/10.1016/0022-4073(72)90014-3); [Lijnse & van der Maas (1973)](https://doi.org/10.1016/0022-4073(73)90115-5) | Flame-temperature cross sections for N2, H2O, H2, and O2 over 1500–2500 K | Exact Lightcell composition or behavior beyond the measured range | Implemented as temperature-dependent `sigma * mean relative speed`; out-of-range values are flagged |
| Does an aggregate flame quench/mix rate agree with time-resolved data? | [Takubo et al. (1986)](https://doi.org/10.1364/AO.25.000740); [Fiechtner et al. (1992)](https://doi.org/10.1364/AO.31.002849) | Atmospheric hydrocarbon flames give total quench rates about `1.4–1.72e9 s-1` and D2-to-D1 mixing about `3.0–3.66e9 s-1` | Species-resolved H2/O2 flame coefficients | Useful aggregate benchmark; mixing closure is not yet species-resolved |
| Does lean/rich H2 flame chemistry change neutral Na? | [Daidoji (1979)](https://doi.org/10.2116/bunsekikagaku.28.2_77) | NaCl and NaOH absorption is strong in lean H2 flames; atomic Na increases in rich flames | Quantitative neutral fraction for this pressure, salt feed, and residence time | Current sigmoid activity is qualitative and is a major brightness uncertainty |
| How quickly does neutral Na return to bound sodium? | [Husain & Plane (1982)](https://doi.org/10.1039/F29827800163); [Gomez Martin et al. (2017)](https://pubmed.ncbi.nlm.nih.gov/28902518/) | Absolute Na+O2+M and Na/NaOH-cycle rate coefficients in their measured regimes | A complete high-temperature NaCl/NaI/H2/O2 mechanism | Radical-burden screen exists; no coupled sodium flame mechanism yet |
| When does resonance trapping require redistribution physics? | [Molisch et al. (1989)](https://doi.org/10.1016/0022-4073(89)90114-3) | Measured sodium escape factors compared with complete- and incomplete-redistribution theories | That one redistribution closure is universally superior | Six-group P1/Voigt is a reduced closure requiring regime validation |
| Can trapping become nonlinear at high excitation? | [Bezuglov et al. (1997)](https://doi.org/10.1103/PhysRevE.55.3333) | Saturation changes effective opacity and emergent decay in strongly pumped sodium vapor | That Lightcell is in the pulsed-laser saturation regime | Not implemented; first test is inferred line-center occupation/saturation |
| What does public video validate? | [Lightcell confinement post (2026)](https://x.com/DanielleFong/status/2075742083605028898) | A persistent, exposure-clipped luminous column; reproducible width and centerline morphology | Absolute radiance, temperature, sodium density, salt identity, or D-line power | Video morphology benchmark implemented and explicitly limited |
| What geometry and system components are contemplated? | [US12136898B2](https://patents.google.com/patent/US12136898B2/en) | Concentric transparent chamber, return annulus, salt source/recovery concepts, recuperation, reflective optics, surrounding PV | Dimensions and performance of the latest public experiment | Geometry is a design study; undisclosed inputs remain provisional |

## Public videos are separate experiments

The public clips cannot be combined as though they show one evolving machine:

| Date | Post | Stated configuration | Valid use |
| --- | --- | --- | --- |
| 11 Jul 2026 | [hydrogen confinement](https://x.com/DanielleFong/status/2075742083605028898) | Hydrogen flame confinement; salt not stated | Steady clipped-column morphology only |
| 15 Jul 2026 | [NaCl chamber lowering](https://x.com/DanielleFong/status/2077515313911042150) | NaCl demonstration; unchanged H2 fuel while an assembly is lowered; no exhaust/salt recuperation | A distinct insertion/diversion protocol at fixed fuel input |
| 16 Jul 2026 | [alumina swirl torch](https://x.com/DanielleFong/status/2077657333476602240) | Fully alumina recuperated outer-annulus, swept/twirled compound nozzle | Future burner architecture and qualitative flame steadiness |
| 16 Jul 2026 | [improvised diversion](https://x.com/DanielleFong/status/2077657331211673775) | Existing hardware with additional flame/exhaust diversion | Separate qualitative diversion case |

Only the 15 July post supports an insertion animation, and even there the
undisclosed motion, geometry, and clipped exposure prevent quantitative
calibration. The simulator should label it as a protocol study rather than a
reconstruction.

## Immediate corrections from the literature

### 1. Quenching cannot use one pressure-scaled constant

For species `i`, the measured cross section is converted to a rate coefficient

`k_i(T) = sigma_i(T) * sqrt(8 k_B T / (pi mu_Na-i))`,

then the local loss rate is `sum_i n_i k_i`. At 2000 K the measured ordering is
O2 > N2 > H2 >> H2O in rate coefficient. This overturns the previous guessed
ordering, which made water the strongest and nitrogen the weakest quencher.

### 2. “Non-LTE” does not mean collisions can be ignored

The free-space Na 3p lifetime is about 16 ns (`A` about `6.2e7 s-1`), while
time-resolved atmospheric flame experiments measured total collisional losses
above `1e9 s-1`. The level population must therefore be solved from pumping,
radiation, quenching, and fine-structure mixing. Boltzmann is only a detached
comparison, but an arbitrary pump fraction is not an acceptable replacement.

### 3. Brightness is dominated by two unidentified quantities

The present absolute light output depends strongly on:

- the neutral-Na fraction released from the salt/speciation cycle; and
- the fraction of chemical power that actually enters Na 3p.

Neither is established by the public video or the 1967 partial reaction rate.
The next defensible feature should invert the measured absolute D1/D2 spectrum
to report the **required** neutral-Na column and chemical pump power, rather than
presenting the fixed 1% yield as a prediction.

## Minimum experiment needed to identify the model

One synchronized run should record:

1. calibrated H2 and oxidizer mass flow, composition, pressure, and inlet
   temperature;
2. exact burner/cell/salt geometry and source motion;
3. an absolutely calibrated, high-resolution 585–593 nm spectrum at multiple
   axial positions and view angles;
4. independent gas temperature and inner/outer wall temperature;
5. exhaust H2/O2/H2O plus sodium-bearing species or captured sodium mass;
6. total line-band optical power and a simultaneous PV I-V curve.

The spectrum supplies D1/D2 power, widths, and self-reversal. Independent
temperature prevents the Na line from being used both to infer temperature and
to validate the same population model. Flow and exhaust data close combustion;
wall measurements close heat transfer; salt capture closes the material cycle;
the I-V curve finally distinguishes optical power from useful electricity.

## Ranked next work

1. **Inverse spectral requirement:** replace the fixed-yield headline with the
   neutral-Na column and Na-3p pump power required to reproduce a chosen absolute
   spectrum; expose uncertainty rather than a tuning knob.
2. **Detailed sodium speciation table:** build or obtain a validated NaCl/NaI/
   Na/NaOH mechanism and benchmark it to seeded H2-flame absorption data.
3. **Redistribution reference solve:** compare the six-group WebGPU closure with
   frequency-resolved slab/cylinder escape factors across optical depth,
   pressure width, and saturation.
4. **Strained H2 flamelets:** replace the holder/one-step chemistry as a
   predictive flame model only after coaxial geometry and flow data are known.
5. **Measured optical/material stack:** import spectral mirror/PV response and
   temperature-dependent sapphire/ceramic data; do not infer survival from the
   melting point.
