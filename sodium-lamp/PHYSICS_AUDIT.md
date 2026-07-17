# Sodium Lamp physics audit

This is a reduced research model, not a design-certification CFD or safety code. Its job is to make the proposed causal chain inspectable:

1. Metered hydrogen and oxidizer enter through a coaxial burner.
2. Mixing and finite-rate reaction generate heat.
3. A fraction of that reaction power pumps neutral sodium into the 3p fine-structure states.
4. D1/D2 photons are emitted, absorbed, stimulated, quenched, transported, reflected, and lost at the optical boundary.
5. Heat conducts through inner and outer sapphire walls while exhaust returns through the annulus.

## What a builder needs to see

- Metered H2 lower-heating-value input and instantaneous integrated heat release.
- Equivalence ratio, H2 nozzle velocity, oxidizer-shroud velocity, Reynolds number, Mach number, and mass-derived return-annulus velocity.
- Resolved flame base, tip, radial clearance, axial clearance, and an open-air jet-flame reference.
- A reproducible camera-morphology extraction from the 11 July 2026 public confinement video: 141 one-second samples across 10--150 s give a median clipped-core width of 0.200 chamber-window widths and centerline jitter of 0.00449 widths. The column crosses every axial row of the fixed analysis window, so its length is censored. These are confinement/stability observables only; the clipped video cannot validate temperature or radiance. The extraction is implemented in `physics_backend/public_video_observables.py`.
- Peak gas temperature against an interpolated Cantera thermochemical ceiling, peak sapphire temperature, outer-skin temperature, maximum through-wall temperature difference, melt margin, creep-relevant screening, peak inner-wall heat flux, and hotspot location.
- D1/D2 populations, detached Boltzmann comparison, departure coefficient, excitation temperature, optical depth, rate-balance residual, reabsorption, quenching, and coupled atom-plus-photon residence time.
- Resolved D1/D2 line shape with hot-core/cool-shell self-absorption, emergent line power and wall exitance, power absorbed by the PV boundary, parasitic optical absorption, sensible exhaust heat, outer thermal loss, stored-energy rate, and closure residual.

## Physics checked and enforced

### Geometry and flow

- The public Lightcell geometry uses two concentric transparent cylinders, an inner combustion region, an annular return path, and burner/manifold flow paths. The model now contains both sapphire walls and excludes them from the gas-flow area.
- H2 velocity is computed from the entered standard flow, ideal-gas expansion to chamber pressure and temperature, and the H2 nozzle area.
- Oxidizer velocity is computed from its standard flow and the physical annulus between the H2 tube and oxidizer shroud.
- Return velocity is independently computed from the sum of the two actual inlet volume flows divided by the return-annulus area. No local nozzle velocity is reused as a bulk exhaust velocity.
- The lower return boundary is an outflow. Design controls rebuild from `t=0`; operating flow controls change the running transient.
- The run-mode selector exposes two distinct combustion branches. **Stabilized reference** initializes near the burning branch and supplies a Gaussian radical-equivalent activity only in a roughly 2.8 mm axial zone around the H2-nozzle lip. Its radial support is resolved over more than one GPU cell so it cannot disappear between cell centers; heat is still released only where transported fuel and oxidizer overlap. **Ignition / blowoff transient** removes that activity and uses one finite ignition seed.
- A separate **15 Jul NaCl lowering study** keeps the external metered H2 input fixed while an area-averaged source-engagement fraction ramps smoothly from bypassed to captured. That fraction scales the admitted fuel, oxidizer, sodium source, holder support, and return flow; the bypassed fuel is reported but lies outside the simulated domain. The roughly 7 ms browser protocol accelerates fluid response for inspection and is not mapped to the 15.541 s video duration. The post does not disclose the moving assembly, trajectory, dimensions, or internal boundary shape, so no hardware motion is claimed.

Reference: [Lightcell patent US12136898B2](https://patents.google.com/patent/US12136898B2/en).

### Combustion and thermal transport

- H2 flow is converted to molar flow, mass flow, and LHV power without mesh-dependent calibration.
- Fuel and stoichiometric-oxidizer-equivalent scalars are advected separately and diffuse at different rates.
- Heat release is proportional to the locally consumed fuel scalar and the molar enthalpy of H2 combustion. There is no continuously imposed hot flame or hidden heater; only the initial condition supplies an ignition seed.
- Axisymmetric conduction uses conservative radial face fluxes and harmonic face conductivity through gas/sapphire interfaces.
- The energy audit includes optical loss, radial environmental loss, sensible exhaust heat, and stored thermal-plus-excitation energy.
- The conversion-feasibility gate keeps PV-absorbed D-line power distinct from electrical output. It reports electrical scenarios using the public 35% large-cell result, the separate 44% 1 mm laser-cell result, and a 60% future-cell case. It also displays the fuel-to-PV-light fraction each would require to meet a 50% hydrogen-to-electric generator target; component peaks are never multiplied as though they were simultaneous.
- The open-air flame length is only a comparator and is not imposed on the confined flame.
- A generated Cantera table supplies the operating HP-equilibrium state, the local stoichiometric adiabatic ceiling, O/H/OH radical comparators, and a premixed multicomponent/Soret flame-speed scale. Only the thermochemical ceiling constrains the reduced solve; the premixed speed is displayed, not imposed.
- A separate Na/NaOH radical-burden screen evaluates the measured `Na + OH + N2 -> NaOH + N2` and `NaOH + H -> Na + H2O` rates against the unperturbed Cantera H/OH pool and the solved sodium inventory. It exposes catalytic-cycle and nominal radical-inventory times beside the core transit time. It is intentionally not fed into the one-step flame: a coupled sodium mechanism must first reproduce sodium-seeded flame data. Reference: [Gómez Martín et al. (2017)](https://pubmed.ncbi.nlm.nih.gov/28902518/).
- A CPU mirror of the local GPU source term verifies that the default stabilized holder cell crosses the 1120 K self-sustaining activation threshold by consuming fuel and stoichiometric oxidizer. With the holder disabled at the same cold state, reaction and heat release remain exactly zero.
- The automated branch sweep covers air and oxygen-enriched oxidizers, lean and rich global mixtures, 0.5–4 bar, and 2–8 mm fuel nozzles. A 112-cell axial advection–reaction mirror uses the browser timestep, coaxial inlet profiles, nozzle-derived velocities, finite ignition kernel, holder source, and Cantera temperature ceiling. It checks persistent stabilized anchoring, cold unforced non-ignition, transient survival or blowoff, and missing-reactant extinction. This exercises source/throughflow competition; it does not replace the axisymmetric WebGPU transport field.

Reference: [Molkov and Saffers, hydrogen jet-flame correlation](https://publications.iafss.org/publications/fss/10/933).

### Sodium non-LTE kinetics

- The solved upper populations are Na 3p 2P1/2 and 3p 2P3/2, with separate D1 and D2 photons.
- Population gains are chemical pumping, thermal collisional excitation, and radiation absorption.
- Losses are spontaneous emission, stimulated emission, and species-weighted collisional quenching.
- D1/D2 collisional transfer conserves total 3p population and approaches detailed balance in the strong-collision limit.
- Boltzmann populations are calculated only after the solve as a diagnostic. They are never fed back into the state update.
- Unit tests enforce population normalization and local gain/loss closure.

Atomic reference: [NIST Atomic Spectra Database](https://physics.nist.gov/PhysRefData/ASD/lines_form.html).

### Resonance-radiation transport

- Six groups are transported: core, near-wing, and far-wing groups for each D line.
- Absorption and stimulated emission use Einstein relations expressed through photon occupation number.
- Line-center opacity uses a Voigt-center expression with Doppler, natural, and effective pressure broadening.
- The right-hand spectrum resolves an integral-normalized Voigt approximation on 720 wavelength points. A hot non-LTE emitting cell is transferred through a cooler sodium-bearing annular state extracted from the GPU, allowing physical D-line self-reversal. Each resolved line is normalized to the power transported by the corresponding three GPU groups.
- The boundary is a P1/partial-current Robin condition. It is not the former nonphysical `ghost = reflectance × interior` boundary.
- Boundary reflectance, PV absorptance, and parasitic absorptance are constrained to sum to one.

References: [Fresnel/P1 Robin boundary derivation](https://arxiv.org/abs/2107.09411), [experimental Na-D broadening in flame perturbers](https://doi.org/10.1016/0022-4073(81)90045-5).

## Important limits that remain

These are displayed as model limits rather than hidden tuning parameters:

- **H/O chemistry:** the one-step reaction does not resolve H, O, OH, HO2, H2O2, extinction, ignition delay, or local detailed kinetics. Temperature is now bounded by an interpolated Cantera stoichiometric HP-equilibrium ceiling, and a premixed flame-speed table is displayed as a scale. A defensible flame prediction still needs a strained non-premixed flamelet or validated reduced mechanism. See [Cantera's constant-enthalpy equilibrium method](https://www.cantera.org/stable/userguide/flame-temperature.html).
- **Flame stabilization:** stabilized mode is a controlled subgrid flame-holder closure, not a Navier-Stokes prediction of attachment. It stands in for unresolved radical recirculation, burner-lip heat feedback, and the low-speed boundary layer. Transient mode is the appropriate branch for asking whether the present reduced model blows off.
- **Velocity field:** the solver advects through a prescribed axisymmetric coaxial-jet/turn/return field. It does not solve Navier-Stokes pressure, swirl, turbulence, buoyancy, acoustic instability, or pressure drop.
- **Chamber engagement:** the 15 July mode is an area-averaged inlet/source homotopy on a fixed mesh. It is useful for checking whether heat, non-LTE excitation, spectra, and wall load settle after source capture, but it cannot predict the actual lowering transient or distinguish partial aperture, flame diversion, changing optical collection, and moving-wall effects.
- **Sodium chemistry:** NaCl/NaOH/Na/OH speciation and neutral-sodium availability use a conservative inventory-preserving surrogate. The new measured-rate radical screen demonstrates why sodium cannot be treated only as a passive emitter, but it does not yet predict how much the flame slows or extinguishes. This is probably the largest uncertainty in both absolute brightness and flame stability.
- **Chemical excitation yield:** the fraction of reaction power accepted into Na 3p is fixed at 1% and must be inferred from experiment.
- **Quenching:** H2, O2, H2O, and N2 now use measured 1500--2500 K flame cross sections converted to rate coefficients with the mean relative speed. Values outside each paper's temperature window clamp to the nearest endpoint and are flagged; the actual local mixture remains model-dependent. References: [Lijnse & Elsenaar (1972)](https://doi.org/10.1016/0022-4073(72)90014-3) and [Lijnse & van der Maas (1973)](https://doi.org/10.1016/0022-4073(73)90115-5).
- **Line shape:** the high-resolution diagnostic is a two-layer transfer reconstruction tied to six-group power, not a frequency-resolved transport solve. The pressure width is one effective coefficient. Real Na-D widths, shifts, and redistribution depend strongly on H2, H2O, N2, O2, temperature, and line wing.
- **Optical hardware:** one diffuse reflectance and one D-line PV absorptance are used on radial and end boundaries. Real angle-, wavelength-, temperature-, and position-dependent mirror/PV data are not yet included.
- **Materials:** sapphire conduction and through-wall gradients are solved. The displayed thermal-stress number is the fully constrained elastic upper bound, not a structural result. Thermal contact resistance, anisotropy, salt wetting/crack mechanics, creep life, flaws, mounting loads, and fracture are not solved.
- **Other radiation:** molecular bands, sodium higher-state cascades, continuum radiation, ionization, aerosols, droplets, and wall/salt emission are omitted.
- **Axisymmetry:** asymmetric flame motion and the experimentally visible instability modes cannot appear.

## Highest-value experimental data

1. H2 and oxidizer mass-flow calibration, chamber pressure, and exact burner dimensions.
2. Time-synchronized high-speed video plus two-color or spectroscopic gas-temperature inference.
3. D1/D2 spectra with absolute radiometric calibration at several axial positions and boundary angles.
4. Inner/outer sapphire temperatures and axial heat-flux proxies.
5. Exhaust O2/H2/H2O and sodium-bearing species, so conversion and neutral-sodium activity can be constrained.
6. Measured spectral reflectance/absorptance of the actual wall, mirror, and PV stack at operating temperature.

Those measurements would turn the largest current assumptions—flow field, sodium activity, excitation yield, quench mixture, and boundary spectrum—into inferred parameters with uncertainty bands.
