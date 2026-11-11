# AGENTS.md — papa-peru

Repo de código de «Ruta del papa León XIV en Perú». Se orquesta desde su meta-repo (la carpeta
padre; ver `repos.yaml` allí). Aquí solo vive el código de la aplicación: una página estática
(DP-001) publicada en https://fertueros.github.io/papa-peru/ por `.github/workflows/pages.yml`.

## Comandos (literales, probados; los usa el método en cada cierre)

Todos se ejecutan desde la raíz del repo.

| Para…                                           | Comando                                                                                        |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Levantar el entorno desde cero                  | `npm ci && npx playwright install chromium`                                                    |
| Correr la suite completa                        | `scripts/ci/full-suite`                                                                        |
| Correr los linters                              | `scripts/ci/lint`                                                                              |
| Lanzar una instancia para que la use el usuario | `node scripts/build.mjs && node e2e/servidor.mjs dist 8080` → http://127.0.0.1:8080/papa-peru/ |
| Comprobación de seguridad                       | `scripts/ci/security`                                                                          |
| Parar / limpiar                                 | `Ctrl+C` en el servidor; `rm -rf dist playwright-report test-results`                          |
| Regenerar el clima (red; fallo blando)          | `node scripts/clima.mjs`                                                                       |
| Regenerar la tarjeta OG (una vez, se commitea)  | `node scripts/og.mjs`                                                                          |

### Pruebas E2E (los planos declaran E2E-4)

| Para…                            | Comando                    |
| -------------------------------- | -------------------------- |
| Preparar identidades y datos E2E | `scripts/ci/provision-e2e` |
| Correr solo los end-to-end       | `scripts/ci/e2e`           |

- No hay usuarios ni credenciales: la web es pública. El alias sintético es
  `rosa-visitante · rol visitante · sin organización`, y sus datos son los JSON de `e2e/fixtures/`
  (copia de la agenda real + `vivo.json` y `clima.json` sintéticos). El reloj se fija con `page.clock`.
- `scripts/ci/provision-e2e` es explícito e idempotente; solo admite `E2E_ENV` local/test/e2e y
  `E2E_INSTANCE` local/test/e2e, rechaza producción antes de hacer nada, instala el Chromium fijado
  y valida los fixtures. Ningún seed se ejecuta al construir o desplegar ni imprime credenciales.
- La secuencia es única: `scripts/ci/full-suite` invoca `scripts/ci/e2e`; `e2e` invoca
  `scripts/ci/provision-e2e` antes de ejecutar los tests y propaga cualquier rojo.

## Qué necesita esta máquina

- Node 22 (probado con v22.23.2) y npm 10.
- Chromium de Playwright 1.65.0 (`npx playwright install chromium`; en Linux sin librerías,
  `npx playwright install-deps chromium`).
- Para medir: `npx lighthouse` con `CHROME_PATH` apuntando al Chromium de `~/.cache/ms-playwright`.

## Estructura

- `site/` es la web tal cual: `index.html`, `estilos.css`, `js/momento.js` (regla pura «dónde está»,
  G-6/G-8), `js/hora.js` (hora de Perú, G-7), `js/portada.js` (render y refresco), `data/*.json`
  (agenda oficial, clima de Open-Meteo, `vivo.json` que escribirá el vigilante), `fotos/`, `img/peru.svg`, `og.png`.
- `scripts/build.mjs` construye `dist/` (esbuild + CSS incrustado) y falla si se pasa el presupuesto de
  peso; `scripts/clima.mjs` y `scripts/og.mjs` generan datos e imagen.
- `tests/` son tests de `node --test`; `e2e/` son los Playwright, sus fixtures y el servidor estático.

## Reglas de este repo

- No hay secretos: no hay `.env` ni imagen Docker. Si un día los hay, van en `.env` (fuera de git) y
  en `.dockerignore`.
- Solo dependencias de desarrollo (`devDependencies`); la web publicada no lleva dependencias.
- Los tests se escriben antes que el código y no se debilitan para que pase la suite.
- Nunca se publica una ubicación real del papa en tierra: solo el lugar público del acto de la agenda.
- Las horas y paradas salen solo de la agenda oficial (`site/data/agenda.json`); no se inventan.
- Los scripts obligatorios de `scripts/ci/` preparan su entorno, usan herramientas fijadas y propagan
  cualquier rojo. Prohibido `|| true` o dar verde por no encontrar tests.
- `.github/workflows/tests.yml` ejecuta la suite en pull requests;
  `quality-security.yml` ejecuta lint y seguridad en paralelo en pull requests, al entrar en
  `main` y semanalmente. `.github/dependabot.yml` propone las actualizaciones normales.
