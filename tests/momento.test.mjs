// R1-R6 sobre la AGENDA REAL (site/data/agenda.json) con relojes fijos y vivo.json sintético.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { duracion, hora } from "../site/js/hora.js";
import { antiguo, momento, proyectar, rotuloOrigen, textoProxima, titular } from "../site/js/momento.js";

const agenda = JSON.parse(readFileSync(new URL("../site/data/agenda.json", import.meta.url), "utf8"));
const VACIO = { actualizado: null, avion: null, detecciones: [], agenda_cambios: [] };
const lima = (s) => new Date(`${s}-05:00`);

describe("R1 · G-6: dónde está según la hora (C-18, C-20)", () => {
  test("11-nov 10:00 → por llegar, «7 h 30 min» hasta el Callao", () => {
    const m = momento(agenda, VACIO, lima("2026-11-11T10:00:00"));
    assert.equal(m.estado, "por-llegar");
    assert.equal(duracion(m.falta_ms), "7 h 30 min");
    assert.equal(titular(m, agenda), "El papa llega al Callao en 7 h 30 min");
    assert.equal(rotuloOrigen(m), "según la agenda");
  });

  test("14-nov 09:30 → en helicóptero Chiclayo → Santa Cruz de Succhabamba, llega 09:50, con avance", () => {
    const m = momento(agenda, VACIO, lima("2026-11-14T09:30:00"));
    assert.equal(m.estado, "en-tramo");
    assert.equal(m.tramo.id, "chiclayo-succhabamba");
    assert.equal(titular(m, agenda), "En helicóptero de Chiclayo a Santa Cruz de Succhabamba, llega a las 09:50");
    assert.equal(m.avion.avance, 0.5);
  });

  test("después de la salida a Roma → terminada, «partió a Roma»", () => {
    const m = momento(agenda, VACIO, lima("2026-11-16T14:00:00"));
    assert.equal(m.estado, "terminada");
    assert.equal(m.proxima, null);
    assert.match(titular(m, agenda), /partió a Roma el lunes 16 a las 13:45/);
  });

  test("13:45 exacto ya es terminada; 13:44 aún es la despedida", () => {
    assert.equal(momento(agenda, VACIO, lima("2026-11-16T13:45:00")).estado, "terminada");
    const m = momento(agenda, VACIO, lima("2026-11-16T13:44:00"));
    assert.equal(m.parada.id, "despedida-callao");
    assert.match(textoProxima(m.proxima), /^Próxima: 13:45 Salida en avión hacia Roma, en 1 min$/);
  });

  test("una parada sigue en curso hasta el inicio de lo siguiente (S-11)", () => {
    const m = momento(agenda, VACIO, lima("2026-11-12T16:00:00"));
    assert.equal(m.estado, "en-parada");
    assert.equal(m.parada.id, "encuentro-plaza-catedral-lima");
  });

  test("aterrizado y antes del siguiente acto → en la ciudad de destino", () => {
    const m = momento(agenda, VACIO, lima("2026-11-15T14:40:00"));
    assert.equal(m.estado, "en-parada");
    assert.equal(m.parada, null);
    assert.equal(m.ciudad, "pucallpa");
    assert.equal(titular(m, agenda), "En Pucallpa: llegó a las 14:30");
  });

  test("el vuelo de llegada en el aire sigue siendo cuenta atrás (G-6)", () => {
    const m = momento(agenda, VACIO, lima("2026-11-11T13:00:00"));
    assert.equal(m.estado, "por-llegar");
    assert.equal(m.vuelo.id, "buenosaires-lima");
    assert.equal(m.proxima.dato.id, "llegada-callao");
  });
});

describe("R2/R5 · G-8: rótulo de origen en tierra (C-19, C-22)", () => {
  const pimentel = {
    actualizado: "2026-11-13T10:45:00-05:00",
    avion: null,
    detecciones: [
      {
        parada: "misa-pampas-pimentel",
        que: "empezo",
        hora_hecho: "2026-11-13T10:42:00-05:00",
        retraso_min: null,
        fuente: "Vatican News",
        url: "https://www.vaticannews.va/es.html",
        frase: "Comenzó la misa en las Pampas de Pimentel",
        hora_deteccion: "2026-11-13T10:45:00-05:00",
      },
    ],
    agenda_cambios: [],
  };

  test("13-nov 10:50 con detección → «según Vatican News, 10:42» y próxima 12:40", () => {
    const m = momento(agenda, pimentel, lima("2026-11-13T10:50:00"));
    assert.equal(m.estado, "en-parada");
    assert.equal(m.parada.id, "misa-pampas-pimentel");
    assert.equal(titular(m, agenda), "Ahora: Santa Misa en las Pampas de Pimentel");
    assert.equal(rotuloOrigen(m), "empezó · según Vatican News, 10:42");
    assert.equal(
      textoProxima(m.proxima),
      "Próxima: 12:40 Visita privada a la Capilla San Óscar A. Romero, en 1 h 50 min",
    );
  });

  test("12-nov 11:40 sin detección → «según la agenda» y el punto es el lugar del acto", () => {
    const m = momento(agenda, VACIO, lima("2026-11-12T11:40:00"));
    assert.equal(m.parada.id, "encuentro-plaza-catedral-lima");
    assert.equal(rotuloOrigen(m), "según la agenda");
    assert.equal(m.avion, undefined, "en tierra nunca hay posición en tiempo real");
    assert.deepEqual([m.parada.lat, m.parada.lon], [-12.046, -77.031]);
  });

  test("una detección futura (hora_hecho > ahora) no cuenta", () => {
    const m = momento(agenda, pimentel, lima("2026-11-13T10:35:00"));
    assert.equal(rotuloOrigen(m), "según la agenda");
  });
});

describe("R3: próxima parada y «hora por confirmar» (C-20 2ª parte)", () => {
  test("vigilia del 12 alargada → «Cena con los obispos · hora por confirmar»", () => {
    const vivo = {
      ...VACIO,
      detecciones: [
        {
          parada: "vigilia-jovenes-monumental",
          que: "retraso",
          hora_hecho: "2026-11-12T19:40:00-05:00",
          retraso_min: 30,
          fuente: "Vatican News",
          url: "https://www.vaticannews.va/es.html",
          frase: "La vigilia se prolonga",
          hora_deteccion: "2026-11-12T19:45:00-05:00",
        },
      ],
    };
    const m = momento(agenda, vivo, lima("2026-11-12T19:50:00"));
    assert.equal(m.parada.id, "vigilia-jovenes-monumental");
    assert.equal(textoProxima(m.proxima), "Próxima: Cena con los obispos · hora por confirmar");
    assert.match(rotuloOrigen(m), /según Vatican News, 19:40 · retraso de 30 min/);
  });

  test("sin retraso la cuenta atrás se recalcula con el reloj", () => {
    const a = momento(agenda, VACIO, lima("2026-11-12T19:50:00"));
    const b = momento(agenda, VACIO, lima("2026-11-12T19:51:00"));
    assert.equal(textoProxima(a.proxima), "Próxima: 20:00 Cena con los obispos, en 10 min");
    assert.equal(textoProxima(b.proxima), "Próxima: 20:00 Cena con los obispos, en 9 min");
  });
});

describe("R6 · G-8: avión real vs estimado (C-23)", () => {
  const avion = (h) => ({
    ...VACIO,
    actualizado: "2026-11-15T13:38:00-05:00",
    avion: {
      tramo: "cusco-pucallpa",
      lat: -11.1,
      lon: -73.0,
      alt_m: 10000,
      hora: `2026-11-15T${h}:00-05:00`,
      fuente: "ADS-B",
    },
  });

  test("15-nov 13:40 con posición de 13:20 → estimado, a mitad de camino", () => {
    const m = momento(agenda, avion("13:20"), lima("2026-11-15T13:40:00"));
    assert.equal(m.estado, "en-tramo");
    assert.equal(m.tramo.id, "cusco-pucallpa");
    assert.equal(m.avion.real, false);
    assert.match(rotuloOrigen(m), /estimado/);
    const f = 35 / 85;
    assert.ok(Math.abs(m.avion.lat - (-13.536 + (-8.378 + 13.536) * f)) < 1e-9);
    assert.notEqual(m.avion.lat, -11.1);
  });

  test("con posición de 13:36 → real, «posición de hace 4 min»", () => {
    const m = momento(agenda, avion("13:36"), lima("2026-11-15T13:40:00"));
    assert.equal(m.avion.real, true);
    assert.deepEqual([m.avion.lat, m.avion.lon], [-11.1, -73.0]);
    assert.equal(rotuloOrigen(m), "posición de hace 4 min");
  });

  test("posición de otro tramo no se usa", () => {
    const v = avion("13:36");
    v.avion.tramo = "lima-chiclayo";
    assert.equal(momento(agenda, v, lima("2026-11-15T13:40:00")).avion.real, false);
  });
});

describe("R7: datos antiguos (>30 min)", () => {
  test("umbral de 30 min", () => {
    const ahora = lima("2026-11-13T11:00:00");
    assert.equal(antiguo("2026-11-13T10:31:00-05:00", ahora), false);
    assert.equal(antiguo("2026-11-13T10:29:00-05:00", ahora), true);
    assert.equal(antiguo(null, ahora), false);
  });
});

describe("mapa", () => {
  test("la proyección deja todas las paradas con coordenadas dentro del contorno", () => {
    for (const p of agenda.paradas.filter((x) => x.lat !== null)) {
      const { x, y } = proyectar(p.lat, p.lon);
      assert.ok(x > 0 && x < 259 && y > 0 && y < 375, p.id);
    }
  });
});

test("las horas de la agenda salen literales de la fuente oficial", () => {
  assert.equal(hora(agenda.llegada_peru), "17:30");
  assert.equal(agenda.paradas.length, 24);
  assert.equal(agenda.tramos.length, 8);
});
