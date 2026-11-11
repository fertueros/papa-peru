// E2E-4 (C-19, C-23, C-24) + C-20, C-21, C-25, R8: lo que ve Rosa en el móvil.
// Reloj fijado con page.clock y datos servidos desde e2e/fixtures/ (agenda real copiada).
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const fixture = (f) => readFileSync(new URL(`fixtures/${f}`, import.meta.url), "utf8");
const json = (body) => ({ status: 200, contentType: "application/json", body });

async function abrir(page, { hora, vivo = fixture("vivo-vacio.json"), clima = fixture("clima.json") }) {
  await page.route("**/data/agenda.json", (r) => r.fulfill(json(fixture("agenda.json"))));
  await page.route("**/data/vivo.json", (r) => r.fulfill(json(vivo)));
  await page.route("**/data/clima.json", (r) =>
    clima === null ? r.fulfill({ status: 404, body: "no" }) : r.fulfill(json(clima)),
  );
  await page.clock.install({ time: new Date(hora) });
  await page.goto("./");
}

const avion = (h) =>
  JSON.stringify({
    actualizado: "2026-11-15T13:38:00-05:00",
    avion: {
      tramo: "cusco-pucallpa",
      lat: -11.1,
      lon: -73.0,
      alt_m: 10000,
      hora: `2026-11-15T${h}:00-05:00`,
      fuente: "ADS-B",
    },
    detecciones: [],
    agenda_cambios: [],
  });

test("C-19: misa de Pimentel detectada → parada, fuente, foto con autor, mapa y próxima", async ({ page }) => {
  const fotos = [];
  page.on("request", (r) => {
    if (r.url().includes("/fotos/")) fotos.push(r.url());
  });
  await abrir(page, { hora: "2026-11-13T10:50:00-05:00", vivo: fixture("vivo-pimentel.json") });

  const ahora = page.locator("#ahora");
  await expect(ahora.locator(".estado")).toHaveText("Ahora: Santa Misa en las Pampas de Pimentel");
  await expect(ahora).toContainText("según Vatican News, 10:42");
  await expect(page.locator("#reloj")).toHaveText("10:50");

  await expect(page.locator("#foto-img")).toBeVisible();
  await expect(page.locator("#foto-pie")).toContainText("Frank Coronel Mendoza");
  await expect(page.locator("#foto-pie")).toContainText("CC BY-SA 4.0");
  await expect(page.locator("#foto-pie a").first()).toHaveAttribute("href", /commons\.wikimedia\.org/);

  await expect(page.locator("#mapa")).toBeVisible();
  await expect(page.locator("#mapa-marcas .marca-actual")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Ver el lugar en el mapa" })).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/?mlat=-6.815&mlon=-79.885#map=16/-6.815/-79.885",
  );

  await expect(page.locator("#clima-ahora")).toHaveText("Chiclayo y Pimentel: 27 °C, despejado, 5 % de lluvia");
  await expect(page.locator("#clima-pie")).toHaveText("pronóstico de Open-Meteo, 10:40");

  await expect(page.locator("#proxima")).toContainText(
    "Próxima: 12:40 Visita privada a la Capilla San Óscar A. Romero, en 1 h 50 min",
  );
  // Q-9: solo se descarga la foto de la parada visible.
  expect(fotos.every((u) => u.includes("/fotos/pimentel-"))).toBe(true);
  expect(fotos.length).toBe(1);
});

test("R3: la cuenta atrás de la próxima se actualiza sin recargar", async ({ page }) => {
  await abrir(page, { hora: "2026-11-13T10:50:00-05:00" });
  await expect(page.locator("#proxima")).toContainText("en 1 h 50 min");
  await page.clock.runFor(61000);
  await expect(page.locator("#proxima")).toContainText("en 1 h 49 min");
  await expect(page.locator("#reloj")).toHaveText("10:51");
});

test("C-23: en vuelo con posición vieja → avión estimado; con posición de hace 4 min → real", async ({ page }) => {
  await abrir(page, { hora: "2026-11-15T13:40:00-05:00", vivo: avion("13:20") });
  await expect(page.locator(".estado")).toHaveText("Volando de Cusco a Pucallpa, llega a las 14:30");
  await expect(page.locator("#ahora")).toContainText("estimado");
  await expect(page.locator("#mapa-marcas .avion-estimado")).toHaveCount(1);
  await expect(page.locator("#mapa-marcas .avion-real")).toHaveCount(0);
  await expect(page.locator("#foto")).toBeHidden();

  await page.unrouteAll();
  await abrir(page, { hora: "2026-11-15T13:40:00-05:00", vivo: avion("13:36") });
  await expect(page.locator("#ahora")).toContainText("posición de hace 4 min");
  await expect(page.locator("#mapa-marcas .avion-real")).toHaveCount(1);
});

test("C-24: el sábado 14 muestra la misa de las 11:00 con el clima de Santa Cruz de Succhabamba", async ({ page }) => {
  await abrir(page, { hora: "2026-11-13T10:50:00-05:00" });
  await page.getByRole("tab", { name: "sábado 14" }).click();
  await expect(page.getByRole("tab", { name: "sábado 14" })).toHaveAttribute("aria-selected", "true");
  const misa = page.locator("#dia li", { hasText: "Santa Misa en Santa Cruz de Succhabamba" });
  await expect(misa).toContainText("11:00");
  await expect(misa).toContainText("18 °C / 9 °C · 60 % de lluvia");
});

test("C-25: sin clima.json desaparece solo el bloque del clima", async ({ page }) => {
  await abrir(page, { hora: "2026-11-13T11:00:00-05:00", clima: null });
  await expect(page.locator(".estado")).toHaveText("Ahora: Santa Misa en las Pampas de Pimentel");
  await expect(page.locator("#proxima")).toContainText("Próxima: 12:40");
  await expect(page.locator("#clima")).toBeHidden();
  await expect(page.locator("#foto")).toBeVisible();
  await expect(page.locator("#mapa")).toBeVisible();
});

test("C-20: el miércoles 11 a las 10:00 → cuenta atrás a la llegada al Callao", async ({ page }) => {
  await abrir(page, { hora: "2026-11-11T10:00:00-05:00" });
  await expect(page.locator(".estado")).toHaveText("El papa llega al Callao en 7 h 30 min");
  await expect(page.locator("#ahora")).toContainText("según la agenda");
  await expect(page.getByRole("tab", { name: "miércoles 11" })).toHaveAttribute("aria-selected", "true");
});

test("R7: clima de hace más de 30 min se rotula «datos antiguos»", async ({ page }) => {
  await abrir(page, { hora: "2026-11-13T11:30:00-05:00" });
  await expect(page.locator("#clima-pie")).toContainText("datos antiguos");
});

test("R8: tarjeta OG fija, imagen absoluta y sin datos de «ahora»", async ({ page, request }) => {
  await abrir(page, { hora: "2026-11-13T10:50:00-05:00" });
  const meta = (p) => page.locator(`meta[property="${p}"], meta[name="${p}"]`).getAttribute("content");
  expect(await meta("og:title")).toBe("Dónde está el papa León XIV en Perú");
  expect(await meta("og:description")).toMatch(/^Sigue la visita del papa León XIV en Perú/);
  expect(await meta("og:image")).toBe("https://fertueros.github.io/papa-peru/og.png");
  expect(await meta("twitter:card")).toBe("summary_large_image");
  const og = await request.get("og.png");
  expect(og.ok()).toBe(true);
  expect(og.headers()["content-type"]).toBe("image/png");
});

test.describe("C-21: móvil con hora de Madrid", () => {
  test.use({ timezoneId: "Europe/Madrid" });
  test("18:05 de Madrid del viernes 13 → todo en hora de Perú (12:05)", async ({ page }) => {
    await abrir(page, { hora: "2026-11-13T18:05:00+01:00" });
    expect(await page.evaluate(() => new Date().getHours())).toBe(18);
    await expect(page.locator("#reloj")).toHaveText("12:05");
    await expect(page.locator(".estado")).toHaveText("Ahora: Santa Misa en las Pampas de Pimentel");
    await expect(page.locator("#proxima")).toContainText("Próxima: 12:40");
  });
});
