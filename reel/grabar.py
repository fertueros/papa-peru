"""Graba reel.html cuadro a cuadro y lo une con la narración en un MP4 vertical 1080x1920.

    python grabar.py <carpeta-voz> --parte 1-lima --destino ../.runtime/reels/1-lima
        → <destino>/reel.mp4, <destino>/portada.png y <destino>/capturas/*.png
    python grabar.py <carpeta-voz> --parte 1-lima --destino … --cuadros 3 20   # solo PNG, para revisar

Inyecta en la página la agenda oficial (site/data/agenda.json), el contorno del Perú
(site/img/peru.svg, Natural Earth) y los «datos» del guion. Necesita Playwright con Chromium y ffmpeg.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

AQUI = Path(__file__).resolve().parent
SITE = AQUI.parent / "site"
# instantes de las capturas de evidencia: portada, gancho, vuelo, Lima (11 y 12), norte y créditos
CAPTURAS = {"portada": 0.2, "gancho": "gancho+2.2", "vuelo": "vuelo+3.0", "aterrizaje": "vuelo-0.6",
            "lima-11": "noche-11-0.8", "lima-12": "tarde-12-0.8", "norte": "norte-0.6", "creditos": "fin-0.8"}


def instante(clave, tiempos: dict) -> float:
    if isinstance(clave, (int, float)):
        return float(clave)
    if clave.startswith("fin"):
        return tiempos["duracion"] + float(clave[3:])
    trozo, signo, valor = re.match(r"(.+?)([+-])([\d.]+)$", clave).groups()
    tr = next(x for x in tiempos["trozos"] if x["id"] == trozo)
    return tr["t0"] + float(valor) if signo == "+" else tr["t1"] - float(valor)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("carpeta", type=Path, help="carpeta con narracion.wav y tiempos.json")
    ap.add_argument("--parte", required=True, help="nombre de reel/partes/<parte>/")
    ap.add_argument("--destino", type=Path, required=True)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--cuadros", type=float, nargs="+", help="segundos a exportar como PNG (sin vídeo)")
    a = ap.parse_args()

    carpeta, destino = a.carpeta.resolve(), a.destino.resolve()
    (destino / "capturas").mkdir(parents=True, exist_ok=True)
    tiempos = json.loads((carpeta / "tiempos.json").read_text(encoding="utf-8"))
    guion = json.loads((AQUI / "partes" / a.parte / "guion.json").read_text(encoding="utf-8"))
    agenda = json.loads((SITE / "data" / "agenda.json").read_text(encoding="utf-8"))
    peru = re.search(r'\bd="([^"]+)"', (SITE / "img" / "peru.svg").read_text(encoding="utf-8")).group(1)
    # mapa/foto del guion actual (por si se cambió después de grabar la voz)
    for tr in tiempos["trozos"]:
        g = next(x for x in guion["trozos"] if x["id"] == tr["id"])
        tr["mapa"], tr["foto"] = g.get("mapa", {}), g.get("foto")
    tiempos["meta"] = {k: guion.get(k) for k in ("titulo", "parte", "tramo", "fechas", "foto_portada")}
    datos = {t["id"]: t.get("datos", []) for t in guion["trozos"]}
    duracion = tiempos["duracion"]

    with sync_playwright() as p:
        nav = p.chromium.launch(args=["--mute-audio", "--allow-file-access-from-files"])
        pagina = nav.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
        pagina.add_init_script(
            f"window.TIEMPOS = {json.dumps(tiempos, ensure_ascii=False)};"
            f"window.AGENDA = {json.dumps(agenda, ensure_ascii=False)};"
            f"window.GUION_DATOS = {json.dumps(datos, ensure_ascii=False)};"
            f"window.PERU_D = {json.dumps(peru)};")
        errores = []
        pagina.on("pageerror", lambda e: errores.append(str(e)))
        pagina.goto((AQUI / "reel.html").as_uri())
        pagina.evaluate("document.fonts.ready")
        pagina.evaluate("window.reelListo")
        faltan = pagina.evaluate("Object.keys(window.TIEMPOS.trozos.reduce((o,t)=>(t.foto&&(o[t.foto]=1),o),{}))")
        lienzo = pagina.locator("#c")

        def foto(t: float, ruta: Path) -> None:
            pagina.evaluate(f"reelIr({t})")
            lienzo.screenshot(path=str(ruta))
            if errores:
                sys.exit(f"error en reel.html a {t:.2f} s: {errores[0]}")

        foto(0.0, destino / "portada.png")
        print(destino / "portada.png", "· fotos:", faltan)
        if a.cuadros:
            for t in a.cuadros:
                foto(t, destino / "capturas" / f"cuadro_{t:06.2f}.png")
            nav.close()
            return
        for nombre, clave in CAPTURAS.items():
            foto(instante(clave, tiempos), destino / "capturas" / f"{nombre}.png")

        mp4 = destino / "reel.mp4"
        ffmpeg = subprocess.Popen(
            ["ffmpeg", "-loglevel", "error", "-y",
             "-f", "image2pipe", "-framerate", str(a.fps), "-c:v", "png", "-i", "-",
             "-i", str(carpeta / "narracion.wav"),
             "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
             "-r", str(a.fps), "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
             "-movflags", "+faststart", "-shortest", str(mp4)],
            stdin=subprocess.PIPE)
        total = int(duracion * a.fps) + 1
        inicio = time.time()
        for i in range(total):
            pagina.evaluate(f"reelIr({i / a.fps})")
            ffmpeg.stdin.write(lienzo.screenshot(type="png"))
            if errores:
                sys.exit(f"error en reel.html a {i / a.fps:.2f} s: {errores[0]}")
            if i % (a.fps * 5) == 0:
                hecho = (i + 1) / total
                resto = (time.time() - inicio) / hecho * (1 - hecho)
                print(f"  {i / a.fps:6.1f} s / {duracion:.1f} s · quedan ~{resto:.0f} s", flush=True)
        nav.close()
        ffmpeg.stdin.close()
        if ffmpeg.wait() != 0:
            sys.exit("ffmpeg falló")
    print(f"Listo: {mp4}")


if __name__ == "__main__":
    main()
