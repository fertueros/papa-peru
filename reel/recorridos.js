/* Recorridos ANUNCIADOS (DP-002): validación y plan de dibujo, sin canvas.
   reel.html dibuja SOLO lo que devuelve plan() (calles, enlaces, rótulos y lugares de reel/partes/<n>/recorridos.json)
   y reel/tests/recorridos.test.mjs lo carga igual para comprobar que nada sale de fuera del anuncio. */
((g) => {
  const ROTULO =
    "Recorrido anunciado por la coordinación de la visita (11-nov) · puede cambiar · no es seguimiento en vivo";
  const VEHICULOS = { cerrado: "vehículo cerrado", papamovil: "papamóvil" };
  const MAX_PUNTOS = 300;
  const ENLACE_MAX_M = 1000;
  // «av. de la Marina» ~ «Av. de la Marina», «jr. Conde de Superunda» ~ «Jr. Conde de Superunda»
  const norm = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  const esCalle = (s) => /^(av|jr)\. /.test(norm(s));
  const metros = (a, b) => {
    const r = Math.PI / 180,
      la1 = a[0] * r,
      la2 = b[0] * r;
    const x = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(x));
  };

  /** Todos los incumplimientos del fichero (vacío = se puede dibujar). */
  function errores(doc) {
    const e = [];
    if (!doc || !Array.isArray(doc.recorridos)) return ["recorridos.json sin lista de recorridos"];
    if (doc.rotulo !== ROTULO) e.push(`rótulo distinto del obligatorio: «${doc.rotulo}»`);
    const geo = doc.geometria ?? {};
    if (!/OpenStreetMap/.test(geo.datos ?? "") || !/ODbL/.test(geo.licencia ?? ""))
      e.push("geometría sin crédito OpenStreetMap / ODbL");
    const [s, w, n, es] = geo.bbox ?? [];
    const ids = new Set();
    for (const r of doc.recorridos) {
      const q = r.id ?? "(sin id)";
      if (ids.has(q)) e.push(`${q}: id repetido`);
      ids.add(q);
      if (!VEHICULOS[r.vehiculo]) e.push(`${q}: vehículo desconocido «${r.vehiculo}»`);
      const f = r.fuente ?? {};
      if (!/^https:\/\//.test(f.url ?? "")) e.push(`${q}: fuente sin URL`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.fecha ?? "")) e.push(`${q}: fuente sin fecha`);
      if (!f.medio || !f.anuncia) e.push(`${q}: fuente sin medio o sin quién lo anuncia`);
      if (!Array.isArray(r.anunciado) || !r.anunciado.length) {
        e.push(`${q}: sin la lista ordenada de calles del anuncio`);
        continue;
      }
      for (const lugar of [r.desde, r.hasta])
        if (!lugar?.nombre || !Number.isFinite(lugar.lat) || !Number.isFinite(lugar.lon))
          e.push(`${q}: origen o destino sin nombre/coordenadas`);
      const anunciadas = r.anunciado.map(norm);
      let previo = -1,
        total = 0;
      const dibujadas = new Set();
      (r.tramos ?? []).forEach((t, i) => {
        const pts = t.puntos ?? [];
        total += pts.length;
        if (pts.length < 2) e.push(`${q}: tramo ${i} sin geometría`);
        for (const p of pts)
          if (!(p[0] >= s && p[0] <= n && p[1] >= w && p[1] <= es)) {
            e.push(`${q}: tramo ${i} fuera de la zona consultada`);
            break;
          }
        if (t.calle !== undefined) {
          const k = anunciadas.indexOf(norm(t.calle));
          if (k < 0) e.push(`${q}: «${t.calle}» no está en el anuncio`);
          else if (k < previo) e.push(`${q}: «${t.calle}» fuera del orden del anuncio`);
          else previo = k;
          if (!t.osm) e.push(`${q}: «${t.calle}» sin su nombre en OpenStreetMap`);
          dibujadas.add(norm(t.calle));
        } else if (t.enlace || t.acceso) {
          if (t.acceso && i !== 0) e.push(`${q}: un acceso solo puede ir al principio`);
          if (pts.length !== 2) e.push(`${q}: un enlace es una recta de dos puntos`);
          else if (metros(pts[0], pts[1]) > ENLACE_MAX_M) e.push(`${q}: enlace de más de ${ENLACE_MAX_M} m`);
          if (!t.motivo) e.push(`${q}: enlace sin motivo`);
        } else e.push(`${q}: tramo ${i} sin calle ni tipo`);
      });
      for (const c of r.anunciado.filter(esCalle))
        if (!dibujadas.has(norm(c))) e.push(`${q}: la calle anunciada «${c}» no se dibuja`);
      if (total > MAX_PUNTOS) e.push(`${q}: ${total} puntos (máximo ${MAX_PUNTOS})`);
    }
    return e;
  }

  /** Lo que se dibuja para un trozo del guion: trazos, rótulos de calle y lugares. Lanza si el fichero no cumple. */
  function plan(doc, ids) {
    const e = errores(doc);
    if (e.length) throw new Error(`recorridos.json: ${e.join("; ")}`);
    const recorridos = ids.map((id) => {
      const r = doc.recorridos.find((x) => x.id === id);
      if (!r) throw new Error(`recorrido desconocido: ${id}`);
      const trazos = r.tramos.map((t) => ({
        tipo: t.calle === undefined ? (t.enlace ? "enlace" : "acceso") : t.solo_cruce ? "cruce" : "calle",
        calle: t.calle,
        puntos: t.puntos,
      }));
      return {
        id,
        vehiculo: r.vehiculo,
        nombreVehiculo: VEHICULOS[r.vehiculo],
        trazos,
        // el vehículo recorre todo menos los cruces (trozo de referencia de una avenida que solo se cruza)
        camino: trazos.filter((t) => t.tipo !== "cruce").flatMap((t) => t.puntos),
        lugares: [r.desde, r.hasta].map((l) => ({ nombre: l.nombre, lat: l.lat, lon: l.lon })),
      };
    });
    return {
      rotulo: doc.rotulo,
      recorridos,
      rotulos: [...new Set(recorridos.flatMap((r) => r.trazos.filter((t) => t.calle).map((t) => t.calle)))],
    };
  }

  g.Recorridos = { ROTULO, VEHICULOS, errores, plan, norm };
})(typeof window !== "undefined" ? window : globalThis);
