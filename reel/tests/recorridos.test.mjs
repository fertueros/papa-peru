// DP-002 / R11 · los reels solo dibujan recorridos ANUNCIADOS: cada calle dibujada o rotulada está en
// reel/partes/<n>/recorridos.json con su fuente, y ningún recorrido sale sin su rótulo.
//   node --test reel/tests/
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), "utf8");
const html = leer("../reel.html");
const ctx = {};
vm.runInNewContext(leer("../recorridos.js"), ctx);
const { Recorridos } = ctx;
const ROTULO_DP002 =
  "Recorrido anunciado por la coordinación de la visita (11-nov) · puede cambiar · no es seguimiento en vivo";

const partes = readdirSync(new URL("../partes/", import.meta.url)).filter((p) =>
  existsSync(new URL(`../partes/${p}/guion.json`, import.meta.url)),
);
/** Cuerpo de una función de reel.html (desde su firma hasta la siguiente función de primer nivel). */
const cuerpo = (fuente, nombre) => {
  const i = fuente.indexOf(`function ${nombre}(`);
  assert.ok(i >= 0, `reel.html no tiene ${nombre}()`);
  const j = fuente.indexOf("\nfunction ", i + 1);
  return fuente.slice(i, j < 0 ? undefined : j);
};

describe("R11 · el rótulo y el dibujo de recorridos en reel.html", () => {
  test("el rótulo es literalmente el de DP-002", () => {
    assert.equal(Recorridos.ROTULO, ROTULO_DP002);
  });
  test("dibujarRecorridos() dibuja siempre el rótulo y solo calles del plan", () => {
    const f = cuerpo(html, "dibujarRecorridos");
    assert.match(f, /rotuloRecorrido\(/);
    assert.match(cuerpo(html, "rotuloRecorrido"), /Recorridos\.ROTULO/);
    assert.ok(html.includes('<script src="recorridos.js"></script>'));
    // los recorridos solo llegan a la escena por Recorridos.plan()
    assert.match(html, /Recorridos\.plan\(REC, tr\.mapa\.recorridos\)/);
  });
  test("reel.html no lleva nombres de calles escritos a mano ni consulta OSM al renderizar", () => {
    assert.doesNotMatch(html, /\b(Av|Jr)\.\s+\p{Lu}|Avenida\s+\p{Lu}|Jirón\s+\p{Lu}/u);
    assert.doesNotMatch(html, /overpass|openstreetmap\.org\/api|tile/i);
  });
  test("R8 · sin pantalla de créditos en el vídeo; los rótulos de veracidad se quedan", () => {
    assert.ok(!html.includes("function creditos("), "reel.html aún tiene la pantalla de créditos");
    assert.doesNotMatch(cuerpo(html, "reelIr"), /creditos\(/);
    assert.match(cuerpo(html, "reelIr"), /sujeto a cambios/);
  });
});

for (const nombre of partes) {
  const ruta = new URL(`../partes/${nombre}/recorridos.json`, import.meta.url);
  const guion = JSON.parse(leer(`../partes/${nombre}/guion.json`));
  const usan = guion.trozos.filter((t) => t.mapa?.recorridos?.length);
  if (!existsSync(ruta)) {
    test(`${nombre}: sin recorridos.json ningún trozo pide recorridos`, () => assert.equal(usan.length, 0));
    continue;
  }
  const doc = JSON.parse(readFileSync(ruta, "utf8"));

  describe(`R11 · ${nombre}: cada calle dibujada está en recorridos.json con fuente`, () => {
    test("recorridos.json cumple (fuente, URL, fecha, orden del anuncio, ≤ 300 puntos, ODbL)", () => {
      // (los arrays vienen de otro contexto de vm: se comparan como lista de textos)
      assert.equal(Recorridos.errores(doc).join("\n"), "");
    });
    for (const tr of usan) {
      test(`${tr.id}: lo que dibuja y rotula sale del anuncio`, () => {
        assert.equal(tr.escena, "lima", "solo la escena de Lima sabe dibujar recorridos");
        const plan = Recorridos.plan(doc, tr.mapa.recorridos);
        assert.equal(plan.rotulo, ROTULO_DP002);
        for (const r of plan.recorridos) {
          const fuente = doc.recorridos.find((x) => x.id === r.id);
          assert.equal(fuente.trozo, tr.id, `${r.id} pertenece a otro trozo`);
          for (const t of r.trazos.filter((x) => x.calle)) {
            assert.ok(
              fuente.anunciado.some((a) => Recorridos.norm(a) === Recorridos.norm(t.calle)),
              `${t.calle} no está en el anuncio de ${r.id}`,
            );
          }
        }
        for (const calle of plan.rotulos)
          assert.ok(
            plan.recorridos.some((r) =>
              doc.recorridos
                .find((x) => x.id === r.id)
                .anunciado.map(Recorridos.norm)
                .includes(Recorridos.norm(calle)),
            ),
            `rótulo ${calle} sin fuente`,
          );
      });
    }
    test("ningún recorrido queda sin escena (y por tanto sin rótulo)", () => {
      for (const r of doc.recorridos)
        assert.ok(
          usan.some((t) => t.id === r.trozo && t.mapa.recorridos.includes(r.id)),
          `${r.id} no lo usa su trozo ${r.trozo}`,
        );
    });
  });
}

/* Casos negativos: el control se pone ROJO si algo sale de fuera del anuncio. */
describe("R11 · el control detecta alteraciones (casos negativos)", () => {
  const doc = JSON.parse(leer("../partes/1-lima/recorridos.json"));
  const alterado = (fn) => {
    const d = structuredClone(doc);
    fn(d);
    return Recorridos.errores(d);
  };
  const rojo = (errores, patron) =>
    assert.ok(
      errores.some((e) => patron.test(e)),
      `debía fallar con ${patron}; errores: ${JSON.stringify(errores)}`,
    );
  const rec = (d, id) => d.recorridos.find((r) => r.id === id);

  test("una calle que no está en el anuncio (av. Abancay)", () => {
    const e = alterado((d) => {
      rec(d, "12-papamovil").tramos[1].calle = "Av. Abancay";
    });
    rojo(e, /«Av\. Abancay» no está en el anuncio/);
    assert.throws(
      () => Recorridos.plan(Object.assign(structuredClone(doc), { recorridos: [] }), ["12-papamovil"]),
      /desconocido/,
    );
  });
  test("un recorrido sin URL ni fecha de la fuente", () => {
    const e = alterado((d) => {
      delete rec(d, "11-papamovil").fuente;
    });
    rojo(e, /11-papamovil: fuente sin URL/);
    rojo(e, /11-papamovil: fuente sin fecha/);
  });
  test("el rótulo cambiado o sin «puede cambiar»", () => {
    rojo(
      alterado((d) => (d.rotulo = "Recorrido del papa")),
      /rótulo distinto/,
    );
    assert.throws(() => Recorridos.plan({ ...doc, rotulo: "" }, ["11-cerrado"]), /rótulo/);
  });
  test("calles fuera de orden o una calle anunciada que no se dibuja", () => {
    rojo(
      alterado((d) => rec(d, "11-cerrado").tramos.reverse()),
      /fuera del orden del anuncio/,
    );
    rojo(
      alterado((d) => rec(d, "12-papamovil").tramos.splice(3, 1)),
      /«jr\. Conde de Superunda» no se dibuja/,
    );
  });
  test("geometría vacía, fuera de la zona consultada o de más de 300 puntos", () => {
    rojo(
      alterado((d) => (rec(d, "12-papamovil").tramos[1].puntos = [])),
      /sin geometría/,
    );
    rojo(
      alterado((d) => rec(d, "12-papamovil").tramos[1].puntos.push([-13.5, -71.9])),
      /fuera de la zona/,
    );
    rojo(
      alterado((d) => {
        const t = rec(d, "11-cerrado").tramos[1];
        while (t.puntos.length < 320) t.puntos.push(t.puntos[t.puntos.length - 1]);
      }),
      /máximo 300/,
    );
  });
  test("un enlace largo o sin motivo (una calle inventada disfrazada de recta)", () => {
    const e = alterado((d) => {
      const t = rec(d, "11-papamovil").tramos.find((x) => x.enlace);
      t.puntos[1] = [-12.09, -77.0];
      delete t.motivo;
    });
    rojo(e, /enlace de más de 1000 m/);
    rojo(e, /enlace sin motivo/);
  });
  test("un vehículo que no es «cerrado» ni «papamóvil»", () => {
    rojo(
      alterado((d) => (rec(d, "11-cerrado").vehiculo = "helicoptero")),
      /vehículo desconocido/,
    );
  });
  test("sin crédito de OpenStreetMap", () => {
    rojo(
      alterado((d) => (d.geometria.licencia = "")),
      /OpenStreetMap \/ ODbL/,
    );
  });
  test("reel.html con dibujarRecorridos() sin rótulo se detecta", () => {
    const sin = html.replace("rotuloRecorrido(aRotulo);", "");
    assert.doesNotMatch(cuerpo(sin, "dibujarRecorridos"), /rotuloRecorrido\(/);
    assert.match(cuerpo(html, "dibujarRecorridos"), /rotuloRecorrido\(/);
  });
});

/* R8 (Fernando, 11-nov): los créditos van en el comentario fijado de LinkedIn, no en el vídeo. texto-linkedin.md es
   un fichero generado, fuera de git (../.runtime/reels/<parte>/ del meta-repo o $REEL_SALIDA). */
const CREDITOS_LINKEDIN = [
  /Calles: © OpenStreetMap contributors \(ODbL\)/,
  /Recorridos anunciados por la coordinación nacional de la visita \(vía RPP, 11-nov\)/,
  /rpp\.pe\/peru\/actualidad\/papa-leon-xiv-conoce-las-rutas/,
  /programa oficial de la Santa Sede/,
  /Natural Earth/,
  /Fotos \(Wikimedia Commons, recortadas\)/,
  /Voz:/,
  /Música:/,
  /Vídeo: CC BY-SA 4\.0/,
];
const faltanCreditos = (texto) => {
  const i = texto.indexOf("## Comentario fijado");
  const comentario = i < 0 ? "" : texto.slice(i);
  return CREDITOS_LINKEDIN.filter((r) => !r.test(comentario)).map(String);
};
const linkedin = (parte) =>
  new URL(
    `${process.env.REEL_SALIDA ? `file://${process.env.REEL_SALIDA}/` : `../../../../.runtime/reels/${parte}/`}texto-linkedin.md`,
    import.meta.url,
  );

describe("R8 · todos los créditos en el comentario fijado de texto-linkedin.md", () => {
  for (const nombre of partes) {
    const ruta = linkedin(nombre);
    test(`${nombre}: el comentario fijado lleva fotos, calles, recorridos, agenda, mapa, voz, música y licencia`, {
      skip: existsSync(ruta) ? false : `no hay ${ruta.pathname} (se genera fuera de git)`,
    }, () => {
      const texto = readFileSync(ruta, "utf8");
      assert.deepEqual(faltanCreditos(texto), []);
      // cada foto usada en el guion aparece con su autor
      const guion = JSON.parse(leer(`../partes/${nombre}/guion.json`));
      const agenda = JSON.parse(leer("../../site/data/agenda.json"));
      for (const id of new Set([guion.foto_portada, ...guion.trozos.map((t) => t.foto)].filter(Boolean)))
        assert.ok(texto.includes(agenda.fotos[id].autor), `falta el crédito de la foto ${id}`);
    });
  }
  test("caso negativo: sin OpenStreetMap ni licencia del vídeo, o fuera del comentario fijado", () => {
    const bueno = CREDITOS_LINKEDIN.map((r) => r.source.replace(/\\/g, "")).join("\n");
    assert.deepEqual(faltanCreditos(`## Comentario fijado\n${bueno}`).length, 0);
    const sinOsm = faltanCreditos(
      `## Comentario fijado\n${bueno.replace("OpenStreetMap", "OSM").replace("Vídeo:", "")}`,
    );
    assert.equal(sinOsm.length, 2);
    assert.equal(faltanCreditos(bueno).length, CREDITOS_LINKEDIN.length);
  });
});
