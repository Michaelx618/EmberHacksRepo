import { repairLatexEscapes as fix, repairInvalidEscapes as pre } from "@/lib/gemini";
const run = (label: string, raw: string, want: string) => {
  let got: string;
  try { got = fix(JSON.parse(pre(raw)).reply); }
  catch (e) { got = "THREW: " + (e as Error).message.slice(0, 50); }
  console.log(got === want ? `PASS  ${label}` : `FAIL  ${label}\n  got: ${JSON.stringify(got)}\n want: ${JSON.stringify(want)}`);
  return got === want;
};
const R = String.raw;
let ok = 0, n = 0;
const t = (l: string, a: string, b: string) => { n++; if (run(l, a, b)) ok++; };

// model emits SINGLE backslashes (invalid JSON escapes)
t("single-backslash LaTeX", R`{"reply":"$\ldots$ and $\sigma^2$"}`, R`$\ldots$ and $\sigma^2$`);
// model emits CORRECTLY escaped backslashes -- must survive untouched
t("double-backslash LaTeX", R`{"reply":"$\\ldots$ and $\\sigma^2$"}`, R`$\ldots$ and $\sigma^2$`);
// the valid-but-wrong control escapes
t("\\b \\f \\t \\r \\n in math", R`{"reply":"$\beta_0$ $\frac12$ $\theta$ $\rho$ $\nu$"}`, R`$\beta_0$ $\frac12$ $\theta$ $\rho$ $\nu$`);
// prose formatting must be preserved
t("prose newlines kept", R`{"reply":"one\ntwo\n\nthree"}`, "one\ntwo\n\nthree");
// mixed
t("mixed math + prose", R`{"reply":"Use $\\frac{1}{2\pi\sigma^2}$ here.\nThen done."}`, "Use " + R`$\frac{1}{2\pi\sigma^2}$` + " here.\nThen done.");
console.log(`\n${ok}/${n} passed`);
