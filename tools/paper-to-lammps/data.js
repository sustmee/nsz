/* ==========================================================================
   Reference data for the MD paper → LAMMPS tool.
   Plain data only (no DOM), so it can be reused and tested anywhere.
   ========================================================================== */

/** Standard atomic masses (g/mol) for elements that show up in MD papers. */
export const MASSES = {
  H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999, F: 18.998,
  Ne: 20.18, Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06, Cl: 35.45, Ar: 39.948,
  K: 39.098, Ca: 40.078, Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938, Fe: 55.845,
  Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.63, As: 74.922, Se: 78.971,
  Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224, Nb: 92.906, Mo: 95.95,
  Ru: 101.07, Rh: 102.91, Pd: 106.42, Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71, Sb: 121.76,
  Te: 127.6, I: 126.9, Xe: 131.29, Cs: 132.91, Ba: 137.33, La: 138.91, Ce: 140.12, Nd: 144.24,
  Gd: 157.25, Hf: 178.49, Ta: 180.95, W: 183.84, Re: 186.21, Os: 190.23, Ir: 192.22, Pt: 195.08,
  Au: 196.97, Hg: 200.59, Pb: 207.2, Bi: 208.98, U: 238.03,
};

export const ELEMENT_NAMES = {
  hydrogen: "H", helium: "He", lithium: "Li", boron: "B", carbon: "C", nitrogen: "N", oxygen: "O",
  fluorine: "F", sodium: "Na", magnesium: "Mg", aluminum: "Al", aluminium: "Al", silicon: "Si",
  phosphorus: "P", sulfur: "S", sulphur: "S", chlorine: "Cl", argon: "Ar", potassium: "K", calcium: "Ca",
  titanium: "Ti", vanadium: "V", chromium: "Cr", manganese: "Mn", iron: "Fe", cobalt: "Co", nickel: "Ni",
  copper: "Cu", zinc: "Zn", gallium: "Ga", germanium: "Ge", arsenic: "As", selenium: "Se",
  zirconium: "Zr", niobium: "Nb", molybdenum: "Mo", palladium: "Pd", silver: "Ag", tin: "Sn",
  tantalum: "Ta", tungsten: "W", platinum: "Pt", gold: "Au", lead: "Pb", hafnium: "Hf", uranium: "U",
};

/**
 * Materials that are common in MD papers.
 * structure: a LAMMPS lattice keyword (fcc, bcc, hcp, diamond) or a description
 * when the structure must be built with another tool (2D sheets, tubes, molecules).
 * a: lattice constant in Å (experimental / typical value — the paper's own value wins).
 */
export const MATERIALS = [
  { id: "graphene", re: /\bgraphene\b/i, name: "Graphene", elements: ["C"], structure: "2D honeycomb", a: 2.46, dim: "2D", build: "graphene" },
  { id: "cnt", re: /carbon nano-?tubes?|\b(?:SW|MW|DW)?CNTs?\b/i, name: "Carbon nanotube (CNT)", elements: ["C"], structure: "nanotube", a: 2.46, dim: "1D", build: "cnt" },
  { id: "diamond", re: /\bdiamond\b(?![- ]like)/i, name: "Diamond", elements: ["C"], structure: "diamond", a: 3.567 },
  { id: "hbn", re: /\bh-?BN\b|hexagonal boron nitride/i, name: "Hexagonal boron nitride (h-BN)", elements: ["B", "N"], structure: "2D honeycomb", a: 2.504, dim: "2D", build: "graphene" },
  { id: "mos2", re: /\bMoS\s?2\b|molybdenum disulfide/i, name: "MoS₂", elements: ["Mo", "S"], structure: "2D TMD (trilayer)", a: 3.16, dim: "2D", build: "tmd" },
  { id: "silicene", re: /\bsilicene\b/i, name: "Silicene", elements: ["Si"], structure: "2D buckled honeycomb", a: 3.86, dim: "2D", build: "graphene" },
  { id: "phosphorene", re: /\bphosphorene\b|black phosphorus/i, name: "Phosphorene", elements: ["P"], structure: "2D puckered", a: 3.31, dim: "2D", build: "tmd" },
  { id: "germanene", re: /\bgermanene\b/i, name: "Germanene", elements: ["Ge"], structure: "2D buckled honeycomb", a: 4.02, dim: "2D", build: "graphene" },
  { id: "sic", re: /silicon carbide|\bSiC\b/i, name: "Silicon carbide (SiC)", elements: ["Si", "C"], structure: "zincblende (3C)", a: 4.36, build: "atomsk" },
  { id: "gan", re: /gallium nitride|\bGaN\b/i, name: "Gallium nitride (GaN)", elements: ["Ga", "N"], structure: "wurtzite", a: 3.189, build: "atomsk" },
  { id: "sio2", re: /\bsilica\b|\bSiO\s?2\b|quartz/i, name: "Silica (SiO₂)", elements: ["Si", "O"], structure: "amorphous / quartz", a: 4.913, build: "atomsk" },
  { id: "al2o3", re: /\balumina\b|\bAl\s?2\s?O\s?3\b|sapphire/i, name: "Alumina (Al₂O₃)", elements: ["Al", "O"], structure: "corundum", a: 4.759, build: "atomsk" },
  { id: "tio2", re: /\bTiO\s?2\b|titania|anatase|rutile/i, name: "Titania (TiO₂)", elements: ["Ti", "O"], structure: "rutile / anatase", a: 4.594, build: "atomsk" },
  { id: "hea", re: /high[- ]entropy alloy|\bHEAs?\b|CoCrFeMnNi|Cantor alloy/i, name: "High-entropy alloy", elements: ["Co", "Cr", "Fe", "Mn", "Ni"], structure: "fcc", a: 3.59, alloy: true },
  { id: "niti", re: /\bNiTi\b|nitinol|shape[- ]memory alloy/i, name: "NiTi (shape-memory alloy)", elements: ["Ni", "Ti"], structure: "B2", a: 3.015, build: "atomsk" },
  { id: "si", re: /\bsilicon\b(?![- ](?:carbide|nitride|dioxide|oxide))|\bSi\b(?![a-zA-Z0-9])/i, name: "Silicon", elements: ["Si"], structure: "diamond", a: 5.431 },
  { id: "ge", re: /\bgermanium\b/i, name: "Germanium", elements: ["Ge"], structure: "diamond", a: 5.658 },
  { id: "cu", re: /\bcopper\b|\bCu\b(?![a-zA-Z0-9])/i, name: "Copper", elements: ["Cu"], structure: "fcc", a: 3.615 },
  { id: "al", re: /\balumin(?:i)?um\b|\bAl\b(?![a-zA-Z0-9])/i, name: "Aluminium", elements: ["Al"], structure: "fcc", a: 4.05 },
  { id: "ni", re: /\bnickel\b|\bNi\b(?![a-zA-Z0-9])/i, name: "Nickel", elements: ["Ni"], structure: "fcc", a: 3.52 },
  { id: "au", re: /\bgold\b|\bAu\b(?![a-zA-Z0-9])/i, name: "Gold", elements: ["Au"], structure: "fcc", a: 4.08 },
  { id: "ag", re: /\bsilver\b|\bAg\b(?![a-zA-Z0-9])/i, name: "Silver", elements: ["Ag"], structure: "fcc", a: 4.09 },
  { id: "pt", re: /\bplatinum\b|\bPt\b(?![a-zA-Z0-9])/i, name: "Platinum", elements: ["Pt"], structure: "fcc", a: 3.924 },
  { id: "pd", re: /\bpalladium\b|\bPd\b(?![a-zA-Z0-9])/i, name: "Palladium", elements: ["Pd"], structure: "fcc", a: 3.89 },
  { id: "pb", re: /\blead\b(?= (?:nano|crystal|atoms|film))|\bPb\b(?![a-zA-Z0-9])/i, name: "Lead", elements: ["Pb"], structure: "fcc", a: 4.95 },
  { id: "fe", re: /\biron\b|\bα-Fe\b|\bFe\b(?![a-zA-Z0-9])/i, name: "Iron (α-Fe)", elements: ["Fe"], structure: "bcc", a: 2.8665 },
  { id: "w", re: /\btungsten\b|\bW\b(?= (?:atoms|crystal|nano|single))/i, name: "Tungsten", elements: ["W"], structure: "bcc", a: 3.165 },
  { id: "mo", re: /\bmolybdenum\b(?! disulfide)/i, name: "Molybdenum", elements: ["Mo"], structure: "bcc", a: 3.147 },
  { id: "ta", re: /\btantalum\b|\bTa\b(?![a-zA-Z0-9])/i, name: "Tantalum", elements: ["Ta"], structure: "bcc", a: 3.303 },
  { id: "cr", re: /\bchromium\b/i, name: "Chromium", elements: ["Cr"], structure: "bcc", a: 2.91 },
  { id: "ti", re: /\btitanium\b(?! (?:dioxide|oxide))|\bTi\b(?![a-zA-Z0-9])/i, name: "Titanium (α-Ti)", elements: ["Ti"], structure: "hcp", a: 2.95, c: 4.68 },
  { id: "mg", re: /\bmagnesium\b|\bMg\b(?![a-zA-Z0-9])/i, name: "Magnesium", elements: ["Mg"], structure: "hcp", a: 3.21, c: 5.21 },
  { id: "zr", re: /\bzirconium\b|\bZr\b(?![a-zA-Z0-9])/i, name: "Zirconium", elements: ["Zr"], structure: "hcp", a: 3.232, c: 5.147 },
  { id: "water", re: /\bwater\b|\bH\s?2\s?O\b/i, name: "Water", elements: ["O", "H"], structure: "liquid", build: "packmol", molecular: true },
  { id: "polymer", re: /\bpolyethylene\b|\bpolymer\b|\bepoxy\b|\bPMMA\b|\bpolystyrene\b/i, name: "Polymer", elements: ["C", "H"], structure: "amorphous polymer", build: "polymer", molecular: true },
];

/**
 * Interatomic potentials / force fields and how they map to LAMMPS.
 * units: preferred LAMMPS units. file: placeholder potential file name.
 */
export const POTENTIALS = [
  { id: "airebo", re: /\bAIREBO(?:-M)?\b|adaptive intermolecular reactive (?:empirical )?bond order/i, name: "AIREBO", pair_style: "airebo 3.0 1 1", file: "CH.airebo", units: "metal", atom_style: "atomic", many: true, cutoff: 3.0 },
  { id: "rebo", re: /\b(?:2nd[- ]generation )?REBO\b|reactive empirical bond[- ]order|Brenner potential/i, name: "REBO", pair_style: "rebo", file: "CH.rebo", units: "metal", atom_style: "atomic", many: true },
  { id: "reaxff", re: /\bReax(?:FF)?\b|reactive force[- ]field/i, name: "ReaxFF", pair_style: "reaxff NULL", file: "ffield.reax", units: "real", atom_style: "charge", many: true, qeq: true },
  { id: "tersoff", re: /\bTersoff\b/i, name: "Tersoff", pair_style: "tersoff", file: "MATERIAL.tersoff", units: "metal", atom_style: "atomic", many: true },
  { id: "meam", re: /\bMEAM\b|modified embedded[- ]atom/i, name: "MEAM", pair_style: "meam", file: "library.meam", units: "metal", atom_style: "atomic", many: true, meam: true },
  { id: "eamfs", re: /Finnis[- –]Sinclair|\bEAM\/FS\b/i, name: "EAM (Finnis–Sinclair)", pair_style: "eam/fs", file: "MATERIAL.eam.fs", units: "metal", atom_style: "atomic", many: true },
  { id: "eam", re: /\bEAM\b|embedded[- ]atom(?: method)?/i, name: "EAM", pair_style: "eam/alloy", file: "MATERIAL.eam.alloy", units: "metal", atom_style: "atomic", many: true },
  { id: "sw", re: /Stillinger[- –]Weber|\bSW potential/i, name: "Stillinger–Weber", pair_style: "sw", file: "MATERIAL.sw", units: "metal", atom_style: "atomic", many: true },
  { id: "comb", re: /\bCOMB3?\b|charge[- ]optimi[sz]ed many[- ]body/i, name: "COMB", pair_style: "comb3 polar_off", file: "ffield.comb3", units: "metal", atom_style: "charge", many: true },
  { id: "adp", re: /angular[- ]dependent potential|\bADP\b/i, name: "ADP", pair_style: "adp", file: "MATERIAL.adp", units: "metal", atom_style: "atomic", many: true },
  { id: "bop", re: /\bBOP\b|analytic bond[- ]order potential/i, name: "BOP", pair_style: "bop", file: "MATERIAL.bop", units: "metal", atom_style: "atomic", many: true },
  { id: "vashishta", re: /\bVashishta\b/i, name: "Vashishta", pair_style: "vashishta", file: "MATERIAL.vashishta", units: "metal", atom_style: "atomic", many: true },
  { id: "edip", re: /\bEDIP\b|environment[- ]dependent interatomic/i, name: "EDIP", pair_style: "edip", file: "Si.edip", units: "metal", atom_style: "atomic", many: true },
  { id: "lcbop", re: /\bLCBOP\b/i, name: "LCBOP", pair_style: "lcbop", file: "C.lcbop", units: "metal", atom_style: "atomic", many: true },
  { id: "snap", re: /\bSNAP\b|spectral neighbo(?:u)?r analysis/i, name: "SNAP (machine learning)", pair_style: "snap", file: "MATERIAL.snapcoeff MATERIAL.snapparam", units: "metal", atom_style: "atomic", many: true },
  { id: "deepmd", re: /DeePMD|Deep Potential/i, name: "Deep Potential (DeePMD)", pair_style: "deepmd graph.pb", file: "", units: "metal", atom_style: "atomic", many: true, noFile: true },
  { id: "ace", re: /atomic cluster expansion|\bpACE\b|\bACE potential/i, name: "ACE (machine learning)", pair_style: "pace", file: "MATERIAL.yace", units: "metal", atom_style: "atomic", many: true },
  { id: "buck", re: /Buckingham/i, name: "Buckingham (+ Coulomb)", pair_style: "buck/coul/long 10.0", units: "metal", atom_style: "charge", pairwise: true, kspace: true },
  { id: "morse", re: /\bMorse\b/i, name: "Morse", pair_style: "morse 10.0", units: "metal", atom_style: "atomic", pairwise: true },
  { id: "opls", re: /\bOPLS(?:-AA)?\b/i, name: "OPLS-AA", pair_style: "lj/cut/coul/long 10.0", units: "real", atom_style: "full", molecular: true, kspace: true },
  { id: "charmm", re: /\bCHARMM\b/i, name: "CHARMM", pair_style: "lj/charmm/coul/long 8.0 10.0", units: "real", atom_style: "full", molecular: true, kspace: true },
  { id: "amber", re: /\bAMBER\b|\bGAFF\b/i, name: "AMBER / GAFF", pair_style: "lj/cut/coul/long 10.0", units: "real", atom_style: "full", molecular: true, kspace: true },
  { id: "dreiding", re: /\bDREIDING\b/i, name: "DREIDING", pair_style: "lj/cut/coul/long 10.0", units: "real", atom_style: "full", molecular: true, kspace: true },
  { id: "compass", re: /\bCOMPASS\b/i, name: "COMPASS", pair_style: "lj/class2/coul/long 10.0", units: "real", atom_style: "full", molecular: true, kspace: true },
  { id: "pcff", re: /\bPCFF\b/i, name: "PCFF", pair_style: "lj/class2/coul/long 10.0", units: "real", atom_style: "full", molecular: true, kspace: true },
  { id: "cvff", re: /\bCVFF\b/i, name: "CVFF", pair_style: "lj/cut/coul/long 10.0", units: "real", atom_style: "full", molecular: true, kspace: true },
  { id: "tip4p", re: /\bTIP4P(?:\/2005|-Ew)?\b/i, name: "TIP4P water", pair_style: "lj/cut/tip4p/long 1 2 1 1 0.1546 10.0", units: "real", atom_style: "full", molecular: true, kspace: true },
  { id: "tip3p", re: /\bTIP3P\b/i, name: "TIP3P water", pair_style: "lj/cut/coul/long 10.0", units: "real", atom_style: "full", molecular: true, kspace: true },
  { id: "spce", re: /\bSPC\/?E\b|\bSPC\b/i, name: "SPC/E water", pair_style: "lj/cut/coul/long 10.0", units: "real", atom_style: "full", molecular: true, kspace: true },
  { id: "lj", re: /Lennard[- –]Jones|\bL-?J\b(?: potential)?|12-6 potential/i, name: "Lennard-Jones", pair_style: "lj/cut 10.0", units: "metal", atom_style: "atomic", pairwise: true },
];

export const THERMOSTATS = [
  { id: "nose-hoover", re: /Nos[eé]\s*[-–—]?\s*Hoover|Nose[- ]Hoover|Hoover thermostat/i, name: "Nosé–Hoover" },
  { id: "berendsen", re: /Berendsen/i, name: "Berendsen" },
  { id: "langevin", re: /Langevin/i, name: "Langevin" },
  { id: "rescale", re: /velocity[- ]rescal|rescaling (?:of )?(?:the )?velocit|rescale thermostat/i, name: "Velocity rescaling" },
  { id: "csvr", re: /Bussi|\bCSVR\b|stochastic velocity rescal/i, name: "Bussi (CSVR)" },
  { id: "andersen", re: /Andersen/i, name: "Andersen" },
];

export const BAROSTATS = [
  { id: "parrinello", re: /Parrinello[- –]Rahman/i, name: "Parrinello–Rahman" },
  { id: "nose-hoover", re: /Nos[eé]\s*[-–—]?\s*Hoover (?:(?:chain )?thermostats? (?:and|&) )?(?:chain )?barostat|\bMTK\b|Martyna[- –]Tobias[- –]Klein/i, name: "Nosé–Hoover (MTK)" },
  { id: "berendsen", re: /Berendsen (?:(?:thermostat|thermostats) (?:and|&) )?barostat|Berendsen pressure/i, name: "Berendsen" },
];

export const SIM_TYPES = [
  { id: "tensile", re: /\btensile|\btension\b|uniaxial (?:tensile )?(?:loading|strain|stretch)|stretching/gi, name: "Uniaxial tension" },
  { id: "compression", re: /\bcompress(?:ion|ive)\b|\bbuckling\b/gi, name: "Uniaxial compression" },
  { id: "shear", re: /\bshear(?:ing)? (?:loading|deformation|strain|test)|\bshear\b/gi, name: "Shear" },
  { id: "indentation", re: /\bnano-?indent(?:ation|er)?|\bindent(?:ation|er)\b/gi, name: "Nanoindentation" },
  { id: "cutting", re: /nano-?cutting|nano-?machining|\bscratch(?:ing)?\b|nano-?scratch/gi, name: "Nanocutting / scratching" },
  { id: "thermal", re: /thermal conductivit|heat (?:flux|conduction|transport)|phonon transport|Kapitza|thermal (?:boundary )?resistance/gi, name: "Thermal conductivity" },
  { id: "melting", re: /\bmelting\b|\bsolidification\b|\bheating rate\b|\bcooling rate\b|\bquench/gi, name: "Melting / solidification" },
  { id: "diffusion", re: /\bdiffusion coefficient|\bdiffusivity\b|mean[- ]square(?:d)? displacement|\bMSD\b/gi, name: "Diffusion" },
  { id: "irradiation", re: /\birradiation\b|collision cascade|primary knock-?on|\bPKA\b/gi, name: "Irradiation / cascade" },
  { id: "fracture", re: /\bcrack propagation|\bfracture toughness|\bpre-?crack/gi, name: "Fracture / crack" },
  { id: "bending", re: /\bbending\b/gi, name: "Bending" },
  { id: "friction", re: /\bfriction\b|\bsliding\b|\btribolog/gi, name: "Friction / sliding" },
  { id: "sintering", re: /\bsintering\b|\bcoalescence\b/gi, name: "Sintering" },
];

export const PROPERTIES = [
  ["Young's modulus", /young'?s modul/i], ["Tensile / ultimate strength", /(?:tensile|ultimate|fracture) strength/i],
  ["Fracture strain", /fracture strain|failure strain|strain at (?:failure|fracture)/i], ["Stress–strain curve", /stress[- –]strain/i],
  ["Poisson's ratio", /poisson'?s ratio/i], ["Shear modulus", /shear modul/i], ["Bulk modulus", /bulk modul/i],
  ["Yield strength", /yield (?:strength|stress|point)/i], ["Hardness", /\bhardness\b/i], ["Toughness", /\btoughness\b/i],
  ["Thermal conductivity", /thermal conductivit/i], ["Phonon DOS", /phonon (?:density of states|DOS)|\bPDOS\b|\bVDOS\b/i],
  ["Melting point", /melting (?:point|temperature)/i], ["Glass transition", /glass transition/i],
  ["Diffusion coefficient", /diffusion coefficient|diffusivit/i], ["Radial distribution function", /radial distribution|\bRDF\b|pair distribution/i],
  ["Mean square displacement", /mean[- ]square(?:d)? displacement|\bMSD\b/i], ["Coefficient of friction", /coefficient of friction|friction coefficient/i],
  ["Potential energy", /potential energy/i], ["Density", /\bdensity\b(?! of states| functional)/i], ["Dislocation density", /dislocation density/i],
  ["Adsorption energy", /adsorption energy|binding energy/i], ["Interfacial / Kapitza resistance", /kapitza|interfacial (?:thermal )?resistance/i],
];

export const ANALYSIS = [
  ["Common neighbour analysis (CNA)", /common neighbou?r analysis|\bCNA\b/i], ["Dislocation extraction (DXA)", /dislocation extraction|\bDXA\b/i],
  ["Centrosymmetry parameter (CSP)", /centro-?symmetry|\bCSP\b/i], ["Atomic (virial) stress", /virial stress|atomic stress|per-atom stress/i],
  ["Von Mises strain / stress", /von mises/i], ["Coordination number", /coordination number/i], ["Wigner–Seitz defect analysis", /wigner[- –]seitz/i],
  ["Polyhedral template matching (PTM)", /polyhedral template|\bPTM\b/i], ["Voronoi analysis", /voronoi/i], ["Bond-angle distribution", /bond[- ]angle distribution/i],
];

export const TOOLS = [
  ["LAMMPS", /\bLAMMPS\b/], ["OVITO", /\bOVITO\b/i], ["VMD", /\bVMD\b/], ["Atomsk", /\bAtomsk\b/i], ["Packmol", /\bPackmol\b/i],
  ["Moltemplate", /\bMoltemplate\b/i], ["Materials Studio", /Materials Studio/i], ["GROMACS", /\bGROMACS\b/i], ["NAMD", /\bNAMD\b/],
  ["DL_POLY", /DL_?POLY/i], ["VESTA", /\bVESTA\b/], ["ASE", /atomic simulation environment|\bASE\b/], ["Nanotube Modeler", /nanotube modeler/i],
  ["Python", /\bPython\b/], ["MATLAB", /\bMATLAB\b/i],
];
