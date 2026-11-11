// Servidor estático mínimo para E2E y Lighthouse: sirve una carpeta bajo /papa-peru/
// (como GitHub Pages) y también en la raíz. Uso: node e2e/servidor.mjs <carpeta> <puerto>
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const raiz = resolve(process.argv[2] ?? "dist");
const puerto = Number(process.argv[3] ?? 8080);
const tipos = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

createServer((req, res) => {
  let ruta = decodeURIComponent(new URL(req.url, "http://x").pathname);
  ruta = ruta.replace(/^\/papa-peru(?=\/|$)/, "");
  if (ruta === "" || ruta.endsWith("/")) ruta += "index.html";
  const fichero = normalize(join(raiz, ruta));
  if (!fichero.startsWith(raiz)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (!statSync(fichero).isFile()) throw new Error("no es fichero");
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("404");
    return;
  }
  res.writeHead(200, {
    "content-type": tipos[extname(fichero)] ?? "application/octet-stream",
    "cache-control": "no-cache",
  });
  createReadStream(fichero).pipe(res);
}).listen(puerto, "127.0.0.1", () => {
  console.log(`sirviendo ${raiz} en http://127.0.0.1:${puerto}/papa-peru/`);
});
