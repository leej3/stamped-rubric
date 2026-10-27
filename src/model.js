export const DIMENSIONS = ["S", "T", "A", "M", "P", "E", "D"];
export const FORMAT_VERSION = "1.0.0";
export const MAX_FILE_BYTES = 2_000_000;
export const MAX_SHARE_LENGTH = 8_000;
export const blankResponse = () => ({
  score: null,
  evidence: [],
  rationale: "",
  evidence_rating: null,
  confidence: null,
  feedback: "",
  priority: false,
  observation: "not_assessed",
});
export function newAssessment(name = "Reviewer 1", previous = null) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    reviewer: { id: crypto.randomUUID(), name },
    created_at: now,
    updated_at: now,
    review_of: previous?.id ?? null,
    weights: previous
      ? { ...previous.weights }
      : Object.fromEntries(DIMENSIONS.map((d) => [d, 1])),
    responses: previous ? structuredClone(previous.responses) : {},
    comment: "",
  };
}
export function newBundle(rubric, digest) {
  return {
    format_version: FORMAT_VERSION,
    rubric_version: rubric.version,
    rubric_sha256: digest,
    research_object: {
      title: "Untitled research object",
      locator: "",
      revision: "",
      scope: "",
    },
    assessments: [newAssessment()],
  };
}
export function scoreAssessment(rubric, assessment) {
  let answered = 0;
  const dimensions = rubric.dimensions.map((d) => {
    const criteria = rubric.criteria.filter((c) => c.dimension === d.id);
    let count = 0;
    const points = criteria.reduce((sum, c) => {
      const score = assessment.responses[c.id]?.score;
      if (score !== null && score !== undefined) count++;
      return sum + (score ?? 0) / Math.max(...c.anchors.map((a) => a.value));
    }, 0);
    answered += count;
    return {
      id: d.id,
      label: d.label,
      score: criteria.length ? (100 * points) / criteria.length : 0,
      answered: count,
      total: criteria.length,
      weight: assessment.weights[d.id],
    };
  });
  const weightSum = dimensions.reduce((sum, d) => sum + d.weight, 0);
  return {
    dimensions,
    total:
      dimensions.reduce((sum, d) => sum + d.score * d.weight, 0) / weightSum,
    answered,
    count: rubric.criteria.length,
    complete: answered === rubric.criteria.length,
  };
}
export function semanticErrors(bundle, rubric, digest) {
  const errors = [];
  if (bundle.rubric_version !== rubric.version)
    errors.push(
      `Rubric version ${bundle.rubric_version} is not supported; expected ${rubric.version}.`,
    );
  if (bundle.rubric_sha256 && bundle.rubric_sha256 !== digest)
    errors.push(
      "Rubric fingerprint differs. Use the original rubric; no automatic migration was performed.",
    );
  const criteria = new Map(rubric.criteria.map((c) => [c.id, c]));
  const ids = new Set();
  for (const a of bundle.assessments) {
    if (ids.has(a.id)) errors.push(`Duplicate assessment ID: ${a.id}`);
    ids.add(a.id);
    const weights = DIMENSIONS.map((d) => a.weights[d]);
    if (
      weights.some((w) => !Number.isFinite(w) || w < 0) ||
      weights.reduce((x, y) => x + y, 0) <= 0
    )
      errors.push(
        `${a.id}: weights must be finite, nonnegative, and not all zero.`,
      );
    for (const [id, response] of Object.entries(a.responses)) {
      const c = criteria.get(id);
      if (!c) errors.push(`Unknown criterion: ${id}`);
      else if (
        response.score !== null &&
        !c.anchors.some((v) => v.value === response.score)
      )
        errors.push(`${id}: score is not an allowed anchor.`);
    }
  }
  const byId = new Map(bundle.assessments.map((a) => [a.id, a]));
  for (const a of bundle.assessments) {
    const seen = new Set([a.id]);
    let next = a.review_of;
    while (next) {
      if (!byId.has(next)) {
        errors.push(`Review reference not found: ${next}`);
        break;
      }
      if (seen.has(next)) {
        errors.push("Review references form a cycle.");
        break;
      }
      seen.add(next);
      next = byId.get(next).review_of;
    }
  }
  return errors;
}
export function normalizeBundle(bundle, digest) {
  const result = structuredClone(bundle);
  result.rubric_sha256 ??= digest;
  for (const a of result.assessments) {
    for (const [id, r] of Object.entries(a.responses))
      a.responses[id] = {
        ...blankResponse(),
        observation: r.score === null ? "not_assessed" : "observed",
        ...r,
      };
  }
  return result;
}
export async function sha256(text) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
async function transform(bytes, stream) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_FILE_BYTES) {
      await reader.cancel();
      throw new Error("Assessment exceeds the 2 MB size limit.");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) {
    output.set(chunk, pos);
    pos += chunk.length;
  }
  return output;
}
export async function encodeBundle(bundle) {
  const raw = new TextEncoder().encode(JSON.stringify(bundle));
  if (raw.length > MAX_FILE_BYTES)
    throw new Error("Assessment exceeds the 2 MB size limit.");
  const bytes = await transform(raw, new CompressionStream("gzip"));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return (
    "v1." +
    btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
  );
}
export async function decodeBundle(encoded) {
  if (!encoded.startsWith("v1."))
    throw new Error("Unsupported share-link version.");
  if (encoded.length > MAX_FILE_BYTES * 2)
    throw new Error("Share link exceeds the size limit.");
  const payload = encoded.slice(3);
  if (!/^[A-Za-z0-9_-]+$/.test(payload))
    throw new Error("Malformed share link.");
  const bytes = Uint8Array.from(
    atob(payload.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await transform(bytes, new DecompressionStream("gzip")),
    ),
  );
}
export function safeURL(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

export function mergeBundles(current, incoming) {
  if (
    current.rubric_version !== incoming.rubric_version ||
    current.rubric_sha256 !== incoming.rubric_sha256
  )
    throw new Error(
      "Cannot combine different rubric versions or fingerprints.",
    );
  for (const field of ["locator", "revision", "scope"])
    if (current.research_object[field] !== incoming.research_object[field])
      throw new Error(
        "Object locator, revision, and scope must match to combine reviews. Open this as a separate bundle instead.",
      );
  const merged = structuredClone(current);
  const canonical = (value) =>
    value && typeof value === "object"
      ? Array.isArray(value)
        ? value.map(canonical)
        : Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((k) => [k, canonical(value[k])]),
          )
      : value;
  for (const review of incoming.assessments) {
    const existing = merged.assessments.find((a) => a.id === review.id);
    if (
      existing &&
      JSON.stringify(canonical(existing)) !== JSON.stringify(canonical(review))
    )
      throw new Error(
        "An assessment ID has conflicting contents. Preserve both by giving the new assessment a new ID and referencing the original with review_of.",
      );
    if (!existing) merged.assessments.push(structuredClone(review));
  }
  return merged;
}
