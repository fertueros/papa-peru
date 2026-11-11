// clima.mjs sin red: transformación de una respuesta de Open-Meteo grabada (no se llama a la API).
import assert from "node:assert/strict";
import { test } from "node:test";
import { cielo, construirUrl, transformar } from "../scripts/clima.mjs";

const respuesta = [
  {
    current: { time: "2026-11-14T10:00", temperature_2m: 14.4, weather_code: 61, precipitation_probability: 55 },
    daily: {
      time: ["2026-11-14"],
      temperature_2m_max: [18.2],
      temperature_2m_min: [8.6],
      precipitation_probability_max: [60],
    },
  },
];

test("C-24: máxima, mínima y lluvia del día de la visita", () => {
  const c = transformar(["succhabamba"], respuesta, new Date("2026-11-14T15:00:00Z"));
  assert.equal(c.actualizado, "2026-11-14T15:00:00.000Z");
  assert.equal(c.fuente, "Open-Meteo");
  assert.deepEqual(c.ciudades.succhabamba.dias["2026-11-14"], { max: 18, min: 9, lluvia_prob: 60 });
  assert.equal(c.ciudades.succhabamba.cielo, "lluvia");
  assert.equal(c.ciudades.succhabamba.hora, "2026-11-14T10:00:00-05:00");
});

test("la URL pide las coordenadas de cada ciudad y la zona de Lima", () => {
  const u = new URL(construirUrl([{ lat: -6.627, lon: -78.944 }], "2026-11-11", "2026-11-16"));
  assert.equal(u.searchParams.get("latitude"), "-6.627");
  assert.equal(u.searchParams.get("timezone"), "America/Lima");
});

test("códigos WMO", () => {
  assert.equal(cielo(0), "despejado");
  assert.equal(cielo(95), "tormenta");
});

test("un número distinto de lugares es error (fallo blando en main)", () => {
  assert.throws(() => transformar(["a", "b"], respuesta));
});
