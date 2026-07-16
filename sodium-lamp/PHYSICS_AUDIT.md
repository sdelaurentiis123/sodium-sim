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

Reference: [Lightcell patent US12136898B2](https://patents.google.com/patent/US12136898B2/en).

### Combustion and thermal transport

- H2 flow is converted to molar flow, mass flow, and LHV power without mesh-dependent calibration.
- Fuel and stoichiometric-oxidizer-equivalent scalars are advected separately and diffuse at different rates.
- Heat release is proportional to the locally consumed fuel scalar and the molar enthalpy of H2 combustion. There is no continuously imposed hot flame or hidden heater; only the initial condition supplies an ignition seed.
- Axisymmetric conduction uses conservative radial face fluxes and harmonic face conductivity through gas/sapphire interfaces.
- The energy audit includes optical loss, radial environmental loss, sensible exhaust heat, and stored thermal-plus-excitation energy.
- The open-air flame length is only a comparator and is not imposed on the confined flame.
- A generated Cantera table supplies the operating HP-equilibrium state, the local stoichiometric adiabatic ceiling, O/H/OH radical comparators, and a premixed multicomponent/Soret flame-speed scale. Only the thermochemical ceiling constrains the reduced solve; the premixed speed is displayed, not imposed.
- A CPU mirror of the local GPU source term verifies that the default stabilized holder cell crosses the 1120 K self-sustaining activation threshold by consuming fuel and stoichiometric oxidizer. With the holder disabled at the same cold state, reaction and heat release remain exactly zero.

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
- **Sodium chemistry:** NaCl/NaOH/Na/OH speciation and neutral-sodium availability use a conservative inventory-preserving surrogate. This is probably the largest uncertainty in absolute brightness.
- **Chemical excitation yield:** the fraction of reaction power accepted into Na 3p is fixed at 1% and must be inferred from experiment.
- **Quenching:** H2 is measurement-anchored; O2, H2O, and N2 coefficients are engineering estimates.
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
