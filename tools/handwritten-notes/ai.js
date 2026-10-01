/* ==========================================================================
   Handwritten notes — reading pages with Claude

   The browser talks to the Claude API directly with the student's own API
   key (nothing passes through this website). One request per page, streamed
   so the text appears while it is being read.
   ========================================================================== */

export const MODEL = "claude-opus-5-5";

let sdk = null;
function loadSdk() {
  if (!sdk) sdk = import("../../assets/vendor/anthropic-sdk.mjs");
  return sdk;
}

/* ---------- Instructions ---------- */

const CORE = `You turn photos of handwritten class notes (lectures, derivations, worked examples, tutorials) into clean, editable Markdown with LaTeX maths. Students will review your text, then export it to Word, PDF or LaTeX, so the structure and the maths both matter.

Output format
- Reply with the transcription only: no preamble, no closing remarks, and no code fence around the whole reply.
- Headings: use #, ## and ### for titles and headings the writer marked (underlined, boxed, numbered, larger or set apart).
- Lists: "- " for bullets, "1. " for numbered points; indent nested points by two spaces.
- Tables: Markdown tables for anything laid out in rows and columns.
- Boxed or highlighted remarks, definitions, laws, theorems and worked examples: a block quote starting with a bold label, e.g. "> **Definition.** …", "> **Example 2.** …", "> **Note.** …".
- Emphasis the writer used (underlining, stars, highlighter): **bold**.

Maths
- Write every mathematical expression in LaTeX — variables, symbols, equations, units next to numbers: inline as $…$, displayed equations alone on their own lines as $$…$$.
- A derivation of several lines is one display block: $$\\begin{aligned} … &= … \\\\ &= … \\end{aligned}$$ aligned at the = signs.
- Use standard commands only (KaTeX renders it): \\frac, \\sqrt, \\int_{a}^{b}, \\sum_{i=1}^{n}, \\lim_{x\\to 0}, \\vec{F}, \\hat{n}, \\dot{x}, \\partial, \\nabla, \\cdot, \\times, \\approx, \\propto, \\Rightarrow, \\begin{bmatrix}…\\end{bmatrix}, \\begin{cases}…\\end{cases}, \\boxed{…} for boxed answers, \\mathrm{} for units and chemical formulas ($9.81\\,\\mathrm{m/s^2}$, $\\mathrm{H_2SO_4}$). No \\usepackage, \\newcommand, \\label or \\tag.
- Read maths in context: decide between look-alikes (1/l/I, 0/O/θ, x/×, u/v/ν, 5/S, t/+, a/α, B/β, n/η) from what makes the expression consistent with the surrounding lines.

Faithfulness
- Never invent content and never "fix" the maths: if the notes contain a step, keep it, even if it looks wrong.
- When you cannot read a word or symbol with confidence, write your best guess wrapped as [?guess?]. For something unreadable write [?illegible?]. Do not wrap whole sentences — just the uncertain part.
- Leave out crossed-out text, page numbers, ruled lines, punch holes and doodles.
- Keep the writer's language. Do not translate; Bangla stays Bangla and mixed Bangla–English stays mixed.

Diagrams
- Do not redraw diagrams, sketches, graphs, circuits or free-body diagrams. Where one appears, put a figure line on its own:
  ![Figure: what it shows](page:P#x0,y0,x1,y1)
  P is the page number you were given. x0,y0 is the top-left and x1,y1 the bottom-right corner of the diagram as fractions of the image width and height (0 = left/top edge, 1 = right/bottom edge), two decimals, with a small margin that includes its labels.
- If the diagram carries information the text needs (values, labels, directions), add one short sentence after the figure line saying it.`;

const STYLES = {
  exact: `Style: exact transcription. Keep the writer's own words, abbreviations and order of points; only add Markdown structure and LaTeX.`,
  clean: `Style: clean study notes. Keep all of the content, meaning and language, but fix spelling and grammar, write out abbreviations whose meaning is clear (e.g. "eqn" → "equation", "w.r.t" → "with respect to"), and organise the material with headings and lists. Do not add facts, steps or explanations that are not in the notes.`,
};

const CHECK = `Also: if you notice a probable mistake in the notes themselves (a sign error, a slip in arithmetic, a wrong unit), keep the original text unchanged and add right after it a block quote "> **Check.** …" explaining the issue in one sentence.`;

export function systemPrompt({ style = "exact", flagErrors = false } = {}) {
  return [CORE, STYLES[style] || STYLES.exact, flagErrors ? CHECK : ""].filter(Boolean).join("\n\n");
}

/** One message for any AI chat (the free route): the same rules, for several pages at once. */
export function chatPrompt(opts, pageCount) {
  const many = pageCount > 1;
  return `${systemPrompt(opts)}

The attached ${many ? `${pageCount} images are pages 1 to ${pageCount}` : "image is page 1"} of my notes${many ? ", in order" : ""}. Start each page with a line <!-- page N --> (N = page number) and transcribe every page completely.`;
}

/* ---------- Calling Claude ---------- */

function friendlyApiError(err, Anthropic) {
  if (err && err.name === "AbortError") return "Stopped.";
  if (Anthropic && err instanceof Anthropic.AuthenticationError) return "The API key was not accepted. Check that you copied the whole key (it starts with sk-ant-).";
  if (Anthropic && err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use the model. Check the key's workspace and permissions in the Claude Console.";
  if (Anthropic && err instanceof Anthropic.RateLimitError) return "Too many requests right now (rate limit). Wait a minute and read again.";
  if (Anthropic && err instanceof Anthropic.BadRequestError) {
    const msg = (err.error && err.error.error && err.error.error.message) || err.message || "";
    if (/credit balance/i.test(msg)) return "Your Claude API account has no credit left. Add credit in the Claude Console (Billing), then read again.";
    return `The request was rejected: ${msg}`;
  }
  if (Anthropic && err instanceof Anthropic.InternalServerError) return "Claude's servers had a problem (overloaded). Wait a moment and read again.";
  if (Anthropic && err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API. Check your internet connection (some campus networks block it) and read again.";
  if (Anthropic && err instanceof Anthropic.APIError) return `Claude API error ${err.status || ""}: ${err.message}`;
  return (err && err.message) || String(err);
}

/**
 * Reads one page.
 *   apiKey, jpegBase64, pageNo, pageCount, prevTail (end of the previous page's text, for continuity)
 *   opts: { style, flagErrors, careful }
 *   onText(textSoFar), signal (AbortSignal)
 * Resolves to { text, stopReason, usage }.
 */
export async function readPage({ apiKey, jpegBase64, pageNo, pageCount, prevTail, opts = {}, onText, signal }) {
  let Anthropic = null;
  try {
    ({ default: Anthropic } = await loadSdk());
  } catch (err) {
    throw new Error(window.NSZ ? window.NSZ.friendlyError(err) : String(err));
  }
  const client = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true, maxRetries: 2 });
  const context = prevTail
    ? `For continuity, the previous page ended with:\n"""\n${prevTail}\n"""\nContinue numbering and heading levels from there, but transcribe only this page.`
    : "";
  const content = [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } },
    { type: "text", text: [`This is page ${pageNo} of ${pageCount}. Use P = ${pageNo} in figure lines.`, context, "Transcribe this page."].filter(Boolean).join("\n\n") },
  ];
  let text = "";
  try {
    const stream = client.beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default", // if a safety classifier declines, the API retries on its recommended model
        thinking: { type: "adaptive" },
        output_config: { effort: opts.careful ? "high" : "medium" },
        system: systemPrompt(opts),
        messages: [{ role: "user", content }],
      },
      { signal }
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        if (onText) onText(text);
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      throw new Error("Claude declined to read this page. Try the free route (any AI chat) for it, or type it in.");
    }
    const finalText = final.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    return { text: tidy(finalText || text), stopReason: final.stop_reason, usage: final.usage };
  } catch (err) {
    const e = new Error(friendlyApiError(err, Anthropic));
    e.aborted = !!(signal && signal.aborted);
    e.partial = text;
    throw e;
  }
}

/** Removes a stray ``` fence around the whole reply and trims. */
export function tidy(text) {
  let t = String(text || "").trim();
  const m = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (m) t = m[1].trim();
  return t;
}
