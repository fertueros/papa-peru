// Portada «dónde está ahora»: lee los JSON, calcula con momento() y pinta.
// Refresca la cuenta atrás cada 30 s y vivo.json/clima.json cada 60 s, sin recargar.
import { diaCorto, diaLargo, diaPeru, hora } from "./hora.js";
import { antiguo, momento, proyectar, rotuloOrigen, textoProxima, titular } from "./momento.js";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const estado = { agenda: null, vivo: null, clima: null, dia: null };

async function leer(nombre) {
  try {
    const r = await fetch(`data/${nombre}`, { cache: "no-cache" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** Escribe HTML solo si cambió (evita repetir avisos al lector de pantalla). */
function poner(el, html) {
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
}

const etiquetaAntiguo = '<span class="antiguo">datos antiguos</span>';

function enlaceMapa(lat, lon, lugar) {
  if (lat === null || lat === undefined) {
    return `https://www.openstreetmap.org/search?query=${encodeURIComponent(lugar)}`;
  }
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}

function pintarAhora(m, ahora) {
  const { agenda, vivo } = estado;
  const partes = [`<p class="estado">${esc(titular(m, agenda))}</p>`];
  const viejo = antiguo(vivo?.actualizado, ahora) ? ` ${etiquetaAntiguo}` : "";

  if (m.estado === "por-llegar") {
    const ll = m.llegada;
    partes.push(`<p class="lugar">${esc(diaLargo(ll.inicio))} a las ${hora(ll.inicio)} · ${esc(ll.lugar)}</p>`);
    if (m.vuelo) {
      partes.push(
        `<p class="lugar">En vuelo desde ${esc(m.vuelo.origen)}: salió a las ${hora(m.vuelo.salida)} (hora de Perú).</p>`,
      );
    }
    partes.push(`<p class="origen">${esc(rotuloOrigen(m))}${viejo}</p>`);
  } else if (m.estado === "en-tramo") {
    const tr = m.tramo;
    const pct = Math.round(m.avion.avance * 100);
    partes.push(
      `<p class="lugar">Salió a las ${hora(tr.salida)} de ${esc(tr.salida_lugar)}; llega a ${esc(tr.llegada_lugar)}.</p>`,
      `<div class="barra" role="progressbar" aria-label="Avance del viaje" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>`,
      `<p class="origen">Avance del viaje: ${pct} % · <strong>${esc(rotuloOrigen(m))}</strong>${viejo}</p>`,
    );
  } else if (m.estado === "en-parada") {
    if (m.parada) {
      const p = m.parada;
      partes.push(
        `<p class="lugar">${esc(p.lugar)} · ${esc(p.ciudad)}</p>`,
        `<p class="lugar">En la agenda: ${hora(p.inicio)}${p.privada ? " · acto privado" : ""}</p>`,
      );
    }
    partes.push(`<p class="origen"><strong>${esc(rotuloOrigen(m))}</strong>${viejo}</p>`);
  } else {
    const ciudades = Object.values(agenda.ciudades).map((c) => c.nombre);
    partes.push(
      `<p class="lugar">Resumen: ${agenda.paradas.length} actos en ${ciudades.length} ciudades (${esc(ciudades.join(", "))}) del ${esc(diaCorto(agenda.llegada_peru))} al ${esc(diaCorto(agenda.salida_roma))} de noviembre.</p>`,
      `<p class="origen">${esc(rotuloOrigen(m))}</p>`,
    );
  }
  poner($("ahora-cuerpo"), partes.join(""));
}

function paradaVisible(m) {
  if (m.estado === "por-llegar") return m.llegada;
  if (m.estado === "en-parada") return m.parada;
  return null;
}

function pintarFoto(parada) {
  const f = parada?.foto ? estado.agenda.fotos?.[parada.foto] : null;
  const fig = $("foto");
  if (!f) {
    fig.hidden = true;
    return;
  }
  const img = $("foto-img");
  const base = `fotos/${parada.foto}`;
  if (img.dataset.id !== parada.foto) {
    img.dataset.id = parada.foto;
    img.onerror = () => {
      fig.hidden = true;
    };
    img.srcset = `${base}-480.webp 480w, ${base}-800.webp 800w`;
    img.sizes = "(min-width: 40rem) 27rem, 100vw";
    img.src = `${base}-800.webp`;
    img.alt = f.alt ?? `Imagen referencial: ${parada.lugar}`;
  }
  const lic = f.licencia_url ? `<a href="${esc(f.licencia_url)}">${esc(f.licencia)}</a>` : esc(f.licencia);
  const autor = f.fuente_url ? `<a href="${esc(f.fuente_url)}">${esc(f.autor)}</a>` : esc(f.autor);
  poner($("foto-pie"), `Imagen referencial${f.titulo ? `: ${esc(f.titulo)}` : ""}. Foto: ${autor} · ${lic}`);
  fig.hidden = false;
}

function pintarMapa(m) {
  const { agenda } = estado;
  const marcas = [];
  for (const c of Object.values(agenda.ciudades)) {
    const { x, y } = proyectar(c.lat, c.lon);
    marcas.push(
      `<circle class="marca-ciudad" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"><title>${esc(c.nombre)}</title></circle>`,
    );
  }
  let pie = "";
  let titulo = "Mapa del Perú con las ciudades de la visita";
  if (m.estado === "en-tramo") {
    const tr = m.tramo;
    const a = proyectar(tr.salida_lat, tr.salida_lon);
    const b = proyectar(tr.llegada_lat, tr.llegada_lon);
    const p = proyectar(m.avion.lat, m.avion.lon);
    marcas.push(
      `<line class="ruta" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"></line>`,
      `<circle class="${m.avion.real ? "avion-real" : "avion-estimado"}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6"></circle>`,
    );
    titulo = `Mapa: ${tr.origen} a ${tr.destino}, avión ${m.avion.real ? "en su posición real" : "en posición estimada"}`;
    pie = `Avión: ${esc(rotuloOrigen(m))}.`;
  } else {
    const parada = paradaVisible(m);
    const ciudad = agenda.ciudades[parada?.ciudad_id ?? m.ciudad];
    if (ciudad) {
      // El único punto es el lugar público del acto (o la ciudad si la agenda no lo sitúa).
      const sinCoord = !parada || parada.lat === null;
      const { x, y } = proyectar(sinCoord ? ciudad.lat : parada.lat, sinCoord ? ciudad.lon : parada.lon);
      marcas.push(`<circle class="marca-actual" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7"></circle>`);
      titulo = `Mapa del Perú con ${parada ? parada.ciudad : ciudad.nombre} marcada`;
      const url = parada
        ? enlaceMapa(parada.lat, parada.lon, `${parada.lugar}, ${parada.ciudad}, Perú`)
        : enlaceMapa(ciudad.lat, ciudad.lon, ciudad.nombre);
      const aprox = parada?.coord_aproximada ? " (ubicación aproximada)" : "";
      pie = `${parada ? `Lugar del acto según la agenda${aprox}` : esc(ciudad.nombre)}. <a href="${esc(url)}">Ver el lugar en el mapa</a>`;
    }
  }
  poner($("mapa-marcas"), marcas.join(""));
  $("mapa-desc").textContent = titulo;
  poner($("mapa-pie"), pie);
  $("mapa").hidden = false;
}

function ciudadClima(m) {
  if (m.estado === "por-llegar") return m.llegada.ciudad_id;
  if (m.estado === "en-tramo") return m.tramo.destino_id;
  if (m.estado === "en-parada") return m.ciudad;
  return null;
}

function pintarClima(m, ahora) {
  const { clima, agenda } = estado;
  const id = ciudadClima(m);
  const c = id && clima?.ciudades?.[id];
  if (!c) {
    $("clima").hidden = true;
    return;
  }
  const nombre = agenda.ciudades[id]?.nombre ?? id;
  poner($("clima-ahora"), `${esc(nombre)}: ${c.temp} °C, ${esc(c.cielo)}, ${c.lluvia_prob} % de lluvia`);
  const viejo = antiguo(clima.actualizado, ahora) ? ` ${etiquetaAntiguo}` : "";
  poner($("clima-pie"), `pronóstico de Open-Meteo, ${hora(clima.actualizado)}${viejo}`);
  $("clima").hidden = false;
}

function pintarProxima(m) {
  const texto = textoProxima(m.proxima);
  const el = $("proxima");
  if (!texto) {
    el.hidden = true;
    return;
  }
  const p = m.proxima;
  const lugar = p.tipo === "parada" ? `<p class="pie">${esc(p.dato.lugar)} · ${esc(diaCorto(p.hora))}</p>` : "";
  poner(el, `<p class="cuenta">${esc(texto)}</p>${lugar}`);
  el.hidden = false;
}

function eventosDelDia(dia) {
  const { agenda } = estado;
  const ev = [
    ...agenda.paradas.map((p) => ({ t: p.inicio, p })),
    ...agenda.tramos.map((tr) => ({ t: tr.salida, tr })),
  ].filter((e) => diaPeru(e.t) === dia);
  return ev.sort((a, b) => new Date(a.t) - new Date(b.t));
}

function pintarAgenda(m) {
  const { agenda, clima } = estado;
  const dias = [];
  for (
    let d = new Date(`${agenda.desde}T12:00:00-05:00`);
    diaPeru(d) <= agenda.hasta;
    d = new Date(d.getTime() + 864e5)
  ) {
    dias.push(diaPeru(d));
  }
  if (!estado.dia) {
    const hoy = diaPeru(new Date());
    estado.dia = dias.includes(hoy) ? hoy : hoy < dias[0] ? dias[0] : dias.at(-1);
  }
  const botones = dias
    .map((d) => {
      const sel = d === estado.dia;
      return `<button type="button" role="tab" id="tab-${d}" aria-controls="dia" aria-selected="${sel}" tabindex="${sel ? 0 : -1}" data-dia="${d}">${esc(diaCorto(`${d}T12:00:00-05:00`))}</button>`;
    })
    .join("");
  poner($("dias"), botones);
  $("dia").setAttribute("aria-labelledby", `tab-${estado.dia}`);

  const actualId = m.parada?.id ?? m.tramo?.id;
  const items = eventosDelDia(estado.dia).map((e) => {
    if (e.tr) {
      const tr = e.tr;
      const medio = tr.medio === "helicoptero" ? "En helicóptero" : "En avión";
      return `<li class="tramo${tr.id === actualId ? " actual" : ""}"><span class="h">${hora(tr.salida)}</span>${medio} de ${esc(tr.origen)} a ${esc(tr.destino)} (llega ${hora(tr.llegada)})</li>`;
    }
    const p = e.p;
    const cd = clima?.ciudades?.[p.ciudad_id]?.dias?.[estado.dia];
    const climaTxt = cd
      ? `<span class="clima-dia">${cd.max} °C / ${cd.min} °C · ${cd.lluvia_prob} % de lluvia</span>`
      : "";
    return `<li${p.id === actualId ? ' class="actual"' : ""}><span class="h">${hora(p.inicio)}</span>${esc(p.nombre)}<span class="clima-dia">${esc(p.lugar)} · ${esc(p.ciudad)}</span>${climaTxt}</li>`;
  });
  poner(
    $("dia"),
    `<p class="cabecera-dia">${esc(diaLargo(`${estado.dia}T12:00:00-05:00`))}</p><ol>${items.join("") || "<li>Sin actos en Perú este día.</li>"}</ol>`,
  );
}

function pintarPie() {
  const { agenda } = estado;
  poner($("fuente-agenda"), `Agenda: <a href="${esc(agenda.fuente.url)}">${esc(agenda.fuente.nombre)}</a>.`);
  const fotos = Object.entries(agenda.fotos ?? {});
  if (fotos.length) {
    poner(
      $("creditos-lista"),
      fotos
        .map(
          ([, f]) =>
            `<li>${esc(f.titulo ?? "")}: <a href="${esc(f.fuente_url)}">${esc(f.autor)}</a>, ${esc(f.licencia)}</li>`,
        )
        .join(""),
    );
    $("creditos").hidden = false;
  }
}

function render() {
  if (!estado.agenda) return;
  const ahora = new Date();
  $("reloj").textContent = hora(ahora);
  const m = momento(estado.agenda, estado.vivo, ahora);
  pintarAhora(m, ahora);
  pintarFoto(paradaVisible(m));
  try {
    pintarMapa(m);
  } catch {
    $("mapa").hidden = true;
  }
  pintarClima(m, ahora);
  pintarProxima(m);
  pintarAgenda(m);
  document.documentElement.classList.remove("cargando");
}

async function refrescar() {
  const [vivo, clima] = await Promise.all([leer("vivo.json"), leer("clima.json")]);
  estado.vivo = vivo;
  estado.clima = clima;
  render();
}

$("dias").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-dia]");
  if (!b) return;
  estado.dia = b.dataset.dia;
  render();
  $(`tab-${estado.dia}`)?.focus();
});
$("dias").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const bs = [...$("dias").querySelectorAll("button")];
  const i = bs.findIndex((b) => b.dataset.dia === estado.dia);
  const n = bs[(i + (e.key === "ArrowRight" ? 1 : -1) + bs.length) % bs.length];
  n.click();
});

async function iniciar() {
  const [agenda, vivo, clima] = await Promise.all([leer("agenda.json"), leer("vivo.json"), leer("clima.json")]);
  if (!agenda) {
    poner($("ahora-cuerpo"), '<p class="estado">No se pudo cargar la agenda. Vuelve a intentarlo en un momento.</p>');
    document.documentElement.classList.remove("cargando");
    return;
  }
  Object.assign(estado, { agenda, vivo, clima });
  pintarPie();
  render();
  setInterval(render, 30000);
  setInterval(refrescar, 60000);
}

iniciar();
