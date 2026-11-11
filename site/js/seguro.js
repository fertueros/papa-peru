// Saneado de los valores de los JSON antes de que lleguen al HTML (puro, sin DOM).
// Todo texto pasa por esc(); los números por num(); los enlaces por urlSegura().

/** Escapa un valor cualquiera para insertarlo como texto o atributo HTML. */
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/** El número si es finito; si no (cadena, null, NaN, Infinity…), null. */
export const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** La URL absoluta normalizada si su esquema es http: o https:; si no, null. */
export function urlSegura(v) {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** `<a href>` con el texto escapado, o solo el texto si la URL no es segura. */
export function enlace(url, texto) {
  const u = urlSegura(url);
  return u ? `<a href="${esc(u)}">${esc(texto)}</a>` : esc(texto);
}

/** ¿Es una fecha ISO legible? */
export const fechaValida = (v) => typeof v === "string" && Number.isFinite(new Date(v).getTime());
