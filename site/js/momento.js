// «¿En qué momento de la visita estamos?» — función pura, sin DOM ni reloj propio.
// Reglas: G-6 (dónde está según la hora), G-8 (de dónde sale el dato), S-11 (una parada
// sigue en curso hasta el inicio de lo siguiente). Todas las horas son instantes absolutos
// (ISO con -05:00); el huso del navegador no interviene (G-7).

import { diaCorto, duracion, hora } from "./hora.js";

export const MIN = 60000;
export const UMBRAL_AVION_MIN = 15;
export const UMBRAL_ANTIGUO_MIN = 30;

const t = (iso) => new Date(iso).getTime();
const aMs = (ahora) => (ahora instanceof Date ? ahora.getTime() : t(ahora));

/** Eventos de la visita en orden: paradas (empiezan en `inicio`) y tramos (en `salida`). */
export function linea(agenda) {
  const ev = [
    ...agenda.paradas.map((p) => ({ tipo: "parada", t: t(p.inicio), dato: p })),
    ...agenda.tramos.map((tr) => ({ tipo: "tramo", t: t(tr.salida), fin: t(tr.llegada), dato: tr })),
  ];
  return ev.sort((a, b) => a.t - b.t);
}

/** Llegada al Perú: la primera parada. Salida definitiva: el tramo que sale en `salida_roma`. */
export function hitos(agenda) {
  const paradas = [...agenda.paradas].sort((a, b) => t(a.inicio) - t(b.inicio));
  const final = agenda.tramos.find((tr) => agenda.salida_roma && t(tr.salida) === t(agenda.salida_roma));
  const entrada = agenda.tramos.find((tr) => t(tr.llegada) === t(paradas[0].inicio));
  return { llegada: paradas[0], final, entrada };
}

function deteccionesDe(vivo, paradaId) {
  const dets = vivo?.detecciones ?? [];
  return dets.filter((d) => d.parada === paradaId).sort((a, b) => t(a.hora_hecho) - t(b.hora_hecho));
}

/** Rótulo de origen en tierra (G-8): «según [fuente], HH:MM» o «según la agenda». */
function origenEnTierra(vivo, parada, ahoraMs) {
  const dets = deteccionesDe(vivo, parada.id).filter((d) => t(d.hora_hecho) <= ahoraMs);
  const ultima = dets.at(-1);
  if (!ultima) return { tipo: "agenda" };
  return {
    tipo: "fuente",
    fuente: ultima.fuente,
    url: ultima.url ?? null,
    hora: ultima.hora_hecho,
    que: ultima.que,
    retraso_min: ultima.retraso_min ?? null,
  };
}

/** Posición del avión (G-8): real si tiene <15 min y es de este tramo; si no, estimada. */
export function posicionAvion(tramo, vivo, ahoraMs) {
  const avance = Math.min(1, Math.max(0, (ahoraMs - t(tramo.salida)) / (t(tramo.llegada) - t(tramo.salida))));
  const a = vivo?.avion;
  if (a && a.tramo === tramo.id && Number.isFinite(a.lat) && Number.isFinite(a.lon)) {
    const edadMin = Math.floor((ahoraMs - t(a.hora)) / MIN);
    if (edadMin >= 0 && edadMin < UMBRAL_AVION_MIN) {
      return { real: true, lat: a.lat, lon: a.lon, hace_min: edadMin, fuente: a.fuente ?? null, avance };
    }
  }
  return {
    real: false,
    lat: tramo.salida_lat + (tramo.llegada_lat - tramo.salida_lat) * avance,
    lon: tramo.salida_lon + (tramo.llegada_lon - tramo.salida_lon) * avance,
    hace_min: null,
    fuente: null,
    avance,
  };
}

/** Próximo evento (parada o tramo) que empieza después de `ahora`, salvo `actual`. */
function proximo(agenda, vivo, ahoraMs, actual) {
  const { entrada } = hitos(agenda);
  const sig = linea(agenda).find((e) => e.t > ahoraMs && e.dato !== actual && e.dato !== entrada);
  if (!sig) return null;
  // Retraso detectado en lo que está en curso → lo siguiente queda «hora por confirmar».
  const retraso =
    actual?.inicio !== undefined &&
    deteccionesDe(vivo, actual.id).some((d) => d.que === "retraso" && t(d.hora_deteccion ?? d.hora_hecho) <= ahoraMs);
  return {
    tipo: sig.tipo,
    dato: sig.dato,
    hora: sig.tipo === "parada" ? sig.dato.inicio : sig.dato.salida,
    falta_ms: sig.t - ahoraMs,
    por_confirmar: Boolean(retraso),
  };
}

/**
 * Estado de la visita en el instante `ahora`.
 * @returns {{estado: 'por-llegar'|'en-parada'|'en-tramo'|'terminada', ...}}
 */
export function momento(agenda, vivo, ahora) {
  const ahoraMs = aMs(ahora);
  const { llegada, final, entrada } = hitos(agenda);

  if (final && ahoraMs >= t(final.salida)) {
    return { estado: "terminada", tramo: final, proxima: null };
  }
  if (ahoraMs < t(llegada.inicio)) {
    return {
      estado: "por-llegar",
      llegada,
      falta_ms: t(llegada.inicio) - ahoraMs,
      // Vuelo de llegada ya en el aire: se informa, pero G-6 manda la cuenta atrás.
      vuelo: entrada && ahoraMs >= t(entrada.salida) ? entrada : null,
      proxima: proximo(agenda, vivo, ahoraMs, null),
    };
  }

  // Lo último que empezó (S-11): una parada sigue en curso hasta el inicio de lo siguiente.
  const empezados = linea(agenda).filter((e) => e.t <= ahoraMs && e.dato !== final && e.dato !== entrada);
  // Una detección «empezó» de una parada posterior manda sobre la agenda (adelanto).
  for (const d of vivo?.detecciones ?? []) {
    if (d.que !== "empezo" || t(d.hora_hecho) > ahoraMs) continue;
    const p = agenda.paradas.find((x) => x.id === d.parada);
    if (p && !empezados.some((e) => e.dato === p)) empezados.push({ tipo: "parada", t: t(d.hora_hecho), dato: p });
  }
  empezados.sort((a, b) => a.t - b.t);
  const actual = empezados.at(-1);

  if (actual.tipo === "tramo" && ahoraMs < actual.fin) {
    const tramo = actual.dato;
    return {
      estado: "en-tramo",
      tramo,
      avion: posicionAvion(tramo, vivo, ahoraMs),
      proxima: proximo(agenda, vivo, ahoraMs, tramo),
    };
  }
  if (actual.tipo === "tramo") {
    // Aterrizó y aún no empieza la siguiente parada: está en la ciudad de destino.
    return {
      estado: "en-parada",
      parada: null,
      ciudad: actual.dato.destino_id,
      llego: actual.dato.llegada,
      origen: { tipo: "agenda" },
      proxima: proximo(agenda, vivo, ahoraMs, actual.dato),
    };
  }
  const parada = actual.dato;
  return {
    estado: "en-parada",
    parada,
    ciudad: parada.ciudad_id,
    origen: origenEnTierra(vivo, parada, ahoraMs),
    proxima: proximo(agenda, vivo, ahoraMs, parada),
  };
}

/** ¿El dato (ISO de `actualizado`) tiene más de 30 min? null/ausente → no se juzga. */
export function antiguo(actualizado, ahora) {
  if (!actualizado) return false;
  return aMs(ahora) - t(actualizado) > UMBRAL_ANTIGUO_MIN * MIN;
}

// Proyección fija del mapa (la misma con la que se generó site/img/peru.svg).
const COS = Math.cos((9.5 * Math.PI) / 180);
export function proyectar(lat, lon) {
  return { x: (lon + 81.6) * 20 * COS, y: (0.2 - lat) * 20 };
}

// ---- Textos (puros) que enseña la portada ----

const MEDIO = { avion: "Volando", helicoptero: "En helicóptero" };

/** Texto del titular de «ahora mismo». */
export function titular(m, agenda) {
  if (m.estado === "por-llegar") return `El papa llega al Callao en ${duracion(m.falta_ms)}`;
  if (m.estado === "terminada")
    return `El papa partió a Roma el ${diaCorto(m.tramo.salida)} a las ${hora(m.tramo.salida)}`;
  if (m.estado === "en-tramo") {
    const tr = m.tramo;
    return `${MEDIO[tr.medio] ?? "Viajando"} de ${tr.origen} a ${tr.destino}, llega a las ${hora(tr.llegada)}`;
  }
  if (!m.parada) return `En ${agenda.ciudades[m.ciudad]?.nombre ?? m.ciudad}: llegó a las ${hora(m.llego)}`;
  return `Ahora: ${m.parada.nombre}`;
}

/** Rótulo de origen (G-8). */
export function rotuloOrigen(m) {
  if (m.estado === "en-tramo")
    return m.avion.real ? `posición de hace ${m.avion.hace_min} min` : "estimado según la agenda";
  if (m.estado !== "en-parada") return "según la agenda";
  const o = m.origen;
  if (o.tipo !== "fuente") return "según la agenda";
  const extra = o.que === "retraso" && o.retraso_min ? ` · retraso de ${o.retraso_min} min` : "";
  const verbo = { empezo: "empezó", termino: "terminó", retraso: "con retraso" }[o.que] ?? "";
  return `${verbo ? `${verbo} · ` : ""}según ${o.fuente}, ${hora(o.hora)}${extra}`;
}

/** Texto de la próxima parada con su cuenta atrás, o «hora por confirmar». */
export function textoProxima(p) {
  if (!p) return null;
  const nombre =
    p.tipo === "parada"
      ? p.dato.nombre
      : `Salida en ${p.dato.medio === "helicoptero" ? "helicóptero" : "avión"} hacia ${p.dato.destino}`;
  if (p.por_confirmar) return `Próxima: ${nombre} · hora por confirmar`;
  return `Próxima: ${hora(p.hora)} ${nombre}, en ${duracion(p.falta_ms)}`;
}
