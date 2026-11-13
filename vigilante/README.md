# Vigilante

Node 22, sin dependencias. Lee el programa vaticano cada vuelta, consulta un único avión confirmado durante su ventana y reúne el clima en una petición como máximo cada hora. Las posiciones en tierra, futuras, de más de dos minutos o anteriores a la salida no se publican.

```sh
node --test vigilante/tests/
node vigilante/vuelta.mjs --estado estado --site site
```

El primer arranque requiere `site/data/agenda.json`; después prevalece la agenda de la rama `vigilante-estado`. Los datos públicos son `agenda.json`, `clima.json` y `vivo.json`. `fallos.json` y `resultado.json` son de operación y no se copian al artefacto Pages. Todas las salidas llevan la hora de generación; conservar la hora de observación permite reconocer datos antiguos.

`VIGILANTE_PAUSA=1` evita nuevas lecturas y cambios, conserva agenda y clima y publica `avion: null`. Para reanudar, retirar la variable. El comando guarda el resultado y sale con éxito incluso si hace falta una alerta: el último paso del workflow señala el fallo **después** de publicar y persistir el último bueno.

`vuelos.json` contiene solo identificadores confirmados por tramo. Actualmente todos son `null`: no se identifica ningún avión por compañía, cercanía, ruta ni un indicativo deducido. No se siguen los helicópteros. Con identidad confirmada se usa `/hex/` o `/callsign/` de adsb.fi, una sola petición por vuelta serializada (sin reintentos), con el User-Agent genérico y timeout de 15 s comunes a las fuentes. El JSON cita `https://adsb.fi/`; la portada debe mostrar esa atribución cuando muestre la posición.

`catalogo.json` es el vocabulario revisado de descripciones del HTML real ligado a los IDs y metadatos canónicos del padre. El parser compara descripciones normalizadas y fecha, nunca el índice de la fila ni su hora. Convierte Buenos Aires UTC−3 y Roma UTC+1 a Perú UTC−5. Conserva los actos retirados y sus fotos. Un acto nuevo solo se admite si tiene un tipo reconocido y nombra explícitamente un lugar peruano ya conocido. Otros cambios requieren revisión y mantienen el último bueno. HTML incompleto, orden roto o extremos de vuelo ausentes no reemplazan la agenda.

El clima propio usa el esquema de la portada y una petición multiciudad a Open-Meteo. Si existe `scripts/clima.mjs` con la función exportada `leerClima(agenda, now, fetcher)`, se reutiliza esa función. Un helper que solo es ejecutable no se importa para evitar consultas al cargarlo: el padre debe adaptar esa exportación o mantener el lector de esta unidad. Los builds programados no deben ejecutar un segundo lector de clima.

El workflow tiene grupo `vigilante` y el job comparte `pages` con el workflow de portada. Ambos deben usar `cancel-in-progress: false`. GitHub limita la cola de concurrencia; el cron es un intento cada cinco minutos, sin puntualidad garantizada. Sin agenda inicial el workflow informa que espera a la unidad 001; sin `site/index.html` conserva el estado y no despliega una web incompleta.

Los permisos `contents: write`, `pages: write` e `id-token: write` viven solo en el job. GitHub no permite restringir `contents: write` a una rama en YAML: el único push del workflow apunta explícitamente a `refs/heads/vigilante-estado`. El estado inicial es huérfano y contiene solo JSON. Ningún dato se commitea a `main`.
