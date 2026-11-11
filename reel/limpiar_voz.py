"""Quita el ruido de fondo de una grabación de voz con DeepFilterNet 3.

    .runtime/limpiar/bin/python limpiar_voz.py entrada.(mp3|wav) salida.wav [--atenuacion 30]

DeepFilterNet separa voz y ruido sin el sonido «metálico» de los filtros clásicos. Con
--atenuacion se limita cuánto baja el ruido (en dB): menos atenuación = más natural.
La salida es WAV mono a 24 kHz, lo que esperan F5, Qwen y ChatterboxVC.
"""

import argparse
import subprocess
import tempfile
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("entrada", type=Path)
    ap.add_argument("salida", type=Path)
    ap.add_argument("--atenuacion", type=float, default=None,
                    help="dB máximos de reducción de ruido (por defecto, sin límite)")
    a = ap.parse_args()

    from df.enhance import enhance, init_df, load_audio, save_audio

    modelo, estado, _ = init_df(log_level="ERROR")
    with tempfile.TemporaryDirectory() as tmp:
        wav48 = Path(tmp) / "entrada48.wav"
        limpio48 = Path(tmp) / "limpio48.wav"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(a.entrada),
                        "-ac", "1", "-ar", str(estado.sr()), str(wav48)], check=True)
        audio, _ = load_audio(str(wav48), sr=estado.sr())
        limpio = enhance(modelo, estado, audio, atten_lim_db=a.atenuacion)
        save_audio(str(limpio48), limpio, estado.sr())
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(limpio48),
                        "-ac", "1", "-ar", "24000", str(a.salida)], check=True)


if __name__ == "__main__":
    main()
