#!/usr/bin/env bash
# Genera el reel de una parte del itinerario: voz (Qwen3-TTS + timbre ChatterboxVC) → canvas → MP4.
#
#   reel/hacer_reel.sh 1-lima                       # voz por defecto de Fernando (ver abajo)
#   reel/hacer_reel.sh 1-lima --rehacer "Gran Teatro"   # otra toma solo de esa frase
#   reel/hacer_reel.sh 1-lima --solo-voz            # para revisar la voz sin grabar vídeo
#   reel/hacer_reel.sh 1-lima --solo-video          # reusar la voz ya hecha
#   reel/hacer_reel.sh 1-lima --solo-video --remezclar   # solo rehacer el audio (voz + música)
#   reel/hacer_reel.sh 1-lima --sin-musica          # sin música de fondo
#
# Música: por defecto ../.runtime/reels/musica/coro.wav (coro original del proyecto) si existe, o
# --musica <wav>; va bajo la voz con ducking (ver grabar.py).
#
# Lee reel/partes/<parte>/guion.json y site/data/agenda.json. Todo lo generado (voz, frases, MP4,
# portada, capturas) va a ../.runtime/reels/<parte>/ del meta-repo (o $REEL_SALIDA): FUERA de git.
# Los entornos pesados y las voces de referencia se usan por ruta desde $REEL_ORIGEN (la cadena
# original de Fernando, ~/Documentos/reel-solvencia-paraguay); no se copian aquí.
set -euo pipefail
cd "$(dirname "$0")"

parte=${1:?uso: hacer_reel.sh <parte> [opciones de voz.py]}
shift
ORIGEN=${REEL_ORIGEN:-$HOME/Documentos/reel-solvencia-paraguay}
SALIDA=${REEL_SALIDA:-$(cd ../../.. && pwd)/.runtime/reels/$parte}
GPU=${PY_GPU:-$HOME/Documentos/fundamentos-python-cd-fct/.runtime/simulacion/gpu/bin/python}
PY_VOZ=${PY_VOZ:-$ORIGEN/.runtime/qwen/bin/python}
guion=partes/$parte/guion.json
[ -f "$guion" ] || { echo "No existe $guion" >&2; exit 1; }
mkdir -p "$SALIDA/voz" "$SALIDA/capturas"

solo_voz=0
solo_video=0
musica=$(cd ../../.. && pwd)/.runtime/reels/musica/coro.wav
remezclar=()
timbre=$ORIGEN/voces/piper_claude_ref.wav
args=(--clonar "$ORIGEN/voces/voz_1_ref.wav" --ref-texto "$ORIGEN/voces/voz_1_ref.txt" --metodo qwen)
while [ $# -gt 0 ]; do
  case "$1" in
    --timbre) timbre=$2; shift 2 ;;
    --sin-timbre) timbre=""; shift ;;
    --solo-voz) solo_voz=1; shift ;;
    --solo-video) solo_video=1; shift ;;
    --musica) musica=$2; shift 2 ;;
    --sin-musica) musica=""; shift ;;
    --remezclar) remezclar=(--remezclar); shift ;;
    *) args+=("$1"); shift ;;
  esac
done

RUIDO="Warning|warn\(|warn_once|warnings.warn|pkg_resources|SoX|sox|flash-attn|path variables|proceed here|pad_token_id|Fetching [0-9]+ files|^\*+$|^ *$"
carpeta=$SALIDA/voz/qwen-voz_1_ref
[ -n "$timbre" ] && carpeta=$carpeta+$(basename "${timbre%.*}")
if [ "$solo_video" = 0 ]; then
  "$PY_VOZ" voz.py --guion "$guion" --salida "$SALIDA/voz" "${args[@]}" \
    2> >(grep --line-buffered -v -E "$RUIDO" >&2) | grep --line-buffered -v -E "$RUIDO" | tee "$SALIDA/voz.log"
  origen=$(sed -n 's/^Narración: .* → //p' "$SALIDA/voz.log" | tail -1)
  [ -n "$origen" ] || { echo "voz.py no terminó bien" >&2; exit 1; }
  carpeta=$origen
  if [ -n "$timbre" ]; then  # entonación de Qwen + timbre de otra voz (ChatterboxVC)
    "$GPU" timbre.py "$origen" "$timbre" 2> >(grep --line-buffered -v -E "$RUIDO" >&2) | tee "$SALIDA/timbre.log"
    carpeta=$(sed -n 's/^Narración: .* → //p' "$SALIDA/timbre.log" | tail -1)
    [ -n "$carpeta" ] || { echo "timbre.py no terminó bien" >&2; exit 1; }
  fi
fi
[ "$solo_voz" = 1 ] && { echo "Voz lista: $carpeta"; exit 0; }

con_musica=()
if [ -n "$musica" ] && [ -f "$musica" ]; then con_musica=(--musica "$musica"); else echo "Sin música de fondo"; fi
uv run --no-project --with playwright==1.65.0 python grabar.py "$carpeta" --parte "$parte" --destino "$SALIDA" \
  "${con_musica[@]}" "${remezclar[@]}"
