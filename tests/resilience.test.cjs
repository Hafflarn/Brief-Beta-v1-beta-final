const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
test("Production builds reject missing configuration and server secrets", () => {
  function check(key, url = "https://project.supabase.co") {
    return spawnSync(process.execPath, ["scripts/check-env.cjs"], {
      env: { ...process.env, VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key },
      encoding: "utf8",
    }).status;
  }
  assert.notEqual(check("", ""), 0);
  assert.notEqual(check("sb_secret_fixture"), 0);
  assert.notEqual(check("sb_publishable_fixture", "http://project.supabase.co"), 0);
  assert.equal(check("sb_publishable_fixture"), 0);
});
function moduleAt(path, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText,
    { exports, setTimeout, clearTimeout, ...globals },
  );
  return exports;
}
test("Denied preference storage does not crash reading or saving UI state", () => {
  const window = {};
  for (const name of ["localStorage", "sessionStorage"])
    Object.defineProperty(window, name, {
      get() {
        throw Error("Storage denied");
      },
    });
  const storage = moduleAt("lib/browser-storage.ts", { window });
  for (const session of [false, true]) {
    assert.equal(storage.readPreference("test", session), null);
    assert.doesNotThrow(() =>
      storage.writePreference("test", "value", session),
    );
  }
});
test("A stalled session rejects and a successful session preserves its result", async () => {
  const { withTimeout } = moduleAt("lib/network.ts");
  await assert.rejects(withTimeout(new Promise(() => {}), 10), /för lång tid/);
  assert.equal(await withTimeout(Promise.resolve("session"), 10), "session");
});
test("Fetch preserves caller cancellation", async () => {
  const controller = new AbortController();
  let signal;
  const { timedFetch } = moduleAt("lib/network.ts", {
    AbortController,
    Request,
    fetch: async (_, init) => {
      signal = init.signal;
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(Error("Cancelled")), {
          once: true,
        });
      });
    },
  });
  const request = timedFetch("https://example.test", {
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(request, /Cancelled/);
  assert.equal(signal.aborted, true);
});
