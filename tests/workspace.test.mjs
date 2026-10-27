import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { JSDOM } from "jsdom";
import { encodeBundle, newBundle } from "../src/model.js";
import viteConfig from "../vite.config.js";
const STORAGE = "stamped-rubric-workspace-v1";
const sample = JSON.parse(
  await readFile(
    new URL("../public/data/paper-remodnav.json", import.meta.url),
    "utf8",
  ),
);
const rubric = JSON.parse(
  await readFile(new URL("../public/data/rubric.json", import.meta.url), "utf8"),
);
let appBase = null;
let requestedURLs = [];
registerHooks({
  load(url, context, next) {
    if (url.endsWith(".css"))
      return { format: "module", source: "export {};", shortCircuit: true };
    const result = next(url, context);
    if (appBase && url.includes("/src/app.js?")) {
      return {
        ...result,
        source: result.source.toString().replaceAll(
          "import.meta.env", JSON.stringify({ BASE_URL: appBase }),
        ),
      };
    }
    return result;
  },
});
let dom;
async function until(fn) {
  for (let n = 0; n < 100; n++) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("UI did not reach the expected state");
}
async function setup({ saved = null, hash = "", fresh = false, base = null } = {}) {
  appBase = base;
  requestedURLs = [];
  if (fresh) saved = JSON.stringify(newBundle(rubric, sample.rubric_sha256));
  dom?.window.close();
  dom = new JSDOM('<div id="app"></div>', {
    url: "http://localhost:5173" + (base ?? "/") + hash,
    pretendToBeVisual: true,
  });
  for (const key of [
    "window",
    "document",
    "localStorage",
    "location",
    "history",
  ])
    Object.defineProperty(globalThis, key, {
      value: dom.window[key],
      configurable: true,
    });
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: async () => {} } },
    configurable: true,
  });
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new dom.window.Event("close"));
  };
  globalThis.fetch = async (url) => {
    requestedURLs.push(url);
    const localPath = base ? "/" + url.slice(base.length) : url;
    return new Response(await readFile(new URL("../public" + localPath, import.meta.url)), {
      status: 200,
    });
  };
  if (saved) localStorage.setItem(STORAGE, saved);
  await import("../src/app.js?test=" + crypto.randomUUID());
  await until(
    () =>
      document.querySelector("#profile") ||
      document.querySelector(".startup-error"),
  );
  assert(!document.querySelector(".startup-error"), document.body.textContent);
}
const click = (selector) => document.querySelector(selector).click();
function change(selector, value) {
  const el = document.querySelector(selector);
  el.value = value;
  el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}
function input(selector, value) {
  const el = document.querySelector(selector);
  el.value = value;
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}
function acceptDialog(value) {
  const d = document.querySelector("dialog");
  assert(d);
  if (value) d.querySelector("input").value = value;
  d.returnValue = "ok";
  d.close();
}
test("workspace restores partial drafts including blank evidence locators", async () => {
  await setup({ fresh: true });
  input('[data-object="title"]', "Draft under review");
  click('[data-action="add-evidence"][data-criterion="S-01"]');
  input(
    '[data-evidence="0"][data-key="description"]',
    "Unfinished evidence note",
  );
  const saved = localStorage.getItem(STORAGE);
  await setup({ saved });
  assert.equal(document.querySelector("h1").textContent, "Draft under review");
  assert.equal(
    document.querySelector('[data-evidence="0"][data-key="description"]').value,
    "Unfinished evidence note",
  );
});
test("shared URL is consumed and later edits survive reloading", async () => {
  const hash = "#assessment=" + (await encodeBundle(sample));
  await setup({ hash });
  assert.equal(location.hash, "");
  assert.equal(
    JSON.parse(localStorage.getItem(STORAGE)).assessments[0].updated_at,
    sample.assessments[0].updated_at,
  );
  change('[data-weight="S"]', "2");
  assert.equal(document.querySelector(".score strong").textContent, "77.6");
  const saved = localStorage.getItem(STORAGE);
  await setup({ saved });
  assert.equal(document.querySelector('[data-weight="S"]').value, "2");
  assert.equal(document.querySelector(".score strong").textContent, "77.6");
});
test("follow-up preserves original responses and stores optional review fields", async () => {
  await setup({ saved: JSON.stringify(sample) });
  click('[data-action="follow-up"]');
  acceptDialog("Test reviewer");
  await until(
    () => document.querySelector("#reviewer-select").options.length === 2,
  );
  change('[data-criterion="S-01"][data-field="score"][value="0"]', "0");
  change('[data-criterion="S-01"][data-field="confidence"]', "low");
  const b = JSON.parse(localStorage.getItem(STORAGE));
  assert.equal(b.assessments[0].responses["S-01"].score, 3);
  assert.equal(b.assessments[1].responses["S-01"].score, 0);
  assert.equal(b.assessments[1].responses["S-01"].confidence, "low");
  assert.equal(b.assessments[1].review_of, b.assessments[0].id);
  assert(document.querySelector("#criterion-S-01 .original"));
});
test("example opening preserves timestamps and bulky URL shares fall back visibly", async () => {
  await setup({ fresh: true });
  click('[data-action="example"]');
  acceptDialog();
  await until(() =>
    document.querySelector("h1").textContent.includes("REMoDNaV"),
  );
  assert.equal(
    JSON.parse(localStorage.getItem(STORAGE)).assessments[0].updated_at,
    sample.assessments[0].updated_at,
  );
  click('[data-action="share"]');
  await until(() =>
    document.querySelector("#notice").textContent.includes("sharing budget"),
  );
  assert(
    document
      .querySelector("#notice")
      .textContent.includes("nothing was omitted"),
  );
});
test("invalid saved workspace is recoverable even after a new draft edit", async () => {
  const invalid = JSON.stringify({ ...sample, rubric_version: "99.0.0" });
  await setup({ saved: invalid });
  input('[data-object="title"]', "Replacement draft");
  assert.equal(localStorage.getItem(STORAGE + "-recovery"), invalid);
  assert(document.querySelector('[data-action="recovery"]'));
});
test("all-zero weight changes are rejected without corrupting score state", async () => {
  await setup({ saved: JSON.stringify(sample) });
  for (const d of ["T", "A", "M", "P", "E", "D"])
    change(`[data-weight="${d}"]`, "0");
  change('[data-weight="S"]', "0");
  assert.equal(document.querySelector('[data-weight="S"]').value, "1");
  assert(
    document.querySelector("#notice").textContent.includes("positive weight"),
  );
  assert.equal(document.querySelector(".score strong").textContent, "91.7");
});

test("first visit opens and saves the example without changing its review timestamps", async () => {
  await setup();
  assert.equal(document.querySelector("h1").textContent, sample.research_object.title);
  assert(document.querySelector(".demo-banner"));
  const saved = JSON.parse(localStorage.getItem(STORAGE));
  assert.equal(saved.assessments[0].updated_at, sample.assessments[0].updated_at);
  assert.equal(saved.assessments[0].id, "remodnav-initial");
});
test("explicitly starting a new assessment stays blank on later visits", async () => {
  await setup();
  click('.demo-banner [data-action="new"]');
  acceptDialog();
  await until(() => document.querySelector("h1").textContent === "Untitled research object");
  assert.equal(document.querySelector(".demo-banner"), null);
  assert.equal(document.querySelector(".score strong").textContent, "0.0");
  const saved = localStorage.getItem(STORAGE);
  await setup({ saved });
  assert.equal(document.querySelector("h1").textContent, "Untitled research object");
  assert(!requestedURLs.some((url) => url.endsWith("paper-remodnav.json")));
});
test("shared assessment takes precedence over the first-visit demo", async () => {
  const shared = structuredClone(sample);
  shared.research_object.title = "Shared review overrides demo";
  await setup({ hash: "#assessment=" + await encodeBundle(shared) });
  assert.equal(document.querySelector("h1").textContent, shared.research_object.title);
  assert(!requestedURLs.some((url) => url.endsWith("paper-remodnav.json")));
});
test("production repository subpath prefixes every fetched data asset", async () => {
  assert.equal(viteConfig({command: "build"}).base, "/stamped-rubric/");
  assert.equal(viteConfig({command: "serve", isPreview: true}).base, "/stamped-rubric/");
  assert.equal(viteConfig({command: "serve", isPreview: false}).base, "/");
  await setup({ base: "/stamped-rubric/" });
  assert.deepEqual(new Set(requestedURLs), new Set([
    "/stamped-rubric/data/rubric.json",
    "/stamped-rubric/data/assessment-bundle.schema.json",
    "/stamped-rubric/data/paper-remodnav.json",
  ]));
  assert(document.querySelector(".demo-banner"));
});
