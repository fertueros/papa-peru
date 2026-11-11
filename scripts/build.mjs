// Construye dist/ desde site/: copia todo, minifica JS (empaquetado) y CSS con esbuild
// e incrusta el CSS en el HTML (una petición menos en la carga crítica). Al final comprueba
// el presupuesto de peso (Q-8, Q-9): HTML+CSS+JS <150 KB gzip y cada foto <120 KB.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const SITE = "site";
const DIST = "dist";

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });
cpSync(SITE, DIST, {
  recursive: true,
  filter: (ruta) => !ruta.endsWith(".css") && !/[\\/]js([\\/]|$)/.test(ruta),
});

await build({
  entryPoints: [`${SITE}/js/portada.js`],
  bundle: true,
  format: "esm",
  minify: true,
  target: "es2020",
  outfile: `${DIST}/js/portada.js`,
  legalComments: "none",
});

const css = await build({
  entryPoints: [`${SITE}/estilos.css`],
  bundle: true,
  minify: true,
  write: false,
  target: "chrome90",
});
const cssMin = css.outputFiles[0].text.trim();

const html = readFileSync(`${SITE}/index.html`, "utf8");
const enlace = '<link rel="stylesheet" href="estilos.css">';
if (!html.includes(enlace)) throw new Error(`index.html debe contener ${enlace}`);
writeFileSync(`${DIST}/index.html`, html.replace(enlace, `<style>${cssMin}</style>`));
console.log("dist/ construido");

const LIMITE_CODIGO = 150 * 1024;
const LIMITE_FOTO = 120 * 1024;
const fallos = [];
let codigo = 0;

function recorrer(dir) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      recorrer(ruta);
      continue;
    }
    const ext = extname(ruta);
    if ([".html", ".css", ".js"].includes(ext)) {
      const gz = gzipSync(readFileSync(ruta), { level: 9 }).length;
      codigo += gz;
      console.log(`${ruta}\t${(gz / 1024).toFixed(1)} KB gzip`);
    }
    if (ext === ".webp" && statSync(ruta).size >= LIMITE_FOTO) {
      fallos.push(`${ruta} pesa ${statSync(ruta).size} B (límite ${LIMITE_FOTO})`);
    }
  }
}

recorrer(DIST);
console.log(`TOTAL HTML+CSS+JS\t${(codigo / 1024).toFixed(1)} KB gzip (límite 150 KB)`);
if (codigo >= LIMITE_CODIGO) fallos.push(`código ${codigo} B gzip >= ${LIMITE_CODIGO}`);
for (const f of fallos) console.error(`FALLO ${f}`);
process.exit(fallos.length ? 1 : 0);
