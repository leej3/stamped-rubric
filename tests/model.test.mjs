import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  newBundle,
  newAssessment,
  blankResponse,
  scoreAssessment,
  semanticErrors,
  normalizeBundle,
  encodeBundle,
  decodeBundle,
  sha256,
  mergeBundles,
  safeURL,
  MAX_SHARE_LENGTH,
} from "../src/model.js";
import { renderReport } from "../src/report.js";
const raw = await readFile(
  new URL("../public/data/rubric.json", import.meta.url),
  "utf8",
);
const rubric = JSON.parse(raw),
  digest = await sha256(raw);
const schema = JSON.parse(
  await readFile(
    new URL("../public/data/assessment-bundle.schema.json", import.meta.url),
    "utf8",
  ),
);
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const sample = JSON.parse(
  await readFile(
    new URL("../public/data/paper-remodnav.json", import.meta.url),
    "utf8",
  ),
);
const fresh = () => {
  const b = newBundle(rubric, digest);
  b.research_object.locator = "https://example.org/object";
  return b;
};
function complete(b) {
  for (const c of rubric.criteria)
    b.assessments[0].responses[c.id] = {
      ...blankResponse(),
      score: Math.max(...c.anchors.map((v) => v.value)),
      observation: "observed",
    };
  return b;
}
test("worked example validates and retains explicit unknowns", () => {
  assert.equal(validate(sample), true, JSON.stringify(validate.errors));
  assert.deepEqual(semanticErrors(sample, rubric, digest), []);
  const s = scoreAssessment(rubric, sample.assessments[0]);
  assert.equal(s.complete, false);
  assert(s.answered > 0 && s.answered < s.count);
});
test("unanswered retains fixed denominators and explicit zero remains answered", () => {
  const b = fresh(),
    a = b.assessments[0];
  let s = scoreAssessment(rubric, a);
  assert.equal(s.total, 0);
  assert.equal(s.answered, 0);
  const c = rubric.criteria[0];
  a.responses[c.id] = { score: 3 };
  s = scoreAssessment(rubric, a);
  assert.equal(
    s.dimensions[0].score,
    100 / rubric.criteria.filter((v) => v.dimension === c.dimension).length,
  );
  a.responses[c.id].score = 0;
  s = scoreAssessment(rubric, a);
  assert.equal(s.total, 0);
  assert.equal(s.answered, 1);
});
test("binary and graded criteria normalize to the same maximum", () => {
  const b = complete(fresh()),
    s = scoreAssessment(rubric, b.assessments[0]);
  assert.equal(s.total, 100);
  assert.equal(s.complete, true);
  for (const d of s.dimensions) assert.equal(d.score, 100);
});
test("custom weights change only overall score", () => {
  const b = complete(fresh()),
    a = b.assessments[0];
  for (const c of rubric.criteria.filter((c) => c.dimension === "S"))
    a.responses[c.id].score = 0;
  const before = scoreAssessment(rubric, a);
  a.weights.S = 7;
  const after = scoreAssessment(rubric, a);
  assert(after.total < before.total);
  assert.deepEqual(
    after.dimensions.map((d) => d.score),
    before.dimensions.map((d) => d.score),
  );
});
test("evidence, confidence, applicability feedback and priority do not affect scores", () => {
  const b = complete(fresh()),
    a = b.assessments[0],
    before = scoreAssessment(rubric, a);
  for (const r of Object.values(a.responses)) {
    r.confidence = "low";
    r.evidence_rating = "conflicting";
    r.feedback = "Not applicable to this project";
    r.priority = true;
  }
  assert.deepEqual(scoreAssessment(rubric, a), before);
});
test("independent and follow-up reviews preserve originals without aliasing", () => {
  const b = complete(fresh()),
    a = b.assessments[0],
    before = structuredClone(a);
  const follow = newAssessment("Second reviewer", a);
  follow.responses[rubric.criteria[0].id].score = 0;
  assert.deepEqual(a, before);
  assert.equal(follow.review_of, a.id);
  assert.deepEqual(newAssessment("Independent").responses, {});
});
test("round trip retains Unicode and every reviewer field", async () => {
  const b = structuredClone(sample);
  b.assessments[0].comment += " Ελληνικά 🧪 日本語";
  const encoded = await encodeBundle(b);
  assert.deepEqual(await decodeBundle(encoded), b);
  assert(encoded.startsWith("v1."));
});
test("malformed versions, payloads and expanded over-limit streams are rejected", async () => {
  await assert.rejects(decodeBundle("v2.abc"), /version/);
  await assert.rejects(decodeBundle("v1.!!!"), /Malformed/);
  await assert.rejects(
    encodeBundle({ comment: "x".repeat(2_000_001) }),
    /size limit/,
  );
});
test("invalid anchors, unknown IDs, hash and cyclic reviews are rejected", () => {
  const b = fresh();
  const a = b.assessments[0];
  a.responses["BAD-01"] = { score: 1 };
  assert(semanticErrors(b, rubric, digest).some((e) => e.includes("Unknown")));
  delete a.responses["BAD-01"];
  const binary = rubric.criteria.find((c) => c.anchors.length === 2);
  a.responses[binary.id] = { score: 2 };
  assert(semanticErrors(b, rubric, digest).some((e) => e.includes("anchor")));
  a.responses = {};
  a.review_of = a.id;
  assert(semanticErrors(b, rubric, digest).some((e) => e.includes("cycle")));
  a.review_of = "missing";
  assert(
    semanticErrors(b, rubric, digest).some((e) => e.includes("not found")),
  );
  b.rubric_sha256 = "0".repeat(64);
  assert(
    semanticErrors(b, rubric, digest).some((e) => e.includes("fingerprint")),
  );
});
test("zero, infinite and negative weights rejected", () => {
  const b = fresh();
  for (const d in b.assessments[0].weights) b.assessments[0].weights[d] = 0;
  assert(semanticErrors(b, rubric, digest).length);
  b.assessments[0].weights.S = Infinity;
  assert(semanticErrors(b, rubric, digest).length);
  b.assessments[0].weights.S = -1;
  assert(semanticErrors(b, rubric, digest).length);
});
test("normalization supports optional response fields without creating invalid observation", () => {
  const b = fresh();
  b.assessments[0].responses[rubric.criteria[0].id] = { score: 1 };
  const normalized = normalizeBundle(b, digest);
  assert.equal(
    normalized.assessments[0].responses[rubric.criteria[0].id].observation,
    "observed",
  );
  assert.equal(validate(normalized), true);
});
test("merging adds distinct reviewers and rejects overwrite or scope mismatch", () => {
  const b = fresh(),
    other = structuredClone(b);
  other.assessments.push(newAssessment("Second"));
  const merged = mergeBundles(b, other);
  assert.equal(merged.assessments.length, 2);
  assert.equal(b.assessments.length, 1);
  other.assessments[0].comment = "Changed";
  assert.throws(() => mergeBundles(b, other), /conflicting/);
  other.assessments[0].comment = "";
  other.research_object.revision = "different";
  assert.throws(() => mergeBundles(b, other), /scope/);
});
test("HTML reports escape supplied text, include all identities, scores, weights and plots", () => {
  const b = structuredClone(sample);
  b.research_object.title = "<script>alert(1)</script>";
  const html = renderReport(b, rubric);
  assert(!html.includes("<script>"));
  assert(html.includes("&lt;script&gt;"));
  assert(html.includes("<svg"));
  assert(html.includes("Weight"));
  assert(html.includes("INCOMPLETE"));
  for (const a of b.assessments) assert(html.includes(a.id));
  assert.equal(safeURL("javascript:alert(1)"), null);
  assert.equal(safeURL("file:///tmp/test"), null);
});
test("share budget is explicit and bulky assessments do not silently lose fields", async () => {
  const b = fresh();
  b.assessments[0].comment = Array.from({ length: 3000 }, () =>
    crypto.randomUUID(),
  ).join("");
  const encoded = await encodeBundle(b);
  assert(encoded.length > MAX_SHARE_LENGTH);
  assert.deepEqual(await decodeBundle(encoded), b);
});
