/* ==========================================================================
   MD paper → simulation parameters (rule-based, runs in the browser)

   extractParameters(text) takes the paper's text (Markdown from the PDF
   reader, optionally with <!-- Page N --> markers) and returns every
   parameter it can find, each with the sentence(s) it came from.
   No DOM access here, so this file also runs in Node for testing.
   ========================================================================== */

import {
  MASSES, ELEMENT_NAMES, MATERIALS, POTENTIALS, THERMOSTATS, BAROSTATS,
  SIM_TYPES, PROPERTIES, ANALYSIS, TOOLS,
} from "./data.js";

/* ---------------------------------------------------------------------- */
/* Text preparation                                                         */
/* ---------------------------------------------------------------------- */

const SUPERSCRIPTS = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+" };
const SUBSCRIPTS = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };

export function normalize(s) {
  return s
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+/g, (m) => "^" + [...m].map((c) => SUPERSCRIPTS[c]).join(""))
    .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (c) => SUBSCRIPTS[c])
    .replace(/˚A|A˚|Å|Å|Ǻ/g, "Å")
    .replace(/[−‒–—‐‑]/g, "-")
    .replace(/[     ]/g, " ")
    .replace(/×/g, "×")
    .replace(/\s*×\s*/g, " × ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/°\s*C\b/g, "°C")
    .replace(/[ \t]+/g, " ");
}

function stripMarkdown(md) {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^\|?\s*-{3,}.*$/gm, "")
    .replace(/\*\*/g, "")
    .replace(/\\\*/g, "\u0001")
    .replace(/\*/g, "")
    .replace(/\u0001/g, "*")
    .replace(/\\([\\`_<#>+\-.!|[\]()])/g, "$1")
    .replace(/<sup>(.*?)<\/sup>/g, "^$1")
    .replace(/<\/?(?:sub|sup|br)\s*\/?>/g, "");
}

const ABBREVIATIONS = /\b(et al|Figs?|Eqs?|Refs?|Tab|Sec|Vol|No|vs|approx|ca|cf|resp|i\.e|e\.g|viz|min|max|Ch|Chap|Suppl)\./gi;
const METHODS_HEAD = /method|simulation|computational|model(?:l)?ing|numerical|molecular dynamics|md detail|set-?up|procedure|approach|potential|force field|details/i;
const NOT_METHODS_HEAD = /result|discussion|conclusion|introduction|acknowledg|reference|abstract/i;
const STOP_HEAD = /^(?:references?|bibliography|acknowledge?ments?|author contributions|conflicts? of interest|declaration|data availability|funding)\b/i;

/** Splits text into sentences that know their page and section. */
export function prepare(raw) {
  const text = normalize(stripMarkdown(raw.replace(/\r/g, "")));
  const lines = text.split("\n");
  const sentences = [];
  let page = 1;
  let section = "";
  let sectionKind = "front";
  let title = "";
  let hasMethods = false;
  let buffer = [];

  const flush = () => {
    const para = buffer.join(" ").replace(/\s+/g, " ").trim();
    buffer = [];
    if (!para) return;
    const protectedPara = para.replace(ABBREVIATIONS, (m) => m.replace(/\./g, "\u0002"));
    for (let s of protectedPara.split(/(?<=[.!?])\s+(?=[A-Z0-9(\["])/)) {
      s = s.replace(/\u0002/g, ".").trim();
      if (s.length > 2) sentences.push({ text: s, page, section, kind: sectionKind });
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const pm = line.match(/^<!--\s*Page\s+(\d+)\s*-->$/i);
    if (pm) {
      flush();
      page = Number(pm[1]);
      continue;
    }
    const hm = line.match(/^#{1,6}\s+(.*)$/);
    const plainHeading = !hm && /^(?:\d+(?:\.\d+)*\.?\s+|[IVX]+\.\s+)?(?:references|bibliography|acknowledge?ments?)$/i.test(line);
    if (hm || plainHeading) {
      flush();
      const h = (hm ? hm[1] : line).trim();
      const bare = h.replace(/^(?:\d+(?:\.\d+)*\.?|[IVX]+\.)\s*/, "");
      if (STOP_HEAD.test(bare)) break; // ignore reference list and back matter
      if (!title && hm && hm[0].startsWith("# ")) title = h;
      section = h;
      if (METHODS_HEAD.test(bare) && !NOT_METHODS_HEAD.test(bare)) {
        sectionKind = "methods";
        hasMethods = true;
      } else if (/introduction|background|literature/i.test(bare)) sectionKind = "intro";
      else if (/abstract/i.test(bare)) sectionKind = "abstract";
      else if (/result|discussion/i.test(bare)) sectionKind = "results";
      else if (/conclusion|summary/i.test(bare)) sectionKind = "conclusion";
      else if (/^\d/.test(h) || /^[IVX]+\./.test(h)) sectionKind = "other";
      // un-numbered sub-headings keep the parent section's kind
      continue;
    }
    if (!line) {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();
  if (!title) {
    const first = sentences.find((s) => s.text.length > 20 && s.text.length < 220);
    title = first ? first.text : "";
  }
  return { sentences, title, hasMethods };
}

/* ---------------------------------------------------------------------- */
/* Scoring helpers                                                          */
/* ---------------------------------------------------------------------- */

const KIND_WEIGHT = { methods: 3, abstract: 1.2, front: 1, other: 1.2, results: 0.9, conclusion: 0.8, intro: 0.35 };

function weight(s, hasMethods) {
  let w = KIND_WEIGHT[s.kind] ?? 1;
  if (!hasMethods && s.kind !== "intro") w = Math.max(w, 1.5);
  // Sentences that cite other work ("Smith et al. used …") describe someone else's setup.
  if (/\bet al\.|\[\d+(?:[,–-]\s*\d+)*\]|previous (?:stud|work)|reported (?:by|in)|in (?:the )?literature/i.test(s.text)) w *= 0.6;
  if (/\b(?:we|our|this (?:work|study|paper)|present (?:work|study)|in this)\b/i.test(s.text)) w *= 1.3;
  return w;
}

function proximity(text, keyRe, index) {
  if (!keyRe) return 0;
  const re = new RegExp(keyRe.source, keyRe.flags.includes("g") ? keyRe.flags : keyRe.flags + "g");
  let best = Infinity;
  for (const m of text.matchAll(re)) best = Math.min(best, Math.abs(m.index - index));
  return best < 45 ? 1.5 : best < 110 ? 0.6 : 0;
}

class Candidates {
  constructor() {
    this.map = new Map();
  }
  add(display, value, unit, sentence, score, match) {
    const key = String(display).toLowerCase();
    let c = this.map.get(key);
    if (!c) this.map.set(key, (c = { display: String(display), value, unit, score: 0, evidence: [] }));
    c.score += score;
    if (!c.evidence.some((e) => e.text === sentence.text)) {
      c.evidence.push({ text: sentence.text, page: sentence.page, section: sentence.section, match });
    }
  }
  list() {
    return [...this.map.values()].sort((a, b) => b.score - a.score);
  }
}

function numberFrom(str) {
  return parseFloat(String(str).replace(/,/g, ""));
}

/** Parses 1 × 10^9, 1×10 9, 10^-3, 1e9, 1.0E+10, 10-10 … Returns a number or NaN. */
export function parseSci(str) {
  const s = String(str).replace(/\s+/g, " ").trim();
  let m = s.match(/^(\d+(?:\.\d+)?)\s*[×x*·]\s*10\s*\^?\s*\(?\s*([-+]?\s*\d{1,3})\s*\)?$/i);
  if (m) return parseFloat(m[1]) * Math.pow(10, parseInt(m[2].replace(/\s/g, ""), 10));
  m = s.match(/^10\s*\^\s*\(?\s*([-+]?\s*\d{1,3})\s*\)?$/) || s.match(/^10\s+([-+]?\d{1,2})$/) || s.match(/^10(-\d{1,2})$/);
  if (m) return Math.pow(10, parseInt(m[1].replace(/\s/g, ""), 10));
  m = s.match(/^(\d+(?:\.\d+)?)\s*[eE]\s*([-+]?\d+)$/);
  if (m) return parseFloat(m[1]) * Math.pow(10, parseInt(m[2], 10));
  return parseFloat(s);
}

export function formatSci(v) {
  if (!isFinite(v)) return "";
  if (v === 0) return "0";
  const e = Math.floor(Math.log10(Math.abs(v)));
  if (e >= -3 && e <= 5) return String(+v.toPrecision(4));
  const m = +(v / Math.pow(10, e)).toPrecision(3);
  return (m === 1 ? "" : m + " × ") + "10^" + e;
}

const SCI = String.raw`(?:\d+(?:\.\d+)?\s*[×x*·]\s*10\s*\^?\s*\(?\s*[-+]?\s*\d{1,2}\)?|10\s*\^\s*\(?[-+]?\s*\d{1,2}\)?|\d+(?:\.\d+)?\s*[eE]\s*[-+]?\d+|10\s+-?\d{1,2}(?=\s*(?:\/|s|ps|fs))|\d+(?:\.\d+)?)`;
const NUM = String.raw`(\d+(?:\.\d+)?)`;

/* ---------------------------------------------------------------------- */
/* Individual extractors                                                    */
/* ---------------------------------------------------------------------- */

function scan(ctx, { key, value, requireKey = true, exclude, build }) {
  const cands = new Candidates();
  for (const s of ctx.sentences) {
    if (requireKey && key && !key.test(s.text)) continue;
    if (exclude && exclude.test(s.text)) continue;
    const re = new RegExp(value.source, value.flags.includes("g") ? value.flags : value.flags + "g");
    for (const m of s.text.matchAll(re)) {
      const v = build(m, s);
      if (!v) continue;
      const score = weight(s, ctx.hasMethods) * (1 + proximity(s.text, key, m.index));
      cands.add(v.display, v.value, v.unit, s, score, m[0]);
    }
  }
  return cands.list();
}

function scanKeywords(ctx, list) {
  const cands = new Candidates();
  for (const s of ctx.sentences) {
    for (const item of list) {
      const re = item.re;
      const m = s.text.match(re);
      if (m) cands.add(item.name, item.id, "", s, weight(s, ctx.hasMethods), m[0]);
    }
  }
  return cands.list();
}

function mentions(ctx, pairs) {
  const found = [];
  for (const [name, re] of pairs) {
    const hit = ctx.sentences.filter((s) => re.test(s.text));
    if (hit.length) found.push({ display: name, value: name, unit: "", score: hit.length, evidence: hit.slice(0, 3).map((s) => ({ text: s.text, page: s.page, section: s.section, match: (s.text.match(re) || [""])[0] })) });
  }
  return found;
}

const TIME_UNITS = { fs: 1, femtosecond: 1, femtoseconds: 1, ps: 1e3, picosecond: 1e3, picoseconds: 1e3, ns: 1e6, nanosecond: 1e6, nanoseconds: 1e6 };

function timeToFs(v, unit) {
  return v * (TIME_UNITS[unit.toLowerCase()] || NaN);
}

function prettyTime(fs) {
  if (fs >= 1e6) return { display: `${+(fs / 1e6).toPrecision(4)} ns`, unit: "ns", value: fs / 1e6 };
  if (fs >= 1e3) return { display: `${+(fs / 1e3).toPrecision(4)} ps`, unit: "ps", value: fs / 1e3 };
  return { display: `${+fs.toPrecision(4)} fs`, unit: "fs", value: fs };
}

function extractTimestep(ctx) {
  return scan(ctx, {
    key: /time[- ]?step|integration step|timestep/i,
    value: /(\d+(?:\.\d+)?)\s*(fs|femtoseconds?|ps|picoseconds?)\b/i,
    build: (m) => {
      const fs = timeToFs(parseFloat(m[1]), m[2]);
      if (!(fs >= 0.01 && fs <= 20)) return null;
      return { display: `${+fs.toPrecision(4)} fs`, value: fs, unit: "fs" };
    },
  });
}

function extractTemperature(ctx) {
  const key = /temperat|thermostat|equilibrat|heated|cooled|\bNVT\b|\bNPT\b|room|kelvin|maintained|kept at/i;
  const cands = scan(ctx, {
    key,
    requireKey: false,
    value: /(-?\d+(?:\.\d+)?)\s*(K|°C)\b(?!\s*(?:\/|per|ps|min|s-1))/,
    exclude: /heating rate|cooling rate|quench(?:ing)? rate/i,
    build: (m) => {
      let t = parseFloat(m[1]);
      if (m[2] === "°C") t += 273.15;
      if (!(t > 0 && t < 20000)) return null;
      return { display: `${+t.toFixed(2)} K`, value: t, unit: "K" };
    },
  });
  // "room temperature" = 300 K (a weak hint unless nothing else is found)
  const room = ctx.sentences.filter((s) => /room temperature|ambient temperature/i.test(s.text));
  if (room.length) {
    const existing = cands.find((c) => c.value === 300);
    if (existing) existing.score += 0.5;
    else cands.push({ display: "300 K", value: 300, unit: "K", score: 0.4, evidence: room.slice(0, 2).map((s) => ({ text: s.text, page: s.page, section: s.section, match: "room temperature" })) });
  }
  return cands.sort((a, b) => b.score - a.score);
}

function extractTemperatureList(ctx) {
  const set = new Map();
  const add = (t, s) => {
    if (!(t > 0 && t < 20000)) return;
    const k = Math.round(t * 100) / 100;
    if (!set.has(k)) set.set(k, s);
  };
  for (const s of ctx.sentences) {
    if (s.kind === "intro" || /heating rate|cooling rate/i.test(s.text)) continue;
    // Lists and ranges: "300, 600, 900 and 1200 K", "from 300 to 1500 K", "300-900 K"
    for (const m of s.text.matchAll(/((?:\d+(?:\.\d+)?\s*K?\s*,\s*)+\d+(?:\.\d+)?\s*K?\s*,?\s*(?:and|or)\s*\d+(?:\.\d+)?)\s*K\b/g)) {
      m[1].match(/\d+(?:\.\d+)?/g).forEach((n) => add(parseFloat(n), s));
    }
    for (const m of s.text.matchAll(/(?:from|between)?\s*(\d+(?:\.\d+)?)\s*K?\s*(?:-|to|and)\s*(\d+(?:\.\d+)?)\s*K\b/g)) {
      add(parseFloat(m[1]), s);
      add(parseFloat(m[2]), s);
    }
  }
  if (set.size < 2) return [];
  const temps = [...set.keys()].sort((a, b) => a - b);
  const ev = [...new Set(set.values())].slice(0, 3).map((s) => ({ text: s.text, page: s.page, section: s.section, match: "" }));
  return [{ display: temps.map((t) => `${t} K`).join(", "), value: temps, unit: "K", score: 1, evidence: ev }];
}

const PRESSURE_UNITS = { bar: 1, bars: 1, kbar: 1000, atm: 1.01325, gpa: 10000, mpa: 10, pa: 1e-5 };

function extractPressure(ctx) {
  const cands = scan(ctx, {
    key: /pressure|barostat|\bNPT\b|isobaric|stress[- ]free/i,
    value: /(-?\d+(?:\.\d+)?)\s*(bar|bars|kbar|atm|GPa|MPa|Pa)\b/,
    exclude: /strength|modul|stress[- ]strain|yield|ultimate|hardness|peak stress/i,
    build: (m) => {
      const bar = parseFloat(m[1]) * PRESSURE_UNITS[m[2].toLowerCase()];
      if (!isFinite(bar)) return null;
      return { display: `${+parseFloat(m[1]).toPrecision(5)} ${m[2]}`, value: bar, unit: "bar" };
    },
  });
  const zero = ctx.sentences.filter((s) => /zero (?:external )?pressure|stress[- ]free|pressure[- ]free|(?:pressure|stress) of zero|0 pressure/i.test(s.text));
  if (zero.length) cands.push({ display: "0 bar", value: 0, unit: "bar", score: zero.reduce((a, s) => a + weight(s, ctx.hasMethods), 0), evidence: zero.slice(0, 2).map((s) => ({ text: s.text, page: s.page, section: s.section, match: "zero pressure" })) });
  const atm = ctx.sentences.filter((s) => /atmospheric pressure|ambient pressure/i.test(s.text));
  if (atm.length && !cands.length) cands.push({ display: "1 atm", value: 1.01325, unit: "bar", score: 0.5, evidence: atm.slice(0, 2).map((s) => ({ text: s.text, page: s.page, section: s.section, match: "atmospheric pressure" })) });
  return cands.sort((a, b) => b.score - a.score);
}

function extractDamping(ctx, kind) {
  const key = kind === "barostat" ? /barostat|pressure (?:damping|relaxation|coupling)|Pdamp/i : /thermostat|temperature (?:damping|relaxation|coupling)|Tdamp/i;
  const other = kind === "barostat" ? /thermostat|temperature damping|Tdamp/i : /barostat|pressure damping|Pdamp/i;
  // "The damping parameters for the thermostat and barostat were 0.1 ps and 1 ps, respectively."
  const cands = new Candidates();
  for (const s of ctx.sentences) {
    if (!/respectively/i.test(s.text) || !/thermostat|Tdamp/i.test(s.text) || !/barostat|Pdamp/i.test(s.text)) continue;
    const vals = [...s.text.matchAll(/(\d+(?:\.\d+)?)\s*(fs|ps)\b/gi)];
    if (vals.length < 2) continue;
    const thermoFirst = s.text.search(/thermostat|Tdamp/i) < s.text.search(/barostat|Pdamp/i);
    const m = vals[(kind === "barostat") === thermoFirst ? 1 : 0];
    const fs = timeToFs(parseFloat(m[1]), m[2]);
    cands.add(`${m[1]} ${m[2]}`, fs, "fs", s, weight(s, ctx.hasMethods) * 3, m[0]);
  }
  if (cands.map.size) return cands.list();
  return scan(ctx, {
    key: /damping|relaxation time|coupling (?:time|constant)|relaxation constant|Tdamp|Pdamp|time constant/i,
    value: /(\d+(?:\.\d+)?)\s*(fs|ps|femtoseconds?|picoseconds?|time ?steps)\b/i,
    build: (m, s) => {
      const hasKey = key.test(s.text);
      const hasOther = other.test(s.text);
      if (!hasKey && hasOther) return null;
      const u = m[2].toLowerCase();
      if (u.startsWith("time")) return { display: `${m[1]} timesteps`, value: parseFloat(m[1]), unit: "steps" };
      const fs = timeToFs(parseFloat(m[1]), u);
      if (!(fs > 0 && fs < 1e6)) return null;
      const short = { femtosecond: "fs", femtoseconds: "fs", picosecond: "ps", picoseconds: "ps" }[u] || u;
      return { display: `${m[1]} ${short}`, value: fs, unit: "fs" };
    },
  });
}

function extractDuration(ctx, which) {
  const equilRe = /equilibrat|relax(?:ed|ation)|annealed|thermali[sz]/i;
  const prodRe = /production|loading|deform|stretch|tensile|compress|indent|simulat|run (?:for|of)|total|collect|sampl|averag|record|heat current|ensemble was (?:then )?used|NVE/i;
  const cands = new Candidates();
  for (const s of ctx.sentences) {
    // "equilibrated for 200 ps …, then the NVE ensemble was used for 2 ns"
    const clauses = s.text.split(/,?\s*(?:and\s+)?(?:then|followed by|after which|subsequently|afterwards)\s+|;\s*/i);
    for (const clause of clauses) {
      const isEquil = equilRe.test(clause);
      if (which === "equil" ? !isEquil : isEquil || !prodRe.test(clause)) continue;
      for (const m of clause.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(fs|ps|ns|picoseconds?|nanoseconds?|(?:time[- ]?)?steps)\b/gi)) {
        const u = m[2].toLowerCase();
        const v = numberFrom(m[1]);
        let d;
        if (/step/.test(u)) {
          if (v < 100) continue;
          d = { display: `${v.toLocaleString("en-US")} steps`, value: v, unit: "steps" };
        } else {
          const fs = timeToFs(v, u);
          if (/time[- ]?step/i.test(clause) && fs <= 20) continue;
          if (/damping|relaxation (?:time|constant)|coupling|correlation/i.test(clause) && fs <= 1e5) continue;
          if (!(fs >= 1000)) continue;
          d = prettyTime(fs);
        }
        const score = weight(s, ctx.hasMethods) * (1 + proximity(clause, which === "equil" ? equilRe : prodRe, m.index));
        cands.add(d.display, d.value, d.unit, s, score, m[0]);
      }
    }
  }
  return cands.list();
}

function extractCorrelation(ctx) {
  return scan(ctx, {
    key: /correlation (?:time|length|window)/i,
    value: /(\d+(?:\.\d+)?)\s*(fs|ps|ns)\b/i,
    exclude: /time[- ]?step/i,
    build: (m) => prettyTime(timeToFs(parseFloat(m[1]), m[2])),
  });
}

function extractIndenter(ctx) {
  return scan(ctx, {
    key: /indenter|tip/i,
    value: /radius\s*(?:\(R\)\s*)?(?:of|is|was|=)?\s*(\d+(?:\.\d+)?)\s*(nm|Å)(?![A-Za-z])|(\d+(?:\.\d+)?)\s*(nm|Å)(?![A-Za-z])\s*(?:in\s+)?radius/i,
    build: (m) => ({ display: `R = ${m[1] || m[3]} ${m[2] || m[4]}`, value: `${m[1] || m[3]} ${m[2] || m[4]}`, unit: "" }),
  });
}

function extractDepth(ctx) {
  return scan(ctx, {
    key: /depth|indent|cutting/i,
    value: /depth\s*(?:of|was|is|=|:)?\s*(?:up to\s*)?(\d+(?:\.\d+)?)\s*(nm|Å)(?![A-Za-z])/i,
    build: (m) => ({ display: `${m[1]} ${m[2]}`, value: `${m[1]} ${m[2]}`, unit: "" }),
  });
}

function extractGroups(ctx) {
  const cands = new Candidates();
  for (const s of ctx.sentences) {
    if (s.kind === "intro") continue;
    const m = s.text.match(/[^,;.]*\b(?:fixed|rigid|frozen|thermostat(?:ted)? (?:layer|region|atoms)|Newtonian (?:layer|region|atoms)|boundary (?:layer|atoms)|heat (?:source|sink)|hot (?:region|slab)|cold (?:region|slab))\b[^,;.]*/i);
    if (m && /layer|atoms|region|slab|bottom|top|end/i.test(m[0])) cands.add(m[0].trim().replace(/^(?:and|while|whereas)\s+/i, ""), m[0].trim(), "", s, weight(s, ctx.hasMethods), m[0]);
  }
  return cands.list();
}

function extractStrainRate(ctx) {
  return scan(ctx, {
    key: /strain rate|loading rate|deformation rate|engineering strain rate|erate/i,
    value: new RegExp(`(${SCI})\\s*(\\/\\s*s\\b|s\\s*\\^?\\s*-\\s*1|s\\^-1|per second|\\/\\s*ps\\b|ps\\s*\\^?\\s*-\\s*1|\\/\\s*fs|fs\\s*\\^?\\s*-\\s*1)`, "i"),
    build: (m) => {
      let raw = m[1].trim();
      let v = parseSci(raw);
      let guessed = false;
      // "10^9" printed as a flat "109" — superscripts often lose their formatting in PDFs.
      if (/^10\d{1,2}$/.test(raw) && v >= 104) {
        v = Math.pow(10, parseInt(raw.slice(2), 10));
        guessed = true;
      }
      const u = m[2].replace(/\s/g, "").toLowerCase();
      if (/ps/.test(u)) v *= 1e12;
      else if (/fs/.test(u)) v *= 1e15;
      if (!(v > 1e3 && v < 1e14)) return null;
      return { display: `${formatSci(v)} s^-1${guessed ? " (check)" : ""}`, value: v, unit: "1/s" };
    },
  });
}

function extractCutoff(ctx) {
  return scan(ctx, {
    key: /cut-?\s*off|cutoff/i,
    value: /(\d+(?:\.\d+)?)\s*(Å|angstroms?|nm)(?![A-Za-z])/i,
    build: (m) => {
      let a = parseFloat(m[1]);
      if (/nm/i.test(m[2])) a *= 10;
      if (!(a >= 1 && a <= 30)) return null;
      return { display: `${+a.toPrecision(4)} Å`, value: a, unit: "Å" };
    },
  });
}

function extractLattice(ctx) {
  return scan(ctx, {
    key: /lattice (?:constant|parameter)|\ba\s*_?0?\s*=|lattice spacing/i,
    value: /(\d+\.\d+)\s*(Å|angstroms?|nm)(?![A-Za-z])/i,
    build: (m) => {
      let a = parseFloat(m[1]);
      if (/nm/i.test(m[2])) a *= 10;
      if (!(a >= 1.5 && a <= 15)) return null;
      return { display: `${+a.toPrecision(5)} Å`, value: a, unit: "Å" };
    },
  });
}

function extractAtoms(ctx) {
  return scan(ctx, {
    key: /atoms|particles|consist|contain|total of|comprise/i,
    value: /(\d{1,3}(?:[,\s]\d{3})+|\d{2,9})\s*(?:carbon |metal |copper |silicon |water |total )?(atoms|particles|molecules)\b/i,
    build: (m) => {
      const n = numberFrom(m[1].replace(/\s/g, ""));
      if (!(n >= 20)) return null;
      return { display: `${n.toLocaleString("en-US")} ${m[2].toLowerCase()}`, value: n, unit: m[2].toLowerCase() };
    },
  });
}

function extractBox(ctx) {
  const dimUnit = String.raw`(nm|Å|angstroms?|unit cells?|lattice (?:units|constants|parameters)|a0|a)`;
  const dims = scan(ctx, {
    key: /dimension|size|box|sample|model|sheet|slab|cell|domain|supercell|length|width/i,
    value: new RegExp(String.raw`(\d+(?:\.\d+)?)\s*(?:nm|Å)?\s*×\s*(\d+(?:\.\d+)?)\s*(?:nm|Å)?\s*(?:×\s*(\d+(?:\.\d+)?))?\s*${dimUnit}(?![A-Za-z])`, "i"),
    build: (m) => {
      const unit = /cell|lattice|a0|^a$/i.test(m[4]) ? "unit cells" : /nm/i.test(m[4]) ? "nm" : "Å";
      const parts = [m[1], m[2], m[3]].filter(Boolean).map(Number);
      return { display: parts.join(" × ") + " " + unit, value: { dims: parts, unit }, unit };
    },
  });
  // "40a0 × 40a0 × 30a0" (sizes in lattice constants)
  for (const s of ctx.sentences) {
    if (s.kind === "intro") continue;
    const m = s.text.match(/(\d+(?:\.\d+)?)\s*a\s*_?0?\s*×\s*(\d+(?:\.\d+)?)\s*a\s*_?0?(?:\s*×\s*(\d+(?:\.\d+)?)\s*a\s*_?0?)?(?![A-Za-z])/);
    if (m) {
      const parts = [m[1], m[2], m[3]].filter(Boolean).map(Number);
      const disp = parts.join(" × ") + " unit cells";
      const existing = dims.find((d) => d.display === disp);
      const score = weight(s, ctx.hasMethods) * 2;
      if (existing) existing.score += score;
      else dims.push({ display: disp, value: { dims: parts, unit: "unit cells" }, unit: "unit cells", score, evidence: [{ text: s.text, page: s.page, section: s.section, match: m[0] }] });
    }
  }
  // drop fragments such as "0 × 40 unit cells" produced by the generic pattern on "40a0 × 40a0 …"
  for (let i = dims.length - 1; i >= 0; i--) if (dims[i].value && dims[i].value.dims && dims[i].value.dims.includes(0)) dims.splice(i, 1);
  // "length of 20 nm and width of 5 nm"
  const sides = {};
  for (const s of ctx.sentences) {
    if (s.kind === "intro") continue;
    for (const m of s.text.matchAll(/\b(length|width|height|thickness)\s*(?:\([LWHt]\)\s*)?(?:of|is|was|=|:)?\s*(?:about|approximately|~|≈)?\s*(\d+(?:\.\d+)?)\s*(nm|Å)(?![A-Za-z])/gi)) {
      const k = m[1].toLowerCase();
      if (!sides[k]) sides[k] = { v: `${m[2]} ${m[3]}`, s };
    }
  }
  const keys = Object.keys(sides);
  if (keys.length >= 2) {
    const disp = keys.map((k) => `${k} ${sides[k].v}`).join(", ");
    dims.push({ display: disp, value: { sides }, unit: "", score: 1.5, evidence: [...new Set(keys.map((k) => sides[k].s))].map((s) => ({ text: s.text, page: s.page, section: s.section, match: "" })) });
  }
  return dims.sort((a, b) => b.score - a.score);
}

function extractChirality(ctx) {
  return scan(ctx, {
    key: /nanotube|CNT|chiral|armchair|zigzag|\(n,\s*m\)/i,
    value: /\(\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)/,
    build: (m) => ({ display: `(${m[1]},${m[2]})`, value: [Number(m[1]), Number(m[2])], unit: "" }),
  });
}

function extractOrientation(ctx) {
  return scan(ctx, {
    key: /orient|direction|along|axis|plane|surface|loading|crystallograph/i,
    value: /([xyz]\s*[-:]?\s*)?([[<(])\s*(-?\d)\s*,?\s*(-?\d)\s*,?\s*(-?\d)\s*([\]>)])/,
    build: (m) => {
      const open = m[2];
      const close = m[6];
      if ((open === "[" && close !== "]") || (open === "<" && close !== ">") || (open === "(" && close !== ")")) return null;
      if (open === "(" && !/plane|surface|facet|\(\s*\d\s*\d\s*\d\s*\)/i.test(m[0])) return null;
      const idx = `${m[3]}${m[4]}${m[5]}`;
      if (/^0+$/.test(idx.replace(/-/g, ""))) return null;
      const axis = m[1] ? m[1].trim().replace(/[-:\s]/g, "") + "-" : "";
      return { display: `${axis}${open}${idx}${close}`, value: `${axis}${open}${idx}${close}`, unit: "" };
    },
  });
}

function extractBoundary(ctx) {
  const cands = new Candidates();
  for (const s of ctx.sentences) {
    const t = s.text;
    if (!/periodic|PBC|boundary condition|non-?periodic|shrink[- ]wrap|free (?:surface|boundar)/i.test(t)) continue;
    const dims = { x: null, y: null, z: null };
    const axesIn = (str) => {
      const found = new Set();
      for (const m of str.matchAll(/\b([xyz])(?:\s*(?:,|and|-)\s*([xyz]))?(?:\s*(?:,|and)\s*([xyz]))?\s*[- ]?(?:direction|dimension|axis|axes)s?/gi)) {
        [m[1], m[2], m[3]].filter(Boolean).forEach((a) => found.add(a.toLowerCase()));
      }
      for (const m of str.matchAll(/\b(?:in|along)\s+(?:the\s+)?([xyz])\s*(?:,\s*([xyz]))?\s*(?:and|,)?\s*([xyz])?\b/gi)) {
        [m[1], m[2], m[3]].filter(Boolean).forEach((a) => found.add(a.toLowerCase()));
      }
      if (/in-plane/i.test(str)) ["x", "y"].forEach((a) => found.add(a));
      if (/all (?:three )?(?:directions|dimensions)|three dimensions|3D periodic|every direction/i.test(str)) ["x", "y", "z"].forEach((a) => found.add(a));
      return found;
    };
    const parts = t.split(/(?:,\s*(?:while|whereas|and)|;|while|whereas|but)\s+/i);
    for (const part of parts) {
      const axes = axesIn(part);
      if (/non-?periodic|free|shrink|fixed|open|vacuum/i.test(part)) axes.forEach((a) => (dims[a] = /fixed/i.test(part) ? "f" : "s"));
      else if (/periodic|PBC/i.test(part)) {
        if (!axes.size) ["x", "y", "z"].forEach((a) => (dims[a] = dims[a] || "p?"));
        axes.forEach((a) => (dims[a] = "p"));
      }
    }
    if (!Object.values(dims).some(Boolean)) continue;
    const code = ["x", "y", "z"].map((a) => (dims[a] || "p?").replace("?", "")).join(" ");
    cands.add(code, code, "", s, weight(s, ctx.hasMethods) * (Object.values(dims).every((d) => d && !d.includes("?")) ? 1.5 : 1), t.match(/periodic[^.,;]*/i)?.[0] || "");
  }
  return cands.list();
}

function extractMinimization(ctx) {
  const cands = new Candidates();
  for (const s of ctx.sentences) {
    const t = s.text;
    let style = null;
    if (/conjugate[- ]gradient/i.test(t)) style = "cg";
    else if (/steepest[- ]descent/i.test(t)) style = "sd";
    else if (/\bFIRE\b/.test(t)) style = "fire";
    else if (/energy minimi[sz]|minimi[sz]ed|minimi[sz]ation/i.test(t)) style = "cg";
    if (!style) continue;
    const tol = t.match(new RegExp(`tolerance[^.]{0,40}?(${SCI})`, "i"));
    const tolV = tol ? parseSci(tol[1]) : NaN;
    const name = { cg: "Conjugate gradient", sd: "Steepest descent", fire: "FIRE" }[style];
    const disp = name + (isFinite(tolV) && tolV < 1 ? ` (tol ${formatSci(tolV)})` : "");
    cands.add(disp, { style, tol: isFinite(tolV) && tolV < 1 ? tolV : null }, "", s, weight(s, ctx.hasMethods), "");
  }
  return cands.list();
}

function extractEnsembles(ctx) {
  const map = [
    ["NVT", /\bNVT\b|canonical ensemble(?! grand)/i], ["NPT", /\bNPT\b|isothermal[- ]isobaric|\bNσT\b|\bNST\b/i],
    ["NVE", /\bNVE\b|micro-?canonical/i], ["NPH", /\bNPH\b|isoenthalpic/i], ["μVT", /\bμVT\b|\bmuVT\b|grand[- ]canonical/i],
  ];
  const cands = new Candidates();
  for (const s of ctx.sentences) {
    for (const [name, re] of map) {
      const m = s.text.match(re);
      if (m) cands.add(name, name, "", s, weight(s, ctx.hasMethods), m[0]);
    }
  }
  return cands.list();
}

function extractVelocity(ctx) {
  const cands = new Candidates();
  for (const s of ctx.sentences) {
    if (!/velocit/i.test(s.text)) continue;
    if (/Gaussian/i.test(s.text)) cands.add("Gaussian", "gaussian", "", s, weight(s, ctx.hasMethods), "Gaussian");
    else if (/Maxwell[- –]Boltzmann/i.test(s.text)) cands.add("Maxwell–Boltzmann (Gaussian)", "gaussian", "", s, weight(s, ctx.hasMethods), "Maxwell");
    else if (/uniform(?:ly)? distribut/i.test(s.text)) cands.add("Uniform", "uniform", "", s, weight(s, ctx.hasMethods), "uniform");
  }
  return cands.list();
}

function extractUnits(ctx) {
  return scan(ctx, {
    key: /units/i,
    value: /\b(metal|real|lj|si|cgs|electron|micro|nano)\s+units\b|units\s+(metal|real)\b/i,
    build: (m) => ({ display: (m[1] || m[2]).toLowerCase(), value: (m[1] || m[2]).toLowerCase(), unit: "" }),
  });
}

function extractSoftware(ctx) {
  const cands = new Candidates();
  for (const s of ctx.sentences) {
    const m = s.text.match(/\bLAMMPS\b(?:[^.]{0,40}?\(?\b(?:version\s*)?((?:\d{1,2}\s+[A-Z][a-z]{2,8}\s+\d{4})|(?:\d{4}\.\d+|\d{1,2}[A-Z][a-z]{2}\d{2,4}))\)?)?/);
    if (m) cands.add(m[1] ? `LAMMPS (${m[1]})` : "LAMMPS", "LAMMPS", "", s, weight(s, ctx.hasMethods) + (m[1] ? 1 : 0), m[0]);
    else {
      const g = s.text.match(/\b(GROMACS|NAMD|DL_?POLY|Materials Studio|AMBER package|CP2K)\b/);
      if (g) cands.add(g[1], g[1], "", s, weight(s, ctx.hasMethods) * 0.8, g[0]);
    }
  }
  return cands.list();
}

function extractPotentialRef(ctx, potential) {
  if (!potential) return [];
  const re = new RegExp(potential.re.source, "i");
  const patterns = [
    /([\w.\-]+\.(?:eam\.alloy|eam\.fs|eam|tersoff|sw|meam|airebo|rebo|reax|comb3?|adp|snapcoeff|yace|lcbop|bop))\b/i,
    /\b(ffield\.[\w.\-]+)/i,
    /(?:developed|proposed|parameteri[sz]ed|fitted|introduced|given|modified|optimi[sz]ed|reported) by\s+([A-Z][A-Za-z'\-]+(?:\s+(?:et al\.?|and|&)\s*(?:[A-Z][A-Za-z'\-]*)?)?)/,
    /(?:potential|parameters?|parameteri[sz]ation|force field|version)\s+(?:of|from|by)\s+([A-Z][A-Za-z'\-]+(?:\s+(?:et al\.?|and\s+[A-Z][A-Za-z'\-]+))?)/,
    /([A-Z][A-Za-z'\-]+(?:\s+et al\.?|\s+and\s+[A-Z][A-Za-z'\-]+)?)\s*(?:\(\d{4}\)|\[\d+\])?\s*(?:parameters|parameteri[sz]ation|potential)\b/,
  ];
  const cands = new Candidates();
  for (const s of ctx.sentences) {
    if (!re.test(s.text) && !/potential|force field|ffield|\.eam|\.tersoff/i.test(s.text)) continue;
    patterns.forEach((p, i) => {
      const m = s.text.match(p);
      if (!m) return;
      const name = m[1].replace(/\s+/g, " ").replace(/\s+(?:and|&)$/, "").trim();
      if (i >= 2 && (/^(?:The|This|These|A|An|In|We|Our|It|All)$/.test(name) || POTENTIALS.some((pt) => pt.re.test(name)))) return;
      cands.add(name, name, "", s, weight(s, ctx.hasMethods) * (i < 2 ? 1.5 : 1), m[0]);
    });
  }
  return cands.list();
}

function extractElectrostatics(ctx) {
  const cands = new Candidates();
  for (const s of ctx.sentences) {
    const m = s.text.match(/\bPPPM\b|particle[- ]particle[- ]particle[- ]mesh|\bEwald\b|Wolf (?:summation|method)|reaction[- ]field|damped shifted force/i);
    if (!m) continue;
    const style = /PPPM|particle[- ]particle/i.test(m[0]) ? "pppm" : /Ewald/i.test(m[0]) ? "ewald" : /wolf|damped/i.test(m[0]) ? "wolf" : "rf";
    const acc = s.text.match(new RegExp(`(?:accuracy|precision|tolerance|error)[^.]{0,30}?(${SCI})`, "i"));
    const accV = acc ? parseSci(acc[1]) : NaN;
    const name = { pppm: "PPPM", ewald: "Ewald", wolf: "Wolf summation", rf: "Reaction field" }[style];
    cands.add(name + (isFinite(accV) && accV < 1 ? ` (accuracy ${formatSci(accV)})` : ""), { style, acc: isFinite(accV) && accV < 1 ? accV : null }, "", s, weight(s, ctx.hasMethods), m[0]);
  }
  return cands.list();
}

function extractOutputFreq(ctx) {
  return scan(ctx, {
    key: /dump|output|record|saved|written|sampl|thermo|trajector|snapshot/i,
    value: /every\s+(\d[\d,]*)\s*(?:time[- ]?)?steps|(?:interval|frequency) of\s+(\d[\d,]*)\s*(?:time[- ]?)?steps/i,
    build: (m) => {
      const n = numberFrom(m[1] || m[2]);
      if (!(n >= 1)) return null;
      return { display: `every ${n.toLocaleString("en-US")} steps`, value: n, unit: "steps" };
    },
  });
}

function extractMaxStrain(ctx) {
  return scan(ctx, {
    key: /strain/i,
    value: /(?:up to|until|maximum|max\.?|total|final|applied)\s+(?:a\s+|an\s+|the\s+)?(?:engineering\s+|tensile\s+|compressive\s+|shear\s+)?strain(?:\s+of|\s+level of)?\s*(?:=|:)?\s*(\d+(?:\.\d+)?)\s*(%)?/i,
    build: (m) => {
      let v = parseFloat(m[1]);
      if (m[2]) v /= 100;
      if (!(v > 0 && v <= 5)) return null;
      return { display: m[2] ? `${m[1]}%` : `${v}`, value: v, unit: "" };
    },
  });
}

function extractHeatingRate(ctx) {
  return scan(ctx, {
    key: /heating|cooling|quench|rate/i,
    value: /(\d+(?:\.\d+)?(?:\s*×\s*10\s*\^?\s*-?\d+)?)\s*K\s*(\/\s*ps|ps\s*\^?\s*-\s*1|\/\s*ns|ns\s*\^?\s*-\s*1|\/\s*s|s\s*\^?\s*-\s*1)/i,
    build: (m) => {
      let v = parseSci(m[1]);
      const u = m[2].replace(/\s/g, "").toLowerCase();
      if (/ns/.test(u)) v /= 1000;
      else if (/^\/s|^s/.test(u)) v /= 1e12;
      if (!(v > 0)) return null;
      return { display: `${formatSci(v)} K/ps`, value: v, unit: "K/ps" };
    },
  });
}

function extractVelocityLoad(ctx) {
  return scan(ctx, {
    key: /velocity|speed|indent|cutting|sliding|moved|pulled|loading rate/i,
    value: /(\d+(?:\.\d+)?)\s*(m\/s|Å\/ps|nm\/ps|m s\^?-1)(?![A-Za-z])/i,
    exclude: /sound|phonon|group velocity/i,
    build: (m) => {
      let v = parseFloat(m[1]);
      const u = m[2].toLowerCase().replace(/\s/g, "");
      if (u.startsWith("m")) v = v / 100; // m/s → Å/ps
      else if (u.startsWith("nm")) v *= 10;
      return { display: `${m[1]} ${m[2]}`, value: v, unit: "Å/ps" };
    },
  });
}

function extractPKA(ctx) {
  return scan(ctx, {
    key: /PKA|knock-?on|recoil|cascade|irradiat|incident/i,
    value: /(\d+(?:\.\d+)?)\s*(keV|eV|MeV)\b/,
    build: (m) => ({ display: `${m[1]} ${m[2]}`, value: parseFloat(m[1]) * ({ ev: 1, kev: 1e3, mev: 1e6 }[m[2].toLowerCase()]), unit: "eV" }),
  });
}

function extractDefects(ctx) {
  const cands = new Candidates();
  const labels = [["vacanc", "vacancies"], ["dop", "doping"], ["porosity", "porosity"], ["grain", "grain size"], ["crack", "crack length"], ["void", "voids"], ["defect", "defects"], ["concentration", "concentration"]];
  const LIST = String.raw`\d+(?:\.\d+)?\s*(?:%|at\.?\s*%|nm)(?:\s*(?:,|,?\s*and|,?\s*or|to|-)\s*\d+(?:\.\d+)?\s*(?:%|at\.?\s*%|nm)?)*`;
  for (const s of ctx.sentences) {
    if (s.kind === "intro") continue;
    const label = labels.find(([k]) => new RegExp(k, "i").test(s.text));
    if (!label) continue;
    for (const m of s.text.matchAll(new RegExp(LIST, "gi"))) {
      if (!/%|nm/.test(m[0])) continue;
      if (label[1] !== "grain size" && label[1] !== "crack length" && /nm/.test(m[0]) && !/%/.test(m[0])) continue;
      const disp = `${m[0].replace(/\s+/g, " ").trim()} ${label[1]}`;
      cands.add(disp, disp, "", s, weight(s, ctx.hasMethods), m[0]);
    }
  }
  return cands.list();
}

function extractDirection(ctx) {
  const cands = new Candidates();
  const loadRe = /load|strain|stretch|tensile|tension|compress|deform|pull|heat flux|temperature gradient|indent|slid/i;
  for (const s of ctx.sentences) {
    if (!loadRe.test(s.text)) continue;
    const w = weight(s, ctx.hasMethods);
    // "along the armchair (x) direction", "along the zigzag direction", "along the x-axis", "along [100]"
    for (const m of s.text.matchAll(/\b(?:along|in|parallel to)\s+(?:the\s+)?(armchair|zig-?zag)?\s*(?:\(\s*([xyz])\s*\)|\b([xyz]))?\s*[- ]?(direction|axis|axes|edge)?/gi)) {
      const chir = m[1] ? m[1].toLowerCase().replace("-", "") : "";
      const axis = (m[2] || m[3] || "").toLowerCase();
      if (!chir && !(axis && m[4])) continue;
      const strong = /^along|parallel/i.test(m[0]) ? 1.5 : 0.6;
      const disp = chir && axis ? `${chir} (${axis})` : chir || `${axis} direction`;
      cands.add(disp, axis || (chir === "armchair" ? "x" : "y"), "", s, w * strong, m[0]);
    }
    const hkl = s.text.match(/\balong\s+(?:the\s+)?\[\s*(-?\d)\s*(-?\d)\s*(-?\d)\s*\]/i);
    if (hkl) cands.add(`[${hkl[1]}${hkl[2]}${hkl[3]}]`, `[${hkl[1]}${hkl[2]}${hkl[3]}]`, "", s, w * 1.3, hkl[0]);
  }
  return cands.list();
}

function extractTCMethod(ctx) {
  const map = [
    ["Müller-Plathe (reverse NEMD)", /M(?:ü|u|ue)ller[- –]Plathe|reverse non-?equilibrium|\bRNEMD\b/i],
    ["Green–Kubo (EMD)", /Green[- –]Kubo|equilibrium molecular dynamics \(EMD\)|\bEMD\b/i],
    ["NEMD (heat source & sink)", /\bNEMD\b|non-?equilibrium molecular dynamics|heat source|heat sink|thermal (?:bath|reservoir)s?/i],
    ["Approach-to-equilibrium (AEMD)", /\bAEMD\b|approach[- ]to[- ]equilibrium/i],
  ];
  const cands = new Candidates();
  for (const s of ctx.sentences) for (const [name, re] of map) if (re.test(s.text)) cands.add(name, name, "", s, weight(s, ctx.hasMethods), "");
  return cands.list();
}

/* ---------------------------------------------------------------------- */
/* Material, elements, potential                                            */
/* ---------------------------------------------------------------------- */

const FORMULA_RE = /\b(?:[A-Z][a-z]?\d*(?:\.\d+)?){2,6}\b/g;

function formulaElements(token) {
  if (!/[a-z\d]/.test(token)) return null; // all-caps acronyms (PBC, FCC, NPT…) are not formulas
  const parts = [...token.matchAll(/([A-Z][a-z]?)(\d*(?:\.\d+)?)/g)];
  if (parts.map((p) => p[0]).join("") !== token) return null;
  const els = parts.map((p) => p[1]);
  if (!els.every((e) => MASSES[e])) return null;
  if (new Set(els).size < 2) return null;
  return [...new Set(els)];
}

/** Splits a regex source into its top-level "|" alternatives. */
function alternatives(source) {
  const out = [];
  let depth = 0;
  let cls = false;
  let cur = "";
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") {
      cur += ch + source[++i];
      continue;
    }
    if (cls) cls = ch !== "]";
    else if (ch === "[") cls = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "|" && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Material names match in any case ("Copper", "copper") but chemical symbols
 * must keep their case, otherwise "et al." looks like aluminium.
 */
const MATERIAL_MATCHERS = MATERIALS.map((mat) => {
  const alts = alternatives(mat.re.source);
  const isSymbol = (a) => /^\\b[A-Z]/.test(a) || /^\\b\(\?:[A-Z]/.test(a);
  const words = alts.filter((a) => !isSymbol(a));
  const symbols = alts.filter(isSymbol);
  const res = [];
  if (words.length) res.push(new RegExp(words.join("|"), "gi"));
  if (symbols.length) res.push(new RegExp(symbols.join("|"), "g"));
  return { mat, res };
});

function extractMaterial(ctx) {
  const cands = new Candidates();
  for (const s of ctx.sentences) {
    for (const { mat, res } of MATERIAL_MATCHERS) {
      const hits = res.flatMap((re) => [...s.text.matchAll(re)]);
      if (hits.length) cands.add(mat.name, mat.id, "", s, weight(s, ctx.hasMethods) * Math.min(hits.length, 3), hits[0][0]);
    }
  }
  // "SiC" also mentions Si and C: prefer the compound when it is discussed a fair amount.
  const list = cands.list();
  const byId = (id) => MATERIALS.find((m) => m.id === id);
  if (list.length > 1) {
    const top = byId(list[0].value);
    const compound = list.find((c) => {
      const m = byId(c.value);
      return m.elements.length > top.elements.length && top.elements.every((e) => m.elements.includes(e)) && c.score >= list[0].score * 0.4;
    });
    if (compound) {
      list.splice(list.indexOf(compound), 1);
      list.unshift(compound);
    }
  }
  return list;
}

function extractElements(ctx, material) {
  const counts = new Map();
  const bump = (e, s, w) => counts.set(e, { n: (counts.get(e)?.n || 0) + w, s: counts.get(e)?.s || s });
  // Chemical formulas must appear in at least two sentences (filters words like "NaN").
  const formulaSentences = new Map();
  for (const s of ctx.sentences) {
    for (const m of s.text.matchAll(FORMULA_RE)) {
      if (/^(?:NaN|InF|CoN|NoN)$/.test(m[0]) || !formulaElements(m[0])) continue;
      if (!formulaSentences.has(m[0])) formulaSentences.set(m[0], new Set());
      formulaSentences.get(m[0]).add(s);
    }
  }
  for (const s of ctx.sentences) {
    const w = weight(s, ctx.hasMethods);
    for (const m of s.text.matchAll(FORMULA_RE)) {
      const els = formulaSentences.get(m[0]) && formulaSentences.get(m[0]).size >= 2 ? formulaElements(m[0]) : null;
      if (els) els.forEach((e) => bump(e, s, w));
    }
    const plain = s.text.replace(/zinc[- ]?blende|lead(?:s|ing)? to|\blead\b(?! atoms)|iron out/gi, " ");
    for (const [name, sym] of Object.entries(ELEMENT_NAMES)) {
      if (new RegExp(`\\b${name}\\b`, "i").test(plain)) bump(sym, s, w * 0.8);
    }
  }
  if (material) material.elements.forEach((e) => bump(e, null, 5));
  const els = [...counts.entries()].filter(([, v]) => v.n >= 1.5).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([e]) => e);
  return els;
}

/* ---------------------------------------------------------------------- */
/* Public API                                                               */
/* ---------------------------------------------------------------------- */

function param(id, label, candidates, extra = {}) {
  const top = candidates[0];
  return {
    id,
    label,
    candidates,
    value: top ? top.display : "",
    raw: top ? top.value : null,
    status: top ? "found" : "missing",
    ...extra,
  };
}

/**
 * @param {string} rawText  Markdown/plain text of the paper
 * @returns {{title:string, hasMethods:boolean, groups:Array, lists:object, numerics:Array, sentences:Array}}
 */
export function extractParameters(rawText) {
  const ctx = prepare(rawText);

  const materials = extractMaterial(ctx);
  const topMaterial = materials[0] ? MATERIALS.find((m) => m.id === materials[0].value) : null;
  const potentials = scanKeywords(ctx, POTENTIALS);
  const topPotential = potentials[0] ? POTENTIALS.find((p) => p.id === potentials[0].value) : null;
  const elements = extractElements(ctx, topMaterial);
  const simTypes = scanKeywords(ctx, SIM_TYPES.map((t) => ({ ...t, re: new RegExp(t.re.source, "i") })));

  const lattice = extractLattice(ctx);
  const latticeParam = param("lattice", "Lattice constant", lattice, { unit: "Å" });
  if (!lattice.length && topMaterial && topMaterial.a) {
    latticeParam.value = `${topMaterial.a} Å`;
    latticeParam.raw = topMaterial.a;
    latticeParam.status = "suggested";
    latticeParam.note = `Typical value for ${topMaterial.name}; not stated in the paper.`;
  }
  const structureParam = {
    id: "structure", label: "Crystal structure", candidates: [], unit: "",
    value: topMaterial ? topMaterial.structure : "", raw: topMaterial ? topMaterial.structure : null,
    status: topMaterial ? "suggested" : "missing",
    note: topMaterial ? `Based on the material (${topMaterial.name}).` : "",
  };
  const structHit = ctx.sentences.find((s) => /\b(fcc|bcc|hcp|face[- ]centered cubic|body[- ]centered cubic|hexagonal close[- ]packed|diamond cubic|zinc-?blende|wurtzite|amorphous)\b/i.test(s.text) && s.kind !== "intro");
  if (structHit) {
    const w = structHit.text.match(/\b(fcc|bcc|hcp|face[- ]centered cubic|body[- ]centered cubic|hexagonal close[- ]packed|diamond cubic|zinc-?blende|wurtzite|amorphous)\b/i)[1].toLowerCase();
    const norm = { "face-centered cubic": "fcc", "face centered cubic": "fcc", "body-centered cubic": "bcc", "body centered cubic": "bcc", "hexagonal close-packed": "hcp", "hexagonal close packed": "hcp", "diamond cubic": "diamond", zincblende: "zincblende", "zinc-blende": "zincblende" }[w] || w;
    structureParam.value = norm;
    structureParam.raw = norm;
    structureParam.status = "found";
    structureParam.candidates = [{ display: norm, value: norm, score: 1, evidence: [{ text: structHit.text, page: structHit.page, section: structHit.section, match: w }] }];
    structureParam.note = "";
  }

  const unitsParam = param("units", "LAMMPS units", extractUnits(ctx));
  if (unitsParam.status === "missing" && topPotential) {
    unitsParam.value = topPotential.units;
    unitsParam.raw = topPotential.units;
    unitsParam.status = "suggested";
    unitsParam.note = `Usual units for ${topPotential.name}.`;
  }

  const thermostats = scanKeywords(ctx, THERMOSTATS);
  const barostats = scanKeywords(ctx, BAROSTATS);
  const ensembles = extractEnsembles(ctx);

  const groups = [
    {
      id: "system", label: "System & structure", icon: "atom",
      params: [
        param("material", "Material / system", materials),
        { id: "elements", label: "Elements (atom types)", candidates: [], value: elements.join(" "), raw: elements, status: elements.length ? "found" : "missing", note: elements.length ? "Order = LAMMPS atom types 1, 2, 3…" : "" },
        structureParam,
        latticeParam,
        param("orientation", "Crystal orientation", extractOrientation(ctx)),
        param("box", "Simulation box / sample size", extractBox(ctx)),
        param("atoms", "Number of atoms", extractAtoms(ctx)),
        param("chirality", "CNT chirality (n,m)", extractChirality(ctx), { hideIfMissing: !topMaterial || topMaterial.id !== "cnt" }),
        param("defects", "Defects / vacancies / grains", extractDefects(ctx), { hideIfMissing: true }),
        param("boundary", "Boundary conditions", extractBoundary(ctx)),
        param("groups", "Fixed / thermostat / special layers", extractGroups(ctx), { hideIfMissing: true }),
      ],
    },
    {
      id: "potential", label: "Interatomic potential", icon: "bolt",
      params: [
        param("potential", "Potential / force field", potentials),
        param("potentialRef", "Potential source / file", extractPotentialRef(ctx, topPotential)),
        param("cutoff", "Cutoff distance", extractCutoff(ctx), { unit: "Å" }),
        param("electrostatics", "Long-range electrostatics", extractElectrostatics(ctx), { hideIfMissing: !(topPotential && topPotential.kspace) }),
      ],
    },
    {
      id: "md", label: "MD settings", icon: "gear",
      params: [
        param("software", "Software", extractSoftware(ctx)),
        unitsParam,
        param("timestep", "Time step", extractTimestep(ctx), { unit: "fs" }),
        param("minimization", "Energy minimization", extractMinimization(ctx)),
        param("velocity", "Initial velocities", extractVelocity(ctx), { hideIfMissing: true }),
        param("ensemble", "Ensemble(s)", ensembles),
        param("thermostat", "Thermostat", thermostats),
        param("tdamp", "Thermostat damping", extractDamping(ctx, "thermostat")),
        param("barostat", "Barostat", barostats, { hideIfMissing: !ensembles.some((e) => e.value === "NPT") }),
        param("pdamp", "Barostat damping", extractDamping(ctx, "barostat"), { hideIfMissing: !ensembles.some((e) => e.value === "NPT") }),
        param("temperature", "Temperature", extractTemperature(ctx), { unit: "K" }),
        param("temperatures", "All temperatures studied", extractTemperatureList(ctx), { hideIfMissing: true }),
        param("pressure", "Pressure", extractPressure(ctx)),
        param("equilTime", "Equilibration time", extractDuration(ctx, "equil")),
        param("prodTime", "Production / loading time", extractDuration(ctx, "prod")),
        param("output", "Output / dump frequency", extractOutputFreq(ctx), { hideIfMissing: true }),
      ],
    },
    {
      id: "loading", label: "Loading & method", icon: "arrow",
      params: [
        param("simType", "Simulation type", simTypes),
        param("direction", "Loading direction", extractDirection(ctx)),
        param("strainRate", "Strain rate", extractStrainRate(ctx), { unit: "1/s", hideIfMissing: !simTypes.some((t) => ["tensile", "compression", "shear", "fracture", "bending"].includes(t.value)) }),
        param("maxStrain", "Maximum strain", extractMaxStrain(ctx), { hideIfMissing: true }),
        param("heatingRate", "Heating / cooling rate", extractHeatingRate(ctx), { hideIfMissing: true }),
        param("tcMethod", "Thermal conductivity method", extractTCMethod(ctx), { hideIfMissing: !simTypes.some((t) => t.value === "thermal") }),
        param("velocityLoad", "Indenter / tool velocity", extractVelocityLoad(ctx), { hideIfMissing: true }),
        param("pka", "PKA / irradiation energy", extractPKA(ctx), { hideIfMissing: true }),
        param("indenter", "Indenter size", extractIndenter(ctx), { hideIfMissing: true }),
        param("depth", "Indentation / cutting depth", extractDepth(ctx), { hideIfMissing: true }),
        param("correlation", "Correlation time (Green–Kubo)", extractCorrelation(ctx), { hideIfMissing: true }),
      ],
    },
  ];

  for (const g of groups) g.params = g.params.filter((p) => !(p.hideIfMissing && p.status === "missing"));

  const lists = {
    properties: mentions(ctx, PROPERTIES),
    analysis: mentions(ctx, ANALYSIS),
    tools: mentions(ctx, TOOLS),
  };

  const looksLikeMD = !!(topPotential || groups[2].params.find((p) => p.id === "timestep" && p.status === "found") ||
    ctx.sentences.some((s) => /molecular dynamics|\bLAMMPS\b|\bMD simulation/i.test(s.text)));

  return {
    title: ctx.title,
    hasMethods: ctx.hasMethods,
    looksLikeMD,
    material: topMaterial,
    potential: topPotential,
    groups,
    lists,
    numerics: collectNumerics(ctx),
    methodsText: ctx.sentences.filter((s) => s.kind === "methods"),
    sentenceCount: ctx.sentences.length,
  };
}

/** Every sentence that states a number with a physical unit, for manual checking. */
const UNIT_RE = /(-?\d+(?:\.\d+)?(?:\s*×\s*10\s*\^?\s*-?\d+)?)\s*(K\b|°C|fs\b|ps\b|ns\b|Å|nm\b|µm|μm|GPa|MPa|bar\b|atm\b|eV\b|keV\b|kcal\/mol|kJ\/mol|W\/m\s*·?\s*K|W\s*m\^?-1\s*K\^?-1|g\/cm\^?3|m\/s|Å\/ps|s\^?-1|\/s\b|%|atoms\b|steps\b|timesteps\b)/g;

function collectNumerics(ctx) {
  const out = [];
  for (const s of ctx.sentences) {
    const hits = [...s.text.matchAll(UNIT_RE)];
    if (!hits.length) continue;
    out.push({ text: s.text, page: s.page, section: s.section, kind: s.kind, values: hits.map((h) => h[0].trim()) });
  }
  return out;
}
