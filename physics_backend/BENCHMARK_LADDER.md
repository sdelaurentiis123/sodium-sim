# Experimental benchmark ladder

The WebGPU model should be judged against measured observables in this order.
Passing a later tier does not excuse failing an earlier one.

## Tier 0 — invariants

- mass, sodium inventory, energy, and atomic populations remain non-negative;
- D1 + D2 + ground-state population closes to one;
- integrated fuel heat, stored energy, wall/exhaust losses, quenching, and
  escaped light close to within 5% after the transient settles;
- changing a design input starts a new run at `t=0`.

## Tier 1 — isolated atomic physics

- D2 and D1 centers are 588.9950 and 589.5924 nm, with radiative lifetimes near
  16 ns;
- the optically thin D2/D1 ratio approaches two, but is not forced to remain
  two after collisional fine-structure mixing and self-absorption;
- line-center optical depth is linear in neutral-sodium column density;
- a cool sodium-bearing boundary layer produces central self-reversal rather
  than only dimming the whole line;
- the Boltzmann 3p population is displayed only as a detached comparison.

Current browser intuition at 2200 K, 1.4 bar, and a 2 cm path:

| neutral Na | D2 line-center optical depth |
| ---: | ---: |
| 0.01 ppm | 0.066 |
| 0.1 ppm | 0.66 |
| 1 ppm | 6.6 |
| 10 ppm | 66 |
| 80 ppm | 531 |

This agrees qualitatively with the public patent's observation that sodium
self-absorption becomes important around 5–10 ppm. Absolute values remain
sensitive to the actual mixture-dependent pressure width and line wings.

## Tier 2 — hydrogen flame

- Cantera `h2o2.yaml` constant-enthalpy equilibrium is a temperature ceiling,
  not a spatial flame solution;
- at the current default (stoichiometric, 38% O2, 1.4 bar, 320 K inlet), the
  equilibrium ceiling is about 2816 K;
- 21% O2 gives about 2408 K and pure O2 gives about 3122 K under the same
  assumptions;
- measured H2-air counterflow extinction near 5670 1/s is a geometry-specific
  validation case, not a universal cutoff;
- the current default inlet velocities, about 63 m/s H2 and 28 m/s oxidizer,
  make flame attachment, lift, strain, and extinction essential outputs.

The next reference computation should therefore be a Cantera axisymmetric or
counterflow diffusion-flame sweep with multicomponent transport and Soret
diffusion, not a tuned one-step reaction rate.

## Tier 3 — sodium chemistry and non-LTE excitation

- in oxygen-rich H2/O2/N2 flames, measured free Na follows H-radical decay;
  NaOH dominates above roughly 2000 K, while NaO2 becomes increasingly
  important at lower temperature;
- the measured partial channel `Na + O + O -> Na(3p) + O2` supplies about
  6.6e3 excitations/s/Na at the default equilibrium state and about 1.1e5
  excitations/s/Na in the pure-O2 equilibrium reference;
- those are partial rates, not a total excitation yield;
- D-line absorption, spontaneous/stimulated emission, fine-structure mixing,
  quenching, and chemical pumping must all be present in the rate ledger.

The strongest non-LTE experimental benchmark is not an inferred departure
coefficient. It is the jointly fitted absolute D1/D2 spectrum, gas temperature,
neutral-Na column, and line self-reversal. The model may then infer the
population that reproduces those observables.

## Tier 4 — Lightcell public experiment

Public peak values are useful as broad validation bands:

- 670,000 cd/m2 peak luminance;
- 6.7 kW/m2 reported peak exitance;
- about 100 W integrated line power;
- NaI and oxygen for the brightest reported run;
- estimated wall working temperature 1400–1600 C;
- NaCl used for continuing evaporation/condensation work.

For narrowband 589 nm Lambertian emission, the CIE photopic conversion maps
670,000 cd/m2 to about 4.0 kW/m2. Applied to the patent's reference cylinder
sidewall area (12 cm long, 7.5 cm diameter), this gives about 113 W. That is
close to the separately reported 100 W integrated estimate. The reported
6.7 kW/m2 over the same reference area gives about 189 W.

These should initially be treated as factor-of-two bands because the public
post explicitly warns that the flow meters and point-light extrapolation may
each carry errors of that order, and the patent cylinder may not be the bright
experiment's exact geometry.

## Tier 5 — salt cycle and wall survival

NIST vapor-pressure fits imply:

| source temperature | NaCl pressure | NaI pressure | validity |
| ---: | ---: | ---: | --- |
| 1200 C | about 0.11 bar | about 0.42 bar | both fits valid |
| 1400 C | about 0.62 bar | about 2.1 bar | NaI is extrapolated |
| 1600 C | about 2.4 bar | about 7.1 bar | both are extrapolated |

Therefore wall temperature cannot be used as a direct salt-vapor-pressure knob
without resolving the source temperature, available salt inventory, flow,
condensation, and non-ideal gas chemistry.

The sapphire pass/fail test cannot be “below 2323 K melting point.” Sapphire
creep is documented from 900–1400 C, and NASA high-temperature optical-window
work shows that thermal gradients, surface flaws, mounting tension, and thermal
shock can fail sapphire far below melting. The browser needs:

- inner/outer temperature and through-wall gradient;
- hoop/axial thermal-stress proxy with curvature and mounting assumptions;
- creep exposure time;
- thermal-cycle rate;
- salt deposition and crack/flaw warning.

## Measurements that would collapse the uncertainty fastest

1. Calibrated H2 and oxidizer mass flow, composition, pressure, and exact
   burner geometry.
2. High-speed flame video synchronized with wall/source motion.
3. An absolutely calibrated 585–593 nm spectrum with enough resolution to see
   D1/D2 line centers, widths, wings, and self-reversal.
4. Sodium line-reversal or another independent gas-temperature measurement.
5. Two-color wall thermometry at the inner and outer sapphire surfaces.
6. Salt mass before/after, source temperature, deposition map, and exhaust
   capture.
7. Simultaneous total optical power, angular radiance, and PV electrical output.

Those measurements let us fit chemistry and boundary parameters while keeping
the atomic constants, conservation laws, and detailed H2/O2 reference fixed.
