// Comprueba que los datos sintéticos de E2E existen y son JSON válido. Solo lee e2e/fixtures.
import { readFileSync } from "node:fs";

const instancia = process.argv[2];
if (!["local", "test", "e2e"].includes(instancia)) {
  console.error(`instancia E2E no admitida: ${instancia}`);
  process.exit(2);
}
for (const f of ["agenda.json", "clima.json", "vivo-vacio.json", "vivo-pimentel.json"]) {
  JSON.parse(readFileSync(new URL(`fixtures/${f}`, import.meta.url), "utf8"));
}
console.log(`fixtures E2E listos (${instancia})`);
