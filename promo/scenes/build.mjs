// Builds each scene page: node promo/scenes/build.mjs → NN-name.html beside each NN-name.src.html.
// Inlines common.js at /*COMMON*/, the Tabler path data (icons.json) at /*ICONS*/{}, and datasets from ../data at /*DATA:name*/null, since artifacts can't fetch any of them.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const common = readFileSync(join(here, "common.js"), "utf8");
const icons = readFileSync(join(here, "icons.json"), "utf8");
for (const f of readdirSync(here).filter((n) => n.endsWith(".src.html"))) {
  // datasets: /*DATA:name*/null becomes promo/data/name.json when that file exists, and stays null otherwise
  const out = readFileSync(join(here, f), "utf8").replace("/*COMMON*/", () => common).replace("/*ICONS*/{}", () => icons)
    .replace(/\/\*DATA:([\w-]+)\*\/null/g, (m, name) => { const p = join(here, "..", "data", `${name}.json`); return existsSync(p) ? readFileSync(p, "utf8") : "null"; });
  writeFileSync(join(here, f.replace(".src.html", ".html")), out);
  console.log(f.replace(".src.html", ".html"));
}
