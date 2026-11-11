// Genera site/og.png (1200×630) — tarjeta Open Graph propia: silueta del Perú (Natural Earth,
// dominio público) con las ciudades y la ruta de la visita, y la frase fija. Sin fotos de
// terceros ni datos de «ahora» (R8). Se ejecuta a mano una vez y el PNG se commitea:
//   node scripts/og.mjs
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { proyectar } from "../site/js/momento.js";

const agenda = JSON.parse(readFileSync("site/data/agenda.json", "utf8"));
const svg = readFileSync("site/img/peru.svg", "utf8");
const path = svg.match(/<path d="([^"]+)"/)[1];

// Ruta en orden: ciudades por las que pasan los tramos internos.
const orden = [];
for (const tr of agenda.tramos) {
  for (const id of [tr.origen_id, tr.destino_id]) {
    if (agenda.ciudades[id] && orden.at(-1) !== id) orden.push(id);
  }
}
const pts = orden.map((id) => proyectar(agenda.ciudades[id].lat, agenda.ciudades[id].lon));
const ruta = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
const puntos = Object.values(agenda.ciudades)
  .map((c) => {
    const p = proyectar(c.lat, c.lon);
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="#7a1f2b" stroke="#fff" stroke-width="2.5"/>`;
  })
  .join("");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;width:1200px;height:630px;display:flex;font-family:"DejaVu Sans",system-ui,sans-serif;background:#faf8f5;color:#1d1d1f}
.izq{width:690px;padding:70px 0 60px 70px;display:flex;flex-direction:column;justify-content:center}
.banda{width:90px;height:10px;background:#7a1f2b;margin-bottom:34px}
h1{font-size:64px;line-height:1.08;margin:0 0 28px}
p{font-size:32px;line-height:1.3;margin:0;color:#4a4a52}
.dcha{flex:1;display:flex;align-items:center;justify-content:center;background:#efe9e1}
</style></head><body>
<div class="izq"><div class="banda"></div><h1>Dónde está el papa León XIV en Perú</h1>
<p>Sigue la visita: dónde está, la próxima parada, la agenda y el clima. 11–16 de noviembre de 2026.</p></div>
<div class="dcha"><svg width="390" height="565" viewBox="0 0 259 375">
<path d="${path}" fill="#ffffff" stroke="#5b7a5a" stroke-width="1.6" stroke-linejoin="round"/>
<path d="${ruta}" fill="none" stroke="#7a1f2b" stroke-width="2" stroke-dasharray="5 4"/>${puntos}</svg></div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html);
await page.screenshot({ path: "site/og.png", type: "png" });
await browser.close();
console.log("site/og.png generado");
