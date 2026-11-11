// R1 · cada hora, día y lugar que dice el guion de un reel sale de site/data/agenda.json
// (programa oficial de la Santa Sede). Si una hora o un lugar no cuadra, el test falla.
//   node --test reel/tests/
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), "utf8");
const agenda = JSON.parse(leer("../../site/data/agenda.json"));
const html = leer("../reel.html");
const partes = readdirSync(new URL("../partes/", import.meta.url)).filter((p) =>
  existsSync(new URL(`../partes/${p}/guion.json`, import.meta.url)),
);
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const PROHIBIDO = /\bcalles?\b|avenida|\bav\.|jirón|papam[oó]vil|en este momento|ahora mismo|en vivo/i;

const parada = (id) => agenda.paradas.find((p) => p.id === id);
const tramo = (id) => agenda.tramos.find((t) => t.id === id);
const horaDe = (iso) => iso.slice(11, 16);
const diaDe = (iso) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}`;
};

/** Lo que la agenda dice de un dato declarado en el guion: hora, día y nombres de lugar admitidos. */
function fuente(dato) {
  if (dato.parada) {
    const p = parada(dato.parada);
    assert.ok(p, `parada desconocida en la agenda: ${dato.parada}`);
    return { iso: p.inicio, lugares: [p.lugar, p.ciudad, p.nombre] };
  }
  const t = tramo(dato.tramo);
  assert.ok(t, `tramo desconocido en la agenda: ${dato.tramo}`);
  assert.ok(["salida", "llegada"].includes(dato.campo), `campo de tramo inválido: ${dato.campo}`);
  const lugares = dato.campo === "salida" ? [t.origen, t.salida_lugar, t.destino] : [t.destino, t.llegada_lugar];
  return { iso: t[dato.campo], lugares };
}

for (const nombre of partes) {
  const guion = JSON.parse(leer(`../partes/${nombre}/guion.json`));

  describe(`R1 · ${nombre}: el guion cuadra con la agenda oficial`, () => {
    for (const trozo of guion.trozos) {
      const datos = trozo.datos ?? [];

      test(`${trozo.id}: cada hora, día y lugar declarado coincide con la agenda`, () => {
        for (const dato of datos) {
          const { iso, lugares } = fuente(dato);
          assert.equal(dato.hora, horaDe(iso), `${trozo.id}: hora de ${dato.parada ?? dato.tramo}`);
          assert.ok(trozo.texto.includes(dato.hora), `${trozo.id}: el subtítulo no dice ${dato.hora}`);
          if (dato.dia) {
            assert.equal(dato.dia, diaDe(iso), `${trozo.id}: día de ${dato.parada ?? dato.tramo}`);
            assert.ok(trozo.texto.includes(dato.dia), `${trozo.id}: el subtítulo no dice «${dato.dia}»`);
          }
          assert.ok(
            lugares.some((l) => l?.includes(dato.lugar)),
            `${trozo.id}: «${dato.lugar}» no es el lugar de ${dato.parada ?? dato.tramo} (${lugares.join(" / ")})`,
          );
          assert.ok(trozo.texto.includes(dato.lugar), `${trozo.id}: el subtítulo no nombra «${dato.lugar}»`);
        }
      });

      test(`${trozo.id}: no dice ninguna hora ni día que no esté declarado`, () => {
        for (const [h] of trozo.texto.matchAll(/\b\d{1,2}:\d{2}\b/g)) {
          assert.ok(
            datos.some((d) => d.hora === h),
            `${trozo.id}: la hora ${h} no está declarada en «datos»`,
          );
        }
        const reDia = new RegExp(`\\b(${DIAS.join("|")}) (\\d{1,2})\\b`, "gi");
        for (const [d] of trozo.texto.matchAll(reDia)) {
          assert.ok(
            datos.some((x) => x.dia === d.toLowerCase()),
            `${trozo.id}: el día «${d}» no está declarado en «datos»`,
          );
        }
      });

      test(`${trozo.id}: nada de calles, papamóvil ni ubicación en vivo; la voz va sin cifras`, () => {
        assert.doesNotMatch(trozo.texto, PROHIBIDO);
        assert.doesNotMatch(trozo.voz, PROHIBIDO);
        assert.doesNotMatch(trozo.voz, /\d/, `${trozo.id}: la voz lleva cifras (el TTS las lee mal)`);
      });

      test(`${trozo.id}: el mapa y la foto existen en la agenda y la escena en reel.html`, () => {
        for (const id of trozo.mapa?.paradas ?? []) {
          const p = parada(id);
          assert.ok(p, `parada ${id}`);
          assert.ok(p.lat !== null, `${id}: solo lugares de la agenda con coordenadas`);
        }
        for (const id of trozo.mapa?.tramos ?? []) assert.ok(tramo(id), `tramo ${id}`);
        if (trozo.foto) assert.ok(agenda.fotos[trozo.foto], `foto ${trozo.foto}`);
        assert.match(html, new RegExp(`\\n {2}${trozo.escena}\\(`), `escena ${trozo.escena}`);
      });
    }
  });
}

describe("R2 · los rótulos de veracidad están en reel.html", () => {
  test("simulación, traslado aproximado y sujeto a cambios", () => {
    assert.ok(html.includes("Simulación del trayecto previsto · no es seguimiento en vivo"));
    assert.ok(html.includes("traslado · trayecto aproximado, no es la ruta real"));
    assert.ok(html.includes("sujeto a cambios"));
  });
});
