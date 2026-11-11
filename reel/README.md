# reel/ — reels verticales del itinerario (1/3 Lima y Callao, 2/3 norte, 3/3 Cusco y Pucallpa)

Cadena copiada y generalizada de la de Fernando (`~/Documentos/reel-solvencia-paraguay`):
`partes/<n>/guion.json` → `voz.py` (Qwen3-TTS con su entonación) + `timbre.py` (ChatterboxVC) →
`reel.html` (canvas 2D) → `grabar.py` (Chromium sin ventana, cuadro a cuadro) → ffmpeg → MP4.

## Generar una parte

```bash
reel/hacer_reel.sh 1-lima                          # voz + vídeo
reel/hacer_reel.sh 1-lima --solo-voz               # solo la voz, para escucharla
reel/hacer_reel.sh 1-lima --rehacer "Gran Teatro"  # otra toma solo de la frase que contiene ese texto
reel/hacer_reel.sh 1-lima --solo-video             # reusar la voz ya hecha
```

Salida (FUERA de git) en `<meta>/.runtime/reels/<parte>/`: `reel.mp4` (H.264 + AAC, 1080×1920,
30 fps), `portada.png` (= los primeros 0,6 s del vídeo, para subirla como miniatura en LinkedIn
desde escritorio), `capturas/` (portada, gancho, vuelo, aterrizaje, Lima, norte, créditos) y `voz/`.

Las partes 2 y 3 se hacen escribiendo `partes/2-norte/guion.json` y `partes/3-cusco/guion.json`
con las mismas escenas (`gancho`, `vuelo`, `lima`, `norte`, `cierre`) o añadiendo una a `reel.html`.

## Requisitos de la máquina

- **Voz**: los entornos pesados viven en la cadena original y se usan **por ruta**, nunca se copian
  (`$REEL_ORIGEN`, por defecto `~/Documentos/reel-solvencia-paraguay`): `.runtime/qwen` (Qwen3-TTS),
  y para ChatterboxVC el Python de `$PY_GPU`. Voces de referencia: `voces/voz_1_ref.wav` + `.txt`
  (entonación) y `voces/piper_claude_ref.wav` (timbre). Las grabaciones no entran en este repo.
- **Vídeo**: `uv`, ffmpeg y Chromium de Playwright 1.65.0.

## Reglas de veracidad (las comprueba `reel/tests/guion.test.mjs`)

- Cada hora, día y lugar del subtítulo se declara en `datos` del guion con la parada o el tramo de
  `site/data/agenda.json` del que sale; el test falla si no coincide o si se dice una hora sin
  declarar. Las tarjetas y el mapa leen la agenda directamente.
- Nada de calles, papamóvil ni ubicación en vivo. Los traslados dentro de una ciudad son **líneas
  rectas punteadas** entre los lugares públicos de dos actos, rotuladas «traslado · trayecto
  aproximado, no es la ruta real». Los vuelos llevan «Simulación del trayecto previsto · no es
  seguimiento en vivo». Fecha de consulta de la agenda y «sujeto a cambios» siempre visibles.
- A escala de ciudad no se dibuja costa (el contorno de Natural Earth simplificado no da para eso):
  es un esquema de posiciones relativas.

Test: `node --test reel/tests/guion.test.mjs`.

## Colores

Fuente oficial del escudo: Sala de Prensa de la Santa Sede, «El escudo del Papa León XIV:
explicación» (14-05-2025),
<https://press.vatican.va/content/salastampa/es/bollettino/pubblico/2025/05/14/140525c.html> —
«Tajado: en el primer campo, de color **azul**, con un lirio de **plata**; en el segundo, de color
**blanco**, con un corazón ardiente atravesado por una flecha […] todo de color **rojo** […] mitra de
plata, adornada con tres bandas de **oro**». La Santa Sede no publica códigos de color, así que los
tonos son una interpretación sobria de esos esmaltes y de la bandera vaticana (oro y blanco):

| Uso                                      | Color     |
| ---------------------------------------- | --------- |
| fondo (azul del escudo, oscuro)          | `#0A1633` |
| acento azul del escudo                   | `#2E5AAC` |
| oro (bandera vaticana, mitra)            | `#F2C230` |
| blanco / plata                           | `#FFFFFF` |
| rojo del Perú, con mesura (punto activo) | `#D91023` |

Subtítulos en blanco y oro sobre caja negra al 78 % con contorno: contraste AA sobre cualquier fondo,
en la franja central (y ≈ 1300 px), lejos de los botones de Instagram/TikTok.

## Créditos y licencia

Fotos de Wikimedia Commons (autor y licencia en `site/data/agenda.json`, recortadas); como varias son
CC BY-SA 4.0, **el vídeo se publica bajo CC BY-SA 4.0**. Mapa: Natural Earth (dominio público).
Agenda: programa oficial de la Santa Sede. Música: coro original generado para este vídeo (sin letra ni
melodías existentes; `../.runtime/reels/musica/coro.wav`, fuera de git), mezclado bajo la voz con
ducking: ~20 dB por debajo mientras se habla, suave en portada, pausas y créditos; mezcla a -14 LUFS,
pico ≤ -1,5 dBTP. Sin música de bibliotecas de redes sociales.
