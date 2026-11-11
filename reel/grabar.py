"""Graba reel.html cuadro a cuadro y lo une con la narración en un MP4 vertical 1080x1920.

    python grabar.py <carpeta-voz> --parte 1-lima --destino ../.runtime/reels/1-lima
        → <destino>/reel.mp4, <destino>/portada.png y <destino>/capturas/*.png
    python grabar.py <carpeta-voz> --parte 1-lima --destino … --cuadros 3 20   # solo PNG, para revisar
    python grabar.py <carpeta-voz> --parte 1-lima --destino … --musica coro.wav             # voz + música
    python grabar.py <carpeta-voz> --parte 1-lima --destino … --musica coro.wav --remezclar # solo el audio

Con --musica, la música va bajo la voz con «ducking» (sidechaincompress: ~20 dB bajo la voz mientras se habla y
sube suave en portada, pausas y en el fundido final); la mezcla se normaliza en dos pasadas a -14 LUFS, pico -1,5 dBTP.
--remezclar reutiliza los cuadros del reel.mp4 ya grabado y solo rehace el audio.

Inyecta en la página la agenda oficial (site/data/agenda.json), el contorno del Perú
(site/img/peru.svg, Natural Earth), los «datos» del guion y, si existe, partes/<parte>/recorridos.json
(recorridos anunciados con geometría de OpenStreetMap ya guardada: el render no consulta OSM). Necesita Playwright con Chromium y ffmpeg.
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
# instantes de las capturas de evidencia: portada, gancho, vuelo, Lima (recorridos anunciados del 11 y 12, traslados),
# norte y cierre (la pregunta final: ya no hay pantalla de créditos)
CAPTURAS = {"portada": 0.2, "gancho": "gancho+2.2", "vuelo": "vuelo+3.0", "aterrizaje": "vuelo-0.6",
            "recorrido-11-cerrado": "noche-11+1.6", "recorrido-11-papamovil": "noche-11+4.3",
            "lima-11": "noche-11-0.8", "recorrido-12-papamovil": "manana-12+4.3",
            "traslado-catedral-plaza": "manana-12-3.0", "lima-12": "tarde-12-0.8",
            "norte": "norte-0.6", "cierre": "fin-0.3"}


def instante(clave, tiempos: dict) -> float:
    if isinstance(clave, (int, float)):
        return float(clave)
    if clave.startswith("fin"):
        return tiempos["duracion"] + float(clave[3:])
    trozo, signo, valor = re.match(r"(.+?)([+-])([\d.]+)$", clave).groups()
    tr = next(x for x in tiempos["trozos"] if x["id"] == trozo)
    return tr["t0"] + float(valor) if signo == "+" else tr["t1"] - float(valor)


MUSICA_BASE_DB = -8  # música sin voz, respecto a su máster (-16 LUFS): ~13 dB bajo la voz en portada y pausas
LOUDNORM = "loudnorm=I=-14:TP=-1.5:LRA=11"


def mezclar(voz: Path, musica: Path | None, duracion: float, salida: Path) -> dict:
    """Voz (+ música con ducking) → WAV estéreo 48 kHz normalizado en dos pasadas. Devuelve la medida final."""
    if musica:
        grafo = (
            f"[0:a]atrim=0:{duracion:.3f},aresample=48000,pan=stereo|c0=c0|c1=c0,asplit=2[voz][clave];"
            f"[1:a]aresample=48000,atrim=0:{duracion:.3f},asetpts=N/SR/TB,"
            f"afade=t=in:d=1.2,afade=t=out:st={max(duracion - 2.5, 0):.3f}:d=2.5,volume={MUSICA_BASE_DB}dB[mus];"
            # mientras se habla la música baja ~20 dB respecto a la voz (medido); suelta lenta para que no bombee
            "[mus][clave]sidechaincompress=threshold=0.08:ratio=2:attack=30:release=700:knee=6[bajo];"
            "[voz][bajo]amix=inputs=2:duration=first:normalize=0[mezcla]"
        )
        entradas = ["-i", str(voz), "-i", str(musica)]
    else:
        grafo = f"[0:a]atrim=0:{duracion:.3f},aresample=48000,pan=stereo|c0=c0|c1=c0[mezcla]"
        entradas = ["-i", str(voz)]
    medir = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", *entradas, "-filter_complex",
         f"{grafo};[mezcla]{LOUDNORM}:print_format=json[o]", "-map", "[o]", "-f", "null", "-"],
        capture_output=True, text=True, check=True).stderr
    m = json.loads(medir[medir.rindex("{"):medir.rindex("}") + 1])
    final = (f"{LOUDNORM}:linear=true:measured_I={m['input_i']}:measured_TP={m['input_tp']}"
             f":measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}"
             ":print_format=json")
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-y", *entradas, "-filter_complex",
         f"{grafo};[mezcla]{final},aresample=48000[o]", "-map", "[o]", "-c:a", "pcm_s24le", str(salida)],
        capture_output=True, text=True, check=True).stderr
    return json.loads(out[out.rindex("{"):out.rindex("}") + 1])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("carpeta", type=Path, help="carpeta con narracion.wav y tiempos.json")
    ap.add_argument("--parte", required=True, help="nombre de reel/partes/<parte>/")
    ap.add_argument("--destino", type=Path, required=True)
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--cuadros", type=float, nargs="+", help="segundos a exportar como PNG (sin vídeo)")
    ap.add_argument("--musica", type=Path, help="WAV de música de fondo (CC0 o propia) para mezclar bajo la voz")
    ap.add_argument("--remezclar", action="store_true", help="solo rehacer el audio del reel.mp4 existente")
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
    fichero_rec = AQUI / "partes" / a.parte / "recorridos.json"
    recorridos = json.loads(fichero_rec.read_text(encoding="utf-8")) if fichero_rec.exists() else None
    # sin pantalla de créditos (R8): la cola tras la última frase es la del guion actual; si la voz se grabó con
    # una cola más larga, se recorta aquí (vídeo y voz) sin regenerar la voz
    ultima = tiempos["trozos"][-1]["frases"][-1]["t1"]
    duracion = round(min(tiempos["duracion"], ultima + float(guion.get("cola", 2.5))), 3)
    tiempos["duracion"] = tiempos["trozos"][-1]["t1"] = duracion
    musica = a.musica.resolve() if a.musica else None
    if musica and not musica.exists():
        sys.exit(f"no existe la música {musica}")
    mp4 = destino / "reel.mp4"
    audio = destino / "mezcla.wav"
    if not a.cuadros:
        medida = mezclar(carpeta / "narracion.wav", musica, duracion, audio)
        print(f"Audio: {'voz + música' if musica else 'voz'} · {medida['output_i']} LUFS · pico {medida['output_tp']} dBTP")
    if a.remezclar:
        previo = destino / "reel.sin-remezcla.mp4"
        mp4.replace(previo)
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-i", str(previo), "-i", str(audio), "-map", "0:v", "-map", "1:a",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-shortest",
             str(mp4)], check=True)
        previo.unlink()
        print(f"Listo (solo audio): {mp4}")
        return

    with sync_playwright() as p:
        nav = p.chromium.launch(args=["--mute-audio", "--allow-file-access-from-files"])
        pagina = nav.new_page(viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
        pagina.add_init_script(
            f"window.TIEMPOS = {json.dumps(tiempos, ensure_ascii=False)};"
            f"window.AGENDA = {json.dumps(agenda, ensure_ascii=False)};"
            f"window.GUION_DATOS = {json.dumps(datos, ensure_ascii=False)};"
            f"window.RECORRIDOS = {json.dumps(recorridos, ensure_ascii=False)};"
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

        ffmpeg = subprocess.Popen(
            ["ffmpeg", "-loglevel", "error", "-y",
             "-f", "image2pipe", "-framerate", str(a.fps), "-c:v", "png", "-i", "-",
             "-i", str(audio),
             "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
             "-r", str(a.fps), "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
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
