/** Fix LaTeX escapes that JSON.parse turned into control chars (\b → backspace, etc.). */
const ALWAYS_LATEX: Record<string, string> = { "\b": "\\b", "\f": "\\f", "\v": "\\v" };
const MATH_ONLY_LATEX: Record<string, string> = { "\n": "\\n", "\t": "\\t", "\r": "\\r" };

export function repairLatexEscapes(text: string): string {
  let out = text.replace(/[\b\f\v]/g, (c) => ALWAYS_LATEX[c] ?? c);
  out = out.replace(/\$\$?[^$]*?\$\$?/g, (span) =>
    span.replace(/[\n\t\r]/g, (c) => MATH_ONLY_LATEX[c] ?? c),
  );
  return out;
}
