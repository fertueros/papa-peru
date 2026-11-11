import { defineConfig, devices } from "@playwright/test";

const PUERTO = 4173;

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.mjs",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${PUERTO}/papa-peru/`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "movil", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `node e2e/servidor.mjs dist ${PUERTO}`,
    url: `http://127.0.0.1:${PUERTO}/papa-peru/`,
    reuseExistingServer: false,
  },
});
