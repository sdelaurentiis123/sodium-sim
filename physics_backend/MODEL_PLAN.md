# Lightcell simulator: physically defensible target

## Experimental interpretation

The recent public experiment is described as “testing out a hydrogen flame
with my salt wand.” This supports treating the current demo as a hydrogen flame
interacting with a sodium-salt source, not yet as a fully specified production
reactor.

The public patent provides one useful scale reference: a chamber 12 cm long
and 7.5 cm in diameter. It does not disclose the dimensions of the recent
burner, salt wand, or sapphire cell. The browser may expose geometry as a design
study, but inferred values must be marked provisional.

## Two simulation modes

### Experiment mode

- hydrogen and oxidizer flow;
- oxygen fraction and diluent identity;
- burner or flame position relative to the salt source and cell;
- NaCl or NaI source temperature, mass, and exposed area;
- ignition and insertion sequence;
- measured camera/spectrometer viewpoint.

The first validation targets are flame attachment/extinction, salt
vaporization, absolute D-line spectrum, and wall temperature.

### Reactor mode

- concentric transparent chamber geometry;
- annular exhaust and recuperator effectiveness;
- salt condensation and recovery;
- hot-mirror and PV spectral response;
- steady power, PV temperature, wall stress, and salt loss.

This mode should only inherit closures already validated in Experiment mode.

## Required model stack

1. **H2/O2 flame reference**
   - Cantera `h2o2.yaml`;
   - H, O, OH, HO2, H2O2 and stable species;
   - multicomponent transport and Soret diffusion;
   - extinction/ignition versus strain, pressure, oxygen enrichment, and
     preheat.
2. **Reduced browser flame**
   - mixture fraction, progress variable, and enthalpy;
   - interpolation from validated flamelet tables;
   - explicit ignition state and conservative mass/energy transport.
3. **Salt cycle**
   - condensed NaCl/NaI, salt vapor, atomic Na, NaOH, and NaO2;
   - evaporation, condensation, wall deposition, exhaust loss, and recovery;
   - uncertainty outside published vapor-pressure ranges.
4. **Non-LTE sodium**
   - D1 and D2 statistical equilibrium;
   - measured Na + O + O chemi-excitation;
   - collisional excitation/quenching and radiative absorption;
   - absolute populations plus the detached Boltzmann diagnostic.
5. **D-line transfer**
   - frequency-resolved D1/D2 opacity and source functions;
   - self-reversal, pressure broadening, and redistribution;
   - a high-resolution reference solver used to validate the WebGPU closure.
6. **Walls and power**
   - sapphire/alumina temperature-dependent properties;
   - gas/wall and salt/wall heat transfer;
   - thermal-gradient stress and creep proxies;
   - measured hot-mirror, PV EQE, voltage, and cooling curves.

## Physical controls

Geometry and material changes restart at `t=0`. Flow, oxygen fraction, salt
feed, preheat, ignition, and burner motion are timed operating changes.

No user-facing control should directly set optical depth, sodium activity,
excitation fraction, quench rate, or flame length. Those are calculated states
or uncertain calibration parameters.

## Primary outputs

- flame state: unignited, attached, lifted, strained, extinguished;
- gas temperature and H/O/OH radical fields;
- salt phase inventory and atomic-sodium column density;
- D1/D2 absolute spectral radiance and self-reversal;
- non-LTE population, excitation temperature, and pump/loss ledger;
- inner/outer wall temperature, heat flux, gradient, and stress margin;
- fuel-to-light-to-electricity energy ledger;
- uncertainty and extrapolation flags.
