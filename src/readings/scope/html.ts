/**
 * A minimal HTML string helper shared by the Node builder and the browser
 * script. Every interpolated value is escaped unless it was produced by `html`
 * itself or wrapped in `raw`, so glossary text can never become markup.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/** A string already safe to place in markup. */
export class Markup {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
  toString(): string {
    return this.text;
  }
}

export function raw(text: string): Markup {
  return new Markup(text);
}

export type HtmlValue = string | number | Markup | HtmlValue[] | null | undefined | false;

function render(value: HtmlValue): string {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof Markup) return value.text;
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(String(value));
}

/** Tagged template: `html\`<p>${text}</p>\`` escapes `text`. */
export function html(strings: TemplateStringsArray, ...values: HtmlValue[]): Markup {
  let out = "";
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += render(values[i]);
  });
  return new Markup(out);
}

/** Join a list of markup pieces without a separator. */
export function join(pieces: Markup[]): Markup {
  return new Markup(pieces.map((p) => p.text).join(""));
}

/** A slug safe for an element id: lower case, words joined by hyphens. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
