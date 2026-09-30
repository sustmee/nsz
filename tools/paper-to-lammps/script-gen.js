/* ==========================================================================
   Parameters → starter LAMMPS input script.

   buildScript(values, info) turns the (user-editable) parameter table into
   a commented in.lammps. Every value is tagged with where it came from:
     [paper]      found in the paper
     [typical]    a typical value suggested by the tool
     [TODO]       not in the paper — a default the student must check
   No DOM access, so this also runs in Node for testing.
   ========================================================================== */

import { MASSES, MATERIALS, POTENTIALS, THERMOSTATS, SIM_TYPES } from "./data.js";
import { parseSci } from "./extractor.js";

const LATTICE_STYLES = new Set(["fcc", "bcc", "hcp", "diamond", "sc", "zincblende", "b2"]);

/* ---------------------------------------------------------------------- */
/* Parsing helpers for user-editable values                                 */
/* ---------------------------------------------------------------------- */

function firstNumber(str) {
  const m = String(str || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?(?:\s*[eE]\s*[-+]?\d+)?/);
  return m ? parseFloat(m[0].replace(/\s/g, "")) : NaN;
}

/** "1 fs", "0.5 ps", "2 ns", "100 timesteps" → femtoseconds (or {steps}) */
function parseTime(str) {
  const s = String(str || "");
  const n = firstNumber(s);
  if (!isFinite(n)) return null;
  if (/step/i.test(s)) return { steps: n };
  if (/\bns\b|nanosec/i.test(s)) return { fs: n * 1e6 };
  if (/\bps\b|picosec/i.test(s)) return { fs: n * 1e3 };
  if (/\bfs\b|femtosec/i.test(s)) return { fs: n };
  return null;
}

function parsePressureBar(str) {
  const s = String(str || "");
  const n = firstNumber(s);
  if (!isFinite(n)) return null;
  if (/gpa/i.test(s)) return n * 1e4;
  if (/mpa/i.test(s)) return n * 10;
  if (/kbar/i.test(s)) return n * 1000;
  if (/atm/i.test(s)) return n * 1.01325;
  return n; // bar
}

function parseRate(str) {
  const s = String(str || "").replace(/\(check\)/, "").trim();
  if (!s) return NaN;
  const m = s.match(/^(.*?)\s*(?:s\^?-1|\/s|per second|ps\^?-1|\/ps)?\s*$/i);
  let v = parseSci(m ? m[1] : s);
  if (/ps\^?-1|\/ps/i.test(s)) v *= 1e12;
  return v;
}

function fmt(v, digits = 6) {
  if (!isFinite(v)) return "0";
  if (v !== 0 && (Math.abs(v) < 1e-4 || Math.abs(v) >= 1e7)) return v.toExponential(3).replace("e+", "e");
  return String(+v.toPrecision(digits));
}

function findMaterial(str) {
  if (!str) return null;
  return MATERIALS.find((m) => m.name.toLowerCase() === String(str).toLowerCase()) ||
    MATERIALS.find((m) => new RegExp(m.re.source, "i").test(str)) || null;
}

function findPotential(str) {
  if (!str) return null;
  return POTENTIALS.find((p) => p.name.toLowerCase() === String(str).toLowerCase()) ||
    POTENTIALS.find((p) => p.re.test(str)) || null;
}

function simTypeId(str) {
  const t = SIM_TYPES.find((x) => x.name.toLowerCase() === String(str || "").toLowerCase()) ||
    SIM_TYPES.find((x) => new RegExp(x.re.source, "i").test(str || ""));
  return t ? t.id : "";
}

function thermostatId(str) {
  const t = THERMOSTATS.find((x) => x.name.toLowerCase() === String(str || "").toLowerCase()) || THERMOSTATS.find((x) => x.re.test(str || ""));
  return t ? t.id : "";
}

function parseOrientation(list) {
  // list of strings like "x-[100]", "[1-10]"; returns {x:[1,0,0], ...} when all three are given
  const out = {};
  for (const item of list || []) {
    const m = String(item).match(/([xyz])\s*-?\s*[[<]\s*(-?\d)\s*(-?\d)\s*(-?\d)\s*[\]>]/i);
    if (m) out[m[1].toLowerCase()] = [m[2], m[3], m[4]].map(Number);
  }
  if (out.x && out.y && out.z) return out;
  return null;
}

function parseBox(str) {
  const s = String(str || "");
  if (!s) return null;
  const sides = {};
  for (const m of s.matchAll(/(length|width|height|thickness)\s*(\d+(?:\.\d+)?)\s*(nm|Å)/gi)) {
    sides[m[1].toLowerCase()] = parseFloat(m[2]) * (/nm/i.test(m[3]) ? 10 : 1);
  }
  if (Object.keys(sides).length) return { unit: "Å", dims: [sides.length, sides.width, sides.height].filter((v) => v != null) };
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (!nums.length) return null;
  if (/cell|lattice|a0/i.test(s)) return { unit: "cells", dims: nums };
  if (/nm/i.test(s)) return { unit: "Å", dims: nums.map((n) => n * 10) };
  return { unit: "Å", dims: nums };
}

/** LAMMPS input files should be plain ASCII (it warns about anything else). */
const ASCII_MAP = { "Å": "A", "—": "-", "–": "-", "→": "->", "×": "x", "•": "*", "κ": "kappa", "·": "*", "é": "e", "ü": "u", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "μ": "u", "σ": "sigma", "ε": "epsilon", "₂": "2", "³": "3", "≈": "~", "°": " deg" };
function toAscii(s) {
  return s.replace(/[^\x00-\x7f]/g, (c) => (c in ASCII_MAP ? ASCII_MAP[c] : ""));
}

/* ---------------------------------------------------------------------- */
/* Script builder                                                           */
/* ---------------------------------------------------------------------- */

/**
 * @param {Object<string,string>} v       parameter values keyed by id (strings as shown in the table)
 * @param {object} info                   { title, fileName, status: {id: 'found'|'suggested'|'missing'|'edited'}, orientations: [] }
 */
export function buildScript(v, info = {}) {
  const status = info.status || {};
  const tag = (id) => {
    const st = status[id];
    if (st === "found" || st === "edited") return "[paper]";
    if (st === "suggested") return "[typical]";
    return "[TODO]";
  };
  const has = (id) => v[id] != null && String(v[id]).trim() !== "";
  const L = [];
  const todo = [];
  const line = (s = "") => L.push(s);
  const section = (title) => {
    line("");
    line("# " + "=".repeat(70));
    line("# " + title);
    line("# " + "=".repeat(70));
  };
  const note = (s) => line("# " + s);
  const missing = (what, def) => {
    todo.push(`${what} (default used: ${def})`);
    return `[TODO: not in paper, default ${def}]`;
  };

  /* ---- Resolve the main choices ---- */
  const material = findMaterial(v.material);
  const potential = findPotential(v.potential);
  let elements = String(v.elements || "").split(/[\s,;]+/).filter((e) => MASSES[e]);
  if (!elements.length && material) elements = material.elements.slice();
  if (!elements.length) elements = ["X"];
  const ntypes = elements.length;

  const units = has("units") ? String(v.units).trim().toLowerCase() : potential ? potential.units : "metal";
  const real = units === "real";
  const tUnit = real ? "fs" : "ps";
  const toTime = (fs) => (real ? fs : fs / 1000);
  const pUnit = real ? "atm" : "bar";
  const toPress = (bar) => (real ? bar / 1.01325 : bar);

  const dtFs = (parseTime(v.timestep) || {}).fs || (real ? (potential && potential.id === "reaxff" ? 0.25 : 1) : 1);
  const dt = toTime(dtFs);
  const steps = (fs) => Math.max(1, Math.round(fs / dtFs));
  const T = firstNumber(v.temperature);
  const temp = isFinite(T) ? T : 300;
  const pBar = parsePressureBar(v.pressure);
  const press = toPress(pBar == null ? 0 : pBar);
  const td = parseTime(v.tdamp);
  const tdamp = td ? (td.steps ? td.steps * dt : toTime(td.fs)) : 100 * dt;
  const pd = parseTime(v.pdamp);
  const pdamp = pd ? (pd.steps ? pd.steps * dt : toTime(pd.fs)) : 1000 * dt;
  const ensembles = (String(v.ensemble || "").match(/NVT|NPT|NVE|NPH/gi) || []).map((e) => e.toUpperCase());
  const simType = simTypeId(v.simType);
  const thermo = thermostatId(v.thermostat);
  const boundary = has("boundary") && /^[pfsm]\s+[pfsm]\s+[pfsm]$/.test(String(v.boundary).trim())
    ? String(v.boundary).trim()
    : material && material.dim === "2D" ? "p p s" : material && material.dim === "1D" ? "s s p" : "p p p";
  const is2D = material && material.dim === "2D";
  // A flat sheet shrink-wrapped in z would get zero thickness; "m" keeps the initial vacuum.
  const boundaryCmd = is2D ? boundary.replace(/^(\S+\s+\S+\s+)s$/, "$1m") : boundary;
  const periodic = boundary.split(/\s+/).map((b) => b === "p");
  const structure = String(v.structure || (material && material.structure) || "").toLowerCase();
  const latticeA = firstNumber(v.lattice) || (material && material.a) || NaN;
  const outEvery = firstNumber(v.output) || 1000;
  const seed = 4928459;

  /* ---- Header ---- */
  line("# " + "=".repeat(70));
  note("Starter LAMMPS input script");
  if (info.title) note("Paper: " + String(info.title).slice(0, 110));
  if (info.fileName) note("File:  " + info.fileName);
  note("Generated by NSZ Toolkit — MD Paper → LAMMPS Input");
  note("");
  note("Tags:  [paper] = value found in the paper");
  note("       [typical] = typical value suggested by the tool (check it)");
  note("       [TODO] = NOT in the paper; a default was used — you must check it");
  note("Always compare this script with the paper's Methods section before running.");
  line("# " + "=".repeat(70));

  /* ---- 1. Initialization ---- */
  section("1. Initialization");
  line(`units           ${units}    # ${has("units") ? tag("units") : potential ? `[typical] usual for ${potential.name}` : missing("Units", "metal")}`);
  line("dimension       3");
  line(`boundary        ${boundaryCmd}    # ${has("boundary") ? tag("boundary") : missing("Boundary conditions", boundary)}${boundaryCmd !== boundary ? " ('m' = shrink-wrapped, keeps the vacuum)" : ""}`);
  const atomStyle = potential ? potential.atom_style : "atomic";
  line(`atom_style      ${atomStyle}`);
  if (potential && potential.molecular) {
    line("bond_style      harmonic      # TODO: match the force field");
    line("angle_style     harmonic      # TODO");
    line("dihedral_style  opls          # TODO");
  }

  /* ---- 2. Structure ---- */
  section("2. Structure / simulation box");
  if (has("material")) note(`Material: ${v.material}   ${tag("material")}`);
  if (has("box")) note(`Sample size in paper: ${v.box}   ${tag("box")}`);
  if (has("atoms")) note(`Number of atoms in paper: ${v.atoms}   ${tag("atoms")} — compare after building`);
  if (has("orientation")) note(`Orientation in paper: ${(info.orientations || [v.orientation]).join(", ")}   ${tag("orientation")}`);
  if (has("defects")) note(`Defects in paper: ${v.defects}   ${tag("defects")} — see the note at the end of this section`);
  const box = parseBox(v.box);
  const build = material && material.build;
  let builtInLammps = false;

  if ((is2D && material && build === "graphene") || (material && material.id === "graphene")) {
    // Orthogonal 4-atom graphene / h-BN cell, armchair along x, zigzag along y.
    const cc = (isFinite(latticeA) ? latticeA : 2.46) / Math.sqrt(3);
    const ax = 3 * cc;
    const ay = Math.sqrt(3) * cc;
    let nx = 20;
    let ny = 34;
    if (box && box.unit === "Å" && box.dims.length >= 2) {
      nx = Math.max(1, Math.round(box.dims[0] / ax));
      ny = Math.max(1, Math.round(box.dims[1] / ay));
    } else if (box && box.unit === "cells" && box.dims.length >= 2) {
      [nx, ny] = box.dims;
    }
    note(`Rectangular honeycomb cell: armchair along x (${fmt(ax, 4)} Å), zigzag along y (${fmt(ay, 4)} Å)`);
    note(`Bond length ${fmt(cc, 4)} Å from lattice constant ${fmt(cc * Math.sqrt(3), 4)} Å   ${tag("lattice")}`);
    line(`variable        nx equal ${nx}    # cells along x (armchair) ${box ? "→ from the paper's size" : missing("Sheet size", `${nx} × ${ny} cells`)}`);
    line(`variable        ny equal ${ny}    # cells along y (zigzag)`);
    line(`lattice         custom 1.0 a1 ${fmt(ax, 6)} 0.0 0.0 a2 0.0 ${fmt(ay, 6)} 0.0 a3 0.0 0.0 20.0 &`);
    line(`                basis 0.0 0.0 0.0 basis ${fmt(1 / 3, 6)} 0.0 0.0 basis 0.5 0.5 0.0 basis ${fmt(5 / 6, 6)} 0.5 0.0`);
    line(`region          box block 0 $(v_nx*${fmt(ax, 6)}) 0 $(v_ny*${fmt(ay, 6)}) -10.0 10.0 units box`);
    line(`create_box      ${ntypes} box`);
    if (ntypes >= 2) line(`create_atoms    1 box basis 1 1 basis 2 2 basis 3 1 basis 4 2    # alternating ${elements[0]}/${elements[1]}`);
    else line("create_atoms    1 box");
    builtInLammps = true;
  } else if (LATTICE_STYLES.has(structure) || (material && LATTICE_STYLES.has(material.structure))) {
    const st = LATTICE_STYLES.has(structure) ? structure : material.structure;
    const lstyle = st === "zincblende" ? "diamond" : st === "b2" ? "bcc" : st;
    const orient = parseOrientation(info.orientations);
    const orientStr = orient ? ` orient x ${orient.x.join(" ")} orient y ${orient.y.join(" ")} orient z ${orient.z.join(" ")}` : "";
    const aTxt = isFinite(latticeA) ? fmt(latticeA, 6) : "3.615";
    line(`lattice         ${lstyle} ${aTxt}${orientStr}    # a ${isFinite(latticeA) ? tag("lattice") : missing("Lattice constant", "3.615 Å")}${orient ? " — orientation " + tag("orientation") : ""}`);
    if (st === "hcp") note("LAMMPS 'hcp' assumes the ideal c/a = 1.633; use 'lattice custom' if the paper gives another c.");
    let region;
    if (box && box.unit === "cells") {
      const d = [...box.dims, box.dims[box.dims.length - 1], box.dims[box.dims.length - 1]].slice(0, 3);
      region = `region          box block 0 ${d[0]} 0 ${d[1]} 0 ${d[2]}    # in lattice units ${tag("box")}`;
    } else if (box && box.unit === "Å") {
      const d = [...box.dims, box.dims[box.dims.length - 1], box.dims[box.dims.length - 1]].slice(0, 3);
      region = `region          box block 0 ${fmt(d[0])} 0 ${fmt(d[1])} 0 ${fmt(d[2])} units box    # Å ${tag("box")}`;
    } else {
      region = `region          box block 0 20 0 20 0 20    # lattice units ${missing("Box size", "20 × 20 × 20 unit cells")}`;
    }
    line(region);
    line(`create_box      ${ntypes} box`);
    if (st === "zincblende" && ntypes >= 2) line(`create_atoms    1 box basis 5 2 basis 6 2 basis 7 2 basis 8 2    # zinc-blende: ${elements[0]} + ${elements[1]}`);
    else if (st === "b2" && ntypes >= 2) line(`create_atoms    1 box basis 2 2    # B2: ${elements[0]} + ${elements[1]}`);
    else line("create_atoms    1 box");
    if (material && material.alloy && ntypes > 1) {
      note("Random solid solution: give each element its share of the atoms (equiatomic example).");
      for (let i = 2; i <= ntypes; i++) line(`set             type 1 type/ratio ${i} ${fmt(1 / (ntypes - i + 2), 4)} ${seed + i}`);
    }
    builtInLammps = true;
  }

  if (!builtInLammps) {
    note("This structure is easiest to build outside LAMMPS, then read it in:");
    if (build === "cnt") {
      note(`  VMD → Extensions → Modeling → Nanotube Builder${has("chirality") ? ` (chirality ${v.chirality})` : " (set n, m and length)"},`);
      note("  then in the VMD Tk console:  topo writelammpsdata structure.data atomic");
    } else if (build === "tmd") {
      note("  Python + ASE:  from ase.build import mx2");
      note("                 s = mx2('MoS2', kind='2H', a=3.18, thickness=3.19, size=(NX, NY, 1), vacuum=10)");
      note("                 s.write('structure.data', format='lammps-data')");
    } else if (build === "packmol" || build === "polymer") {
      note("  Packmol (to pack molecules) + Moltemplate or LigParGen (for force-field parameters),");
      note("  or build the model in Materials Studio and export a LAMMPS data file.");
    } else if (material && /wurtzite/.test(material.structure)) {
      note(`  Atomsk:  atomsk --create wurtzite ${material.a} 5.185 ${elements.slice(0, 2).join(" ")} -orthogonal-cell -duplicate NX NY NZ structure.lmp`);
    } else {
      note("  Atomsk, ASE, VMD or Materials Studio can all export a LAMMPS data file.");
    }
    line("read_data       structure.data    # TODO: build this file first (see above)");
    todo.push("Structure file structure.data (build it with the tool suggested in section 2)");
  }
  line("");
  elements.forEach((e, i) => line(`mass            ${i + 1} ${MASSES[e] ? MASSES[e] : "1.0    # TODO"}    # ${e}`));
  if (has("defects")) {
    line("");
    note(`Defects from the paper (${v.defects}). Example for randomly removing atoms (vacancies):`);
    note(`  delete_atoms random fraction 0.01 yes all NULL ${seed}    # removes 1% of atoms`);
  }

  /* ---- 3. Potential ---- */
  section("3. Interatomic potential");
  if (has("potentialRef")) note(`Source in paper: ${v.potentialRef}   ${tag("potentialRef")}`);
  note("Potential files: LAMMPS 'potentials/' folder or the NIST repository https://www.ctcms.nist.gov/potentials/");
  const els = elements.join(" ");
  const looksLikeFile = (x) => /\.\w+$/.test(String(x).trim()) && !/\s/.test(String(x).trim());
  const refFile = has("potentialRef") && looksLikeFile(v.potentialRef) ? String(v.potentialRef).trim() : (info.potentialFiles || []).find(looksLikeFile) || null;
  if (!potential) {
    line(`pair_style      lj/cut 10.0    # ${missing("Interatomic potential", "Lennard-Jones")}`);
    for (let i = 1; i <= ntypes; i++) for (let j = i; j <= ntypes; j++) line(`pair_coeff      ${i} ${j} 0.0103 3.405    # TODO epsilon (energy) sigma (Å)`);
  } else if (potential.pairwise) {
    const rc = firstNumber(v.cutoff);
    const style = isFinite(rc) ? potential.pair_style.replace(/[\d.]+$/, fmt(rc)) : potential.pair_style;
    line(`pair_style      ${style}    # ${tag("potential")} ${potential.name}${isFinite(rc) ? `, cutoff ${tag("cutoff")}` : ""}`);
    for (let i = 1; i <= ntypes; i++) for (let j = i; j <= ntypes; j++) line(`pair_coeff      ${i} ${j} TODO TODO    # ${elements[i - 1]}-${elements[j - 1]}: parameters from the paper's table`);
    if (potential.kspace) line(`kspace_style    pppm 1.0e-5`);
  } else if (potential.molecular) {
    line(`pair_style      ${potential.pair_style}    # ${tag("potential")} ${potential.name}`);
    note("Force-field coefficients (pair, bond, angle, dihedral) are usually stored in the data file.");
    const acc = String(v.electrostatics || "").match(/accuracy\s*([\d.^× e-]+)/i);
    line(`kspace_style    pppm ${acc ? fmt(parseSci(acc[1])) : "1.0e-4"}    # ${has("electrostatics") ? tag("electrostatics") : missing("Long-range electrostatics", "PPPM 1e-4")}`);
    if (potential.id === "opls") line("special_bonds   lj/coul 0.0 0.0 0.5");
  } else {
    let file = refFile || potential.file.replace(/MATERIAL/g, elements.join(""));
    line(`pair_style      ${potential.pair_style}    # ${tag("potential")} ${potential.name}`);
    if (potential.noFile) line(`pair_coeff      * *`);
    else if (potential.meam) line(`pair_coeff      * * library.meam ${els} ${elements.join("")}.meam ${els}    # TODO: MEAM library + parameter files`);
    else line(`pair_coeff      * * ${file} ${els}    # ${refFile ? "file named in paper" : "TODO: download the right file"}`);
    if (potential.qeq) line(`fix             qeq all qeq/reaxff 1 0.0 10.0 1.0e-6 reaxff    # charge equilibration (needed for ReaxFF)`);
    if ((potential.id === "airebo" || potential.id === "rebo") && has("cutoff")) {
      note(`Paper modifies a cutoff to ${v.cutoff} ${tag("cutoff")}: for fracture studies this is usually the`);
      note(`C–C switching distance (rcmin_CC / rcmax_CC) inside ${file} — edit the file, not this script.`);
    } else if (has("cutoff")) {
      note(`Cutoff in paper: ${v.cutoff} ${tag("cutoff")} — it is defined inside the potential file for ${potential.name}.`);
    }
  }
  line("");
  line(`neighbor        2.0 bin`);
  line(`neigh_modify    every 1 delay 0 check yes`);

  /* ---- 4. Settings ---- */
  section("4. Settings");
  line(`timestep        ${fmt(dt)}    # = ${fmt(dtFs)} fs ${has("timestep") ? tag("timestep") : missing("Time step", `${fmt(dtFs)} fs`)}`);
  line(`variable        T equal ${fmt(temp)}    # K ${isFinite(T) ? tag("temperature") : missing("Temperature", "300 K")}`);
  if (has("temperatures")) note(`Paper also studies: ${v.temperatures} — run the script once per temperature (lmp -var T 600 …).`);
  line(`variable        P equal ${fmt(press)}    # ${pUnit} ${pBar != null && has("pressure") ? tag("pressure") : missing("Pressure", `0 ${pUnit}`)}`);
  line(`variable        Tdamp equal ${fmt(tdamp)}    # ${tUnit} ${td ? tag("tdamp") : missing("Thermostat damping", `100 × timestep`)}`);
  if (ensembles.includes("NPT") || ensembles.includes("NPH") || /tensile|compression/.test(simType)) line(`variable        Pdamp equal ${fmt(pdamp)}    # ${tUnit} ${pd ? tag("pdamp") : missing("Barostat damping", `1000 × timestep`)}`);
  line("");
  line(`thermo          ${Math.max(100, Math.round(outEvery))}`);
  line(`thermo_style    custom step temp press pe ke etotal lx ly lz pxx pyy pzz`);

  /* ---- Groups for fixed / thermostat layers ---- */
  const needsGroups = has("groups") || ["indentation", "cutting"].includes(simType);
  let mobile = "all";
  if (needsGroups) {
    section("5. Atom groups (fixed / thermostat layers)");
    if (has("groups")) note(`Paper: "${String(v.groups).slice(0, 100)}"   ${tag("groups")}`);
    note("TODO: set the thicknesses (Å) to match the paper.");
    line("region          fixedR block INF INF INF INF INF $(zlo+5.0) units box");
    line("region          thermoR block INF INF INF INF $(zlo+5.0) $(zlo+15.0) units box");
    line("group           fixed region fixedR");
    line("group           thermo region thermoR");
    line("group           mobile subtract all fixed");
    line("velocity        fixed set 0.0 0.0 0.0");
    line("fix             freeze fixed setforce 0.0 0.0 0.0");
    mobile = "mobile";
  }

  /* ---- Energy minimization ---- */
  section(`${needsGroups ? 6 : 5}. Energy minimization`);
  const minStyle = /steepest/i.test(v.minimization) ? "sd" : /fire/i.test(v.minimization) ? "fire" : "cg";
  const tolM = String(v.minimization || "").match(/tol\s*([^)]+)/i);
  const tol = tolM ? parseSci(tolM[1]) : NaN;
  if (!has("minimization")) note(`Not described in the paper — a short minimization is still good practice. ${missing("Energy minimization", "cg 1e-10")}`);
  line(`min_style       ${minStyle}    # ${has("minimization") ? tag("minimization") : "[TODO]"}`);
  line(`minimize        ${isFinite(tol) ? fmt(tol) : "1.0e-10"} 1.0e-10 10000 100000`);
  line("reset_timestep  0");

  /* ---- Thermostat helper ---- */
  const lateral = periodic.map((p, i) => (p ? ["x", "y", "z"][i] : null)).filter(Boolean);
  const pressArgs = (skip) => {
    const dims = lateral.filter((d) => d !== skip);
    if (!skip && dims.length === 3) return `iso \${P} \${P} \${Pdamp}`;
    return dims.map((d) => `${d} \${P} \${P} \${Pdamp}`).join(" ");
  };
  const integrate = (id, group, ensemble, skipDim, Tstart = "${T}", Tstop = "${T}") => {
    const npt = ensemble === "NPT";
    if (ensemble === "NVE") return [`fix             ${id} ${group} nve`];
    if (thermo === "berendsen") {
      const out = [`fix             ${id} ${group} nve`, `fix             ${id}_t ${group} temp/berendsen ${Tstart} ${Tstop} \${Tdamp}`];
      if (npt) out.push(`fix             ${id}_p ${group} press/berendsen ${pressArgs(skipDim).replace(/\$\{Pdamp\}/g, "${Pdamp}")}`);
      return out;
    }
    if (thermo === "langevin") {
      const out = [`fix             ${id} ${group} ${npt ? "nph " + pressArgs(skipDim) : "nve"}`, `fix             ${id}_t ${group} langevin ${Tstart} ${Tstop} \${Tdamp} ${seed}`];
      return out;
    }
    if (thermo === "rescale") return [`fix             ${id} ${group} nve`, `fix             ${id}_t ${group} temp/rescale 10 ${Tstart} ${Tstop} 1.0 1.0`];
    if (thermo === "csvr") return [`fix             ${id} ${group} nve`, `fix             ${id}_t ${group} temp/csvr ${Tstart} ${Tstop} \${Tdamp} ${seed}`];
    if (npt && lateral.length) return [`fix             ${id} ${group} npt temp ${Tstart} ${Tstop} \${Tdamp} ${pressArgs(skipDim)}`];
    return [`fix             ${id} ${group} nvt temp ${Tstart} ${Tstop} \${Tdamp}`];
  };
  const unfixAll = (lines) => lines.map((l) => l.split(/\s+/)[1]).forEach((id) => line(`unfix           ${id}`));

  /* ---- Equilibration ---- */
  let n = needsGroups ? 7 : 6;
  section(`${n++}. Equilibration`);
  const eqEns = ensembles[0] || (/tensile|compression/.test(simType) ? "NPT" : "NVT");
  const eqT = parseTime(v.equilTime);
  const eqSteps = eqT ? (eqT.steps || steps(eqT.fs)) : steps(100000);
  note(`Ensemble ${eqEns} ${ensembles.length ? tag("ensemble") : "[TODO]"}, thermostat ${has("thermostat") ? v.thermostat + " " + tag("thermostat") : "Nosé–Hoover [TODO]"}`);
  const vdist = /uniform/i.test(v.velocity) ? "uniform" : "gaussian";
  line(`velocity        ${mobile} create \${T} ${seed} mom yes rot yes dist ${vdist}    # ${has("velocity") ? tag("velocity") : "[TODO] distribution"}`);
  const eqFix = integrate("equil", mobile, eqEns, null);
  eqFix.forEach(line);
  line(`run             ${eqSteps}    # ${eqT ? `${v.equilTime} ${tag("equilTime")}` : missing("Equilibration time", "100 ps")}`);
  unfixAll(eqFix);
  line("reset_timestep  0");

  /* ---- Main stage ---- */
  section(`${n++}. ${SIM_TYPES.find((t) => t.id === simType)?.name || "Production run"}`);
  const prodEns = ensembles[1] || ensembles[0] || "NVT";
  const prodT = parseTime(v.prodTime);
  const dir = /\by\b|zigzag/i.test(v.direction) && !/armchair/i.test(v.direction) ? "y" : /\bz\b/i.test(v.direction) ? "z" : "x";

  if (simType === "tensile" || simType === "compression" || simType === "fracture" || simType === "bending") {
    const rate = parseRate(v.strainRate);
    const r = isFinite(rate) && rate > 0 ? rate : 1e9;
    const sign = simType === "compression" ? "-" : "";
    const perTime = real ? r * 1e-15 : r * 1e-12;
    const maxStrain = firstNumber(v.maxStrain);
    const eMax = isFinite(maxStrain) && maxStrain > 0 ? (/%/.test(v.maxStrain) ? maxStrain / 100 : maxStrain) : 0.3;
    const nSteps = Math.round(eMax / (r * dtFs * 1e-15));
    note(`Loading direction: ${dir} ${has("direction") ? tag("direction") + " (" + v.direction + ")" : "[TODO]"}`);
    line(`variable        srate equal ${fmt(r)}    # 1/s ${isFinite(rate) ? tag("strainRate") : missing("Strain rate", "1e9 /s")}`);
    line(`variable        srate1 equal "${sign}v_srate * ${real ? "1.0e-15" : "1.0e-12"}"    # → 1/${tUnit} = ${fmt(perTime)}`);
    line(`variable        L0 equal l${dir}`);
    line(`variable        L0v equal \${L0}`);
    line(`fix             defo all deform 1 ${dir} erate \${srate1} units box remap x`);
    const f = integrate("load", mobile, prodEns === "NVE" ? "NVE" : prodEns, dir);
    f.forEach(line);
    const toGPa = real ? "*0.000101325" : "/10000";
    const thick = is2D ? (material.id === "graphene" || material.id === "hbn" ? 3.35 : 6.15) : null;
    line(`variable        strain equal "(l${dir} - v_L0v)/v_L0v"`);
    if (is2D) {
      note(`2D sheet: rescale the stress from the box height (lz) to the sheet thickness (${thick} Å is typical).`);
      line(`variable        stress equal "-p${dir}${dir}${toGPa}*lz/${thick}"    # GPa`);
    } else {
      line(`variable        stress equal "-p${dir}${dir}${toGPa}"    # GPa`);
    }
    line(`fix             ss all print ${Math.max(10, Math.round(outEvery / 10))} "\${strain} \${stress}" file stress_strain.txt screen no title "# strain stress(GPa)"`);
    line(`compute         peratom all stress/atom NULL`);
    line(`dump            1 all custom ${outEvery} dump.deform.lammpstrj id type x y z c_peratom[1] c_peratom[2] c_peratom[3]`);
    line(`run             ${nSteps}    # strain ${fmt(eMax)} at this rate ${isFinite(maxStrain) ? tag("maxStrain") : missing("Maximum strain", "0.3")}`);
  } else if (simType === "shear") {
    const rate = parseRate(v.strainRate);
    const r = isFinite(rate) && rate > 0 ? rate : 1e9;
    line(`change_box      all triclinic`);
    line(`variable        srate1 equal ${fmt(real ? r * 1e-15 : r * 1e-12)}    # shear rate 1/${tUnit} ${isFinite(rate) ? tag("strainRate") : "[TODO]"}`);
    line(`fix             defo all deform 1 xy erate \${srate1} remap v`);
    integrate("load", mobile, prodEns, null).forEach(line);
    line(`variable        gamma equal "xy/ly"`);
    line(`variable        tau equal "-pxy${real ? "*0.000101325" : "/10000"}"    # GPa`);
    line(`fix             ss all print 100 "\${gamma} \${tau}" file shear_stress_strain.txt screen no`);
    line(`dump            1 all custom ${outEvery} dump.shear.lammpstrj id type x y z`);
    line(`run             ${Math.round(0.3 / (r * dtFs * 1e-15))}    # shear strain 0.3 [TODO]`);
  } else if (simType === "indentation") {
    const R = firstNumber(v.indenter);
    const Ra = isFinite(R) ? R * (/nm/.test(v.indenter) ? 10 : 1) : 30;
    const vel = firstNumber(v.velocityLoad);
    let velA = isFinite(vel) ? vel : 0.2; // Å/ps
    if (isFinite(vel) && /m\/s/.test(v.velocityLoad)) velA = vel / 100;
    if (isFinite(vel) && /nm\/ps/.test(v.velocityLoad)) velA = vel * 10;
    const depth = firstNumber(v.depth);
    const depthA = isFinite(depth) ? depth * (/nm/.test(v.depth) ? 10 : 1) : 20;
    const velTime = real ? velA / 1000 : velA; // per time unit
    const travel = depthA + 5;
    note(`Spherical indenter R = ${fmt(Ra)} Å ${isFinite(R) ? tag("indenter") : "[TODO]"}, speed ${fmt(velA)} Å/ps ${isFinite(vel) ? tag("velocityLoad") : "[TODO]"}, depth ${fmt(depthA)} Å ${isFinite(depth) ? tag("depth") : "[TODO]"}`);
    line(`variable        R equal ${fmt(Ra)}`);
    line(`variable        vind equal ${fmt(velTime)}    # Å/${tUnit}`);
    line(`variable        z0 equal $(zhi+v_R+5.0)`);
    line(`variable        zind equal "v_z0 - v_vind*elapsed*dt"`);
    line(`fix             ind all indent 10.0 sphere $((xlo+xhi)/2) $((ylo+yhi)/2) v_zind \${R} units box`);
    line(`fix_modify      ind energy yes`);
    line(`fix             nve_mobile mobile nve`);
    line(`fix             tstat thermo ${thermo === "berendsen" ? "temp/berendsen" : "langevin"} \${T} \${T} \${Tdamp}${thermo === "berendsen" ? "" : ` ${seed}`}    # thermostat layer only`);
    line(`variable        ztop equal $(zhi)`);
    line(`variable        depth equal "v_ztop - v_zind + v_R"    # < 0 before contact`);
    line(`variable        force equal "f_ind[3]"`);
    line(`fix             fd all print 100 "\${depth} \${force}" file load_depth.txt screen no title "# depth(Å) force(${real ? "kcal/mol/Å" : "eV/Å"})"`);
    line(`dump            1 all custom ${outEvery} dump.indent.lammpstrj id type x y z`);
    line(`run             ${Math.round((travel + 5) / velA / (dtFs / 1000))}    # moves ${fmt(travel + 5)} Å`);
  } else if (simType === "thermal") {
    const method = String(v.tcMethod || "");
    if (/green|kubo|emd/i.test(method) || !method) {
      note(`Green–Kubo (EMD) method ${has("tcMethod") ? tag("tcMethod") : "[TODO] method not found — Green–Kubo shown"}`);
      const corr = parseTime(v.correlation);
      const s = 10;
      const p = corr && corr.fs ? Math.max(10, Math.round(corr.fs / dtFs / s)) : 2000;
      line(`variable        s equal ${s}      # sample interval`);
      line(`variable        p equal ${p}    # correlation length → ${fmt((p * s * dtFs) / 1000)} ps ${corr ? tag("correlation") : "[TODO]"}`);
      line(`variable        d equal $p*$s    # dump interval`);
      if (real) {
        line(`variable        kB equal 1.3806504e-23    # J/K`);
        line(`variable        kCal2J equal 4186.0/6.02214e23`);
        line(`variable        A2m equal 1.0e-10`);
        line(`variable        fs2s equal 1.0e-15`);
        line(`variable        convert equal \${kCal2J}*\${kCal2J}/\${fs2s}/\${A2m}`);
      } else {
        line(`variable        kB equal 1.3806504e-23    # J/K`);
        line(`variable        ev2J equal 1.60210e-19`);
        line(`variable        A2m equal 1.0e-10`);
        line(`variable        ps2s equal 1.0e-12`);
        line(`variable        convert equal \${ev2J}*\${ev2J}/\${ps2s}/\${A2m}`);
      }
      line(`fix             nve all nve`);
      line(`compute         myKE all ke/atom`);
      line(`compute         myPE all pe/atom`);
      line(`compute         myStress all stress/atom NULL virial`);
      line(`compute         flux all heat/flux myKE myPE myStress`);
      line(`variable        Jx equal c_flux[1]/vol`);
      line(`variable        Jy equal c_flux[2]/vol`);
      line(`variable        Jz equal c_flux[3]/vol`);
      line(`fix             JJ all ave/correlate $s $p $d c_flux[1] c_flux[2] c_flux[3] type auto file J0Jt.dat ave running`);
      line(`variable        V equal vol`);
      line(`variable        scale equal \${convert}/\${kB}/\${T}/\${T}/\${V}*$s*${fmt(dt)}`);
      line(`variable        k11 equal trap(f_JJ[3])*\${scale}`);
      line(`variable        k22 equal trap(f_JJ[4])*\${scale}`);
      line(`variable        k33 equal trap(f_JJ[5])*\${scale}`);
      line(`thermo          $d`);
      line(`thermo_style    custom step temp v_Jx v_Jy v_Jz v_k11 v_k22 v_k33`);
      const total = prodT ? prodT.steps || steps(prodT.fs) : steps(2e6);
      line(`run             ${Math.max(1, Math.round(total / (p * s))) * p * s}    # ${prodT ? v.prodTime + " " + tag("prodTime") : missing("Production time", "2 ns")} (a multiple of $d)`);
      line(`variable        k equal (v_k11+v_k22+v_k33)/3.0`);
      line(`print           "Average thermal conductivity: $k W/mK"`);
    } else {
      note(`Müller-Plathe / NEMD method ${tag("tcMethod")}`);
      line(`fix             nve all nve`);
      line(`fix             mp all thermal/conductivity 10 ${dir} 20`);
      line(`compute         ke all ke/atom`);
      line(`variable        temp atom c_ke/1.5/8.617333e-5    # K (metal units)`);
      line(`compute         layers all chunk/atom bin/1d ${dir} lower 0.05 units reduced`);
      line(`fix             profile all ave/chunk 10 100 1000 layers v_temp file temp_profile.txt`);
      line(`thermo_style    custom step temp f_mp`);
      line(`run             ${prodT ? prodT.steps || steps(prodT.fs) : steps(1e6)}    # ${prodT ? tag("prodTime") : missing("Production time", "1 ns")}`);
      note("κ = (total energy swapped f_mp / (2 · time · area)) / (temperature gradient from temp_profile.txt)");
    }
  } else if (simType === "melting") {
    const hr = firstNumber(v.heatingRate);
    const temps = String(v.temperatures || "").match(/\d+(?:\.\d+)?/g);
    const T2 = temps && temps.length > 1 ? Number(temps[temps.length - 1]) : temp + 1500;
    const rateKps = isFinite(hr) ? hr : 1.0;
    const time = ((T2 - temp) / rateKps) * 1000; // fs
    line(`variable        T2 equal ${fmt(T2)}    # final temperature ${temps && temps.length > 1 ? tag("temperatures") : "[TODO]"}`);
    integrate("heat", "all", prodEns === "NVE" ? "NPT" : prodEns, null, "${T}", "${T2}").forEach(line);
    line(`dump            1 all custom ${outEvery} dump.heat.lammpstrj id type x y z`);
    line(`run             ${steps(time)}    # heating rate ${fmt(rateKps)} K/ps ${isFinite(hr) ? tag("heatingRate") : "[TODO]"}`);
  } else if (simType === "diffusion") {
    integrate("prod", "all", prodEns, null).forEach(line);
    line(`compute         msd all msd com yes`);
    line(`fix             msdout all ave/time 100 1 100 c_msd[4] file msd.txt`);
    line(`run             ${prodT ? prodT.steps || steps(prodT.fs) : steps(1e6)}    # ${prodT ? tag("prodTime") : missing("Production time", "1 ns")}`);
    note("Diffusion coefficient D = slope(MSD vs time) / 6 (in 3D).");
  } else if (simType === "irradiation") {
    const E = firstNumber(v.pka);
    const Eev = isFinite(E) ? E * (/kev/i.test(v.pka) ? 1000 : 1) : 1000;
    line(`variable        Epka equal ${fmt(Eev)}    # eV ${isFinite(E) ? tag("pka") : "[TODO]"}`);
    line(`variable        mpka equal ${MASSES[elements[0]] || 1}    # amu (${elements[0]})`);
    line(`variable        vpka equal sqrt(2*\${Epka}*1.602177e-19/(\${mpka}*1.660539e-27))/100    # Å/ps`);
    line(`group           pka id 1    # TODO: pick the knock-on atom near the box centre`);
    line(`velocity        pka set 0.0 0.0 -\${vpka} units box    # TODO direction`);
    line(`fix             nve all nve`);
    line(`fix             dtr all dt/reset 1 NULL 0.001 0.05 units box    # adaptive timestep for fast atoms`);
    line(`dump            1 all custom ${outEvery} dump.cascade.lammpstrj id type x y z`);
    line(`run             ${steps(10000)}`);
  } else {
    integrate("prod", mobile, prodEns, null).forEach(line);
    line(`dump            1 all custom ${outEvery} dump.prod.lammpstrj id type x y z`);
    line(`run             ${prodT ? prodT.steps || steps(prodT.fs) : steps(1e6)}    # ${prodT ? v.prodTime + " " + tag("prodTime") : missing("Production time", "1 ns")}`);
  }

  section(`${n}. Save the final state`);
  line("write_data      final.data");

  const header = [];
  if (todo.length) {
    header.push("# " + "-".repeat(70));
    header.push("# CHECK THESE — not found in the paper, defaults were used:");
    todo.forEach((t) => header.push("#   • " + t));
    header.push("# " + "-".repeat(70));
  }
  const firstBlockEnd = L.findIndex((l, i) => i > 0 && /^# =+$/.test(l));
  L.splice(firstBlockEnd + 1, 0, ...header);
  return { script: toAscii(L.join("\n") + "\n"), todo };
}
