// DP-002 · el rótulo «Recorrido anunciado…» entra A LA VEZ que la geometría del recorrido: en cada cuadro de las
// escenas de Lima con recorridos, su opacidad en pantalla es ≥ la de cualquier trazo del recorrido, desde el primero.
// Se ejecuta reel.html de verdad (vm, con un lienzo falso que lleva la cuenta de globalAlpha con save/restore).
//   node --test reel/tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), "utf8");
const html = leer("../reel.html");
const agenda = JSON.parse(leer("../../site/data/agenda.json"));
const guion = JSON.parse(leer("../partes/1-lima/guion.json"));
const recorridos = JSON.parse(leer("../partes/1-lima/recorridos.json"));
const correcciones = JSON.parse(leer("../partes/1-lima/correcciones.json"));
const FPS = 30;

/** Lienzo 2D falso: no pinta, pero apunta la opacidad efectiva de cada trazo y de cada texto. */
function lienzoFalso(registro) {
  const pila = [];
  const estado = { globalAlpha: 1, font: "10px sans-serif" };
  const metodos = {
    save: () => pila.push({ ...estado }),
    restore: () => Object.assign(estado, pila.pop() ?? {}),
    measureText: (t) => ({
      width: String(t).length * 0.55 * (Number.parseFloat(/(\d+)px/.exec(estado.font)?.[1]) || 10),
    }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    stroke: () => registro.trazos.push({ a: estado.globalAlpha, dentroDeTrazo: registro.enTrazo > 0 }),
    fillText: (t) => registro.textos.push({ t: String(t), a: estado.globalAlpha }),
    getLineDash: () => [],
  };
  return new Proxy(estado, {
    get: (o, k) => (k in metodos ? metodos[k] : k in o ? o[k] : () => {}),
    set: (o, k, v) => {
      o[k] = v;
      return true;
    },
  });
}

/** Carga reel.html (con recorridos.js y correcciones.js) en un contexto vm y prepara un reel de frases de 5 s. */
function cargar(fuente) {
  const registro = { trazos: [], textos: [], enTrazo: 0 };
  const ctx = lienzoFalso(registro);
  const g = {
    console,
    document: { getElementById: () => ({ getContext: () => ctx }) },
    Path2D: class {},
    Image: class {},
  };
  g.window = g;
  vm.createContext(g);
  vm.runInContext(leer("../recorridos.js"), g);
  vm.runInContext(leer("../correcciones.js"), g);
  const scripts = [...fuente.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  vm.runInContext(scripts.at(-1), g);
  // trazo() es la geometría del recorrido: se marca para separar sus stroke() de los demás (subtítulos, mapa…)
  const trazo = g.trazo;
  g.trazo = (...a) => {
    registro.enTrazo++;
    try {
      trazo(...a);
    } finally {
      registro.enTrazo--;
    }
  };
  let t = 0.75;
  const trozos = guion.trozos.map((tr) => {
    const frases = tr.texto.split(/(?<=[.!?])\s+(?=[¿¡A-ZÁÉÍÓÚÑ])/).map((texto) => {
      const f = { t0: t, t1: t + 4.6, texto, golpes: [[texto, t, t + 4.6]] };
      t += 5;
      return f;
    });
    return { ...tr, t0: frases[0].t0, t1: t, frases };
  });
  trozos[0].t0 = 0;
  g.GUION_DATOS = Object.fromEntries(guion.trozos.map((x) => [x.id, x.datos ?? []]));
  g.RECORRIDOS = recorridos;
  g.CORRECCIONES = correcciones;
  g.reelPreparar({ trozos, duracion: t + 3, meta: { parte: "1/3", tramo: "Lima" } }, agenda, null);
  return { g, registro, trozos };
}

const L1 = "Recorrido anunciado por la coordinación de la visita (11-nov)";
/** Cuadros de la entrada (primer segundo) de cada escena con recorridos en los que el rótulo va por detrás. */
function cuadrosSinRotulo(fuente) {
  const { g, registro, trozos } = cargar(fuente);
  const malos = [];
  let escenas = 0;
  for (const tr of trozos.filter((x) => x.mapa?.recorridos?.length)) {
    escenas++;
    for (let n = 0; n <= FPS; n++) {
      registro.trazos.length = registro.textos.length = 0;
      g.reelIr(tr.t0 + n / FPS);
      const geo = Math.max(0, ...registro.trazos.filter((x) => x.dentroDeTrazo).map((x) => x.a));
      const rot = Math.max(0, ...registro.textos.filter((x) => x.t === L1).map((x) => x.a));
      if (geo > 0 && rot + 1e-9 < geo)
        malos.push(`${tr.id} cuadro ${n}: geometría ${geo.toFixed(3)} > rótulo ${rot.toFixed(3)}`);
    }
  }
  return { malos, escenas };
}

describe("DP-002 · el rótulo del recorrido entra a la vez que la geometría", () => {
  test("en las dos escenas de Lima con recorridos, desde el primer cuadro, rótulo ≥ geometría", () => {
    const { malos, escenas } = cuadrosSinRotulo(html);
    assert.equal(escenas, 2, "noche-11 y manana-12");
    assert.deepEqual(malos, []);
  });
  test("caso negativo: el rótulo con retraso (el fallo de la 3ª ronda, ap(s, .3, .4)) se detecta", () => {
    const viejo = html.replace(
      "dibujarRecorridos(pl, s, ag.rec, 1,",
      "dibujarRecorridos(pl, s, ag.rec, ap(s, .3, .4),",
    );
    assert.notEqual(viejo, html, "el caso negativo necesita la llamada a dibujarRecorridos() con rótulo 1");
    const { malos } = cuadrosSinRotulo(viejo);
    assert.ok(
      malos.some((m) => m.startsWith("noche-11")) && malos.some((m) => m.startsWith("manana-12")),
      malos.join("\n"),
    );
  });
});

/* R13 · con la sede corregida (Estadio Nacional, a ~0,8 km de la Nunciatura) la cámara de tarde-12 se acerca: ningún
   lugar puede quedar fuera del mapa (en la 6ª vuelta, antes del arreglo, Estadio Nacional y Nunciatura caían bajo el
   subtítulo). Se comprueba cada punto de acto dibujado en las escenas de Lima sin calles, cada 0,25 s tras el zoom. */
function puntosFuera(fuente) {
  const { g, trozos } = cargar(fuente);
  const MAPA = vm.runInContext("MAPA", g);
  const punto = g.punto;
  let dibujados = [];
  g.punto = (xy, r, color, a = 1, ...resto) => {
    if (a > 0.05) dibujados.push(xy);
    return punto(xy, r, color, a, ...resto);
  };
  const fuera = [];
  let escenas = 0;
  for (const tr of trozos.filter((x) => x.escena === "lima" && !x.mapa?.recorridos?.length)) {
    escenas++;
    for (let s = 1.5; tr.t0 + s < tr.t1; s += 0.25) {
      dibujados = [];
      g.reelIr(tr.t0 + s);
      for (const [x, y] of dibujados)
        if (x < MAPA.x || x > MAPA.x + MAPA.w || y < MAPA.y || y > MAPA.y + MAPA.h)
          fuera.push(`${tr.id} +${s.toFixed(2)} s: punto en (${Math.round(x)}, ${Math.round(y)})`);
    }
  }
  return { fuera: [...new Set(fuera)], escenas };
}
describe("R13 · los lugares de cada escena de Lima caen dentro del mapa", () => {
  test("tarde-12 (Plaza Mayor → Estadio Nacional → Nunciatura): todos los puntos dentro del mapa", () => {
    const { fuera, escenas } = puntosFuera(html);
    assert.ok(escenas >= 1);
    assert.deepEqual(fuera, []);
  });
  test("caso negativo: con el acercamiento sin recentrar de antes, el Estadio Nacional sale del mapa", () => {
    const viejo = html.replace(
      "  return encuadre(pts, .84, LIMA_PUNTOS, k);",
      "  const v = encuadre(pts, .84, LIMA_PUNTOS);\n  return { ...v, k: Math.max(v.k, TRASLADO_MIN * 2.5 / Math.min(...tramos)) };",
    );
    assert.notEqual(viejo, html, "el caso negativo necesita el return de vistaLima()");
    assert.ok(puntosFuera(viejo).fuera.some((m) => m.startsWith("tarde-12")));
  });
});
