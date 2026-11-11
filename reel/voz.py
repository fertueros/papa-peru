"""Narración del reel: una pista WAV y los tiempos de cada frase.

Por defecto usa Kokoro (voz em_alex, velocidad 1.0). Con --clonar MI_VOZ.mp3, Kokoro dice el
texto con acento neutro y ChatterboxVC le pone el timbre de esa grabación (10-20 s limpios).
Con --metodo directo es Chatterbox Multilingual quien habla (su español tira a rioplatense).

Se ejecuta con el Python que ya tiene kokoro y chatterbox instalados (ver hacer_reel.sh).
Escribe en salida/<motor>/: narracion.wav y tiempos.json.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

AQUI = Path(__file__).resolve().parent
# La cadena original (de Fernando) guarda las voces de referencia y los entornos pesados
# (.runtime/qwen, .runtime/limpiar): se usan por ruta, nunca se copian a este repo público.
ORIGEN = Path(os.environ.get("REEL_ORIGEN", Path.home() / "Documentos" / "reel-solvencia-paraguay"))
SR = 24000
ENTRADA = 0.35  # silencio antes de la primera frase
ENTRE_FRASES = 0.38
ENTRE_TROZOS = 0.55
COLA = 1.6  # el último cuadro se queda en pantalla
FRASES = re.compile(r"(?<=[.!?])\s+(?=[¿¡A-ZÁÉÍÓÚÑ])")


def frases(texto: str) -> list[str]:
    return [f.strip() for f in FRASES.split(texto.strip()) if f.strip()]


def silencio(segundos: float) -> np.ndarray:
    return np.zeros(int(round(segundos * SR)), dtype=np.float32)


class Kokoro:
    def __init__(self, voz: str, velocidad: float):
        from kokoro import KPipeline
        from misaki import espeak

        self.tubo = KPipeline(lang_code="e", device="cuda")
        self.tubo.g2p = espeak.EspeakG2P(language="es-419")
        self.voz, self.velocidad = voz, velocidad

    def decir(self, texto: str) -> np.ndarray:
        partes = [np.asarray(r.audio, dtype=np.float32)
                  for r in self.tubo(texto, voice=self.voz, speed=self.velocidad)]
        return np.concatenate(partes)


class Clon:
    """Chatterbox Multilingual con la voz de referencia; la velocidad se aplica con atempo."""

    def __init__(self, referencia: Path, velocidad: float, exageracion: float, cfg: float):
        import torch  # noqa: F401
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        self.tmp = Path(tempfile.mkdtemp(prefix="clon-"))
        self.ref = self.tmp / "referencia.wav"
        # mp3 → wav mono, sin silencios largos al principio
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(referencia),
                        "-af", "silenceremove=start_periods=1:start_threshold=-45dB",
                        "-ac", "1", "-ar", "24000", str(self.ref)], check=True)
        self.modelo = ChatterboxMultilingualTTS.from_pretrained(device="cuda")
        self.velocidad, self.exageracion, self.cfg = velocidad, exageracion, cfg

    def decir(self, texto: str) -> np.ndarray:
        import torchaudio as ta

        wav = self.modelo.generate(texto, language_id="es", audio_prompt_path=str(self.ref),
                                   exaggeration=self.exageracion, cfg_weight=self.cfg)
        crudo, salida = self.tmp / "frase.wav", self.tmp / "frase_rapida.wav"
        ta.save(str(crudo), wav.cpu(), self.modelo.sr)
        filtro = f"atempo={self.velocidad},silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08," \
                 "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(crudo), "-af", filtro,
                        "-ac", "1", "-ar", str(SR), str(salida)], check=True)
        audio, _ = sf.read(salida, dtype="float32")
        return audio


def referencia_wav(mp3: Path, carpeta: Path) -> Path:
    """mp3 → wav mono 24 kHz sin el silencio inicial."""
    ref = carpeta / "referencia.wav"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(mp3),
                    "-af", "silenceremove=start_periods=1:start_threshold=-45dB",
                    "-ac", "1", "-ar", "24000", str(ref)], check=True)
    return ref


SIMULACION = Path(os.environ.get("REEL_SIMULACION", Path.home() / "Documentos" / "fundamentos-python-cd-fct" / ".runtime" / "simulacion"))
PIPER = SIMULACION / "venv" / "bin" / "piper"
VOCES_PIPER = SIMULACION / "voces"


class Piper:
    """Voz Piper (VITS entrenado con hablantes nativos): la «r» suena bien, el timbre es más plano."""

    def __init__(self, voz: str, velocidad: float):
        self.modelo = VOCES_PIPER / f"{voz}.onnx"
        if not self.modelo.exists():
            disponibles = ", ".join(p.stem for p in VOCES_PIPER.glob("*.onnx"))
            sys.exit(f"No existe la voz Piper {voz}. Disponibles: {disponibles}")
        self.escala = 1.0 / velocidad
        self.tmp = Path(tempfile.mkdtemp(prefix="piper-"))

    def decir(self, texto: str) -> np.ndarray:
        crudo, limpio = self.tmp / "crudo.wav", self.tmp / "limpio.wav"
        subprocess.run([str(PIPER), "-m", str(self.modelo), "-f", str(crudo),
                        "--length-scale", f"{self.escala:.3f}"],
                       input=texto.encode("utf-8"), check=True, capture_output=True)
        filtro = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08," \
                 "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(crudo), "-af", filtro,
                        "-ac", "1", "-ar", str(SR), str(limpio)], check=True)
        audio, _ = sf.read(limpio, dtype="float32")
        return audio


class Conversion:
    """Kokoro dice el texto (acento latino neutro) y ChatterboxVC le pone tu timbre.

    El acento, el ritmo y las pausas son los de Kokoro; de tu grabación solo se toma el color
    de la voz. Por eso no se cuela el acento que el TTS de Chatterbox trae de fábrica.
    """

    def __init__(self, referencia: Path, base):
        from chatterbox.vc import ChatterboxVC

        self.base = base
        self.tmp = Path(tempfile.mkdtemp(prefix="conv-"))
        self.vc = ChatterboxVC.from_pretrained(device="cuda")
        self.vc.set_target_voice(str(referencia_wav(referencia, self.tmp)))

    def decir(self, texto: str) -> np.ndarray:
        fuente = self.tmp / "base.wav"
        sf.write(fuente, self.base.decir(texto), SR)
        wav = self.vc.generate(str(fuente)).squeeze(0).cpu().numpy().astype(np.float32)
        if self.vc.sr != SR:
            import librosa
            wav = librosa.resample(wav, orig_sr=self.vc.sr, target_sr=SR)
        return wav


LIMPIAR = ORIGEN / ".runtime" / "limpiar" / "bin" / "python"


def limpiar(clip: Path) -> None:
    """Quita el ruido de fondo del clip con DeepFilterNet (guarda el original como *_original.wav).

    Si la referencia trae ruido, F5/Qwen/ChatterboxVC lo copian en cada frase generada.
    """
    original = clip.with_name(clip.stem + "_original.wav")
    if original.exists():
        return  # ya limpio
    if not LIMPIAR.exists():
        print("  (sin .runtime/limpiar: la referencia se usa con su ruido)", flush=True)
        return
    clip.rename(original)
    subprocess.run([str(LIMPIAR), str(ORIGEN / "limpiar_voz.py"), str(original), str(clip)], check=True)
    print(f"  ruido de fondo quitado: {clip.name} (original en {original.name})", flush=True)


def firma(ruta: Path) -> str:
    import hashlib
    return hashlib.sha1(ruta.read_bytes()).hexdigest()[:8]


def preparar_referencia(audio: Path, texto: Path | None) -> tuple[Path, str]:
    """Clip de 6-12 s entre dos pausas y su transcripción (F5 y Qwen piden ambas cosas).

    Si ya viene el texto, se usa el audio tal cual. Si no, el clip y su texto se guardan en
    voces/<nombre>_ref.wav y .txt para que puedas corregir la transcripción y reutilizarla.
    """
    if texto:
        return audio, texto.read_text(encoding="utf-8").strip()
    carpeta = ORIGEN / "voces"
    carpeta.mkdir(exist_ok=True)
    clip, txt = carpeta / f"{audio.stem}_ref.wav", carpeta / f"{audio.stem}_ref.txt"
    if clip.exists() and txt.exists():
        print(f"  referencia ya preparada: {clip.name} + {txt.name}")
        limpiar(clip)
        return clip, txt.read_text(encoding="utf-8").strip()
    total = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                  "-of", "csv=p=0", str(audio)],
                                 capture_output=True, text=True, check=True).stdout)
    cortes = [0.0]
    for umbral in ("-30dB", "-25dB"):
        log = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(audio), "-af",
                              f"silencedetect=noise={umbral}:d=0.2", "-f", "null", "-"],
                             capture_output=True, text=True).stderr
        ini = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", log)]
        fin = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", log)]
        cortes = sorted({0.0, total, *[(a + b) / 2 for a, b in zip(ini, fin)]})
        if len(cortes) > 3:
            break
    mejor = None
    for i, a in enumerate(cortes):
        for b in cortes[i + 1:]:
            if 6 <= b - a <= 12 and (mejor is None or b - a > mejor[1] - mejor[0]):
                mejor = (a, b)
    a, b = mejor or (0.0, min(total, 10.0))
    print(f"  referencia: {a:.1f}-{b:.1f} s de {audio.name}")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{a:.2f}", "-to", f"{b:.2f}",
                    "-i", str(audio), "-ac", "1", "-ar", "24000", str(clip)], check=True)
    limpiar(clip)
    from faster_whisper import WhisperModel

    segs, _ = WhisperModel("small", device="cpu", compute_type="int8").transcribe(
        str(clip), language="es", beam_size=5)
    dicho = " ".join(s.text.strip() for s in segs)
    txt.write_text(dicho + "\n", encoding="utf-8")
    print(f"  transcripción (corrígela en {txt} si falla): {dicho}")
    return clip, dicho


def acelerar(audio: np.ndarray, sr: int, velocidad: float, tmp: Path) -> np.ndarray:
    """Pasa a 24 kHz, aplica la velocidad con atempo y recorta silencios de los bordes."""
    crudo, listo = tmp / "crudo.wav", tmp / "listo.wav"
    sf.write(crudo, audio, sr)
    filtro = ("" if abs(velocidad - 1) < 1e-3 else f"atempo={velocidad},") + \
        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08," \
        "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse," \
        "afade=t=in:d=0.01,areverse,afade=t=in:d=0.03,areverse"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(crudo), "-af", filtro,
                    "-ac", "1", "-ar", str(SR), str(listo)], check=True)
    salida, _ = sf.read(listo, dtype="float32")
    return salida


class F5:
    """F5-TTS con el checkpoint en español de jpgallegoar (incluye hablantes peruanos).

    Copia timbre Y pronunciación de la referencia: el acento sale del tuyo.
    """

    REPO = "jpgallegoar/F5-Spanish"

    def __init__(self, referencia: Path, texto: Path | None, velocidad: float):
        from f5_tts.api import F5TTS
        from huggingface_hub import hf_hub_download

        self.ref, self.ref_texto = preparar_referencia(referencia, texto)
        self.firma = firma(self.ref)
        print("  cargando F5-TTS (~15 s)…", flush=True)
        self.modelo = F5TTS(model="F5TTS_Base",
                            ckpt_file=hf_hub_download(self.REPO, "model_1250000.safetensors"),
                            vocab_file=hf_hub_download(self.REPO, "vocab.txt"), device="cuda")
        self.velocidad, self.semilla = velocidad, 7
        self.tmp = Path(tempfile.mkdtemp(prefix="f5-"))

    def decir(self, texto: str) -> np.ndarray:
        wav, sr, _ = self.modelo.infer(ref_file=str(self.ref), ref_text=self.ref_texto,
                                       gen_text=texto, speed=self.velocidad, nfe_step=32,
                                       seed=self.semilla, show_info=lambda *a, **k: None)
        return acelerar(np.asarray(wav, dtype=np.float32), sr, 1.0, self.tmp)


class Qwen:
    """Qwen3-TTS 0.6B Base: clonación con referencia + transcripción, idioma español."""

    MODELO = "Qwen/Qwen3-TTS-12Hz-0.6B-Base"

    def __init__(self, referencia: Path, texto: Path | None, velocidad: float):
        ref, ref_texto = preparar_referencia(referencia, texto)
        self.firma = firma(ref)
        print("  cargando Qwen3-TTS (~30 s)…", flush=True)
        import torch
        from qwen_tts import Qwen3TTSModel

        self.modelo = Qwen3TTSModel.from_pretrained(self.MODELO, device_map="cuda",
                                                    dtype=torch.bfloat16)
        self.prompt = self.modelo.create_voice_clone_prompt(ref_audio=str(ref), ref_text=ref_texto)
        self.velocidad = velocidad
        self.tmp = Path(tempfile.mkdtemp(prefix="qwen-"))

    def decir(self, texto: str) -> np.ndarray:
        wavs, sr = self.modelo.generate_voice_clone(text=texto, language="Spanish",
                                                    voice_clone_prompt=self.prompt)
        return acelerar(np.asarray(wavs[0], dtype=np.float32), sr, self.velocidad, self.tmp)


def frase_grabada(motor, dicha: str, salida: Path, nombre: str, velocidad: float,
                  rehacer: list[str], etiqueta: str) -> np.ndarray:
    """Cada frase se guarda en salida/frases/<huella>.wav y se reutiliza en la siguiente pasada.

    Con --rehacer, la frase se graba de nuevo con otra semilla (otra «toma»): sirve cuando
    Qwen o F5 se traban en una frase concreta y el resto ya quedó bien.
    """
    import hashlib

    carpeta = salida / "frases"
    carpeta.mkdir(exist_ok=True)
    indice_ruta = carpeta / "indice.json"
    indice = json.loads(indice_ruta.read_text(encoding="utf-8")) if indice_ruta.exists() else {}
    clave = f"{nombre}|{velocidad}|{getattr(motor, 'firma', '')}|{dicha}"
    huella = hashlib.sha1(clave.encode()).hexdigest()[:12]
    ruta = carpeta / f"{huella}.wav"
    otra_toma = any(r in dicha.lower() for r in rehacer)
    if ruta.exists() and not otra_toma:
        print(f"  {etiqueta} (guardada): {dicha[:55]}", flush=True)
        audio, _ = sf.read(ruta, dtype="float32")
        return audio
    toma = indice.get(huella, {}).get("toma", 0) + (1 if otra_toma and ruta.exists() else 0)
    print(f"  {etiqueta}{f' (toma {toma + 1})' if toma else ''}: {dicha[:55]}", flush=True)
    try:
        import torch
        torch.manual_seed(int(huella, 16) % 2**31 + toma)
    except ImportError:
        pass
    if hasattr(motor, "semilla"):
        motor.semilla = int(huella, 16) % 2**31 + toma
    audio = motor.decir(dicha)
    sf.write(ruta, audio, SR)
    indice[huella] = {"texto": dicha, "toma": toma}
    indice_ruta.write_text(json.dumps(indice, ensure_ascii=False, indent=1), encoding="utf-8")
    return audio


def trocear(texto: str, max_palabras: int = 5) -> list[str]:
    """Subtítulo en golpes cortos, cortando antes en comas y dos puntos."""
    trozos, actual = [], []
    palabras = []
    for p in texto.split():  # «₲» va con la cifra siguiente y «%» con la anterior
        if palabras and (palabras[-1] == "₲" or p.startswith("%")):
            palabras[-1] += " " + p
        else:
            palabras.append(p)
    for p in palabras:
        actual.append(p)
        if len(actual) >= max_palabras or (p[-1] in ",:;…" and len(actual) >= 2):
            trozos.append(" ".join(actual))
            actual = []
    if actual:
        if trozos and len(actual) == 1:
            trozos[-1] += " " + actual[0]
        else:
            trozos.append(" ".join(actual))
    return trozos


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--guion", type=Path, required=True, help="reel/partes/<n>/guion.json")
    ap.add_argument("--clonar", type=Path, help="MP3/WAV con la voz a imitar")
    ap.add_argument("--metodo", choices=["conversion", "directo", "f5", "qwen"], default="conversion",
                    help="conversion: voz base (Piper/Kokoro) + tu timbre (por defecto)\n"
                         "directo: Chatterbox habla con tu voz (tira a rioplatense)\n"
                         "f5: F5-TTS español, copia timbre y acento de tu grabación\n"
                         "qwen: Qwen3-TTS 0.6B, clonación en español")
    ap.add_argument("--ref-texto", type=Path,
                    help="f5/qwen: transcripción exacta del audio de --clonar (si falta, se\n"
                         "recorta un tramo de 6-12 s y se transcribe solo)")
    ap.add_argument("--base", choices=["kokoro", "piper"],
                    help="quién dice el texto. Por defecto: kokoro sin --clonar, piper con --clonar\n"
                         "(Kokoro articula flojo la «r» española; Piper es nativo)")
    ap.add_argument("--voz", help="Kokoro: em_alex (defecto), ef_dora, em_santa · "
                                  "Piper: es_MX-claude-high (defecto), es_MX-ald-medium, es_ES-davefx-medium")
    ap.add_argument("--velocidad", type=float, default=1.0)
    ap.add_argument("--exageracion", type=float, default=0.5, help="Chatterbox: expresividad")
    ap.add_argument("--cfg", type=float, default=0.5, help="Chatterbox: apego al ritmo de la referencia")
    ap.add_argument("--salida", type=Path, help="carpeta base; la voz queda en <salida>/<motor>/")
    ap.add_argument("--rehacer", action="append", default=[], metavar="TEXTO",
                    help="vuelve a grabar (otra toma) las frases que contienen TEXTO; repetible.\n"
                         "El resto se reutiliza de salida/<motor>/frases/")
    a = ap.parse_args()

    guion = json.loads(a.guion.read_text(encoding="utf-8"))
    base_nombre = a.base or ("piper" if a.clonar else "kokoro")
    voz = a.voz or ("es_MX-claude-high" if base_nombre == "piper" else "em_alex")

    def base():
        return Piper(voz, a.velocidad) if base_nombre == "piper" else Kokoro(voz, a.velocidad)

    if a.clonar:
        if not a.clonar.exists():
            sys.exit(f"No encuentro la voz a clonar: {a.clonar}")
        if a.metodo == "f5":
            motor, nombre = F5(a.clonar, a.ref_texto, a.velocidad), f"f5-{a.clonar.stem}"
        elif a.metodo == "qwen":
            motor, nombre = Qwen(a.clonar, a.ref_texto, a.velocidad), f"qwen-{a.clonar.stem}"
        elif a.metodo == "conversion":
            motor, nombre = Conversion(a.clonar, base()), f"clon-{a.clonar.stem}-{voz}"
        else:
            motor = Clon(a.clonar, a.velocidad, a.exageracion, a.cfg)
            nombre = "clon-directo-" + a.clonar.stem
    else:
        motor, nombre = base(), f"{base_nombre}-{voz}"
    salida = a.salida / nombre if a.salida else AQUI / "salida" / nombre
    salida.mkdir(parents=True, exist_ok=True)
    rehacer = [r.lower() for r in a.rehacer]

    entrada = float(guion.get("entrada", ENTRADA))  # la portada fija ocupa este hueco
    cola = float(guion.get("cola", COLA))  # la pregunta final en pantalla y la música en fundido (sin créditos)
    pista, t = [silencio(entrada)], entrada
    tiempos = {"motor": nombre, "velocidad": a.velocidad, "titulo": guion.get("titulo", ""),
               "firma": guion.get("firma", ""), "trozos": [],
               "meta": {k: guion.get(k) for k in ("titulo", "parte", "tramo", "fechas", "foto_portada")}}
    for i, trozo in enumerate(guion["trozos"]):
        dichas, vistas = frases(trozo["voz"]), frases(trozo.get("texto", trozo["voz"]))
        if len(dichas) != len(vistas):
            sys.exit(f"{trozo['id']}: 'voz' tiene {len(dichas)} frases y 'texto' {len(vistas)}")
        inicio, registro = t, []
        for j, (dicha, vista) in enumerate(zip(dichas, vistas)):
            audio = frase_grabada(motor, dicha, salida, nombre, a.velocidad, rehacer,
                                  f"{trozo['id']} {j + 1}/{len(dichas)}")
            a0, a1 = t, t + len(audio) / SR
            golpes = trocear(vista)
            pesos = np.array([len(g) + 3 for g in golpes], dtype=float)
            bordes = a0 + (a1 - a0) * np.concatenate([[0], np.cumsum(pesos) / pesos.sum()])
            registro.append({"t0": round(a0, 3), "t1": round(a1, 3), "texto": vista,
                             "golpes": [[g, round(bordes[k], 3), round(bordes[k + 1], 3)]
                                        for k, g in enumerate(golpes)]})
            pista.append(audio)
            t = a1
            pausa = ENTRE_FRASES if j < len(dichas) - 1 else (
                ENTRE_TROZOS if i < len(guion["trozos"]) - 1 else cola)
            pista.append(silencio(pausa))
            t += pausa
        tiempos["trozos"].append({"id": trozo["id"], "escena": trozo["escena"],
                                  "mapa": trozo.get("mapa", {}), "foto": trozo.get("foto"),
                                  "t0": round(inicio, 3), "t1": round(t, 3), "frases": registro})
    tiempos["duracion"] = round(t, 3)

    sf.write(salida / "narracion.wav", np.concatenate(pista), SR)
    (salida / "tiempos.json").write_text(json.dumps(tiempos, ensure_ascii=False, indent=1),
                                         encoding="utf-8")
    print(f"Narración: {t:.1f} s → {salida}")


if __name__ == "__main__":
    main()
