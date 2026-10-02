const { chromium } = require("playwright-core");
const fs = require("fs");
const assert = require("node:assert/strict");
const server = require("node:child_process").spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3005",
  ],
  {
    cwd: require("node:path").resolve(__dirname, ".."),
    stdio: ["ignore", "pipe", "pipe"],
  },
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
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:3005");
  await page.getByRole("heading", { name: "Välkommen tillbaka" }).waitFor();
  await page.getByLabel("Tema", { exact: true }).selectOption("dark");
  await page.screenshot({
    path: require("node:path").resolve(
      __dirname,
      "../docs/screenshots/login-desktop.png",
    ),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Öppna demonstration" }).click();
  await page
    .getByRole("heading", { name: "Arbetsorder", exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("Äldre avslutad order", { exact: true }).count(),
    0,
  );
  assert.deepEqual(await page.locator(".filters button").allTextContents(), [
    "Alla",
    "Mina ordrar",
    "Påbörjade",
    "Ej påbörjade",
    "Avslutade",
  ]);
  await page.screenshot({
    path: require("node:path").resolve(
      __dirname,
      "../docs/screenshots/home-dark.png",
    ),
    fullPage: true,
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Sök", exact: true })
    .click();
  await page.getByRole("heading", { name: "Sök arbetsorder" }).waitFor();
  assert.equal(
    await page.getByText("Äldre avslutad order", { exact: true }).count(),
    1,
  );
  await page.goBack();
  await page
    .getByRole("heading", { name: "Arbetsorder", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Öppna AO-1042" }).click();
  await page
    .getByRole("heading", { name: "AO-1042 · Byta innerdörr" })
    .waitFor();
  await page.getByLabel("Slutkommentar (valfri)").fill("Klart!");
  let warning = false;
  page.once("dialog", async (d) => {
    warning = true;
    await d.dismiss();
  });
  await page.getByRole("button", { name: "Brief – till startsidan" }).click();
  assert(warning);
  assert.match(page.url(), /order/);
  await page.getByLabel("Slutkommentar (valfri)").fill("");
  await page
    .getByRole("button", { name: "Avsluta order", exact: true })
    .click();
  await page.getByRole("button", { name: "Återöppna order" }).waitFor();
  await page.getByRole("button", { name: "Återöppna order" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Återöppna", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Avsluta order", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Ta bort", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Flytta till papperskorgen" })
    .click();
  await page
    .getByRole("heading", { name: "Papperskorg", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Återställ", exact: true }).click();
  await page.getByRole("button", { name: "Brief – till startsidan" }).click();
  await page.getByRole("button", { name: "Öppna AO-1042" }).waitFor();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Företag & projekt" })
    .click();
  await page.getByRole("heading", { name: "Företagsbank" }).waitFor();
  await page
    .getByRole("button", { name: "Anna Andersson", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("heading", { name: "Anna Andersson" })
    .waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Stäng" }).click();
  await page.screenshot({
    path: require("node:path").resolve(
      __dirname,
      "../docs/screenshots/companies-dark.png",
    ),
    fullPage: true,
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Personal", exact: true })
    .click();
  await page
    .locator(".person-row")
    .filter({ hasText: "Erik Svensson" })
    .getByRole("button", { name: "Redigera" })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Yrkesroll", { exact: true })
    .fill("Snickare och montör");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Spara", exact: true })
    .click();
  await page.getByText("Snickare och montör · Brief Bygg").waitFor();
  await page.getByLabel("Demoprofil", { exact: true }).selectOption("erik");
  await page
    .getByRole("heading", { name: "Arbetsorder", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Öppna AO-1042" }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Öppna AO-1043" }).count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Företag & projekt" })
      .count(),
    0,
  );
  await page.getByLabel("Demoprofil", { exact: true }).selectOption("samuel");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: require("node:path").resolve(
      __dirname,
      "../docs/screenshots/home-mobile.png",
    ),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.equal(
    await page
      .locator(".tips p")
      .evaluate((e) => e.scrollWidth > e.clientWidth),
    false,
  );
  await page.getByLabel("Tema", { exact: true }).selectOption("light");
  await page.screenshot({
    path: require("node:path").resolve(
      __dirname,
      "../docs/screenshots/home-mobile-light.png",
    ),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.screenshot({
    path: require("node:path").resolve(
      __dirname,
      "../docs/screenshots/home-light.png",
    ),
    fullPage: true,
  });
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Företag & projekt" })
    .click();
  await page.getByRole("button", { name: "+ Lägg till företag" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Företag eller organisation", { exact: true })
    .fill("Nytt bolag");
  await page
    .getByRole("dialog")
    .getByLabel("Namn", { exact: true })
    .fill("Kontakt");
  await page
    .getByRole("dialog")
    .getByLabel("Telefon", { exact: true })
    .fill("0700000000");
  await page
    .getByRole("dialog")
    .getByLabel("E-post", { exact: true })
    .fill("kontakt@example.se");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Spara", exact: true })
    .click();
  await page.getByRole("button", { name: "Nytt bolag Beställare" }).waitFor();
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log(
    "PASS: desktop/mobile, theme, one-line tips, filters, old-order search, back navigation, unsaved guard, completion/reopening, trash/restore, contact profile, personnel editing and role visibility",
  );
  await browser.close();
  server.kill();
})().catch((e) => {
  console.error(e);
  server.kill();
  process.exit(1);
});
