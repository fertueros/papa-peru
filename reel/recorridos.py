"""Geometría de los recorridos ANUNCIADOS (DP-002) a partir de OpenStreetMap, una sola vez y fuera del render.

    python reel/recorridos.py 1-lima                    # consulta Overpass y reescribe la geometría
    python reel/recorridos.py 1-lima --osm calles.json  # o reusa una respuesta de Overpass guardada

Lee reel/partes/<parte>/recorridos.json (escrito a mano: fuente, URL, fecha, orden de calles del anuncio y,
para cada tramo, la calle de OSM) y rellena «puntos» de cada tramo y «osm» (fecha de los datos). Reglas:

- cada calle se recorta al tramo entre sus cruces del recorrido: sale por el nodo más cercano a la calle
  siguiente y entra cerca de donde terminó la anterior, por el nodo que deja el camino más corto por la propia calle
  (sin rodeos por la calzada del sentido contrario);
- si dos calles seguidas del anuncio no se tocan (> 30 m), se une con un «enlace»: recta entre los dos puntos,
  que reel.html dibuja como traslado aproximado (no se inventa la calle intermedia);
- del lugar de partida a la primera calle, un «acceso» (recta corta, sin nombre);
- «solo_cruce»: el anuncio nombra la avenida pero la ruta solo la cruza; se guarda un trozo corto (±220 m) como
  referencia para rotularla (±220 m), sin que el vehículo lo recorra;
- la línea se simplifica (Douglas-Peucker) hasta ≤ 300 puntos por recorrido.

Después: `npx biome format --write reel/partes/<parte>/recorridos.json` (formato del repo) y `node --test reel/tests/*.test.mjs`.
Geometría: © OpenStreetMap contributors, ODbL 1.0. Solo biblioteca estándar.
"""

from __future__ import annotations

import argparse
import heapq
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
OVERPASS = "https://overpass-api.de/api/interpreter"
UNIDO_M = 30  # dos calles a menos de esto se consideran cruzadas
CABO_M = 25  # extremo suelto de una calzada a menos de esto del resto de la calle: se une
COSER_M = 60  # trozos sueltos de una misma calle (puentes, pasos a desnivel) a menos de esto se cosen
TOLERANCIA_M = 4.0
MAX_PUNTOS = 300


def dist(a, b) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    x = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(x))


def consulta(nombres: list[str], bbox: list[float]) -> str:
    patron = "|".join(sorted(set(nombres)))
    s, w, n, e = bbox
    return f'[out:json][timeout:90];way["highway"]["name"~"^({patron})$"]({s},{w},{n},{e});out body geom;'


def descargar(q: str) -> dict:
    datos = urllib.parse.urlencode({"data": q}).encode()
    pet = urllib.request.Request(OVERPASS, data=datos, headers={"User-Agent": "reel-itinerario/1.0 (mapa de recorridos)"})
    with urllib.request.urlopen(pet, timeout=180) as r:
        return json.load(r)


class Calle:
    """Grafo no dirigido de los nodos de todas las vías OSM con un nombre (calzadas dobles incluidas)."""

    def __init__(self, nombre: str, vias: list[dict]):
        self.nombre, self.xy, self.ady = nombre, {}, {}
        for v in vias:
            for nid, g in zip(v["nodes"], v["geometry"]):
                self.xy[nid] = (g["lat"], g["lon"])
            for a, b in zip(v["nodes"], v["nodes"][1:]):
                self._unir(a, b)
        # el nombre en OSM a veces se corta entre vías vecinas: se cosen los trozos sueltos a < COSER_M
        comp = self._componentes()
        if len(comp) > 1:
            for i, c in enumerate(comp):
                for d in comp[i + 1:]:
                    par = min(((dist(self.xy[a], self.xy[b]), a, b) for a in c for b in d))
                    if par[0] < COSER_M:
                        self._unir(par[1], par[2])
        # el final de una calzada de sentido único suele acabar a pocos metros del nodo del cruce, en una vía de
        # otro nombre: cada extremo suelto se une al nodo más cercano de la misma calle a < CABO_M
        for n in [n for n, v in self.ady.items() if len(v) == 1]:
            otros = [(dist(self.xy[n], self.xy[m]), m) for m in self.xy if m != n and m not in self.ady[n]]
            if otros and min(otros)[0] < CABO_M:
                self._unir(n, min(otros)[1])
        if not self.xy:
            raise SystemExit(f"OSM no devuelve ninguna vía «{nombre}»")

    def _unir(self, a, b):
        d = dist(self.xy[a], self.xy[b])
        self.ady.setdefault(a, {})[b] = d
        self.ady.setdefault(b, {})[a] = d

    def _componentes(self):
        vistos, comp = set(), []
        for n in self.xy:
            if n in vistos:
                continue
            pila, c = [n], set()
            while pila:
                x = pila.pop()
                if x in c:
                    continue
                c.add(x)
                pila.extend(self.ady.get(x, {}))
            vistos |= c
            comp.append(c)
        return comp

    def cercano(self, p):
        return min(self.xy, key=lambda n: dist(self.xy[n], p))

    def dijkstra(self, a):
        """Distancia por la propia calle desde a a cada nodo, y el nodo previo de cada camino."""
        cola, prev, mejor = [(0.0, a)], {a: None}, {a: 0.0}
        while cola:
            d, x = heapq.heappop(cola)
            if d > mejor[x]:
                continue
            for y, w in self.ady.get(x, {}).items():
                if d + w < mejor.get(y, math.inf):
                    mejor[y], prev[y] = d + w, x
                    heapq.heappush(cola, (d + w, y))
        return mejor, prev

    def camino(self, a, b) -> list[tuple[float, float]]:
        _, prev = self.dijkstra(b)
        if a not in prev:
            raise SystemExit(f"«{self.nombre}»: no hay camino por la propia calle entre los dos cruces")
        ruta, x = [], a
        while x is not None:
            ruta.append(self.xy[x])
            x = prev[x]
        return ruta

    def entrada(self, p, sale):
        """Nodo por el que se entra a la calle desde p hacia «sale»: entre los cercanos a p (ver «lim»),
        el que deja el camino más corto. Evita rodeos cuando la calzada más cercana es la del sentido contrario y
        solo se une a la otra lejos (calzadas dobles)."""
        mejor, _ = self.dijkstra(sale)
        h = min(dist(self.xy[n], p) for n in self.xy)
        # si se toca con la calle anterior, se entra sin hueco; un acceso corto puede alargarse 40 m para no dar un
        # rodeo; un enlace largo (> 200 m) va siempre al punto más cercano, para no cortar manzanas en diagonal
        lim = UNIDO_M if h <= UNIDO_M else h + 40 if h <= 200 else h
        cand = [n for n in self.xy if n in mejor and dist(self.xy[n], p) <= lim]
        if not cand:
            raise SystemExit(f"«{self.nombre}»: no hay camino por la propia calle entre los dos cruces")
        return min(cand, key=lambda n: dist(self.xy[n], p) + mejor[n])


def cruce(a: Calle, b: Calle):
    """Nodos de a y b más cercanos entre sí (el cruce, o el hueco si no se tocan)."""
    return min(((dist(a.xy[i], b.xy[j]), i, j) for i in a.xy for j in b.xy))


def rdp(puntos, tol):
    if len(puntos) < 3:
        return list(puntos)
    a, b = puntos[0], puntos[-1]
    # distancia aproximada a la recta en metros (plano local)
    k = math.cos(math.radians(a[0]))
    ax, ay, bx, by = a[1] * k, a[0], b[1] * k, b[0]
    def d(p):
        px, py = p[1] * k, p[0]
        dx, dy = bx - ax, by - ay
        if dx == dy == 0:
            return math.hypot(px - ax, py - ay) * 111320
        u = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - ax - u * dx, py - ay - u * dy) * 111320
    i, m = max(((i, d(p)) for i, p in enumerate(puntos[1:-1], 1)), key=lambda x: x[1])
    if m <= tol:
        return [a, b]
    return rdp(puntos[: i + 1], tol)[:-1] + rdp(puntos[i:], tol)


def stub(c: Calle, nodo, metros=220.0):
    """Trozo corto de la calle alrededor de un nodo (para rotular una avenida que la ruta solo cruza)."""
    cerca = [n for n in c.xy if dist(c.xy[n], c.xy[nodo]) <= metros and n in c.ady]
    a = max(cerca, key=lambda n: dist(c.xy[n], c.xy[nodo]))
    b = max(cerca, key=lambda n: dist(c.xy[n], c.xy[a]))
    return c.camino(a, b)


def construir(rec: dict, calles: dict[str, Calle]) -> None:
    fin = (rec["desde"]["lat"], rec["desde"]["lon"])
    tramos = [t for t in rec["tramos"] if "calle" in t]
    salida = []
    for i, t in enumerate(tramos):
        c = calles[t["osm"]]
        if t.get("solo_cruce"):
            n = c.cercano(fin)
            t["_crudo"] = stub(c, n)
            t["hueco_m"] = round(dist(c.xy[n], fin))
            salida.append(t)
            continue
        sig = next((x for x in tramos[i + 1:] if not x.get("solo_cruce")), None)
        sig_cruce = tramos[i + 1] if i + 1 < len(tramos) and tramos[i + 1].get("solo_cruce") else None
        if sig_cruce:
            sale = cruce(c, calles[sig_cruce["osm"]])[1]
        elif sig:
            sale = cruce(c, calles[sig["osm"]])[1]
        else:
            sale = c.cercano((rec["hasta"]["lat"], rec["hasta"]["lon"]))
        entra = c.entrada(fin, sale)
        hueco = dist(c.xy[entra], fin)
        if hueco > UNIDO_M and not salida:
            salida.append({"acceso": True, "motivo": "del lugar de partida a la primera calle del anuncio",
                           "puntos": [list(fin), list(c.xy[entra])], "hueco_m": round(hueco)})
        elif hueco > UNIDO_M:
            salida.append({"enlace": True, "motivo": "el anuncio no detalla por dónde se une con la calle anterior: recta, trayecto aproximado",
                           "puntos": [list(fin), list(c.xy[entra])], "hueco_m": round(hueco)})
        ruta = c.camino(entra, sale)
        t["_crudo"] = ruta
        salida.append(t)
        fin = ruta[-1]
    # simplificación hasta ≤ MAX_PUNTOS en total
    tol = TOLERANCIA_M
    while True:
        for t in salida:
            if "_crudo" in t:
                t["puntos"] = rdp(t["_crudo"], tol)
        total = sum(len(t["puntos"]) for t in salida)
        if total <= MAX_PUNTOS:
            break
        tol *= 1.5
    for t in salida:
        t.pop("_crudo", None)
        t["puntos"] = [[round(a, 6), round(b, 6)] for a, b in t["puntos"]]
    rec["tramos"] = salida
    rec["puntos_total"] = sum(len(t["puntos"]) for t in salida)
    rec["tolerancia_m"] = round(tol, 1)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("parte")
    ap.add_argument("--osm", type=Path, help="respuesta de Overpass ya descargada (JSON)")
    ap.add_argument("--guardar-osm", type=Path, help="guardar aquí la respuesta de Overpass (fuera de git)")
    a = ap.parse_args()
    ruta = AQUI / "partes" / a.parte / "recorridos.json"
    doc = json.loads(ruta.read_text(encoding="utf-8"))
    nombres = [t["osm"] for r in doc["recorridos"] for t in r["tramos"] if "calle" in t]
    q = consulta(nombres + list(doc["geometria"].get("alias", {})), doc["geometria"]["bbox"])
    osm = json.loads(a.osm.read_text(encoding="utf-8")) if a.osm else descargar(q)
    if a.guardar_osm:
        a.guardar_osm.write_text(json.dumps(osm, ensure_ascii=False), encoding="utf-8")
    vias: dict[str, list] = {}
    alias = doc["geometria"].get("alias", {})
    for e in osm["elements"]:
        if e["type"] == "way":
            n = alias.get(e["tags"]["name"], e["tags"]["name"])
            vias.setdefault(n, []).append(e)
    calles = {n: Calle(n, vias.get(n, [])) for n in set(nombres)}
    for r in doc["recorridos"]:
        for t in r["tramos"]:
            t.pop("puntos", None)
        construir(r, calles)
    doc["geometria"]["consulta"] = q
    doc["geometria"]["osm_base"] = osm["osm3s"]["timestamp_osm_base"]
    ruta.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for r in doc["recorridos"]:
        print(r["id"], r["puntos_total"], "puntos ·", " → ".join(
            (f"[{'enlace' if t.get('enlace') else 'acceso'} {t['hueco_m']} m]" if "calle" not in t else t["calle"] + (" (cruce)" if t.get("solo_cruce") else ""))
            for t in r["tramos"]))


if __name__ == "__main__":
    main()
