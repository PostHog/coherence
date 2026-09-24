// Builds each scene page: node promo/scenes/build.mjs → NN-name.html beside each NN-name.src.html.
// Inlines common.js at /*COMMON*/ and the Tabler path data (icons.json) at /*ICONS*/{}, since artifacts can't fetch either.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const common = readFileSync(join(here, "common.js"), "utf8");
const icons = readFileSync(join(here, "icons.json"), "utf8");
for (const f of readdirSync(here).filter((n) => n.endsWith(".src.html"))) {
  const out = readFileSync(join(here, f), "utf8").replace("/*COMMON*/", () => common).replace("/*ICONS*/{}", () => icons);
  writeFileSync(join(here, f.replace(".src.html", ".html")), out);
  console.log(f.replace(".src.html", ".html"));
}
