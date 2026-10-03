const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const server = require("node:child_process").spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3006",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
(async () => {
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (d) => {
      if (d.toString().includes("Ready")) resolve();
    });
    server.once("error", reject);
    server.once("exit", (code) => reject(Error("Server exited " + code)));
  });
  const browser = await chromium.launch({
    executablePath: process.env.BRIEF_CHROMIUM_EXECUTABLE || undefined,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:3006");
  await page.getByRole("button", { name: "Öppna demonstration" }).click();
  await page
    .getByRole("button", { name: "Byta innerdörr", exact: true })
    .click();
  await page.getByRole("button", { name: "Redigera", exact: true }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Egenkontroll", { exact: true }).check();
  await form
    .getByLabel("Egenkontrollpunkter – en per rad")
    .fill("Kontrollera underlag\nDokumentera arbetet");
  await form.getByRole("button", { name: "Spara", exact: true }).click();
  await page.getByRole("tab", { name: "Kontroller", exact: true }).waitFor();
  assert(
    await page
      .getByRole("button", { name: "Avsluta order", exact: true })
      .isDisabled(),
  );
  await page.getByRole("tab", { name: "Kontroller", exact: true }).click();
  await page.screenshot({
    path: require("node:path").resolve(
      process.env.BRIEF_TEST_OUTPUT || "docs/screenshots",
      "sections-desktop.png",
    ),
    fullPage: true,
  });
  for (const label of ["Kontrollera underlag", "Dokumentera arbetet"]) {
    const row = page.locator(".control-row").filter({ hasText: label });
    await row.getByRole("checkbox").check();
    await row.getByRole("button", { name: "Spara kontroll" }).click();
    await page.getByText("Sparat.", { exact: true }).waitFor();
  }
  await page.getByRole("tab", { name: "Översikt", exact: true }).click();
  assert(
    await page
      .getByRole("button", { name: "Avsluta order", exact: true })
      .isEnabled(),
  );
  await page.getByRole("tab", { name: "Dagbok", exact: true }).click();
  await page
    .getByLabel("Kommentar", { exact: true })
    .fill("Utfört arbete dokumenterat.");
  await page
    .getByRole("button", { name: "Lägg till kommentar", exact: true })
    .click();
  await page
    .getByText("Utfört arbete dokumenterat.", { exact: true })
    .waitFor();
  await page.getByRole("tab", { name: "Bilagor", exact: true }).click();
  await page.getByRole("heading", { name: "Bilder och handlingar" }).waitFor();
  await page.getByRole("button", { name: "Redigera", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Egenkontroll", { exact: true })
    .uncheck();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Spara", exact: true })
    .click();
  await page.getByRole("tab", { name: "Kontroller", exact: true }).click();
  await page
    .getByText("Avmarkerad – tidigare dokumentation finns kvar.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await page.locator(".control-row").count(), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "Översikt", exact: true }).click();
  await page.screenshot({
    path: require("node:path").resolve(
      process.env.BRIEF_TEST_OUTPUT || "docs/screenshots",
      "sections-mobile.png",
    ),
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page
    .getByRole("button", { name: "Avsluta order", exact: true })
    .click();
  await page.getByRole("button", { name: "Återöppna order" }).waitFor();
  assert.deepEqual(errors, []);
  await browser.close();
  server.kill();
  console.log(
    "PASS sections desktop/mobile, mandatory self checks, retained answers, diary, navigation, completion; no browser errors",
  );
})().catch((e) => {
  console.error(e);
  server.kill();
  process.exit(1);
});
