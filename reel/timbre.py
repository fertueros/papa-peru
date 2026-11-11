"""Cambia el timbre de una narración ya generada, conservando su entonación y su ritmo.

    <python con chatterbox> timbre.py salida/qwen-voz_1 voces/piper_claude_ref.wav

Convierte frase a frase con ChatterboxVC (el que habla sigue siendo el de la carpeta de origen:
su entonación, pausas y acento; solo cambia el color de la voz) y escribe una carpeta nueva
salida/<origen>+<timbre>/ con narracion.wav y tiempos.json reajustados.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

SR = 24000


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("origen", type=Path, help="carpeta con narracion.wav y tiempos.json")
    ap.add_argument("timbre", type=Path, help="WAV/MP3 de 10-20 s con la voz cuyo timbre quieres")
    a = ap.parse_args()

    from chatterbox.vc import ChatterboxVC
    import librosa

    tiempos = json.loads((a.origen / "tiempos.json").read_text(encoding="utf-8"))
    pista, sr = sf.read(a.origen / "narracion.wav", dtype="float32")
    if sr != SR:
        sys.exit(f"narracion.wav a {sr} Hz; se esperaba {SR}")

    vc = ChatterboxVC.from_pretrained(device="cuda")
    vc.set_target_voice(str(a.timbre))
    tmp = Path(tempfile.mkdtemp(prefix="timbre-"))

    # tramos (inicio_viejo, fin_viejo, audio_nuevo): frases convertidas y pausas tal cual
    frases = [f for tr in tiempos["trozos"] for f in tr["frases"]]
    tramos, cursor = [], 0.0
    for i, f in enumerate(frases):
        if f["t0"] > cursor:
            tramos.append((cursor, f["t0"], pista[int(cursor * SR):int(f["t0"] * SR)] * 0))
        fuente = tmp / "frase.wav"
        sf.write(fuente, pista[int(f["t0"] * SR):int(f["t1"] * SR)], SR)
        nuevo = vc.generate(str(fuente)).squeeze(0).cpu().numpy().astype(np.float32)
        if vc.sr != SR:
            nuevo = librosa.resample(nuevo, orig_sr=vc.sr, target_sr=SR)
        tramos.append((f["t0"], f["t1"], nuevo))
        cursor = f["t1"]
        print(f"  {i + 1}/{len(frases)}: {f['texto'][:60]}", flush=True)
    final = tiempos["duracion"]
    if final > cursor:
        tramos.append((cursor, final, np.zeros(int((final - cursor) * SR), dtype=np.float32)))

    # reloj viejo → reloj nuevo, lineal dentro de cada tramo
    mapa, t = [], 0.0
    for v0, v1, audio in tramos:
        mapa.append((v0, v1, t, t + len(audio) / SR))
        t += len(audio) / SR

    def nuevo_t(x: float) -> float:
        for v0, v1, n0, n1 in mapa:
            if x <= v1 + 1e-6:
                return round(n0 + (x - v0) / max(v1 - v0, 1e-9) * (n1 - n0), 3)
        return round(t, 3)

    for tr in tiempos["trozos"]:
        tr["t0"], tr["t1"] = nuevo_t(tr["t0"]), nuevo_t(tr["t1"])
        for f in tr["frases"]:
            f["t0"], f["t1"] = nuevo_t(f["t0"]), nuevo_t(f["t1"])
            f["golpes"] = [[g, nuevo_t(g0), nuevo_t(g1)] for g, g0, g1 in f["golpes"]]
    tiempos["duracion"] = round(t, 3)
    tiempos["motor"] += f"+{a.timbre.stem}"

    destino = a.origen.with_name(f"{a.origen.name}+{a.timbre.stem}")
    destino.mkdir(parents=True, exist_ok=True)
    sf.write(destino / "narracion.wav", np.concatenate([x for _, _, x in tramos]), SR)
    (destino / "tiempos.json").write_text(json.dumps(tiempos, ensure_ascii=False, indent=1),
                                          encoding="utf-8")
    print(f"Narración: {t:.1f} s → {destino}")


if __name__ == "__main__":
    main()
