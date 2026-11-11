// R4 · G-7: todo en hora de Perú aunque el equipo esté en Europe/Madrid (C-21).
process.env.TZ = "Europe/Madrid";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { diaCorto, diaPeru, duracion, hora } from "../site/js/hora.js";
import { momento, titular } from "../site/js/momento.js";

const agenda = JSON.parse(readFileSync(new URL("../site/data/agenda.json", import.meta.url), "utf8"));

test("C-21: 18:05 de Madrid del viernes 13 → 12:05 de Perú y lo que toca a esa hora", () => {
  const ahora = new Date("2026-11-13T18:05:00+01:00");
  assert.equal(ahora.getHours(), 18, "el proceso corre de verdad en hora de Madrid");
  assert.equal(hora(ahora), "12:05");
  assert.equal(diaCorto(ahora), "viernes 13");
  const m = momento(agenda, null, ahora);
  assert.equal(titular(m, agenda), "Ahora: Santa Misa en las Pampas de Pimentel");
});

test("el día de Perú no cambia a medianoche de Madrid", () => {
  const ahora = new Date("2026-11-14T00:30:00+01:00");
  assert.equal(diaPeru(ahora), "2026-11-13");
});

test("duraciones legibles", () => {
  assert.equal(duracion(0), "menos de 1 min");
  assert.equal(duracion(45 * 60000), "45 min");
  assert.equal(duracion(120 * 60000), "2 h");
  assert.equal(duracion((26 * 60 + 5) * 60000), "1 d 2 h");
});
