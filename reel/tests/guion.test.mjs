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

/* ---------- la voz: horas, días y lugares dichos en palabras ---------- */
const NUM = [
  "cero",
  "una",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
  "veinte",
  "veintiuno",
  "veintidós",
  "veintitrés",
  "veinticuatro",
  "veinticinco",
  "veintiséis",
  "veintisiete",
  "veintiocho",
  "veintinueve",
  "treinta",
  "treinta y uno",
];
const DECENAS = { treinta: 30, cuarenta: 40, cincuenta: 50 };
/** «cuarenta y cinco» → 45, «veinte» → 20, «media» → 30, «cuarto» → 15 */
function minutos(m) {
  if (!m) return 0;
  if (m === "media") return 30;
  if (m === "cuarto") return 15;
  const [dec, , uni] = m.split(" ");
  if (DECENAS[dec] !== undefined) return DECENAS[dec] + (uni ? NUM.indexOf(uni) : 0);
  return NUM.indexOf(m);
}
const MIN =
  "(?:cuarenta|cincuenta|treinta) y (?:una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)|cuarenta|cincuenta|treinta|media|cuarto|veinti\\p{L}+|diez|once|doce|trece|catorce|quince|dieci\\p{L}+|veinte|cinco|uno|dos|tres|cuatro|seis|siete|ocho|nueve";
const RE_HORA = new RegExp(
  `\\ba (?:las|la) (una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)(?: y (${MIN}))?(?: en punto)?(?: (de la mañana|de la tarde|de la noche|del día|del mediodía))?`,
  "giu",
);
/** Horas que dice la voz: [{ dicho, h12, mm, franja }] */
export function horasDichas(voz) {
  return [...voz.matchAll(RE_HORA)].map(([dicho, h, m, franja]) => ({
    dicho,
    h12: NUM.indexOf(h.toLowerCase()),
    mm: minutos(m?.toLowerCase()),
    franja: franja?.toLowerCase(),
  }));
}
/** ¿«seis y cuarto» puede ser 18:15? (12 h, con «de la tarde/noche/mañana» si lo dice) */
export function horaCuadra(d, hhmm) {
  const [hh, mm] = hhmm.split(":").map(Number);
  if (d.mm !== mm || d.h12 % 12 !== hh % 12) return false;
  if (d.franja === "de la mañana") return hh < 12;
  if (d.franja === "de la tarde") return hh >= 12 && hh < 21;
  if (d.franja === "de la noche") return hh >= 19 || hh < 5;
  if (d.franja === "del día" || d.franja === "del mediodía") return hh === 12;
  return true;
}
const RE_DIA = new RegExp(`\\b(${DIAS.join("|")}) (${[...NUM].reverse().join("|")})\\b`, "giu");
export const diasDichos = (voz) =>
  [...voz.matchAll(RE_DIA)].map(([dicho, d, n]) => ({
    dicho,
    dia: `${d.toLowerCase()} ${NUM.indexOf(n.toLowerCase())}`,
  }));

// nombres propios que no son lugares, y palabras que solo van en mayúscula por empezar frase
const NO_LUGAR = new Set(["León", "Hora Media"]);
const INICIO = new Set(["A", "Y", "El", "La", "Los", "Las", "En", "Este", "Esta", "Ese", "Es", "Así", "Qué", "Hoy"]);
/** Grupos de palabras en mayúscula de la voz («Teatro Municipal», «Catedral de Lima»). */
export function nombresPropios(voz) {
  const re = /\p{Lu}\p{L}*(?:\s+(?:(?:de|del|de la|de los)\s+)?\p{Lu}\p{L}*)*/gu;
  const fuera = [];
  for (let [n] of voz.matchAll(re)) {
    let partes = n.split(/\s+/);
    while (partes.length && INICIO.has(partes[0])) partes = partes.slice(1);
    n = partes.join(" ");
    if (n && !NO_LUGAR.has(n)) fuera.push(n);
  }
  return fuera;
}
// ciudades de la agenda («Lima y Callao» → Lima, Callao) y extremos de los tramos: se pueden nombrar siempre
const CIUDADES = new Set(["Perú"]);
for (const c of Object.values(agenda.ciudades)) for (const n of c.nombre.split(" y ")) CIUDADES.add(n);
for (const t of agenda.tramos) CIUDADES.add(t.origen).add(t.destino);

/** Todos los errores de un trozo del guion frente a la agenda (vacío = cuadra). */
export function erroresDe(trozo) {
  const err = [];
  const datos = trozo.datos ?? [];
  const fuentes = datos.map((d) => ({ d, ...fuente(d) }));
  // 1. datos ↔ agenda ↔ subtítulo
  for (const { d, iso, lugares } of fuentes) {
    const quien = d.parada ?? d.tramo;
    if (d.hora !== horaDe(iso)) err.push(`hora de ${quien}: ${d.hora} ≠ ${horaDe(iso)}`);
    if (!trozo.texto.includes(d.hora)) err.push(`el subtítulo no dice ${d.hora}`);
    if (d.dia) {
      if (d.dia !== diaDe(iso)) err.push(`día de ${quien}: ${d.dia} ≠ ${diaDe(iso)}`);
      if (!trozo.texto.includes(d.dia)) err.push(`el subtítulo no dice «${d.dia}»`);
    }
    if (!lugares.some((l) => l?.includes(d.lugar)))
      err.push(`«${d.lugar}» no es el lugar de ${quien} (${lugares.join(" / ")})`);
    if (!trozo.texto.includes(d.lugar)) err.push(`el subtítulo no nombra «${d.lugar}»`);
    // 2. y lo mismo en la voz
    if (!trozo.voz.includes(d.lugar)) err.push(`la voz no nombra «${d.lugar}»`);
  }
  // 3. el subtítulo no dice horas ni días sin declarar
  for (const [h] of trozo.texto.matchAll(/\b\d{1,2}:\d{2}\b/g))
    if (!datos.some((d) => d.hora === h)) err.push(`subtítulo: la hora ${h} no está declarada en «datos»`);
  const reDia = new RegExp(`\\b(${DIAS.join("|")}) (\\d{1,2})\\b`, "gi");
  for (const [d] of trozo.texto.matchAll(reDia))
    if (!datos.some((x) => x.dia === d.toLowerCase())) err.push(`subtítulo: el día «${d}» no está declarado`);
  // 4. horas dichas en palabras: cada una es una hora declarada, y cada hora declarada se dice
  const dichas = horasDichas(trozo.voz);
  for (const h of dichas)
    if (!datos.some((d) => horaCuadra(h, d.hora)))
      err.push(`voz: «${h.dicho}» no es ninguna hora de la agenda declarada`);
  for (const d of datos)
    if (!dichas.some((h) => horaCuadra(h, d.hora)))
      err.push(`voz: no dice la hora ${d.hora} de ${d.parada ?? d.tramo}`);
  // 5. días dichos en palabras
  const dias = diasDichos(trozo.voz);
  for (const x of dias) if (!datos.some((d) => d.dia === x.dia)) err.push(`voz: «${x.dicho}» no es un día declarado`);
  for (const d of datos.filter((x) => x.dia))
    if (!dias.some((x) => x.dia === d.dia)) err.push(`voz: no dice el día «${d.dia}»`);
  // 6. lugares dichos: solo los declarados en este trozo (con su nombre de la agenda) o ciudades de la agenda
  const permitidos = fuentes.flatMap(({ d, lugares }) => [d.lugar, ...lugares]).filter(Boolean);
  for (const n of nombresPropios(trozo.voz)) {
    const ok =
      CIUDADES.has(n) ||
      permitidos.some((l) => l.includes(n)) ||
      datos.some((d) => [...CIUDADES].some((c) => n === `${d.lugar} de ${c}` || n === `${d.lugar} del ${c}`));
    if (!ok) err.push(`voz: «${n}» no es un lugar declarado de la agenda en este trozo`);
  }
  // 7. nada de calles, papamóvil ni ubicación en vivo; la voz va sin cifras
  if (PROHIBIDO.test(trozo.texto)) err.push("subtítulo: calles, papamóvil o «en vivo»");
  if (PROHIBIDO.test(trozo.voz)) err.push("voz: calles, papamóvil o «en vivo»");
  if (/\d/.test(trozo.voz)) err.push("la voz lleva cifras (el TTS las lee mal)");
  return err;
}

for (const nombre of partes) {
  const guion = JSON.parse(leer(`../partes/${nombre}/guion.json`));

  describe(`R1 · ${nombre}: el guion cuadra con la agenda oficial`, () => {
    for (const trozo of guion.trozos) {
      test(`${trozo.id}: horas, días y lugares de datos, subtítulo y voz coinciden con la agenda`, () => {
        assert.deepEqual(erroresDe(trozo), []);
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

/* Casos negativos: el test tiene que ponerse ROJO si la voz o el subtítulo contradicen la agenda. */
describe("R1 · el control detecta alteraciones (casos negativos)", () => {
  const guion = JSON.parse(leer("../partes/1-lima/guion.json"));
  const trozo = (id) => structuredClone(guion.trozos.find((t) => t.id === id));
  const alterado = (id, campo, de, a) => {
    const t = trozo(id);
    assert.ok(t[campo].includes(de), `el caso negativo necesita «${de}» en ${id}.${campo}`);
    t[campo] = t[campo].replace(de, a);
    return erroresDe(t);
  };
  const rojo = (errores, patron) =>
    assert.ok(
      errores.some((e) => patron.test(e)),
      `debía fallar con ${patron}; errores: ${JSON.stringify(errores)}`,
    );

  test("el guion entregado está limpio (control positivo)", () => {
    for (const t of guion.trozos) assert.deepEqual(erroresDe(t), [], t.id);
  });
  test("noche-11: «ocho y media» en la voz en lugar de «seis y cuarto»", () => {
    rojo(alterado("noche-11", "voz", "seis y cuarto", "ocho y media"), /voz: «a las ocho y media»/i);
  });
  test("noche-11: «Teatro Municipal» en la voz en lugar de «Palacio de Gobierno»", () => {
    const e = alterado("noche-11", "voz", "Palacio de Gobierno", "Teatro Municipal");
    rojo(e, /«Teatro Municipal» no es un lugar declarado/);
    rojo(e, /la voz no nombra «Palacio de Gobierno»/);
  });
  test("noche-11: las dos alteraciones a la vez, con datos y texto intactos", () => {
    const t = trozo("noche-11");
    t.voz = t.voz.replace("seis y cuarto", "ocho y media").replace("Palacio de Gobierno", "Teatro Municipal");
    assert.ok(erroresDe(t).length >= 3);
  });
  test("tarde-12: un lugar real de la agenda pero de otro acto («Gran Teatro Nacional»)", () => {
    rojo(
      alterado("tarde-12", "voz", "Estadio Monumental", "Gran Teatro Nacional"),
      /«Gran Teatro Nacional» no es un lugar declarado/,
    );
  });
  test("tarde-12: «seis de la mañana» no puede ser las 18:00", () => {
    rojo(alterado("tarde-12", "voz", "seis de la tarde", "seis de la mañana"), /voz: «a las seis de la mañana»/i);
  });
  test("vuelo: la voz cambia el día («jueves doce» por «miércoles once»)", () => {
    rojo(alterado("vuelo", "voz", "miércoles once", "jueves doce"), /voz: «jueves doce» no es un día declarado/);
  });
  test("vuelo: la voz omite una hora declarada", () => {
    rojo(alterado("vuelo", "voz", " a las doce del día, hora peruana", ""), /voz: no dice la hora 12:00/);
  });
  test("noche-11: el subtítulo cambia la hora (18:15 → 18:30)", () => {
    rojo(alterado("noche-11", "texto", "18:15", "18:30"), /subtítulo: la hora 18:30/);
  });
  test("noche-11: datos con un lugar que no es el de la parada", () => {
    const t = trozo("noche-11");
    t.datos[1].lugar = "Teatro Municipal";
    t.texto = t.texto.replace("Gran Teatro Nacional", "Teatro Municipal");
    t.voz = t.voz.replace("Gran Teatro Nacional", "Teatro Municipal");
    rojo(erroresDe(t), /«Teatro Municipal» no es el lugar de encuentro-autoridades-gtn/);
  });
});
