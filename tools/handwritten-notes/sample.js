/* ==========================================================================
   A sample notebook page (drawn in a handwriting font) and its transcription,
   so the whole flow can be tried without an API key.
   ========================================================================== */

import { newCanvas } from "./pages.js";

const W = 1500;
const H = 2000;
// Diagram position (fractions of the page) — used in the sample transcription
const FIG = [0.52, 0.465, 0.95, 0.69];

export async function samplePage() {
  try {
    if (document.fonts && document.fonts.load) await Promise.race([document.fonts.load("700 60px Caveat"), new Promise((r) => setTimeout(r, 2500))]);
  } catch (e) { /* fall back to a cursive system font */ }
  const c = newCanvas(W, H);
  const x = c.getContext("2d");

  // Paper with a lamp shadow on one side, so the clean-up has something to fix
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#efe9da");
  g.addColorStop(0.55, "#e2dccb");
  g.addColorStop(1, "#b9b29f");
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  // ruled lines + margin
  x.strokeStyle = "rgba(90, 140, 200, .45)";
  x.lineWidth = 2;
  for (let y = 190; y < H - 40; y += 78) { x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
  x.strokeStyle = "rgba(210, 80, 80, .55)";
  x.beginPath(); x.moveTo(150, 0); x.lineTo(150, H); x.stroke();

  const ink = "#1c2a6b";
  const font = (size, w = 500) => `${w} ${size}px Caveat, "Segoe Script", "Bradley Hand", cursive`;
  const line = (row) => 180 + row * 78; // baseline of ruled row
  const write = (t, px, row, size = 54, color = ink, w = 500) => {
    x.fillStyle = color;
    x.font = font(size, w);
    x.fillText(t, px, line(row) - 8);
    return x.measureText(t).width;
  };
  x.save();
  x.rotate(-0.006);

  write("12/03", 1230, 0, 46, "#333");
  const tw = write("Lecture 4 — Projectile Motion", 190, 1, 72, ink, 700);
  x.strokeStyle = ink; x.lineWidth = 4;
  x.beginPath(); x.moveTo(190, line(1) + 6); x.quadraticCurveTo(190 + tw / 2, line(1) + 14, 190 + tw, line(1) + 2); x.stroke();

  write("Assume: no air resistance, g = 9.8 m/s² (downward)", 190, 2);
  write("Horizontal:   x = u cos θ · t", 190, 3);
  write("Vertical:   y = u sin θ · t − ½ g t²", 190, 4);
  write("Time of flight   T = 2u sin θ / g", 190, 5);
  write("R = u² sin 2θ / g", 190 + write("Range", 190, 6, 54, "#b42318", 700) + 30, 6);
  write("H = u² sin²θ / 2g", 190 + write("Max height", 190, 7, 54, "#b42318", 700) + 30, 7);
  write("★ R is max when θ = 45°", 190, 8, 54, "#b42318", 700);
  write("(same R for θ and 90° − θ)", 210, 9, 50);

  // Diagram: trajectory with axes, launch angle and velocity arrow
  const [fx0, fy0, fx1, fy1] = FIG.map((v, i) => v * (i % 2 ? H : W));
  const ox = fx0 + 50, oy = fy1 - 50, ex = fx1 - 30;
  x.strokeStyle = "#222"; x.lineWidth = 4;
  x.beginPath(); x.moveTo(ox, fy0 + 30); x.lineTo(ox, oy); x.lineTo(ex, oy); x.stroke();
  x.strokeStyle = "#1d4ed8"; x.lineWidth = 5;
  x.beginPath(); x.moveTo(ox, oy); x.quadraticCurveTo((ox + ex) / 2 - 10, fy0 - 70, ex - 60, oy); x.stroke();
  x.strokeStyle = "#b42318"; x.lineWidth = 5;
  x.beginPath(); x.moveTo(ox, oy); x.lineTo(ox + 120, oy - 140); x.stroke();
  x.beginPath(); x.moveTo(ox + 120, oy - 140); x.lineTo(ox + 92, oy - 132); x.moveTo(ox + 120, oy - 140); x.lineTo(ox + 114, oy - 112); x.stroke();
  x.strokeStyle = "#222"; x.lineWidth = 3;
  x.beginPath(); x.arc(ox, oy, 70, -0.86, 0); x.stroke();
  x.fillStyle = ink; x.font = font(48);
  x.fillText("u", ox + 128, oy - 150);
  x.fillText("θ", ox + 80, oy - 20);
  x.fillText("R", (ox + ex) / 2 - 40, oy + 46);
  x.fillText("H", (ox + ex) / 2 - 30, fy0 + 70);
  x.setLineDash([10, 10]);
  x.beginPath(); x.moveTo((ox + ex) / 2 - 35, oy); x.lineTo((ox + ex) / 2 - 35, fy0 + 82); x.stroke();
  x.setLineDash([]);

  write("u = 20 m/s, θ = 30°", 190 + write("Example:", 190, 16, 56, "#b42318", 700) + 30, 16);
  write("R = (20)² sin 60° / 9.8", 230, 17);
  write("= 400 × 0.866 / 9.8", 300, 18);
  const bw = write("≈ 35.3 m", 300, 19, 58, ink, 700);
  x.strokeStyle = ink; x.lineWidth = 3;
  x.strokeRect(288, line(19) - 64, bw + 26, 76);
  write("H = u² sin² 30° / 2g = 5.1 m", 230, 20);
  write("Next class: motion on an incline (pg 87)", 190, 22, 50, "#555");
  x.restore();
  return c;
}

export const SAMPLE_TEXT = `<!-- page 1 -->

*12/03*

# Lecture 4 — Projectile Motion

Assume: no air resistance, $g = 9.8\\,\\mathrm{m/s^2}$ (downward).

- **Horizontal:** $x = u\\cos\\theta \\cdot t$
- **Vertical:** $y = u\\sin\\theta \\cdot t - \\tfrac{1}{2} g t^2$

Time of flight:

$$T = \\frac{2u\\sin\\theta}{g}$$

**Range**

$$R = \\frac{u^2 \\sin 2\\theta}{g}$$

**Max height**

$$H = \\frac{u^2 \\sin^2\\theta}{2g}$$

> **Note.** $R$ is maximum when $\\theta = 45^\\circ$ (same $R$ for $\\theta$ and $90^\\circ - \\theta$).

![Figure: Trajectory of a projectile launched at speed u and angle θ, showing range R and maximum height H](page:1#${FIG.map((v, i) => (i < 2 ? v - 0.02 : v + 0.02).toFixed(2)).join(",")})

> **Example.** $u = 20\\,\\mathrm{m/s}$, $\\theta = 30^\\circ$
>
> $$\\begin{aligned} R &= \\frac{(20)^2 \\sin 60^\\circ}{9.8} \\\\ &= \\frac{400 \\times 0.866}{9.8} \\\\ &\\approx \\boxed{35.3\\,\\mathrm{m}} \\end{aligned}$$
>
> $H = \\dfrac{u^2 \\sin^2 30^\\circ}{2g} = 5.1\\,\\mathrm{m}$

Next class: motion on an incline ([?pg 87?]).
`;
