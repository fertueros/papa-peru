// Formateo de horas SIEMPRE en hora de Perú (G-7): la zona del móvil no cuenta.
export const ZONA = "America/Lima";

const fmtHora = new Intl.DateTimeFormat("es-PE", {
  timeZone: ZONA,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const fmtPartes = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const fmtDiaSemana = new Intl.DateTimeFormat("es-PE", {
  timeZone: ZONA,
  weekday: "long",
});
const fmtDiaMes = new Intl.DateTimeFormat("es-PE", {
  timeZone: ZONA,
  day: "numeric",
});
const fmtMes = new Intl.DateTimeFormat("es-PE", {
  timeZone: ZONA,
  month: "long",
});

const aFecha = (x) => (x instanceof Date ? x : new Date(x));

/** «HH:MM» en hora de Perú. */
export function hora(x) {
  return fmtHora.format(aFecha(x));
}

/** «AAAA-MM-DD» del día en Perú. */
export function diaPeru(x) {
  return fmtPartes.format(aFecha(x));
}

/** «viernes 13». */
export function diaCorto(x) {
  const f = aFecha(x);
  return `${fmtDiaSemana.format(f)} ${fmtDiaMes.format(f)}`;
}

/** «viernes 13 de noviembre». */
export function diaLargo(x) {
  const f = aFecha(x);
  return `${diaCorto(f)} de ${fmtMes.format(f).toLowerCase()}`;
}

/** Duración legible de una cuenta atrás, redondeando al minuto superior (a las 10:00:20 faltan
 * «7 h 30 min» para las 17:30): «7 h 30 min», «45 min», «2 d 3 h», «menos de 1 min». */
export function duracion(ms) {
  const min = Math.ceil(Math.max(0, ms) / 60000);
  if (min < 1) return "menos de 1 min";
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  return `${m} min`;
}
