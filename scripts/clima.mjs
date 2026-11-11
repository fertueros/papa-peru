// Genera site/data/clima.json con Open-Meteo (CC BY 4.0) para cada ciudad de la agenda.
// Se ejecuta en el build (GitHub Actions), nunca desde el navegador: 5.000 visitas/min no
// pueden golpear la API. FALLO BLANDO: si Open-Meteo no responde se conserva el último
// clima.json y el proceso termina en 0; la portada oculta el bloque si el fichero falta.
// Coordenadas: las del lugar del acto de cada ciudad (ciudades[id].lat/lon de la agenda).
import { readFileSync, renameSync, writeFileSync } from "node:fs";

const AGENDA = process.env.AGENDA ?? "site/data/agenda.json";
const SALIDA = process.env.CLIMA_SALIDA ?? "site/data/clima.json";
const API = "https://api.open-meteo.com/v1/forecast";

// Códigos WMO de Open-Meteo → texto corto.
export function cielo(codigo) {
  if (codigo === 0) return "despejado";
  if (codigo === 1) return "mayormente despejado";
  if (codigo === 2) return "parcialmente nublado";
  if (codigo === 3) return "nublado";
  if (codigo === 45 || codigo === 48) return "niebla";
  if (codigo >= 51 && codigo <= 57) return "llovizna";
  if (codigo >= 61 && codigo <= 67) return "lluvia";
  if (codigo >= 71 && codigo <= 77) return "nieve";
  if (codigo >= 80 && codigo <= 82) return "chubascos";
  if (codigo >= 85 && codigo <= 86) return "chubascos de nieve";
  if (codigo >= 95) return "tormenta";
  return "variable";
}

export function construirUrl(ciudades, desde, hasta) {
  const p = new URLSearchParams({
    latitude: ciudades.map((c) => c.lat).join(","),
    longitude: ciudades.map((c) => c.lon).join(","),
    current: "temperature_2m,weather_code,precipitation_probability",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "America/Lima",
    start_date: desde,
    end_date: hasta,
  });
  return `${API}?${p}`;
}

export function transformar(ids, respuesta, ahora = new Date()) {
  const lista = Array.isArray(respuesta) ? respuesta : [respuesta];
  if (lista.length !== ids.length) throw new Error("Open-Meteo devolvió otro número de lugares");
  const ciudades = {};
  ids.forEach((id, i) => {
    const r = lista[i];
    const dias = {};
    r.daily.time.forEach((dia, j) => {
      dias[dia] = {
        max: Math.round(r.daily.temperature_2m_max[j]),
        min: Math.round(r.daily.temperature_2m_min[j]),
        lluvia_prob: r.daily.precipitation_probability_max[j],
      };
    });
    ciudades[id] = {
      temp: Math.round(r.current.temperature_2m),
      cielo: cielo(r.current.weather_code),
      lluvia_prob: r.current.precipitation_probability,
      hora: `${r.current.time}:00-05:00`,
      dias,
    };
  });
  return { actualizado: ahora.toISOString(), fuente: "Open-Meteo", ciudades };
}

async function main() {
  const agenda = JSON.parse(readFileSync(AGENDA, "utf8"));
  const ids = Object.keys(agenda.ciudades);
  const ciudades = ids.map((id) => agenda.ciudades[id]);
  const url = construirUrl(ciudades, agenda.desde, agenda.hasta);
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Open-Meteo respondió ${r.status}`);
  const datos = transformar(ids, await r.json());
  const tmp = `${SALIDA}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(datos, null, 1)}\n`);
  renameSync(tmp, SALIDA);
  console.log(`clima.json actualizado (${ids.length} ciudades)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.warn(`AVISO clima (fallo blando, se conserva el último clima.json): ${e.message}`);
  });
}
