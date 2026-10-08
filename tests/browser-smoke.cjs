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
  await page.getByText("Logga in till din arbetsyta.", { exact: true }).waitFor();
  await page.getByRole("button", {name:"Byt till mörkt tema",exact:true}).click();
  await page.screenshot({
    path: require("node:path").resolve(
      __dirname,
      "../docs/screenshots/login-desktop.png",
    ),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Öppna demonstration" }).click();
  await page
    .getByRole("heading", { name: "Översikt", exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("Äldre avslutad order", { exact: true }).count(),
    1,
  );
  assert.deepEqual(await page.locator(".order-scope button").allTextContents(), ["Mina arbetsorder", "Företagets arbetsorder"]);
  await page.screenshot({
    path: require("node:path").resolve(
      __dirname,
      "../docs/screenshots/home-dark.png",
    ),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Öppna kontomeny" }).click();
  await page.getByRole("button", { name: "Sök", exact: true }).click();
  await page.getByRole("heading", { name: "Sök arbetsorder" }).waitFor();
  assert.equal(
    await page.getByText("Äldre avslutad order", { exact: true }).count(),
    1,
  );
  await page.goBack();
  await page
    .getByRole("heading", { name: "Översikt", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Byta innerdörr", exact: true }).click();
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
  await page.getByRole("button", { name: "Byta innerdörr", exact: true }).waitFor();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Företag", exact: true })
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
  await page.getByRole("button", { name: "Öppna kontomeny" }).click();
  await page.getByRole("button", { name: "Mina kollegor", exact: false }).click();
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
    .getByRole("heading", { name: "Översikt", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Byta innerdörr", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Laga kökslucka", exact: true }).count(),
    1,
  );
  assert.equal(
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "Företag", exact: true })
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
  await page.getByRole("button", {name:"Byt till ljust tema",exact:true}).click();
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
    .getByRole("button", { name: "Företag", exact: true })
    .click();
  await page.getByRole("button", { name: "+ Lägg till företag" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Företag eller organisation", { exact: true })
    .fill("Nytt bolag");
  await page
    .getByRole("dialog")
    .getByLabel("För- och efternamn", { exact: true })
    .fill("Kontakt Person");
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
  const privateContext = await browser.newContext({
    viewport: { width: 320, height: 740 },
  });
  await privateContext.addInitScript(() => {
    for (const name of ["localStorage", "sessionStorage"])
      Object.defineProperty(window, name, {
        get() {
          throw new DOMException("Storage denied", "SecurityError");
        },
      });
  });
  const privatePage = await privateContext.newPage();
  const privateErrors = [];
  privatePage.on("pageerror", (error) => privateErrors.push(error.message));
  await privatePage.goto("http://127.0.0.1:3005");
  await privatePage
    .getByText("Logga in till din arbetsyta.", { exact: true })
    .waitFor();
  await privatePage.getByRole("button", {name:"Byt till mörkt tema",exact:true}).click();
  await privatePage
    .getByRole("button", { name: "Öppna demonstration" })
    .click();
  await privatePage
    .getByRole("heading", { name: "Översikt", exact: true })
    .waitFor();
  assert.equal(
    await privatePage.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "320px mobile viewport must not overflow",
  );
  assert.deepEqual(privateErrors, []);
  await privateContext.close();
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
