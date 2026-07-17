import {
  CONSTANTS,
  checkRateBalance,
  coupledExcitationResidenceTime,
  departureCoefficient,
  excitationTemperatureK,
  fineStructureRateBalance,
  lteFineStructureFractions,
  neutralSodiumFraction,
  opticalBoundary,
  opticalDepths,
  p1BoundaryLeakageSpeed,
  hydrogenNozzleState,
  oxidizerCoflowState,
  annularReturnState,
  openAirHydrogenFlameLength,
  flameCellAssessment,
  resolvedSodiumSpectrum,
  canteraOperatingReference,
  coaxialShearRateProxy,
  sapphireThermalAssessment,
  PUBLIC_BENCHMARK,
  conversionFeasibility,
  sodiumRadicalCycleDiagnostic,
  chamberEngagementProtocol,
} from './physics.js';

const ids = [
  'gpu-status','pause','reset','simulation-mode','operating-protocol','mode-badge','mode-explanation','protocol-status','volume','volume-field','volume-definition','volume-scale','spectrum-plot',
  'departure-big','gas-temperature','peak-gas-temperature','excitation-temperature','optical-depth','d1-pop','d2-pop','ground-pop',
  'solved-bar','lte-bar','solved-population','lte-population','reabsorptions','escape-probability','residence-time',
  'flow-pump','flow-abs','flow-emit','flow-quench','flow-pump-value','flow-abs-value','flow-emit-value','flow-quench-value',
  'spectrum-d2','spectrum-d1','spectrum-yield','spectrum-reversal','wall-temperature','wall-skin-temperature','wall-melt-margin','wall-status','wall-detail',
  'flame-length','flame-wall-clearance','flame-exit-clearance','flame-status','flame-regime',
  'reference-tad','reference-temperature-ratio','reference-exitance','reference-status',
  'radical-status','radical-cycle-time','radical-h-time','radical-oh-time','radical-flow-time','radical-detail',
  'probe-label','preset','fuel-flow','oxidizer-flow','oxygen','sodium','pressure','reflect','pv-absorb',
  'core-radius','wall-thickness','nozzle-diameter','oxidizer-nozzle','nozzle-insertion','fuel-flow-out','oxidizer-flow-out','oxygen-out','sodium-out','pressure-out','reflect-out','pv-absorb-out',
  'derived-power','derived-phi','derived-speed','derived-coflow','derived-return','derived-free-flame','derived-tad','derived-flame-speed','derived-shear','run-number','core-radius-out','wall-thickness-out','nozzle-diameter-out','oxidizer-nozzle-out','nozzle-insertion-out','sim-time','control-status','r-pump','r-abs','r-sp','r-stim',
  'r-q','upper-solved','upper-lte','enhancement','balance','fuel-input-power','combustion-power','fuel-conversion','unburned-power','atomic-pump-power','boundary-line-power','pv-line-power',
  'quench-heat','parasitic-light','boundary-heat','exhaust-sensible','storage-rate','energy-residual',
  'evidence-status','line-fuel-efficiency','pv-electric-current','generator-eff-current','required-light-large','required-light-laser','required-light-future','fatal',
];
const ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

const NX = 64, NZ = 112, FLOATS = 16, CHEMISTRY_RATE_S = 4e4;
// Keep the live view responsive on integrated GPUs. The explicit diagnostic
// step below retains ten radiation sweeps per physical step for validation.
const LIVE_STEPS_PER_FRAME = 3, LIVE_RADIATION_SWEEPS = 6;
const stateBytes = NX * NZ * FLOATS * 4;
const P = Object.freeze({NX:0,NZ:1,R:2,L:3,RC:4,TW:5,PRESSURE:6,POWER:7,O2:8,NA:9,REFLECT:10,PV:11,ETA:12,QSCALE:13,SPEED:14,TIME:15,DT:16,SALT:17,AMBIENT:18,RESERVED:19,PHI:20,NOZZLE:21,INSERTION:22,COFLOW:23,OXNOZZLE:24,RETURN:25,TMAX:26,STABILIZED:27,CAPTURE:28});
const params = new Float32Array(29);
Object.assign(params, {[P.NX]:NX,[P.NZ]:NZ,[P.R]:.038,[P.L]:.105,[P.RC]:.020,[P.TW]:.003,[P.PRESSURE]:1.4e5,[P.POWER]:10.1,[P.O2]:.38,[P.NA]:80,[P.REFLECT]:.08,[P.PV]:.84,[P.ETA]:.01,[P.QSCALE]:1,[P.SPEED]:50,[P.TIME]:0,[P.DT]:2e-5,[P.SALT]:0,[P.AMBIENT]:320,[P.RESERVED]:0,[P.PHI]:1,[P.NOZZLE]:.004,[P.INSERTION]:.006,[P.COFLOW]:.7,[P.OXNOZZLE]:.008,[P.RETURN]:.8,[P.TMAX]:2850,[P.STABILIZED]:1,[P.CAPTURE]:1});
let volumeMode = 4, orbit = -.72, pitch = .18, paused = false, dragging = false, lastX = 0, lastY = 0;
let initializeGPU = null, designPending = false, previousEnergy = null, previousEnergyTime = null, runNumber = 0;
let nozzleState = null, coflowState = null, returnState = null, openAirReferenceM = 0;
let operatingReference = null, shearRateProxyS = 0;
let engagementState = chamberEngagementProtocol();

function updateEngagementState() {
  engagementState = chamberEngagementProtocol({
    timeS: params[P.TIME],
    mode: ui['operating-protocol'].value,
  });
  params[P.CAPTURE] = engagementState.capturedFraction;
  const percent = Math.round(100 * engagementState.capturedFraction);
  ui['protocol-status'].value = engagementState.mode === 'steady'
    ? 'FULL CHAMBER CAPTURE'
    : `${engagementState.phase} · ${percent}% CAPTURED · H₂ METER FIXED`;
  ui['protocol-status'].className = engagementState.phase === 'CAPTURED' ? '' : 'entering';
  return engagementState;
}

function readControls({commitDesign = false} = {}) {
  const pendingDesign = {
    coreRadius: +ui['core-radius'].value / 1000,
    wallThickness: +ui['wall-thickness'].value / 1000,
    nozzleDiameter: +ui['nozzle-diameter'].value / 1000,
    oxidizerNozzleDiameter: Math.max(+ui['nozzle-diameter'].value + .5, +ui['oxidizer-nozzle'].value) / 1000,
    nozzleInsertion: +ui['nozzle-insertion'].value / 1000,
    pressure: +ui.pressure.value * 1e5,
    sodium: +ui.sodium.value,
    reflect: +ui.reflect.value / 100,
    pv: +ui['pv-absorb'].value / 100,
  };
  if (commitDesign) {
    params[P.RC] = pendingDesign.coreRadius;
    params[P.TW] = pendingDesign.wallThickness;
    params[P.NOZZLE] = pendingDesign.nozzleDiameter;
    params[P.OXNOZZLE] = pendingDesign.oxidizerNozzleDiameter;
    params[P.INSERTION] = pendingDesign.nozzleInsertion;
    params[P.PRESSURE] = pendingDesign.pressure;
    params[P.NA] = pendingDesign.sodium;
    const boundary = opticalBoundary({lineReflectance:pendingDesign.reflect,pvAbsorptance:pendingDesign.pv});
    params[P.REFLECT] = boundary.reflectance;
    params[P.PV] = boundary.pvAbsorptance;
  }
  const fuelSLPM=+ui['fuel-flow'].value,oxidizerSLPM=+ui['oxidizer-flow'].value,oxygenFraction=+ui.oxygen.value/100;
  params[P.POWER] = fuelSLPM * 0.1798;
  params[P.O2] = oxygenFraction;
  params[P.PHI] = fuelSLPM / Math.max(2 * oxygenFraction * oxidizerSLPM, 1e-6);
  nozzleState=hydrogenNozzleState({flowSLPM:fuelSLPM,nozzleDiameterM:pendingDesign.nozzleDiameter,pressurePa:pendingDesign.pressure,temperatureK:params[P.AMBIENT]});
  coflowState=oxidizerCoflowState({flowSLPM:oxidizerSLPM,coreRadiusM:pendingDesign.coreRadius,nozzleDiameterM:pendingDesign.nozzleDiameter,oxidizerOuterDiameterM:pendingDesign.oxidizerNozzleDiameter,pressurePa:pendingDesign.pressure,temperatureK:params[P.AMBIENT]});
  returnState=annularReturnState({fuelActualVolumeM3s:nozzleState.actualVolumeM3s,oxidizerActualVolumeM3s:coflowState.actualVolumeM3s,coreRadiusM:pendingDesign.coreRadius,wallThicknessM:pendingDesign.wallThickness,outerRadiusM:params[P.R]});
  openAirReferenceM=openAirHydrogenFlameLength({massFlowKgS:nozzleState.massFlowKgS,nozzleDiameterM:pendingDesign.nozzleDiameter});
  params[P.SPEED] = nozzleState.velocityMS;
  params[P.COFLOW] = coflowState.velocityMS;
  params[P.RETURN] = returnState.velocityMS;
  params[P.STABILIZED] = ui['simulation-mode'].value === 'stable' ? 1 : 0;
  updateEngagementState();
  operatingReference=canteraOperatingReference({
    equivalenceRatio:params[P.PHI],
    oxygenFraction:params[P.O2],
    pressureBar:pendingDesign.pressure/1e5,
  });
  params[P.TMAX]=Math.max(
    params[P.AMBIENT]+100,
    operatingReference.stoichiometric.adiabatic_temperature_k*1.005,
  );
  shearRateProxyS=coaxialShearRateProxy({
    fuelVelocityMS:nozzleState.velocityMS,
    oxidizerVelocityMS:coflowState.velocityMS,
    fuelNozzleDiameterM:pendingDesign.nozzleDiameter,
    oxidizerOuterDiameterM:pendingDesign.oxidizerNozzleDiameter,
  });
  volumeMode = +ui['volume-field'].value;

  ui['core-radius-out'].value = `${Math.round(+ui['core-radius'].value)} mm`;
  ui['wall-thickness-out'].value = `${(+ui['wall-thickness'].value).toFixed(1)} mm`;
  ui['nozzle-diameter-out'].value = `${(+ui['nozzle-diameter'].value).toFixed(1)} mm`;
  ui['oxidizer-nozzle-out'].value = `${(pendingDesign.oxidizerNozzleDiameter*1000).toFixed(1)} mm`;
  ui['nozzle-insertion-out'].value = `${Math.round(+ui['nozzle-insertion'].value)} mm`;
  ui['pressure-out'].value = `${(+ui.pressure.value).toFixed(1)} bar`;
  ui['sodium-out'].value = `${Math.round(+ui.sodium.value)} ppm`;
  ui['reflect-out'].value = `${Math.round(+ui.reflect.value)}%`;
  ui['pv-absorb-out'].value = `${Math.round(+ui['pv-absorb'].value)}%`;
  ui['fuel-flow-out'].value = `${fuelSLPM.toFixed(0)} SLPM`;
  ui['oxidizer-flow-out'].value = `${oxidizerSLPM.toFixed(0)} SLPM`;
  ui['oxygen-out'].value = `${Math.round(params[P.O2] * 100)}%`;
  ui['derived-power'].textContent = `${params[P.POWER].toFixed(2)} kW`;
  ui['derived-phi'].textContent = params[P.PHI].toFixed(3);
  ui['derived-speed'].textContent = `${params[P.SPEED].toFixed(2)} m/s`;
  ui['derived-coflow'].textContent = `${params[P.COFLOW].toFixed(2)} m/s`;
  ui['derived-return'].textContent = `${params[P.RETURN].toFixed(2)} m/s`;
  ui['derived-free-flame'].textContent = `${(openAirReferenceM*1000).toFixed(0)} mm`;
  ui['derived-tad'].textContent = `${operatingReference.stoichiometric.adiabatic_temperature_k.toFixed(0)} K`;
  ui['derived-flame-speed'].textContent = `${operatingReference.freeFlame.laminar_flame_speed_m_s.toFixed(2)} m/s`;
  ui['derived-shear'].textContent = `${shearRateProxyS.toExponential(2)} s⁻¹`;
  const stabilized=params[P.STABILIZED]>.5;
  ui['mode-badge'].textContent=stabilized?'STABILIZED REFERENCE':'UNFORCED TRANSIENT';
  ui['mode-badge'].className=stabilized?'':'warning';
  const branchExplanation=stabilized
    ? 'A mesh-resolved burner-lip holder enables chemistry but adds no heat. The flame persists only while transported H₂ and O₂ are consumed.'
    : 'A finite hot kernel is applied once, with no continuing holder. Fresh flow can carry it downstream, so survival or blowoff is an output.';
  const protocolExplanation=engagementState.mode==='july15'
    ? ' The chamber source is area-averaged from bypassed to captured at fixed metered H₂. This accelerates the fluid response and does not reconstruct the video geometry or timing.'
    : ' The source is fully engaged from t=0.';
  ui['mode-explanation'].textContent=branchExplanation+protocolExplanation;
  const descriptions = [
    'Color + opacity = spontaneous D1 + D2 emissivity from the solved 3p populations.',
    'Color = dimensional gas and solid temperature; the sapphire wall is part of the thermal solve.',
    'Yellow color + opacity = six transported D-line radiation groups surrounding the reaction core.',
    'Color + opacity = finite-rate H₂/O₂ heat release after transported fuel and oxidizer mix.',
    'Display-only camera response: solved sodium emission and trapped D-line radiation viewed through the complete cell with sensor exposure and saturation.',
  ];
  const ends = [['dark','intense 589 nm'],['320 K',`${params[P.TMAX].toFixed(0)} K`],['10⁻⁹','10¹ / mode'],['no reaction','peak local rate'],['sensor black','clipped Na-D']];
  ui['volume-definition'].textContent = descriptions[volumeMode];
  ui['volume-scale'].className = `volume-scale ${['sodium','thermal','photon','reaction','camera'][volumeMode]}`;
  ui['volume-scale'].firstElementChild.textContent = ends[volumeMode][0];
  ui['volume-scale'].lastElementChild.textContent = ends[volumeMode][1];
}

for (const id of ['fuel-flow','oxidizer-flow','oxygen','volume-field']) {
  ui[id].addEventListener('input', () => readControls());
}
ui['simulation-mode'].addEventListener('change',()=>{
  if(ui['simulation-mode'].value==='transient'&&ui['operating-protocol'].value==='july15')ui['operating-protocol'].value='steady';
  readControls({commitDesign:true});
  initializeGPU?.();
});
ui['operating-protocol'].addEventListener('change',()=>{
  if(ui['operating-protocol'].value==='july15'){
    ui['simulation-mode'].value='stable';
    ui.preset.value='nacl';
    params[P.SALT]=0;
  }
  readControls({commitDesign:true});
  initializeGPU?.();
});
for (const input of document.querySelectorAll('[data-control-kind="design"]')) {
  input.addEventListener('input', () => {
    readControls();
    designPending = true;
    input.closest('label').dataset.pending = 'true';
    ui['control-status'].textContent = 'release to rebuild design';
    ui['control-status'].className = 'pending';
  });
  input.addEventListener('change', () => {
    readControls({commitDesign:true});
    designPending = false;
    for (const label of document.querySelectorAll('.controls label')) delete label.dataset.pending;
    initializeGPU?.();
  });
}
ui.preset.addEventListener('change', () => {
  const preset = ui.preset.value;
  if(preset!=='nacl'&&ui['operating-protocol'].value==='july15')ui['operating-protocol'].value='steady';
  if (preset === 'nai') {
    ui.sodium.value = 130; ui.oxygen.value = 80; ui.pressure.value = 1.2; params[P.SALT] = 1;
  } else if (preset === 'hps') {
    ui.sodium.value = 300; ui.oxygen.value = 21; ui.pressure.value = 4; params[P.SALT] = 2;
  } else {
    ui.sodium.value = 80; ui.oxygen.value = 38; ui.pressure.value = 1.4; params[P.SALT] = 0;
  }
  readControls({commitDesign:true});
  initializeGPU?.();
});

// CAPTURE scales area-averaged inlet scalars while the active-fraction core
// velocity remains dimensional, so admitted scalar flux is linear—not
// quadratic—in engagement. The bulk return velocity scales with captured flow.
const WGSL = /* wgsl */`
const PI:f32=3.14159265359;const C:f32=2.99792458e8;const KB:f32=1.380649e-23;const EV:f32=1.602176634e-19;const EN:f32=2.1035*EV;const MNA:f32=3.81754e-26;const KCHEM:f32=4e4;
const A1:f32=6.14e7;const A2:f32=6.16e7;const G1:f32=1.;const G2:f32=2.;const F1:f32=.320;const F2:f32=.641;const L1:f32=5.895924e-7;const L2:f32=5.889950e-7;
struct Cell{a:vec4<f32>,b:vec4<f32>,c:vec4<f32>,d:vec4<f32>}
@group(0)@binding(0)var<storage,read>src:array<Cell>;@group(0)@binding(1)var<storage,read_write>dst:array<Cell>;@group(0)@binding(2)var<storage,read>p:array<f32>;
fn ix(x:u32,z:u32)->u32{return z*u32(p[0])+x;}fn clampCell(x:i32,z:i32)->Cell{return src[ix(u32(clamp(x,0,i32(p[0])-1)),u32(clamp(z,0,i32(p[1])-1)))];}
fn material(r:f32,z:f32)->f32{let innerWall=z>.10*p[3]&&z<.90*p[3]&&r>=p[4]&&r<p[4]+p[5];let outerWall=r>=p[2]-p[5];if(innerWall||outerWall){return 1.;}return select(0.,2.,r>=p[4]+p[5]);}
fn thermalK(c:Cell)->f32{let m=c.a.w;return select(select(.18,.12,m>1.5),max(4.5,35.*pow(300./max(c.a.x,300.),.78)),m>.5&&m<1.5);}
fn harmonicK(a:f32,b:f32)->f32{return 2.*a*b/max(a+b,1e-8);}
fn flameShape(r:f32,z:f32)->f32{if(r>=p[4]||z<=p[22]||z>=.94*p[3]){return 0.;}let span=max(.01,.94*p[3]-p[22]);let axial=pow(max(0.,sin(PI*(z-p[22])/span)),.7);let jetRadius=.5*p[21]+.10*(z-p[22]);let sheetRadius=.70*jetRadius;let sheetWidth=max(.0007,.35*jetRadius);return axial*exp(-pow((r-sheetRadius)/sheetWidth,2.));}
fn flameHolder(r:f32,z:f32)->f32{let lipR=.5*p[21];let radialWidth=max(max(.00055,.18*p[21]),1.25*p[2]/p[0]);let axialWidth=max(.0028,2.5*p[3]/p[1]);let radial=exp(-pow((r-lipR)/radialWidth,2.));let axial=exp(-pow((z-(p[22]+.0018))/axialWidth,2.));return p[27]*p[28]*radial*axial;}
fn chemistryRate(T:f32,fuel:f32,ox:f32,m:f32,r:f32,z:f32)->f32{let thermal=smoothstep(760.,1120.,T);let activation=max(thermal,.92*flameHolder(r,z));return select(activation*min(max(fuel,0.),max(ox,0.))*KCHEM,0.,m>.5);}
fn heatFromReaction(z:f32,T:f32,reactionRate:f32,m:f32)->f32{if(z<p[22]||m>.5){return 0.;}let molarDensity=p[6]/(8.314462618*max(T,300.));return molarDensity*max(reactionRate,0.)*241800.;}
fn flow(r:f32,z:f32,m:f32)->vec2<f32>{if(m>.5&&m<1.5){return vec2(0.);}let y=z/p[3];let top=smoothstep(.76,.96,y);if(m<.5){let rn=.5*p[21];let ro=.5*p[24];let zr=max(z-p[22],0.);let rj=rn+.10*zr;let jet=exp(-pow(r/max(rj,.0002),2.));let decay=pow(rn/max(rj,rn),2.);let enabled=select(0.,1.,z>=p[22]);let edge=max(.00020,.10*(ro-rn));let annulus=smoothstep(rn,rn+edge,r)*(1.-smoothstep(ro-edge,ro,r));let axial=enabled*(p[14]*decay*jet+p[23]*annulus);let entrain=-enabled*.08*p[14]*decay*(r/max(rj,.0002))*jet;let turn=.28*top*max(axial,p[23])*r/max(p[4],.001);return vec2(entrain+turn,axial*(1.-.85*top));}let a=p[4]+p[5];let b=p[2]-p[5];let rr=clamp((r-a)/max(b-a,1e-4),0.,1.);return p[28]*vec2(.22*p[25]*top*(1.-rr),-p[25]*(1.-top)*(.6+.4*rr));}
fn sample(pos:vec2<f32>,m:f32)->Cell{let dr=p[2]/p[0];let dz=p[3]/p[1];let q=clamp(vec2(pos.x/dr-.5,pos.y/dz-.5),vec2(0.),vec2(p[0]-1.001,p[1]-1.001));let i=vec2<i32>(floor(q));let f=fract(q);let c00=clampCell(i.x,i.y);let c10=clampCell(i.x+1,i.y);let c01=clampCell(i.x,i.y+1);let c11=clampCell(i.x+1,i.y+1);if(abs(c00.a.w-m)>.4||abs(c10.a.w-m)>.4||abs(c01.a.w-m)>.4||abs(c11.a.w-m)>.4){return c00;}var o:Cell;o.a=mix(mix(c00.a,c10.a,f.x),mix(c01.a,c11.a,f.x),f.y);o.b=mix(mix(c00.b,c10.b,f.x),mix(c01.b,c11.b,f.x),f.y);o.c=mix(mix(c00.c,c10.c,f.x),mix(c01.c,c11.c,f.x),f.y);o.d=mix(mix(c00.d,c10.d,f.x),mix(c01.d,c11.d,f.x),f.y);return o;}
fn neutralActivity(T:f32,phi:f32)->f32{let mid=select(1180.,980.,p[17]>.5&&p[17]<1.5);let thermal=1./(1.+exp(-(T-mid)/125.));let rich=.35+.65/(1.+exp(-(phi-.9)/.16));return clamp(thermal*rich,0.,1.);}
fn meanRelSpeed(T:f32,partnerAMU:f32)->f32{let partner=partnerAMU*1.6605390666e-27;let mu=MNA*partner/(MNA+partner);return sqrt(8.*KB*T/(PI*mu));}
fn measuredKq(T:f32,species:u32)->f32{var sigmaA2=2.2;var massAMU=18.01528;if(species==0u){sigmaA2=mix(9.3,6.8,clamp((T-1500.)/1000.,0.,1.));massAMU=2.01588;}else if(species==1u){sigmaA2=mix(39.,31.,clamp((T-1720.)/780.,0.,1.));massAMU=31.9988;}else if(species==3u){sigmaA2=22.;massAMU=28.0134;}return sigmaA2*1e-20*meanRelSpeed(T,massAMU);}
fn qrate(T:f32,fuel:f32,ox:f32,water:f32)->f32{let h2=.15*fuel;let o2=p[8]*.95*ox;let h2o=.60*water;let n2=max(.1,1.-h2-o2-h2o);let s=h2+o2+h2o+n2;let keff=(h2*measuredKq(T,0u)+o2*measuredKq(T,1u)+h2o*measuredKq(T,2u)+n2*measuredKq(T,3u))/s*p[13];return keff*p[6]/(KB*T);}
fn modeDensity(T:f32,lambda:f32)->f32{let nu=C/lambda;let doppler=nu/C*sqrt(2.*KB*T/MNA);let collision=30.4e6*(p[6]/133.322368)*sqrt(450./T);let width=max(doppler,collision);return 8.*PI*nu*nu*width/(C*C*C);}
fn erfcx(x:f32)->f32{let t=1./(1.+.5*max(x,0.));return t*exp(-1.26551223+t*(1.00002368+t*(.37409196+t*(.09678418+t*(-.18628806+t*(.27886807+t*(-1.13520398+t*(1.48851587+t*(-.82215223+t*.17087277)))))))));}
fn groupWeight(g:u32)->f32{return select(select(.55,.30,g==1u),.15,g==2u);}fn profileWeight(g:u32)->f32{return select(select(1.,.08,g==1u),.004,g==2u);}
fn photon(c:Cell,line:u32,g:u32)->f32{if(line==0u){return select(select(c.c.x,c.c.y,g==1u),c.c.z,g==2u);}return select(select(c.c.w,c.d.x,g==1u),c.d.y,g==2u);}
fn photons(c:Cell,line:u32)->f32{return select(c.c.x+c.c.y+c.c.z,c.c.w+c.d.x+c.d.y,line==1u);}
@compute @workgroup_size(8,8)fn init(@builtin(global_invocation_id)gid:vec3<u32>){
  if(gid.x>=u32(p[0])||gid.y>=u32(p[1])){return;}
  let dr=p[2]/p[0];let dz=p[3]/p[1];let r=(f32(gid.x)+.5)*dr;let z=(f32(gid.y)+.5)*dz;let m=material(r,z);
  let engagement=clamp(p[28],0.,1.);let shape=flameShape(r,z)*engagement;let seedRise=mix(900.,.88*max(p[26]-p[18],100.),p[27]);var T=select(select(p[18]+seedRise*shape,p[18]+220.,m>1.5),p[18]+120.,m>.5&&m<1.5);
  let enabled=select(0.,1.,z>=p[22]);let zr=max(z-p[22],0.);let rj=.5*p[21]+.10*zr;let jet=exp(-pow(r/max(rj,.0003),2.));let outerRadius=.5*p[24]+.08*zr;let outer=exp(-pow(r/max(outerRadius,.0004),4.));let fade=1.-smoothstep(.72,.94,z/p[3]);
  let fuel=select(engagement*jet*fade*enabled,0.,m>.5);let ox=select(engagement*max(0.,outer-.94*jet)*fade*enabled/max(p[20],.05),0.,m>.5);let total=select(select(engagement*p[9]*1e-6,0.,z<p[22]),0.,m>.5&&m<1.5);
  let phi=fuel/max(ox,.05);let neutral=total*neutralActivity(T,phi);let react=select(chemistryRate(T,fuel,ox,m,r,z),0.,z<p[22]);
  if(z<p[22]&&m<.5){T=p[18];}
  dst[ix(gid.x,gid.y)]=Cell(vec4(T,total,neutral,m),vec4(1e-12,2e-12,fuel,ox),vec4(0.),vec4(0.,0.,0.,clamp(react/KCHEM,0.,1.)));
}
@compute @workgroup_size(8,8)fn advance(@builtin(global_invocation_id)gid:vec3<u32>){
  if(gid.x>=u32(p[0])||gid.y>=u32(p[1])){return;}
  let id=ix(gid.x,gid.y);let dr=p[2]/p[0];let dz=p[3]/p[1];let r=(f32(gid.x)+.5)*dr;let z=(f32(gid.y)+.5)*dz;let m=material(r,z);
  let old=src[id];let vel=flow(r,z,m);var adv:Cell=old;if(!(m>.5&&m<1.5)){adv=sample(vec2(r,z)-vel*p[16],m);}
  let l=clampCell(i32(gid.x)-1,i32(gid.y));let rr=clampCell(i32(gid.x)+1,i32(gid.y));let dn=clampCell(i32(gid.x),i32(gid.y)-1);let up=clampCell(i32(gid.x),i32(gid.y)+1);
  let k0=thermalK(old);let kw=harmonicK(k0,thermalK(l));let ke=harmonicK(k0,thermalK(rr));let ks=harmonicK(k0,thermalK(dn));let kn=harmonicK(k0,thermalK(up));
  let re=r+.5*dr;let rw=max(r-.5*dr,0.);let radialHeat=(re*ke*(rr.a.x-old.a.x)-rw*kw*(old.a.x-l.a.x))/(max(r,.5*dr)*dr*dr);
  let axialHeat=(kn*(up.a.x-old.a.x)-ks*(old.a.x-dn.a.x))/(dz*dz);let conduction=radialHeat+axialHeat;
  let cv=select(select(p[6]/(287.*max(old.a.x,300.))*2400.,p[6]/(287.*max(old.a.x,300.))*2500.,m>1.5),3.95e6,m>.5&&m<1.5);
  let lf=select(old.b.z,l.b.z,abs(l.a.w-m)<.4);let rf=select(old.b.z,rr.b.z,abs(rr.a.w-m)<.4);let df=select(old.b.z,dn.b.z,abs(dn.a.w-m)<.4);let uf=select(old.b.z,up.b.z,abs(up.a.w-m)<.4);
  let lo=select(old.b.w,l.b.w,abs(l.a.w-m)<.4);let ro=select(old.b.w,rr.b.w,abs(rr.a.w-m)<.4);let dox=select(old.b.w,dn.b.w,abs(dn.a.w-m)<.4);let uox=select(old.b.w,up.b.w,abs(up.a.w-m)<.4);
  let lw=select(old.d.z,l.d.z,abs(l.a.w-m)<.4);let rwtr=select(old.d.z,rr.d.z,abs(rr.a.w-m)<.4);let dw=select(old.d.z,dn.d.z,abs(dn.a.w-m)<.4);let uw=select(old.d.z,up.d.z,abs(up.a.w-m)<.4);
  let lapFuel=(lf-2.*old.b.z+rf)/(dr*dr)+(rf-lf)/(2.*max(r,.5*dr)*dr)+(df-2.*old.b.z+uf)/(dz*dz);
  let lapOx=(lo-2.*old.b.w+ro)/(dr*dr)+(ro-lo)/(2.*max(r,.5*dr)*dr)+(dox-2.*old.b.w+uox)/(dz*dz);
  let lapWater=(lw-2.*old.d.z+rwtr)/(dr*dr)+(rwtr-lw)/(2.*max(r,.5*dr)*dr)+(dw-2.*old.d.z+uw)/(dz*dz);
  let diffScale=pow(max(adv.a.x,300.)/300.,1.65)*101325./p[6];let dFuel=min(8e-4,7.8e-5*diffScale);let dOx=min(3.5e-4,2.1e-5*diffScale);let dWater=min(3.5e-4,2.5e-5*diffScale);
  var fuel=max(0.,adv.b.z+p[16]*dFuel*lapFuel);var ox=max(0.,adv.b.w+p[16]*dOx*lapOx);var water=max(0.,adv.d.z+p[16]*dWater*lapWater);
  let inlet=abs(z-p[22])<=.55*dz&&m<.5;var react=chemistryRate(adv.a.x,fuel,ox,m,r,z);if(inlet||z<p[22]){react=0.;}
  fuel=max(0.,fuel-p[16]*react);ox=max(0.,ox-p[16]*react);water=min(1.,water+p[16]*react);
  if(inlet){let fuelIn=1.-smoothstep(.45*p[21],.55*p[21],r);let oxIn=smoothstep(.50*p[21],.58*p[21],r)*(1.-smoothstep(.45*p[24],.50*p[24],r));fuel=p[28]*fuelIn;ox=p[28]*oxIn/max(p[20],.05);water=0.;}
  if(z<p[22]&&m<.5){fuel=0.;ox=0.;water=0.;react=0.;}
  let qchem=heatFromReaction(z,adv.a.x,react,m);var total=select(max(0.,adv.a.y),0.,m>.5&&m<1.5);if(inlet){total=p[28]*p[9]*1e-6;}if(z<p[22]&&m<.5){total=0.;}
  let phi=fuel/max(ox,.05);let neutral=total*neutralActivity(adv.a.x,phi);let nna=p[6]/(KB*max(adv.a.x,300.))*neutral;let lower=max(0.,1.-old.b.x-old.b.y);
  let rawPump=min(5e8,p[12]*qchem/max(nna*EN,1e-12));let accepted=rawPump*lower*nna*EN;let qquench=qrate(max(old.a.x,300.),fuel,ox,water)*nna*(old.b.x+old.b.y)*EN;let thermalSource=qchem-accepted+qquench;
  let surfaceFlux=12.*(old.a.x-p[18])+.82*5.670374419e-8*(pow(old.a.x,4.)-pow(p[18],4.));let boundary=select(0.,surfaceFlux*p[2]/(max(r,.5*dr)*dr),gid.x+1u==u32(p[0]));
  var T=adv.a.x+p[16]*(conduction+thermalSource-boundary)/max(cv,1.);if(z<p[22]&&m<.5){T=p[18];}T=clamp(T,p[18],p[26]);
  dst[id]=Cell(vec4(T,total,neutral,m),vec4(old.b.x,old.b.y,fuel,ox),old.c,vec4(old.d.x,old.d.y,water,clamp(react/KCHEM,0.,1.)));
}
fn solveGroup(gid:vec3<u32>,line:u32,g:u32,T:f32,nna:f32,upper:f32,lower:f32,A:f32,G:f32,F:f32,L:f32)->f32{
  let dr=p[2]/p[0];let dz=p[3]/p[1];let r=(f32(gid.x)+.5)*dr;let nm=max(modeDensity(T,L)*groupWeight(g),1.);
  let nu=C/L;let dnu=nu/C*sqrt(2.*KB*T/MNA);let pw=30.4e6*(p[6]/133.322368)*sqrt(450./T);let gamma=A/(4.*PI)+pw/2.;
  let center=erfcx(gamma/max(dnu,1.))/(sqrt(PI)*max(dnu,1.));let sigma=PI*2.8179403262e-15*C*F*center*profileWeight(g);let kappa=max(nna*sigma,.01);
  let D=C/(3.*(kappa+1./min(p[2],p[3])));let aw=select(0.,D*max(r-.5*dr,0.)/(max(r,.5*dr)*dr*dr),gid.x>0u);let ae=select(4.*D/(dr*dr),D*(r+.5*dr)/(r*dr*dr),gid.x>0u);let az=D/(dz*dz);
  let here=photon(src[ix(gid.x,gid.y)],line,g);var west=here;var east=here;var south=here;var north=here;
  if(gid.x>0u){west=photon(src[ix(gid.x-1u,gid.y)],line,g);}if(gid.x+1u<u32(p[0])){east=photon(src[ix(gid.x+1u,gid.y)],line,g);}
  if(gid.y>0u){south=photon(src[ix(gid.x,gid.y-1u)],line,g);}if(gid.y+1u<u32(p[1])){north=photon(src[ix(gid.x,gid.y+1u)],line,g);}
  let leakageSpeed=C*(1.-p[10])/(2.*(1.+p[10]));var boundaryLeak=0.;
  if(gid.x+1u==u32(p[0])){boundaryLeak+=leakageSpeed*(r+.5*dr)/(max(r,.5*dr)*dr);}
  if(gid.y==0u){boundaryLeak+=leakageSpeed/dz;}if(gid.y+1u==u32(p[1])){boundaryLeak+=leakageSpeed/dz;}
  let source=A*nna*upper*groupWeight(g);let sink=max((G*A*nna*lower-A*nna*upper)/nm,0.);
  return max((source+aw*west+ae*east+az*(south+north))/max(sink+boundaryLeak+aw+ae+2.*az,1.),0.);
}
@compute @workgroup_size(8,8)fn radiation(@builtin(global_invocation_id)gid:vec3<u32>){if(gid.x>=u32(p[0])||gid.y>=u32(p[1])){return;}let id=ix(gid.x,gid.y);let s=src[id];let wall=s.a.w>.5&&s.a.w<1.5;let T=max(s.a.x,300.);let r=(f32(gid.x)+.5)*p[2]/p[0];let z=(f32(gid.y)+.5)*p[3]/p[1];let nbuf=p[6]/(KB*T);let nna=select(nbuf*s.a.z,0.,wall);let nm1=modeDensity(T,L1);let nm2=modeDensity(T,L2);let occ1=photons(s,0u)/max(nm1,1.);let occ2=photons(s,1u)/max(nm2,1.);let q=qrate(T,s.b.z,s.b.w,s.d.z);let qchem=heatFromReaction(z,T,s.d.w*KCHEM,s.a.w);let pump=min(5e8,p[12]*qchem/max(nna*EN,1e-12));let th1=q*G1*exp(-2.1023*EV/(KB*T));let th2=q*G2*exp(-2.1044*EV/(KB*T));let ratio1=(pump/3.+th1+G1*A1*occ1)/max(A1*(1.+occ1)+q,1.);let ratio2=(2.*pump/3.+th2+G2*A2*occ2)/max(A2*(1.+occ2)+q,1.);let lower=1./(1.+ratio1+ratio2);var u1=select(mix(s.b.x,ratio1*lower,.82),0.,wall);var u2=select(mix(s.b.y,ratio2*lower,.82),0.,wall);let total=u1+u2;let mixRate=2e-17*nbuf;let fineRatio=2.*exp(-.0021*EV/(KB*T));let d2eq=total*fineRatio/(1.+fineRatio);let mixFraction=mixRate/(mixRate+.5*(A1+A2));u2=mix(u2,d2eq,mixFraction);u1=max(0.,total-u2);let lo=max(0.,1.-u1-u2);dst[id]=Cell(s.a,vec4(u1,u2,s.b.z,s.b.w),vec4(solveGroup(gid,0u,0u,T,nna,u1,lo,A1,G1,F1,L1),solveGroup(gid,0u,1u,T,nna,u1,lo,A1,G1,F1,L1),solveGroup(gid,0u,2u,T,nna,u1,lo,A1,G1,F1,L1),solveGroup(gid,1u,0u,T,nna,u2,lo,A2,G2,F2,L2)),vec4(solveGroup(gid,1u,1u,T,nna,u2,lo,A2,G2,F2,L2),solveGroup(gid,1u,2u,T,nna,u2,lo,A2,G2,F2,L2),s.d.z,s.d.w));}
`;

const RENDER_WGSL = /* wgsl */`
const PI:f32=3.14159265359;const KB:f32=1.380649e-23;const C:f32=2.99792458e8;const L:f32=5.88995e-7;const MNA:f32=3.81754e-26;
struct Cell{a:vec4<f32>,b:vec4<f32>,c:vec4<f32>,d:vec4<f32>}@group(0)@binding(0)var<storage,read>s:array<Cell>;@group(0)@binding(1)var<storage,read>p:array<f32>;@group(0)@binding(2)var<storage,read>v:array<f32>;
struct O{@builtin(position)pos:vec4<f32>,@location(0)uv:vec2<f32>};@vertex fn vs(@builtin(vertex_index)i:u32)->O{var q=array<vec2<f32>,3>(vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));var o:O;o.pos=vec4(q[i],0.,1.);o.uv=q[i];return o;}fn cell(r:f32,z:f32)->Cell{let x=u32(clamp(r,0.,.999)*p[0]);let y=u32(clamp(z,0.,.999)*p[1]);return s[y*u32(p[0])+x];}
fn modes(T:f32)->f32{let nu=C/L;let d=max(nu/C*sqrt(2.*KB*T/MNA),30.4e6*(p[6]/133.322368)*sqrt(450./T));return 8.*PI*nu*nu*d/(C*C*C);}fn photons(q:Cell)->f32{return q.c.x+q.c.y+q.c.z+q.c.w+q.d.x+q.d.y;}
fn sodiumMap(x:f32)->vec3<f32>{let q=clamp(x,0.,1.);if(q<.33){return mix(vec3(.025,.005,.09),vec3(.36,.03,.42),q/.33);}if(q<.68){return mix(vec3(.36,.03,.42),vec3(1.,.27,.015),(q-.33)/.35);}return mix(vec3(1.,.27,.015),vec3(1.,.96,.52),(q-.68)/.32);}fn thermalMap(x:f32)->vec3<f32>{let q=clamp(x,0.,1.);if(q<.33){return mix(vec3(.02,0.,.08),vec3(.32,.03,.48),q/.33);}if(q<.68){return mix(vec3(.32,.03,.48),vec3(.88,.23,.13),(q-.33)/.35);}return mix(vec3(.88,.23,.13),vec3(.99,1.,.64),(q-.68)/.32);}fn photonMap(x:f32)->vec3<f32>{let q=clamp(x,0.,1.);if(q<.38){return mix(vec3(.018,.003,0.),vec3(.58,.10,.002),q/.38);}if(q<.76){return mix(vec3(.58,.10,.002),vec3(1.,.71,.045),(q-.38)/.38);}return mix(vec3(1.,.71,.045),vec3(1.,.99,.80),(q-.76)/.24);}fn logten(x:f32)->f32{return log2(x)/3.32192809489;}
fn hitCylinder(ro:vec3<f32>,rd:vec3<f32>)->vec2<f32>{let a=dot(rd.xy,rd.xy);let b=2.*dot(ro.xy,rd.xy);let cc=dot(ro.xy,ro.xy)-1.;let d=b*b-4.*a*cc;if(d<0.){return vec2(1.,-1.);}let sd=sqrt(d);var t0=(-b-sd)/(2.*a);var t1=(-b+sd)/(2.*a);let z0=(-1.-ro.z)/rd.z;let z1=(1.-ro.z)/rd.z;t0=max(t0,min(z0,z1));t1=min(t1,max(z0,z1));return vec2(t0,t1);}fn hash(q:vec3<f32>)->f32{return fract(sin(dot(q,vec3(12.9898,78.233,41.37)))*43758.5453);}
@fragment fn volume(in:O)->@location(0)vec4<f32>{let yaw=v[1];let pitch=v[2];let aspect=v[3];let mode=i32(v[6]);let ro=vec3(3.1*cos(yaw)*cos(pitch),3.1*sin(yaw)*cos(pitch),3.1*sin(pitch));let fw=normalize(-ro);let right=normalize(cross(fw,vec3(0.,0.,1.)));let up=cross(right,fw);let rd=normalize(fw+right*in.uv.x*aspect*.57+up*in.uv.y*.57);let hit=hitCylinder(ro,rd);if(hit.y<=max(hit.x,0.)){return vec4(.008,.01,.013,1.);}var col=vec3(0.);var alpha=0.;let start=max(hit.x,0.);let step=(hit.y-start)/56.;for(var i=0;i<56;i++){let t=start+(f32(i)+.5)*step;let pos=ro+rd*t;let angle=atan2(pos.y,pos.x);if(mode!=4&&angle>-.45&&angle<1.05){continue;}let rr=length(pos.xy);let z=pos.z*.5+.5;let rM=rr*p[2];let zM=z*p[3];let q=cell(rr,z);let occ=photons(q)/max(modes(q.a.x),1.);let emit=clamp((q.b.x+q.b.y)*2e5+log2(1.+occ)*.04+q.d.w*.10,0.,1.);var value=emit;var rgb=sodiumMap(value);var density=.008+emit*.085;if(mode==1){value=clamp((q.a.x-p[18])/max(p[26]-p[18],1.),0.,1.);rgb=thermalMap(value);density=.005+value*.07;}if(mode==2){value=clamp((logten(max(occ,1e-9))+9.)/10.,0.,1.);let core=clamp(q.d.w*3.2,0.,1.);rgb=mix(photonMap(value),vec3(1.,.99,.88),core);density=.006+value*.11+core*.07;}if(mode==3){value=clamp(q.d.w*2.8,0.,1.);rgb=mix(vec3(.18,.30,1.),vec3(1.,.97,.58),smoothstep(.08,.75,value));density=.002+value*.17;}if(mode==4){let excited=clamp((q.b.x+q.b.y)*8e5,0.,1.);let trapped=clamp(log2(1.+occ)*.07,0.,1.);let flame=clamp(q.d.w*1.4,0.,1.);value=clamp(excited+.45*trapped+.18*flame,0.,1.);rgb=mix(vec3(1.,.16,.006),vec3(1.,.96,.34),smoothstep(.02,.62,value));density=.010+.17*value+.045*trapped;}let fuelInner=.5*p[21];let fuelOuter=fuelInner+.00045;let shroudInner=.5*p[24];let shroudOuter=shroudInner+.00060;let belowLip=1.-smoothstep(p[22],p[22]+.00045,zM);let fuelTube=smoothstep(fuelInner-.00020,fuelInner,rM)*(1.-smoothstep(fuelOuter,fuelOuter+.00020,rM))*belowLip;let shroudTube=smoothstep(shroudInner-.00020,shroudInner,rM)*(1.-smoothstep(shroudOuter,shroudOuter+.00020,rM))*belowLip;let lipZ=smoothstep(p[22]-.00035,p[22],zM)*(1.-smoothstep(p[22],p[22]+.00035,zM));let fuelLip=(1.-smoothstep(fuelOuter,fuelOuter+.00020,rM))*lipZ;let shroudLip=smoothstep(fuelOuter,fuelOuter+.00020,rM)*(1.-smoothstep(shroudOuter,shroudOuter+.00020,rM))*lipZ;let nozzleMask=max(max(fuelTube,shroudTube),max(fuelLip,shroudLip));if(nozzleMask>.01){rgb=mix(rgb,vec3(.58,.66,.71),nozzleMask);density=max(density,.34*nozzleMask);}if(q.a.w>.5&&q.a.w<1.5){if(mode==4){rgb=mix(rgb,vec3(.30,.21,.07),.16);density=.008;}else{rgb=mix(vec3(.43,.52,.58),thermalMap(value),select(.12,.55,mode==1));density=select(.055,.085,mode==1);}}else if(q.a.w>1.5){rgb=mix(rgb,vec3(.10,.25,.34),.22);}let da=density*(1.-alpha);col+=rgb*da*(1.18+hash(pos*90.+p[15])*.08);alpha+=da;let outerShell=smoothstep(.972,.995,rr);let wallDa=select(.018,.004,mode==4)*outerShell*(1.-alpha);col+=vec3(.38,.78,.84)*wallDa;alpha+=wallDa;if(alpha>.97){break;}}if(mode==4){let sensor=vec3(1.)-exp(-3.2*col);return vec4(pow(clamp(sensor,vec3(0.),vec3(1.)),vec3(.4545)),1.);}return vec4(col,1.);}`;

function fmtRate(value) { return Number.isFinite(value) ? `${value.toExponential(2)} s⁻¹` : '—'; }
function fmtPower(value) { return Number.isFinite(value) ? `${value.toFixed(value < 1 ? 3 : 2)} kW` : '—'; }
function fmtFraction(value) { return Number.isFinite(value) ? value.toExponential(2) : '—'; }
function fmtTime(value) {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1e-6) return `${(value * 1e9).toPrecision(3)} ns`;
  if (value < 1e-3) return `${(value * 1e6).toPrecision(3)} µs`;
  if (value < 1) return `${(value * 1e3).toPrecision(3)} ms`;
  return `${value.toPrecision(3)} s`;
}
function setBar(element, value) { element.style.width = `${Math.max(0, Math.min(100, (Math.log10(Math.max(value, 1e-12)) + 12) / 12 * 100))}%`; }
function setFlow(element, rate, maximum) { element.style.width = `${Math.max(1, Math.min(100, 100 * rate / Math.max(maximum, 1)))}%`; }

function compositionFromCell(fuel, ox, water) {
  const raw = {H2:.15*Math.max(0,fuel),O2:params[P.O2]*.95*Math.max(0,ox),H2O:.60*Math.max(0,water)};
  raw.N2 = Math.max(.1, 1-raw.H2-raw.O2-raw.H2O);
  return raw;
}
function sourceAt(r,z,T,reactionFraction) {
  if (r >= params[P.RC] || z < params[P.INSERTION]) return 0;
  const reactionRate=Math.max(0,reactionFraction)*CHEMISTRY_RATE_S;
  return params[P.PRESSURE]/(8.314462618*Math.max(T,300))*reactionRate*241800;
}
function thermalConductivity(T,material) {
  if (material === 1) return Math.max(4.5, 35 * (300 / Math.max(T,300)) ** .78);
  return material === 2 ? .12 : .18;
}
function smoothstep(edge0,edge1,x) {
  const q=Math.max(0,Math.min(1,(x-edge0)/Math.max(edge1-edge0,1e-12)));
  return q*q*(3-2*q);
}
function axialVelocityAt(r,z,material) {
  if (material === 1) return 0;
  const top=smoothstep(.76,.96,z/params[P.L]);
  if (material === 0) {
    if (z < params[P.INSERTION]) return 0;
    const rn=.5*params[P.NOZZLE],ro=.5*params[P.OXNOZZLE],zr=Math.max(z-params[P.INSERTION],0),rj=rn+.10*zr;
    const jet=Math.exp(-((r/Math.max(rj,.0002))**2)),decay=(rn/Math.max(rj,rn))**2,edge=Math.max(.00020,.10*(ro-rn));
    const annulus=smoothstep(rn,rn+edge,r)*(1-smoothstep(ro-edge,ro,r));
    return (params[P.SPEED]*decay*jet+params[P.COFLOW]*annulus)*(1-.85*top);
  }
  const a=params[P.RC]+params[P.TW],b=params[P.R]-params[P.TW],rr=Math.max(0,Math.min(1,(r-a)/Math.max(b-a,1e-4)));
  return -params[P.RETURN]*(1-top)*(.6+.4*rr);
}
function localRawPump(r,z,T,neutral,reactionFraction) {
  const nNa=params[P.PRESSURE]*neutral/(CONSTANTS.kB*T), qchem=sourceAt(r,z,T,reactionFraction);
  return Math.min(5e8, params[P.ETA]*qchem/Math.max(nNa*2.1035*CONSTANTS.eV,1e-12));
}
function drawSpectrum({coreState,shellState,escapeByGroup,spontaneousByLine}) {
  const canvas=ui['spectrum-plot'],ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height,pad={l:54,r:12,t:12,b:31},x0=588.55,x1=590.05;
  const css=getComputedStyle(document.documentElement),colors={grid:css.getPropertyValue('--line').trim(),text:css.getPropertyValue('--muted').trim(),actual:css.getPropertyValue('--yellow').trim(),source:css.getPropertyValue('--cyan').trim()};
  const resolved=resolvedSodiumSpectrum({pressurePa:params[P.PRESSURE],core:coreState,shell:shellState,wavelengthMinNM:x0,wavelengthMaxNM:x1,points:720});
  const wavelengths=resolved.wavelengthsNM,n=wavelengths.length,actual=new Float64Array(n),source=new Float64Array(n),lines=[CONSTANTS.lines.D2,CONSTANTS.lines.D1];
  const integrate=(values)=>{let sum=0;for(let k=1;k<n;k++)sum+=.5*(values[k-1]+values[k])*(wavelengths[k]-wavelengths[k-1]);return sum;};
  const escapedByLine=[
    escapeByGroup.slice(0,3).reduce((a,b)=>a+b,0)*CONSTANTS.h*CONSTANTS.c/CONSTANTS.lines.D2.wavelength,
    escapeByGroup.slice(3).reduce((a,b)=>a+b,0)*CONSTANTS.h*CONSTANTS.c/CONSTANTS.lines.D1.wavelength,
  ];
  const producedByLine=spontaneousByLine.map((count,li)=>count*CONSTANTS.h*CONSTANTS.c/lines[li].wavelength);
  for(let li=0;li<2;li++){
    const diagnostic=li===0?resolved.D2:resolved.D1,emergentIntegral=integrate(diagnostic.emergent),sourceIntegral=integrate(diagnostic.source),emergentScale=escapedByLine[li]/Math.max(emergentIntegral,1e-300),sourceScale=producedByLine[li]/Math.max(sourceIntegral,1e-300);
    for(let k=0;k<n;k++){actual[k]+=diagnostic.emergent[k]*emergentScale;source[k]+=diagnostic.source[k]*sourceScale;}
  }
  const ceiling=Math.max(1e-12,...actual,...source),floor=ceiling*1e-6,logMin=Math.log10(floor),logMax=Math.log10(ceiling*1.15),px=(x)=>pad.l+(x-x0)/(x1-x0)*(w-pad.l-pad.r),py=(y)=>pad.t+(logMax-Math.log10(Math.max(y,floor)))/(logMax-logMin)*(h-pad.t-pad.b);
  ctx.clearRect(0,0,w,h);ctx.font='18px ui-monospace, SFMono-Regular, Menlo, monospace';ctx.textBaseline='middle';ctx.lineWidth=1;ctx.strokeStyle=colors.grid;ctx.fillStyle=colors.text;
  for(let d=0;d<=6;d++){const y=pad.t+d*(h-pad.t-pad.b)/6;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();ctx.textAlign='right';ctx.fillText(`10^${Math.round(logMax-d*(logMax-logMin)/6)}`,pad.l-7,y);}
  for(const tick of [588.6,588.9,589.2,589.5,589.8,590.0]){const x=px(tick);ctx.beginPath();ctx.moveTo(x,pad.t);ctx.lineTo(x,h-pad.b);ctx.stroke();ctx.textAlign='center';ctx.fillText(tick.toFixed(1),x,h-13);}
  for(const line of lines){const x=px(line.wavelength*1e9);ctx.save();ctx.setLineDash([4,5]);ctx.strokeStyle=colors.grid;ctx.beginPath();ctx.moveTo(x,pad.t);ctx.lineTo(x,h-pad.b);ctx.stroke();ctx.restore();ctx.textAlign='center';ctx.fillStyle=colors.text;ctx.fillText(line.id,x,pad.t+8);}
  const stroke=(values,color,dash=[])=>{ctx.save();ctx.strokeStyle=color;ctx.lineWidth=2.5;ctx.setLineDash(dash);ctx.beginPath();for(let k=0;k<n;k++){const x=px(wavelengths[k]),y=py(values[k]);if(k)ctx.lineTo(x,y);else ctx.moveTo(x,y);}ctx.stroke();ctx.restore();};
  stroke(source,colors.source,[7,5]);stroke(actual,colors.actual);
  const [escapedD2,escapedD1]=escapedByLine,produced=producedByLine[0]+producedByLine[1],reversal=resolved.D2.reversalDepth;
  ui['spectrum-d2'].textContent=`${escapedD2.toPrecision(3)} W`;ui['spectrum-d1'].textContent=`${escapedD1.toPrecision(3)} W`;ui['spectrum-yield'].textContent=`${(100*(escapedD1+escapedD2)/Math.max(produced,1e-30)).toPrecision(3)}%`;ui['spectrum-reversal'].textContent=`${(100*reversal).toFixed(1)}%`;
  return {escapedD1W:escapedD1,escapedD2W:escapedD2,producedW:produced,reversalDepthD2:reversal,coreOpticalDepthD2:resolved.D2.centerOpticalDepthCore,shellOpticalDepthD2:resolved.D2.centerOpticalDepthShell,coreState,shellState};
}

async function main() {
  if (!navigator.gpu) throw new Error('WebGPU is unavailable. Open this page in a current browser over HTTPS or localhost.');
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('No WebGPU adapter was returned.');
  const device=await adapter.requestDevice();device.lost.then((info)=>fail(`GPU device lost: ${info.message}`));device.addEventListener('uncapturederror',(event)=>fail(`WebGPU validation error: ${event.error.message}`));
  const format=navigator.gpu.getPreferredCanvasFormat(),context=ui.volume.getContext('webgpu');context.configure({device,format,alphaMode:'opaque'});
  const state=[0,1].map(()=>device.createBuffer({size:stateBytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}));
  const paramBuffer=device.createBuffer({size:params.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const viewBuffer=device.createBuffer({size:32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const readback=device.createBuffer({size:stateBytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const simModule=device.createShaderModule({code:WGSL}),renderModule=device.createShaderModule({code:RENDER_WGSL});
  const reports=await Promise.all([simModule.getCompilationInfo(),renderModule.getCompilationInfo()]);
  const errors=reports.flatMap((report,index)=>report.messages.filter((m)=>m.type==='error').map((m)=>`${index?'render':'compute'}:${m.lineNum}:${m.linePos} ${m.message}`));
  if(errors.length)throw new Error(`WGSL compilation failed:\n${errors.join('\n')}`);
  const simLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}}]}),simPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[simLayout]});
  const [initPipeline,advancePipeline,radiationPipeline]=await Promise.all(['init','advance','radiation'].map((entryPoint)=>device.createComputePipelineAsync({layout:simPipelineLayout,compute:{module:simModule,entryPoint}})));
  const pipelines={init:initPipeline,advance:advancePipeline,radiation:radiationPipeline};const bind=(a,b)=>device.createBindGroup({layout:simLayout,entries:[{binding:0,resource:{buffer:state[a]}},{binding:1,resource:{buffer:state[b]}},{binding:2,resource:{buffer:paramBuffer}}]});const groups=[bind(0,1),bind(1,0)];
  const renderLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}},{binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'read-only-storage'}}]}),renderPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[renderLayout]});
  const renderPipeline=await device.createRenderPipelineAsync({layout:renderPipelineLayout,vertex:{module:renderModule,entryPoint:'vs'},fragment:{module:renderModule,entryPoint:'volume',targets:[{format}]},primitive:{topology:'triangle-list'}});
  let current=1,frame=0,reading=false;
  function writeParams(){device.queue.writeBuffer(paramBuffer,0,params);}function compute(pass,pipeline){pass.setPipeline(pipeline);pass.setBindGroup(0,groups[current===0?0:1]);pass.dispatchWorkgroups(Math.ceil(NX/8),Math.ceil(NZ/8));current=1-current;}
  function initialize(){params[P.TIME]=0;readControls({commitDesign:true});updateEngagementState();writeParams();const enc=device.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(pipelines.init);pass.setBindGroup(0,groups[0]);pass.dispatchWorkgroups(Math.ceil(NX/8),Math.ceil(NZ/8));pass.end();device.queue.submit([enc.finish()]);current=1;previousEnergy=null;previousEnergyTime=null;window.__lampStats=null;runNumber++;const stabilized=params[P.STABILIZED]>.5,protocol=engagementState.mode==='july15'?'15 Jul engagement':'full capture';ui['run-number'].value=`run ${runNumber} · ${stabilized?'stabilized branch':'ignition transient'} · ${protocol} · t₀`;ui['control-status'].textContent=engagementState.mode==='july15'?'rebuilding · source initially bypassed':stabilized?'rebuilding · converging burning branch':'rebuilding · advancing ignition transient';ui['control-status'].className='solving';}
  initializeGPU=initialize;
  function resize(){const dpr=Math.min(devicePixelRatio,1.25),limit=Math.min(1800,device.limits.maxTextureDimension2D),w=Math.min(limit,Math.max(1,Math.floor(ui.volume.clientWidth*dpr))),h=Math.min(limit,Math.max(1,Math.floor(ui.volume.clientHeight*dpr)));if(ui.volume.width!==w||ui.volume.height!==h){ui.volume.width=w;ui.volume.height=h;}return w/h;}

  async function inspect(){
    if(reading)return;reading=true;const enc=device.createCommandEncoder();enc.copyBufferToBuffer(state[current],0,readback,0,stateBytes);device.queue.submit([enc.finish()]);await readback.mapAsync(GPUMapMode.READ);const data=new Float32Array(readback.getMappedRange());
    const dr=params[P.R]/NX,dz=params[P.L]/NZ,boundary=opticalBoundary({lineReflectance:params[P.REFLECT],pvAbsorptance:params[P.PV]}),boundaryLeakageSpeed=p1BoundaryLeakageSpeed(boundary.reflectance);
    let maxT=0,maxGasT=0,hottestGasCell=0,minT=Infinity,maxWallT=0,outerWallT=0,maxThroughWallDeltaK=0,maxInnerWallHeatFluxWm2=0,wallHotspotZM=0,cappedGasCells=0,hotGasCells=0,burningCells=0,gasCells=0,maxDeparture=0,maxNa=0,maxUpper=0,maxPhotons=0,maxReaction=0,flameBase=Infinity,flameTip=-Infinity,flameRadius=0,best=0,bestBand=-1,bandCell=0,bestFallback=-1,fallbackCell=0,totalEnergy=0,combustionW=0,atomicPumpW=0,quenchW=0,photonCount=0,excitedAtoms=0,boundaryHeatW=0,outflowSensibleW=0,escapePhotonsS=0,radialEscapePhotonsS=0;
    const escapeByGroup=[0,0,0,0,0,0],spontaneousByLine=[0,0];
    const ledger={pump:0,thermalExcitation:0,absorption:0,spontaneous:0,stimulated:0,quench:0};
    for(let j=0;j<NZ;j++)for(let i=0;i<NX;i++){
      const cell=j*NX+i,o=cell*FLOATS,T=Math.max(data[o],params[P.AMBIENT]),totalNa=Math.max(data[o+1],0),neutral=Math.max(data[o+2],0),material=Math.round(data[o+3]),u1=Math.max(data[o+4],0),u2=Math.max(data[o+5],0),fuel=Math.max(data[o+6],0),ox=Math.max(data[o+7],0),p1=Math.max(0,data[o+8]+data[o+9]+data[o+10]),p2=Math.max(0,data[o+11]+data[o+12]+data[o+13]),water=Math.max(data[o+14],0),reaction=Math.max(data[o+15],0),upper=u1+u2,r=(i+.5)*dr,z=(j+.5)*dz,volume=2*Math.PI*r*dr*dz;
      minT=Math.min(minT,T);maxT=Math.max(maxT,T);maxNa=Math.max(maxNa,neutral);maxUpper=Math.max(maxUpper,upper);maxPhotons=Math.max(maxPhotons,p1+p2);
      if(material===1){
        maxWallT=Math.max(maxWallT,T);if(r>params[P.R]-.6*params[P.TW])outerWallT=Math.max(outerWallT,T);
        if(i>0&&Math.round(data[o-FLOATS+3])===0){const gasT=Math.max(data[o-FLOATS],params[P.AMBIENT]),kg=thermalConductivity(gasT,0),kw=thermalConductivity(T,1),kFace=2*kg*kw/Math.max(kg+kw,1e-12),flux=Math.max(0,kFace*(gasT-T)/dr);if(flux>maxInnerWallHeatFluxWm2){maxInnerWallHeatFluxWm2=flux;wallHotspotZM=z;}}
      } else {gasCells++;if(T>maxGasT){maxGasT=T;hottestGasCell=cell;}if(T>1200)hotGasCells++;if(T>=params[P.TMAX]-.5)cappedGasCells++;}
      if(material===0&&z>=params[P.INSERTION]){maxReaction=Math.max(maxReaction,reaction);if(reaction>.03){burningCells++;flameBase=Math.min(flameBase,z);flameTip=Math.max(flameTip,z);flameRadius=Math.max(flameRadius,r);}}
      const cv=material===1?3.95e6:params[P.PRESSURE]/(287*T)*(material===2?2500:2400);totalEnergy+=cv*(T-params[P.AMBIENT])*volume;
      if(material!==1&&(j===0||j===NZ-1)){const vz=axialVelocityAt(r,z,material),outward=(j===0?Math.max(0,-vz):Math.max(0,vz)),area=Math.PI*((i+1)**2-i**2)*dr*dr;outflowSensibleW+=outward*cv*Math.max(0,T-params[P.AMBIENT])*area;}
      if(material!==1){
        const nNa=params[P.PRESSURE]*neutral/(CONSTANTS.kB*T),atoms=nNa*volume,composition=compositionFromCell(fuel,ox,water),pump=localRawPump(r,z,T,neutral,reaction),qchem=sourceAt(r,z,T,reaction),rates=fineStructureRateBalance({temperatureK:T,pressurePa:params[P.PRESSURE],upperD1:u1,upperD2:u2,photonDensityD1:p1,photonDensityD2:p2,reaction:1,pumpMax:pump,quenchCoefficient:0,composition,quenchScale:params[P.QSCALE],fineMixingCoefficient:2e-17});
        combustionW+=qchem*volume;atomicPumpW+=rates.pump*atoms*2.1035*CONSTANTS.eV;quenchW+=rates.quench*atoms*2.1035*CONSTANTS.eV;photonCount+=(p1+p2)*volume;excitedAtoms+=upper*atoms;totalEnergy+=(upper*atoms+p1*volume+p2*volume)*2.1035*CONSTANTS.eV;
        spontaneousByLine[0]+=rates.perLine.D2.spontaneous*atoms;spontaneousByLine[1]+=rates.perLine.D1.spontaneous*atoms;
        for(const key of Object.keys(ledger))ledger[key]+=rates[key]*atoms;
        const cellDeparture=upper/Math.max(lteFineStructureFractions(T).total,1e-30),brightness=neutral*(CONSTANTS.lines.D1.A*u1+CONSTANTS.lines.D2.A*u2),fallbackScore=brightness*Math.max(1,Math.min(1e5,cellDeparture));if(T>700&&upper>1e-9){maxDeparture=Math.max(maxDeparture,cellDeparture);if(cellDeparture>=1e2&&cellDeparture<=1e5&&brightness>bestBand){bestBand=brightness;bandCell=cell;}if(fallbackScore>bestFallback){bestFallback=fallbackScore;fallbackCell=cell;}}
        if(i===NX-1||j===0||j===NZ-1){
          const lines=[[CONSTANTS.lines.D2,[data[o+11],data[o+12],data[o+13]],0],[CONSTANTS.lines.D1,[data[o+8],data[o+9],data[o+10]],3]],areaRadial=2*Math.PI*params[P.R]*dz,areaAxial=Math.PI*((i+1)**2-i**2)*dr*dr;
          for(const [,groups,offset] of lines){for(let g=0;g<3;g++){let flux=0;if(i===NX-1){const radialFlux=boundaryLeakageSpeed*Math.max(0,groups[g])*areaRadial;flux+=radialFlux;radialEscapePhotonsS+=radialFlux;}if(j===0||j===NZ-1)flux+=boundaryLeakageSpeed*Math.max(0,groups[g])*areaAxial;escapeByGroup[offset+g]+=flux;escapePhotonsS+=flux;}}
        }
      }
      if(i===NX-1){const area=2*Math.PI*params[P.R]*dz;boundaryHeatW+=(12*(T-params[P.AMBIENT])+.82*5.670374419e-8*(T**4-params[P.AMBIENT]**4))*area;}
    }
    const innerTubeInnerIndex=Math.max(0,Math.min(NX-1,Math.floor(params[P.RC]/dr))),innerTubeOuterIndex=Math.max(0,Math.min(NX-1,Math.floor((params[P.RC]+params[P.TW])/dr)-1)),outerShellInnerIndex=Math.max(0,Math.min(NX-1,Math.floor((params[P.R]-params[P.TW])/dr))),outerShellSkinIndex=NX-1;
    for(let j=0;j<NZ;j++){const innerA=(j*NX+innerTubeInnerIndex)*FLOATS,innerB=(j*NX+innerTubeOuterIndex)*FLOATS,outerA=(j*NX+outerShellInnerIndex)*FLOATS,outerB=(j*NX+outerShellSkinIndex)*FLOATS;if(Math.round(data[innerA+3])===1&&Math.round(data[innerB+3])===1)maxThroughWallDeltaK=Math.max(maxThroughWallDeltaK,Math.abs(data[innerA]-data[innerB]));if(Math.round(data[outerA+3])===1&&Math.round(data[outerB+3])===1)maxThroughWallDeltaK=Math.max(maxThroughWallDeltaK,Math.abs(data[outerA]-data[outerB]));}
    best=bestBand>=0?bandCell:bestFallback>=0?fallbackCell:hottestGasCell;const off=best*FLOATS,T=data[off],neutral=data[off+2],u1=data[off+4],u2=data[off+5],fuel=data[off+6],ox=data[off+7],p1=data[off+8]+data[off+9]+data[off+10],p2=data[off+11]+data[off+12]+data[off+13],water=data[off+14],reaction=data[off+15],r=((best%NX)+.5)*dr,bestJ=Math.floor(best/NX),z=(bestJ+.5)*dz,composition=compositionFromCell(fuel,ox,water),pump=localRawPump(r,z,T,neutral,reaction);
    let shellWeight=0,shellTemperature=0,shellNeutral=0,shellUpperD1=0,shellUpperD2=0;for(let i=0;i<NX;i++){const shellOffset=(bestJ*NX+i)*FLOATS;if(Math.round(data[shellOffset+3])!==2)continue;const weight=Math.max(data[shellOffset+2],0)*dr;if(weight<=0)continue;shellWeight+=weight;shellTemperature+=Math.max(data[shellOffset],params[P.AMBIENT])*weight;shellNeutral+=Math.max(data[shellOffset+2],0)*weight;shellUpperD1+=Math.max(data[shellOffset+4],0)*weight;shellUpperD2+=Math.max(data[shellOffset+5],0)*weight;}
    const shellPathLengthM=Math.max(dr,params[P.R]-params[P.RC]-2*params[P.TW]),coreState={temperatureK:T,sodiumMixingFraction:neutral,upperD1:u1,upperD2:u2,pathLengthM:Math.max(dr,params[P.RC]-r)},shellState=shellWeight>0?{temperatureK:shellTemperature/shellWeight,sodiumMixingFraction:shellNeutral/shellWeight,upperD1:shellUpperD1/shellWeight,upperD2:shellUpperD2/shellWeight,pathLengthM:shellPathLengthM}:{temperatureK:params[P.AMBIENT],sodiumMixingFraction:0,upperD1:0,upperD2:0,pathLengthM:shellPathLengthM};
    const rates=fineStructureRateBalance({temperatureK:T,pressurePa:params[P.PRESSURE],upperD1:u1,upperD2:u2,photonDensityD1:p1,photonDensityD2:p2,reaction:1,pumpMax:pump,quenchCoefficient:0,composition,quenchScale:params[P.QSCALE],fineMixingCoefficient:2e-17}),check=checkRateBalance(rates),lte=lteFineStructureFractions(T),upper=u1+u2,b=departureCoefficient(T,upper),tex=excitationTemperatureK(upper),tau=opticalDepths({temperatureK:T,pressurePa:params[P.PRESSURE],sodiumMixingFraction:neutral,pathLengthM:params[P.RC]});
    const fuelInputW=nozzleState.lowerHeatingValueW,fuelConversion=combustionW/Math.max(fuelInputW,1),unburnedPowerW=Math.max(0,fuelInputW-combustionW),escapePowerW=escapePhotonsS*2.1035*CONSTANTS.eV,boundaryIncidentW=escapePowerW/Math.max(1-boundary.reflectance,1e-9),pvW=boundaryIncidentW*boundary.pvAbsorptance,parasiticW=boundaryIncidentW*boundary.parasiticAbsorptance,escapeRateS=escapePhotonsS,storageRateW=previousEnergy===null?0:(totalEnergy-previousEnergy)/Math.max(params[P.TIME]-previousEnergyTime,1e-9);previousEnergy=totalEnergy;previousEnergyTime=params[P.TIME];const residualW=combustionW-pvW-parasiticW-boundaryHeatW-outflowSensibleW-storageRateW,conversion=conversionFeasibility({fuelInputW,pvOpticalW:pvW});
    const inletNitrogenFraction=Math.max(0,(1-params[P.O2])/(1+2*params[P.PHI]*params[P.O2])),radicalCycle=sodiumRadicalCycleDiagnostic({temperatureK:operatingReference.operating.adiabatic_temperature_k,pressurePa:params[P.PRESSURE],sodiumMoleFraction:Math.max(data[off+1],0),hydrogenAtomMoleFraction:operatingReference.operating.hydrogen_atom_mole_fraction,hydroxylMoleFraction:operatingReference.operating.hydroxyl_mole_fraction,nitrogenMoleFraction:inletNitrogenFraction}),coreTransitTimeS=params[P.L]/Math.max(params[P.SPEED],1e-9);
    const residence=coupledExcitationResidenceTime({photonCount,excitedAtomCount:excitedAtoms,escapeRateS,quenchRateS:ledger.quench});
    ui['departure-big'].value=`${b.toExponential(2)}×`;ui['gas-temperature'].textContent=`${T.toFixed(0)} K`;ui['peak-gas-temperature'].textContent=`${maxGasT.toFixed(0)} K`;ui['excitation-temperature'].textContent=`${Number.isFinite(tex)?tex.toFixed(0):'—'} K`;ui['optical-depth'].textContent=tau.D2.toExponential(2);ui['d1-pop'].textContent=`n = ${fmtFraction(u1)}`;ui['d2-pop'].textContent=`n = ${fmtFraction(u2)}`;ui['ground-pop'].textContent=`n = ${fmtFraction(Math.max(0,1-upper))}`;ui['solved-population'].value=fmtFraction(upper);ui['lte-population'].value=fmtFraction(lte.total);setBar(ui['solved-bar'],upper);setBar(ui['lte-bar'],lte.total);
    const accepted=Math.max(ledger.pump,1);ui.reabsorptions.textContent=(ledger.absorption/accepted).toPrecision(3);ui['escape-probability'].textContent=`${(100*escapePhotonsS/accepted).toPrecision(3)}%`;ui['residence-time'].textContent=`${(residence*1e9).toPrecision(3)} ns`;
    const channels={pump:ledger.pump+ledger.thermalExcitation,abs:ledger.absorption,emit:ledger.spontaneous+ledger.stimulated,quench:ledger.quench},maximum=Math.max(...Object.values(channels),1);for(const key of Object.keys(channels)){setFlow(ui[`flow-${key}`],channels[key],maximum);ui[`flow-${key}-value`].value=fmtRate(channels[key]);}
    ui['probe-label'].textContent=`non-LTE emission probe · r ${(r*1000).toFixed(1)} mm · z ${(z*1000).toFixed(1)} mm`;ui['r-pump'].textContent=fmtRate(rates.pump+rates.thermalExcitation);ui['r-abs'].textContent=fmtRate(rates.absorption);ui['r-sp'].textContent=fmtRate(rates.spontaneous);ui['r-stim'].textContent=fmtRate(rates.stimulated);ui['r-q'].textContent=fmtRate(rates.quench);ui['upper-solved'].textContent=fmtFraction(upper);ui['upper-lte'].textContent=fmtFraction(lte.total);ui.enhancement.textContent=`${b.toExponential(2)}×`;ui.balance.textContent=`six-group D1/D2 · local population residual ${(100*check.relativeResidual).toFixed(2)}% · neutral Na ${(neutral/Math.max(data[off+1],1e-30)*100).toFixed(1)}% of total · kq,eff ${rates.mixtureQuench.effectiveCoefficientM3s.toExponential(2)} m³/s · ${rates.mixtureQuench.withinMeasuredRange?'within measured quench T range':'quench T outside measured range'}`;
    ui['fuel-input-power'].textContent=fmtPower(fuelInputW/1000);ui['combustion-power'].textContent=fmtPower(combustionW/1000);ui['fuel-conversion'].textContent=`${(100*fuelConversion).toFixed(1)}%`;ui['fuel-conversion'].className=fuelConversion>1.05?'danger':fuelConversion<.5?'warning':'';ui['unburned-power'].textContent=fmtPower(unburnedPowerW/1000);ui['atomic-pump-power'].textContent=fmtPower(atomicPumpW/1000);ui['boundary-line-power'].textContent=fmtPower(boundaryIncidentW/1000);ui['pv-line-power'].textContent=fmtPower(pvW/1000);ui['quench-heat'].textContent=fmtPower(quenchW/1000);ui['parasitic-light'].textContent=fmtPower(parasiticW/1000);ui['boundary-heat'].textContent=fmtPower(boundaryHeatW/1000);ui['exhaust-sensible'].textContent=fmtPower(outflowSensibleW/1000);ui['storage-rate'].textContent=fmtPower(storageRateW/1000);ui['energy-residual'].textContent=fmtPower(residualW/1000);
    ui['line-fuel-efficiency'].textContent=`${(100*conversion.pvOpticalToFuelEfficiency).toPrecision(3)}%`;ui['pv-electric-current'].textContent=fmtPower(conversion.scenarios.largeCell.electricPowerW/1000);ui['generator-eff-current'].textContent=`${(100*conversion.scenarios.largeCell.generatorEfficiency).toPrecision(3)}%`;ui['required-light-large'].textContent=`${(100*conversion.scenarios.largeCell.requiredFuelToPvLightEfficiency).toFixed(0)}%`;ui['required-light-laser'].textContent=`${(100*conversion.scenarios.smallLaserCell.requiredFuelToPvLightEfficiency).toFixed(0)}%`;ui['required-light-future'].textContent=`${(100*conversion.scenarios.futureCell.requiredFuelToPvLightEfficiency).toFixed(0)}%`;ui['evidence-status'].textContent='MODEL ONLY · NEEDS SIMULTANEOUS CALORIMETRY';
    const radicalBurdenTimeS=Math.min(radicalCycle.hydrogenInventoryTimeS,radicalCycle.hydroxylInventoryTimeS),radicalCompetes=radicalBurdenTimeS<coreTransitTimeS;ui['radical-cycle-time'].textContent=fmtTime(radicalCycle.cycleTimeS);ui['radical-h-time'].textContent=fmtTime(radicalCycle.hydrogenInventoryTimeS);ui['radical-oh-time'].textContent=fmtTime(radicalCycle.hydroxylInventoryTimeS);ui['radical-flow-time'].textContent=fmtTime(coreTransitTimeS);ui['radical-status'].textContent=radicalCompetes?'MAY COMPETE WITH FLOW · NOT COUPLED':'SLOW VS FLOW · NOT COUPLED';ui['radical-status'].className=radicalCompetes?'warning':'';ui['radical-detail'].textContent=`N₂-only measured cycle · unperturbed Cantera xH ${operatingReference.operating.hydrogen_atom_mole_fraction.toExponential(2)}, xOH ${operatingReference.operating.hydroxyl_mole_fraction.toExponential(2)} · solved total Na ${(data[off+1]*1e6).toPrecision(3)} ppm. A coupled Na/NaOH flame mechanism is still required.`;
    const spectrum=drawSpectrum({coreState,shellState,escapeByGroup,spontaneousByLine}),meltReferenceK=2323,thermochemistryLimited=cappedGasCells>0,wall=sapphireThermalAssessment({peakTemperatureK:maxWallT,outerSkinTemperatureK:outerWallT,maximumThroughWallDeltaK:maxThroughWallDeltaK,wallThicknessM:params[P.TW],maximumHeatFluxWM2:maxInnerWallHeatFluxWm2,meltReferenceK}),radialIncidentW=radialEscapePhotonsS*2.1035*CONSTANTS.eV/Math.max(1-boundary.reflectance,1e-9),lateralAreaM2=2*Math.PI*params[P.R]*params[P.L],lineExitanceWM2=radialIncidentW/Math.max(lateralAreaM2,1e-12),temperatureRatio=maxGasT/Math.max(operatingReference.stoichiometric.adiabatic_temperature_k,1);
    ui['wall-temperature'].textContent=`${maxWallT.toFixed(0)} K`;ui['wall-skin-temperature'].textContent=`${outerWallT.toFixed(0)} K`;ui['wall-melt-margin'].textContent=`${maxThroughWallDeltaK.toFixed(0)} K`;ui['wall-status'].className=wall.meltMarginK<0?'danger':wall.creepRelevant?'warning':'';ui['wall-status'].textContent=wall.state;ui['wall-detail'].textContent=`melt margin ${wall.meltMarginK>=0?'+':''}${wall.meltMarginK.toFixed(0)} K · peak q″ ${(maxInnerWallHeatFluxWm2/1e4).toFixed(2)} W cm⁻² at z ${(wallHotspotZM*1000).toFixed(1)} mm · |∇T| ${(wall.gradientKM/1e3).toFixed(1)} kK m⁻¹ · fully constrained elastic bound ${(wall.constrainedStressUpperBoundPa/1e6).toFixed(0)} MPa (not a stress solve)`;ui['wall-detail'].className=wall.meltMarginK<0?'danger':'';
    ui['reference-tad'].textContent=`${operatingReference.stoichiometric.adiabatic_temperature_k.toFixed(0)} K`;ui['reference-temperature-ratio'].textContent=temperatureRatio.toFixed(3);ui['reference-exitance'].textContent=`${(lineExitanceWM2/1000).toPrecision(3)} kW m⁻²`;ui['reference-status'].className=temperatureRatio>1.02?'danger':thermochemistryLimited?'warning':'';ui['reference-status'].textContent=temperatureRatio>1.02?`PEAK GAS EXCEEDS CANTERA STOICH CEILING · inspect reduced chemistry energy closure`:`Cantera ceiling respected · free-flame Sₗ ${operatingReference.freeFlame.laminar_flame_speed_m_s.toFixed(2)} m s⁻¹ is a comparator only · line exitance ${(lineExitanceWM2/PUBLIC_BENCHMARK.lineExitanceWM2).toPrecision(3)}× public peak`;
    const stabilized=params[P.STABILIZED]>.5,flame=flameCellAssessment({nozzleVelocityMS:nozzleState.velocityMS,reynolds:nozzleState.reynolds,mach:nozzleState.mach,flameBaseM:flameBase,flameTipM:flameTip,flameRadiusM:flameRadius,coreRadiusM:params[P.RC],cellLengthM:.94*params[P.L],maxReaction,wallTemperatureK:maxWallT,meltReferenceK});ui['flame-length'].textContent=flame.present?`${(flame.flameLengthM*1000).toFixed(1)} mm`:'—';ui['flame-wall-clearance'].textContent=flame.present?`${(flame.wallClearanceM*1000).toFixed(1)} mm`:'—';ui['flame-exit-clearance'].textContent=flame.present?`${(flame.axialClearanceM*1000).toFixed(1)} mm`:'—';ui['flame-status'].textContent=flame.state;ui['flame-status'].className=/EXCEEDED|IMPINGEMENT/.test(flame.state)?'danger':/WARNING|LOW-RE/.test(flame.state)?'warning':'';ui['flame-regime'].textContent=`${stabilized?'lip flame-holder closure active':'one-time ignition seed only'} · H₂ nozzle Re ${nozzleState.reynolds.toExponential(2)} · M ${nozzleState.mach.toFixed(3)} · shear proxy ${shearRateProxyS.toExponential(2)} s⁻¹ · Cantera premixed Sₗ ${operatingReference.freeFlame.laminar_flame_speed_m_s.toFixed(2)} m s⁻¹`;
    const residualFraction=Math.abs(residualW)/Math.max(combustionW,1),protocolSettled=engagementState.mode==='steady'?params[P.TIME]>.002:engagementState.phase==='CAPTURED'&&params[P.TIME]>.010,branchLost=stabilized&&protocolSettled&&(maxGasT<1200||burningCells===0);if(!designPending){const engaging=engagementState.mode==='july15'&&engagementState.phase!=='CAPTURED';ui['control-status'].textContent=engaging?`${engagementState.phase.toLowerCase()} · chamber source ${(100*engagementState.capturedFraction).toFixed(0)}% captured · metered H₂ unchanged`:branchLost?`stabilized branch lost · peak gas ${maxGasT.toFixed(0)} K · rerun or reduce flow`:params[P.TIME]<.05?(stabilized?`stabilized burning branch · ${burningCells} reacting cells · peak gas ${maxGasT.toFixed(0)} K`:'advancing ignition / blowoff transient'):`${stabilized?'stabilized branch':'transient'} · fuel converted ${(100*fuelConversion).toFixed(0)}% · thermal residual ${(100*residualFraction).toFixed(0)}%`;ui['control-status'].className=branchLost?'danger':engaging||residualFraction>.15||fuelConversion<.5?'solving':'';}
    window.__lampStats={minT,maxT,maxGasT,maxWallT,outerWallT,meltMarginK:wall.meltMarginK,maxDeparture,maxNa,maxUpper,maxPhotons,maxReaction,physicalTimeS:params[P.TIME],runNumber,mode:stabilized?'stabilized':'transient',engagement:{...engagementState},reference:{...operatingReference,temperatureRatio,lineExitanceWM2,publicLineExitanceWM2:PUBLIC_BENCHMARK.lineExitanceWM2,shearRateProxyS,radicalCycle:{...radicalCycle,coreTransitTimeS}},flame:{...flame,baseM:flameBase,tipM:flameTip,radiusM:flameRadius,openAirReferenceM,flameHolderEnabled:stabilized,burningCells,hotGasCells},thermal:{...wall,maxInnerWallHeatFluxWm2,wallHotspotZM,maxThroughWallDeltaK,cappedGasCells,gasCells,hotGasCells,thermochemistryLimited},nozzle:{...nozzleState},coflow:{...coflowState},returnFlow:{...returnState,engagedVelocityMS:returnState.velocityMS*engagementState.capturedFraction},selected:{T,neutral,u1,u2,p1,p2,fuel,ox,water,reaction,departure:b},rates,ledger,spectrum:{...spectrum,escapeByGroup:[...escapeByGroup],spontaneousByLine:[...spontaneousByLine]},energy:{fuelInputW,capturedFuelInputW:fuelInputW*engagementState.capturedFraction,bypassedFuelInputW:fuelInputW*engagementState.bypassFraction,fuelConversion,unburnedPowerW,combustionW,atomicPumpW,quenchW,boundaryIncidentW,pvW,parasiticW,boundaryHeatW,outflowSensibleW,storageRateW,residualW,totalEnergy,conversion},boundary:{...boundary,leakageSpeedMS:boundaryLeakageSpeed},controls:{fuelFlowSLPM:+ui['fuel-flow'].value,oxidizerFlowSLPM:+ui['oxidizer-flow'].value,powerKW:params[P.POWER],equivalenceRatio:params[P.PHI],oxygenFraction:params[P.O2],flowSpeedMS:params[P.SPEED],coflowSpeedMS:params[P.COFLOW],returnSpeedMS:params[P.RETURN],pressurePa:params[P.PRESSURE],sodiumInventoryPPM:params[P.NA],coreRadiusM:params[P.RC],wallThicknessM:params[P.TW],nozzleDiameterM:params[P.NOZZLE],oxidizerNozzleDiameterM:params[P.OXNOZZLE],nozzleInsertionM:params[P.INSERTION],thermochemistryCeilingK:params[P.TMAX],simulationMode:stabilized?'stabilized':'transient',operatingProtocol:engagementState.mode}};
    readback.unmap();reading=false;
  }
  async function stepPhysics(stepCount=8){
    const steps=Math.max(1,Math.min(5000,Math.floor(stepCount)));
    const wasPaused=paused;paused=true;
    for(let completed=0;completed<steps;){
      const chunk=Math.min(32,steps-completed);updateEngagementState();writeParams();
      const enc=device.createCommandEncoder(),pass=enc.beginComputePass();
      for(let step=0;step<chunk;step++){compute(pass,pipelines.advance);for(let i=0;i<10;i++)compute(pass,pipelines.radiation);params[P.TIME]+=params[P.DT];}
      pass.end();device.queue.submit([enc.finish()]);completed+=chunk;
    }
    updateEngagementState();await device.queue.onSubmittedWorkDone();await inspect();paused=wasPaused;
    return window.__lampStats;
  }
  function tick(){const steps=paused||designPending?0:LIVE_STEPS_PER_FRAME;updateEngagementState();writeParams();const enc=device.createCommandEncoder();if(steps){const pass=enc.beginComputePass();for(let step=0;step<steps;step++){compute(pass,pipelines.advance);for(let i=0;i<LIVE_RADIATION_SWEEPS;i++)compute(pass,pipelines.radiation);params[P.TIME]+=params[P.DT];}pass.end();}const aspect=resize();device.queue.writeBuffer(viewBuffer,0,new Float32Array([0,orbit,pitch,aspect,0,0,volumeMode,0]));const bg=device.createBindGroup({layout:renderLayout,entries:[{binding:0,resource:{buffer:state[current]}},{binding:1,resource:{buffer:paramBuffer}},{binding:2,resource:{buffer:viewBuffer}}]}),rp=enc.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:.005,g:.006,b:.008,a:1},loadOp:'clear',storeOp:'store'}]});rp.setPipeline(renderPipeline);rp.setBindGroup(0,bg);rp.draw(3);rp.end();device.queue.submit([enc.finish()]);ui['sim-time'].value=`${params[P.TIME].toFixed(4)} s physical time`;if(frame++%60===0)inspect();requestAnimationFrame(tick);}
  ui.reset.addEventListener('click',initialize);ui.pause.addEventListener('click',()=>{paused=!paused;ui.pause.textContent=paused?'Resume':'Pause';});ui.volume.addEventListener('pointerdown',(event)=>{dragging=true;lastX=event.clientX;lastY=event.clientY;ui.volume.setPointerCapture(event.pointerId);});ui.volume.addEventListener('pointermove',(event)=>{if(!dragging)return;orbit+=(event.clientX-lastX)*.008;pitch=Math.max(-.65,Math.min(.65,pitch-(event.clientY-lastY)*.006));lastX=event.clientX;lastY=event.clientY;});ui.volume.addEventListener('pointerup',()=>dragging=false);
  initialize();ui['gpu-status'].textContent=`WebGPU · ${NX}×${NZ} · coaxial burner + two walls + return · 6 radiation groups`;ui['gpu-status'].classList.add('ok');window.__lampControls={rebuild:initialize,step:stepPhysics,params,snapshot:()=>({runNumber,designPending,paused,physicalTimeS:params[P.TIME],simulationMode:params[P.STABILIZED]>.5?'stabilized':'transient',operatingProtocol:engagementState.mode,engagement:{...engagementState},fuelFlowSLPM:+ui['fuel-flow'].value,oxidizerFlowSLPM:+ui['oxidizer-flow'].value,powerKW:params[P.POWER],equivalenceRatio:params[P.PHI],oxygenFraction:params[P.O2],flowSpeedMS:params[P.SPEED],coflowSpeedMS:params[P.COFLOW],returnSpeedMS:params[P.RETURN],nozzleReynolds:nozzleState.reynolds,nozzleMach:nozzleState.mach,openAirFlameReferenceM:openAirReferenceM,coreRadiusM:params[P.RC],wallThicknessM:params[P.TW],nozzleDiameterM:params[P.NOZZLE],oxidizerNozzleDiameterM:params[P.OXNOZZLE],nozzleInsertionM:params[P.INSERTION]})};tick();
}

function fail(error){console.error(error);if(!ui.fatal.hidden)return;ui.fatal.hidden=false;ui.fatal.textContent=`Sodium Lamp could not start.\n\n${error.message||error}`;ui['gpu-status'].textContent='WebGPU failed';ui['gpu-status'].classList.add('error');}
readControls({commitDesign:true});main().catch(fail);
