const { chromium } = require("playwright-core");
const assert = require("node:assert/strict");
const fs = require("fs");
const ts = require("typescript");
require.extensions[".ts"] = (m, p) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(p, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    p,
  );
const { demo } = require("../lib/demo.ts");
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
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let authorized = false;
  const s = demo();
  const uid = "00000000-0000-0000-0000-000000000001";
  const session = {
    access_token: "fixture-access-token",
    refresh_token: "fixture-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    user: {
      id: uid,
      email: "samuel@example.se",
      user_metadata: { full_name: "Samuel" },
      app_metadata: {},
    },
  };
  await page.route("https://brief-tests.supabase.co/**", async (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p.endsWith("/token"))
      return r.fulfill({
        status: authorized ? 200 : 400,
        contentType: "application/json",
        body: JSON.stringify(
          authorized
            ? session
            : {
                msg: "Invalid login credentials",
                error_code: "invalid_credentials",
              },
        ),
      });
    if (p.endsWith("/brief_beta_bootstrap"))
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ id: "demo", name: "Testarbetsyta" }]),
      });
    if (p.endsWith("/brief_beta_load"))
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(s),
      });
    if (p.endsWith("/signup")) {
      const body = r.request().postDataJSON();
      assert.equal(body.data.job_title, "Snickare");
      assert.equal(body.data.company_name, "Elvbygg");
      assert.equal(body.data.phone, "0701234567");
      assert.equal(body.data.role, undefined);
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: uid,
          email: body.email,
          user_metadata: body.data,
          identities: [],
        }),
      });
    }
    if (p.endsWith("/user"))
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(session.user),
      });
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
  await page.goto("http://127.0.0.1:3006");
  await page.getByRole("heading", { name: "Välkommen tillbaka" }).waitFor();
  assert.equal(await page.locator(".global-error").count(), 0);
  await page.getByLabel("E-post", { exact: true }).fill("samuel@example.se");
  await page.getByLabel("Lösenord", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await page
    .getByText("Fel e-postadress eller lösenord.", { exact: true })
    .waitFor();
  assert.equal(await page.locator(".success-tick").count(), 0);
  await page
    .getByRole("button", { name: "Nytt konto? Registrera dig" })
    .click();
  await page.getByLabel("Namn", { exact: true }).fill("Samuel");
  await page.getByLabel("Yrkesroll", { exact: true }).fill("Snickare");
  await page.getByLabel("Företag", { exact: true }).fill("Elvbygg");
  await page.getByLabel("Telefon", { exact: true }).fill("0701234567");
  await page
    .getByRole("button", { name: "Registrera dig", exact: true })
    .click();
  await page.getByText("Kontrollera din e-post och bekräfta kontot.").waitFor();
  assert.equal(await page.locator(".success-tick").count(), 0);
  await page
    .getByRole("button", { name: "Har du ett konto? Logga in" })
    .click();
  authorized = true;
  await page.getByRole("button", { name: "Logga in", exact: true }).click();
  await page.locator(".success-tick").waitFor();
  await page.waitForTimeout(250);
  await page.screenshot({
    path: require("node:path").resolve(
      __dirname,
      "../docs/screenshots/login-success-mobile.png",
    ),
    fullPage: true,
  });
  assert.equal(await page.locator(".login-page").count(), 1);
  assert.equal(await page.locator(".loading").count(), 0);
  await page
    .getByRole("heading", { name: "Arbetsorder", exact: true })
    .waitFor();
  assert.equal(
    (await page.request.get("http://127.0.0.1:3006/api/cleanup")).status(),
    401,
  );
  await page.evaluate(() => localStorage.clear());
  await page.goto("about:blank");
  await page.goto(
    "http://127.0.0.1:3006/#access_token=fixture-access-token&refresh_token=fixture-refresh-token&token_type=bearer&expires_in=3600&type=recovery",
  );
  await page.getByRole("heading", { name: "Välj nytt lösenord" }).waitFor();
  const stalled = await browser.newContext({
    viewport: { width: 390, height: 844 },
    storageState: await page.context().storageState(),
  });
  const stalledPage = await stalled.newPage();
  const stalledErrors = [];
  stalledPage.on("pageerror", (error) => stalledErrors.push(error.message));
  await stalledPage.route("https://brief-tests.supabase.co/**", () => {});
  await stalledPage.goto("http://127.0.0.1:3006");
  await stalledPage.getByText("Hämtar din arbetsyta…").waitFor();
  await stalledPage.getByRole("alert").waitFor({ timeout: 22000 });
  await stalledPage
    .getByRole("button", { name: "Försök igen", exact: true })
    .waitFor();
  await stalledPage
    .getByRole("heading", { name: "Välkommen tillbaka" })
    .waitFor();
  assert.equal(await stalledPage.locator(".session-check").count(), 0);
  assert.deepEqual(stalledErrors, []);
  await stalled.close();
  console.log(
    "PASS: password recovery callback, failed login never animates, registration fields and confirmation, successful login animation remains on login page then opens workspace, cleanup requires authentication",
  );
  await browser.close();
  server.kill();
})().catch((e) => {
  console.error(e);
  server.kill();
  process.exit(1);
});
