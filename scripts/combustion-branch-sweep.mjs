import { pathToFileURL } from 'node:url';
import {
  canteraOperatingReference,
  hydrogenNozzleState,
  oxidizerCoflowState,
  reducedBurnerCellStep,
} from '../sodium-lamp/physics.js';

export const SWEEP_CASES = Object.freeze([
  {name:'baseline',phi:1.0,oxygenFraction:.38,pressureBar:1.4,fuelNozzleMm:4,oxidizerOuterMm:8},
  {name:'air',phi:1.0,oxygenFraction:.21,pressureBar:1.4,fuelNozzleMm:4,oxidizerOuterMm:8},
  {name:'oxygen-rich',phi:1.0,oxygenFraction:.80,pressureBar:1.4,fuelNozzleMm:4,oxidizerOuterMm:8},
  {name:'lean',phi:.60,oxygenFraction:.38,pressureBar:1.4,fuelNozzleMm:4,oxidizerOuterMm:8},
  {name:'rich',phi:1.50,oxygenFraction:.38,pressureBar:1.4,fuelNozzleMm:4,oxidizerOuterMm:8},
  {name:'low-pressure',phi:1.0,oxygenFraction:.38,pressureBar:.5,fuelNozzleMm:4,oxidizerOuterMm:8},
  {name:'high-pressure',phi:1.0,oxygenFraction:.38,pressureBar:4,fuelNozzleMm:4,oxidizerOuterMm:8},
  {name:'small-nozzle',phi:1.0,oxygenFraction:.38,pressureBar:1.4,fuelNozzleMm:2,oxidizerOuterMm:6},
  {name:'large-nozzle',phi:1.0,oxygenFraction:.38,pressureBar:1.4,fuelNozzleMm:8,oxidizerOuterMm:12},
]);

const AXIAL_CELLS=112;
const CELL_LENGTH_M=.105;
const DT_S=2e-5;
const INSERTION_M=.006;
const AMBIENT_K=320;
const FUEL_FLOW_SLPM=56;

function smoothstep(low,high,value){
  const x=Math.max(0,Math.min(1,(value-low)/Math.max(high-low,Number.EPSILON)));
  return x*x*(3-2*x);
}

function sampleLinear(values,position){
  const q=position/(CELL_LENGTH_M/AXIAL_CELLS)-.5;
  const low=Math.max(0,Math.min(values.length-1,Math.floor(q)));
  const high=Math.max(0,Math.min(values.length-1,low+1));
  const fraction=Math.max(0,Math.min(1,q-low));
  return values[low]*(1-fraction)+values[high]*fraction;
}

function operatingState(operatingCase){
  const pressurePa=operatingCase.pressureBar*1e5;
  const fuelNozzleDiameterM=operatingCase.fuelNozzleMm/1000;
  const oxidizerOuterDiameterM=operatingCase.oxidizerOuterMm/1000;
  const oxidizerSLPM=FUEL_FLOW_SLPM/
    Math.max(2*operatingCase.oxygenFraction*operatingCase.phi,.02);
  const nozzle=hydrogenNozzleState({
    flowSLPM:FUEL_FLOW_SLPM,
    nozzleDiameterM:fuelNozzleDiameterM,
    pressurePa,
    temperatureK:AMBIENT_K,
  });
  const coflow=oxidizerCoflowState({
    flowSLPM:oxidizerSLPM,
    coreRadiusM:.02,
    nozzleDiameterM:fuelNozzleDiameterM,
    oxidizerOuterDiameterM,
    pressurePa,
    temperatureK:AMBIENT_K,
  });
  const reference=canteraOperatingReference({
    equivalenceRatio:operatingCase.phi,
    oxygenFraction:operatingCase.oxygenFraction,
    pressureBar:operatingCase.pressureBar,
  });
  return {
    pressurePa,
    fuelNozzleDiameterM,
    oxidizerOuterDiameterM,
    oxidizerSLPM,
    fuelVelocityMS:nozzle.velocityMS,
    oxidizerVelocityMS:coflow.velocityMS,
    ceilingK:reference.stoichiometric.adiabatic_temperature_k*1.005,
  };
}

// One axial streamline through the burner-lip reaction zone. Its inlet
// scalars and prescribed coaxial velocity are algebraic mirrors of app.js.
// It adds the missing competition between finite-rate chemistry and throughflow
// to the local source-unit tests; it is not presented as a replacement for the
// axisymmetric WebGPU transport solve.
function profileAt({z,r,state,phi}){
  if(z<INSERTION_M)return {fuel:0,oxidizer:0,velocityMS:0};
  const zr=Math.max(z-INSERTION_M,0);
  const rn=.5*state.fuelNozzleDiameterM;
  const ro=.5*state.oxidizerOuterDiameterM;
  const rj=rn+.10*zr;
  const jet=Math.exp(-((r/Math.max(rj,.0003))**2));
  const outerRadius=ro+.08*zr;
  const outer=Math.exp(-((r/Math.max(outerRadius,.0004))**4));
  const fade=1-smoothstep(.72,.94,z/CELL_LENGTH_M);
  const edge=Math.max(.00020,.10*(ro-rn));
  const annulus=smoothstep(rn,rn+edge,r)*(1-smoothstep(ro-edge,ro,r));
  const decay=(rn/Math.max(rj,rn))**2;
  return {
    fuel:jet*fade,
    oxidizer:Math.max(0,outer-.94*jet)*fade/Math.max(phi,.05),
    velocityMS:state.fuelVelocityMS*decay*jet+state.oxidizerVelocityMS*annulus,
  };
}

function initialTemperature(z,branch){
  if(branch!=='transient-hot')return branch==='stable'?520:AMBIENT_K;
  const center=INSERTION_M+.008;
  const width=.0035;
  return AMBIENT_K+1120*Math.exp(-(((z-center)/width)**2));
}

export function runLocalSourceCase(operatingCase,{
  stabilized=true,
  initialTemperatureK=520,
  fuelEnabled=true,
  oxidizerEnabled=true,
}={}){
  const state=operatingState(operatingCase);
  const r=.5*state.fuelNozzleDiameterM+.00008;
  const z=INSERTION_M+.00103;
  const inlet=profileAt({z,r,state,phi:operatingCase.phi});
  return reducedBurnerCellStep({
    temperatureK:initialTemperatureK,
    fuelFraction:fuelEnabled?inlet.fuel:0,
    stoichiometricOxidizerFraction:oxidizerEnabled?inlet.oxidizer:0,
    pressurePa:state.pressurePa,
    radiusM:r,
    axialPositionM:z,
    fuelNozzleDiameterM:state.fuelNozzleDiameterM,
    nozzleInsertionM:INSERTION_M,
    stabilized,
    thermochemistryCeilingK:state.ceilingK,
  });
}

export function runBranchCase(operatingCase,{
  branch='stable',
  steps=800,
  fuelEnabled=true,
  oxidizerEnabled=true,
}={}){
  const state=operatingState(operatingCase);
  const dz=CELL_LENGTH_M/AXIAL_CELLS;
  const radiusM=.5*state.fuelNozzleDiameterM+.00008;
  const z=Array.from({length:AXIAL_CELLS},(_,index)=>(index+.5)*dz);
  const profiles=z.map((position)=>profileAt({z:position,r:radiusM,state,phi:operatingCase.phi}));
  let temperature=Float64Array.from(z,(position)=>initialTemperature(position,branch));
  let fuel=Float64Array.from(profiles,(profile)=>fuelEnabled?profile.fuel:0);
  let oxidizer=Float64Array.from(profiles,(profile)=>oxidizerEnabled?profile.oxidizer:0);
  let peakTemperatureK=Math.max(...temperature);
  let everReactedFraction=0;
  let tailPeakSum=0,tailReactionSum=0,tailSamples=0;
  const tailStart=Math.max(0,steps-100);

  for(let step=0;step<steps;step++){
    const nextTemperature=new Float64Array(AXIAL_CELLS);
    const nextFuel=new Float64Array(AXIAL_CELLS);
    const nextOxidizer=new Float64Array(AXIAL_CELLS);
    let stepPeak=AMBIENT_K,stepReaction=0;
    for(let index=0;index<AXIAL_CELLS;index++){
      const position=z[index];
      if(position<INSERTION_M){
        nextTemperature[index]=AMBIENT_K;
        continue;
      }
      const velocity=profiles[index].velocityMS;
      const upstream=position-velocity*DT_S;
      let transportedTemperature=sampleLinear(temperature,upstream);
      let transportedFuel=sampleLinear(fuel,upstream);
      let transportedOxidizer=sampleLinear(oxidizer,upstream);
      if(Math.abs(position-INSERTION_M)<=.55*dz){
        transportedTemperature=AMBIENT_K;
        transportedFuel=fuelEnabled?profiles[index].fuel:0;
        transportedOxidizer=oxidizerEnabled?profiles[index].oxidizer:0;
      }
      const source=reducedBurnerCellStep({
        temperatureK:transportedTemperature,
        fuelFraction:transportedFuel,
        stoichiometricOxidizerFraction:transportedOxidizer,
        pressurePa:state.pressurePa,
        radiusM,
        axialPositionM:position,
        fuelNozzleDiameterM:state.fuelNozzleDiameterM,
        nozzleInsertionM:INSERTION_M,
        stabilized:branch==='stable',
        timeStepS:DT_S,
        thermochemistryCeilingK:state.ceilingK,
      });
      nextTemperature[index]=source.nextTemperatureK;
      nextFuel[index]=source.fuelFraction;
      nextOxidizer[index]=source.stoichiometricOxidizerFraction;
      stepPeak=Math.max(stepPeak,source.nextTemperatureK);
      stepReaction+=source.reactedFraction;
    }
    temperature=nextTemperature;
    fuel=nextFuel;
    oxidizer=nextOxidizer;
    peakTemperatureK=Math.max(peakTemperatureK,stepPeak);
    everReactedFraction+=stepReaction;
    if(step>=tailStart){
      tailPeakSum+=stepPeak;
      tailReactionSum+=stepReaction;
      tailSamples++;
    }
  }

  const finalPeakTemperatureK=Math.max(...temperature);
  const finalHotCells=temperature.reduce((count,value)=>count+(value>1120?1:0),0);
  const tailPeakTemperatureK=tailPeakSum/Math.max(1,tailSamples);
  const tailReactionPerStep=tailReactionSum/Math.max(1,tailSamples);
  const tailBurning=tailPeakTemperatureK>1120&&tailReactionPerStep>1e-8;
  return {
    name:operatingCase.name,
    branch,
    simulatedTimeMs:steps*DT_S*1000,
    fuelVelocityMS:state.fuelVelocityMS,
    oxidizerVelocityMS:state.oxidizerVelocityMS,
    peakTemperatureK,
    finalPeakTemperatureK,
    tailPeakTemperatureK,
    ceilingK:state.ceilingK,
    finalHotCells,
    everReactedFraction,
    tailReactionPerStep,
    tailBurning,
    temperatureBounded:peakTemperatureK<=state.ceilingK+1e-8,
  };
}

export function runCombustionBranchSweep(cases=SWEEP_CASES){
  return cases.flatMap((operatingCase)=>[
    runBranchCase(operatingCase,{branch:'stable'}),
    runBranchCase(operatingCase,{branch:'transient-cold'}),
    runBranchCase(operatingCase,{branch:'transient-hot'}),
  ]);
}

export function branchSweepFailures(results){
  const failures=[];
  for(const result of results){
    const label=`${result.name}/${result.branch}`;
    if(!result.temperatureBounded)failures.push(`${label}: thermochemical ceiling exceeded`);
    if(result.branch==='stable'&&!result.tailBurning){
      failures.push(`${label}: burner-lip branch was not anchored after ${result.simulatedTimeMs.toFixed(0)} ms`);
    }
    if(result.branch==='transient-cold'){
      if(result.everReactedFraction!==0)failures.push(`${label}: cold unforced branch self-ignited`);
      if(result.finalHotCells!==0)failures.push(`${label}: cold unforced branch retained hot cells`);
    }
    if(result.branch==='transient-hot'&&result.everReactedFraction<=0){
      failures.push(`${label}: finite ignition kernel never reacted`);
    }
  }
  return failures;
}

function printable(results){
  return results.map((result)=>({
    case:result.name,
    branch:result.branch,
    'uH2 m/s':result.fuelVelocityMS.toFixed(1),
    'peak K':Math.round(result.peakTemperatureK),
    'tail K':Math.round(result.tailPeakTemperatureK),
    'hot cells':result.finalHotCells,
    'tail rxn':result.tailReactionPerStep.toExponential(2),
    verdict:result.branch==='stable'?(result.tailBurning?'anchored':'lost'):
      result.branch==='transient-cold'?(result.everReactedFraction===0?'unignited':'false ignition'):
        result.tailBurning?'survives':'kernel convected/extinguished',
  }));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const results=runCombustionBranchSweep();
  console.table(printable(results));
  const failures=branchSweepFailures(results);
  if(failures.length){
    console.error(`\n${failures.length} branch-sweep failure(s):\n- ${failures.join('\n- ')}`);
    process.exitCode=1;
  }else{
    console.log(`\nPASS: ${results.length} axial advection-reaction cases satisfy anchoring, ignition, extinction, and temperature-bound invariants.`);
  }
}
