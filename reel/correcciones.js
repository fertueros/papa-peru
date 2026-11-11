/* R13 · correcciones del reel sobre la agenda oficial (reel/partes/<n>/correcciones.json). La corrección manda:
   Correcciones.aplicar(agenda, doc) devuelve una copia de la agenda con los campos corregidos. Lo usan reel.html
   (window.CORRECCIONES, inyectado por grabar.py) y reel/tests/guion.test.mjs. site/data/agenda.json no se toca. */
((g) => {
  const CAMPOS = ["lugar", "lat", "lon"];
  /** Errores de un correcciones.json (vacío = válido). */
  function errores(doc, agenda) {
    const e = [];
    if (!Array.isArray(doc?.correcciones)) return ["sin lista «correcciones»"];
    for (const c of doc.correcciones) {
      const quien = c.parada ?? "(sin parada)";
      if (agenda && !agenda.paradas.some((p) => p.id === c.parada)) e.push(`${quien}: no es una parada de la agenda`);
      const campos = Object.keys(c.campos ?? {});
      if (!campos.length) e.push(`${quien}: no corrige ningún campo`);
      for (const k of campos) if (!CAMPOS.includes(k)) e.push(`${quien}: no se puede corregir «${k}»`);
      for (const k of ["lat", "lon"])
        if (k in (c.campos ?? {}) && typeof c.campos[k] !== "number") e.push(`${quien}: ${k} no es un número`);
      const f = c.fuente ?? {};
      if (!f.nombre) e.push(`${quien}: sin fuente`);
      if (!/^https:\/\/\S+$/.test(f.url ?? "")) e.push(`${quien}: la fuente no tiene URL`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha ?? "")) e.push(`${quien}: la fuente no tiene fecha (AAAA-MM-DD)`);
    }
    return e;
  }
  /** Copia de la agenda con las correcciones aplicadas (si el documento no es válido, lanza). */
  function aplicar(agenda, doc) {
    if (!doc) return agenda;
    const e = errores(doc, agenda);
    if (e.length) throw new Error(`correcciones.json no válido: ${e.join("; ")}`);
    const ag = JSON.parse(JSON.stringify(agenda));
    for (const c of doc.correcciones)
      Object.assign(
        ag.paradas.find((p) => p.id === c.parada),
        c.campos,
      );
    return ag;
  }
  g.Correcciones = { CAMPOS, errores, aplicar };
})(typeof window !== "undefined" ? window : globalThis);
