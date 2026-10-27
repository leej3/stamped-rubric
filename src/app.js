import "./style.css";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  DIMENSIONS,
  blankResponse,
  newAssessment,
  newBundle,
  scoreAssessment,
  semanticErrors,
  normalizeBundle,
  sha256,
  encodeBundle,
  decodeBundle,
  safeURL,
  escapeHTML as e,
  MAX_FILE_BYTES,
  MAX_SHARE_LENGTH,
  mergeBundles,
} from "./model.js";
import { renderReport } from "./report.js";

const STORAGE = "stamped-rubric-workspace-v1";
const COLORS = [
  "#267564",
  "#c57932",
  "#6b62a1",
  "#aa5867",
  "#55809b",
  "#8c7951",
  "#527949",
];
let importMode = "open";
let rubric,
  digest,
  validateStructure,
  bundle,
  activeId,
  dimension = "all",
  overlay = false,
  filter = "all",
  notice = "",
  storageFailed = false;
const root = document.querySelector("#app");
const active = () =>
  bundle.assessments.find((a) => a.id === activeId) ?? bundle.assessments[0];
const response = (id) => active().responses[id] ?? blankResponse();
const criterion = (id) => rubric.criteria.find((c) => c.id === id);
const selected = (a, b) => (a === b ? " selected" : "");
const checked = (v) => (v ? " checked" : "");
const options = (values, value) =>
  values
    .map(
      ([key, label]) =>
        `<option value="${e(key)}"${selected(key, value ?? "")}>${e(label)}</option>`,
    )
    .join("");
const urlLink = (url, label = url) =>
  safeURL(url)
    ? `<a href="${e(safeURL(url))}" target="_blank" rel="noopener noreferrer">${e(label)} ↗</a>`
    : `<span>${e(label)}</span>`;
function validate(value, draft = false) {
  const candidate = structuredClone(value);
  if (
    draft &&
    candidate?.research_object &&
    Array.isArray(candidate.assessments)
  ) {
    for (const key of ["title", "locator"])
      if (candidate.research_object[key] === "")
        candidate.research_object[key] = "Draft";
    for (const a of candidate.assessments)
      for (const r of Object.values(a.responses ?? {}))
        for (const v of r.evidence ?? [])
          if (v.locator === "") v.locator = "Draft";
  }
  if (!validateStructure(candidate))
    throw new Error(
      validateStructure.errors
        .slice(0, 4)
        .map((x) => `${x.instancePath || "Assessment"} ${x.message}`)
        .join("; "),
    );
  const errors = semanticErrors(value, rubric, digest);
  for (const a of value.assessments)
    for (const [id, r] of Object.entries(a.responses))
      if (r.observation === "not_assessed" && r.score !== null)
        errors.push(`${id}: not_assessed cannot carry a score.`);
  if (errors.length) throw new Error(errors.slice(0, 5).join(" "));
  return normalizeBundle(value, digest);
}
function save(touch = true) {
  if (touch) active().updated_at = new Date().toISOString();
  try {
    localStorage.setItem(STORAGE, JSON.stringify(bundle));
    storageFailed = false;
  } catch {
    storageFailed = true;
  }
  document
    .querySelector("#save-state")
    ?.replaceChildren(
      document.createTextNode(
        storageFailed
          ? "Storage full or unavailable — export JSON to save"
          : "Saved in this browser",
      ),
    );
}
function backup() {
  try {
    localStorage.setItem(STORAGE + "-previous", JSON.stringify(bundle));
  } catch {
    toast(
      "Could not retain a local backup. Export JSON before replacing this workspace.",
    );
  }
}
function replace(value, message) {
  backup();
  bundle = validate(value, true);
  activeId = bundle.assessments[0].id;
  dimension = "all";
  filter = "all";
  if (location.hash.startsWith("#assessment="))
    history.replaceState(null, "", location.pathname + location.search);
  save(false);
  notice = message;
  render();
}
function download(text, type, name) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportJSON() {
  download(
    JSON.stringify(bundle, null, 2) + "\n",
    "application/json",
    "stamped-assessment.json",
  );
}
function ask(message, textInput = false) {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "app-dialog";
    dialog.innerHTML = `<form method="dialog"><h2>${textInput ? "Add a reviewer" : "Change workspace"}</h2><p>${e(message)}</p>${textInput ? '<label>Reviewer name<input name="answer" required autofocus autocomplete="off"></label>' : ""}<div class="dialog-actions"><button value="cancel" class="secondary" formnovalidate>Cancel</button><button value="ok" class="primary">${textInput ? "Add reviewer" : "Continue"}</button></div></form>`;
    document.body.append(dialog);
    dialog.addEventListener(
      "close",
      () => {
        const value =
          dialog.returnValue === "ok"
            ? textInput
              ? dialog.querySelector("input").value
              : true
            : null;
        dialog.remove();
        resolve(value);
      },
      { once: true },
    );
    dialog.showModal();
  });
}
function toast(message) {
  notice = message;
  const el = document.querySelector("#notice");
  if (el) {
    el.textContent = message;
    el.hidden = !message;
  }
}
function radar() {
  const cx = 175,
    cy = 155,
    r = 104;
  const p = (i, scale) => [
    cx + Math.sin((i * 2 * Math.PI) / 7) * r * scale,
    cy - Math.cos((i * 2 * Math.PI) / 7) * r * scale,
  ];
  const points = (scale) =>
    DIMENSIONS.map((_, i) => p(i, scale).join(",")).join(" ");
  const chosen = overlay ? bundle.assessments : [active()];
  return `<svg viewBox="0 0 350 320" role="img" aria-labelledby="radar-title radar-desc"><title id="radar-title">STAMPED dimension scores</title><desc id="radar-desc">Seven axes from zero at the center to 100 at the edge. Exact values and weights are in the adjacent table. Unanswered criteria contribute zero.</desc>
${[0.25, 0.5, 0.75, 1].map((v) => `<polygon points="${points(v)}" class="grid-ring"/>`).join("")}
${DIMENSIONS.map((d, i) => {
  const end = p(i, 1),
    label = p(i, 1.24);
  return `<line x1="${cx}" y1="${cy}" x2="${end[0]}" y2="${end[1]}" class="axis"/><text x="${label[0]}" y="${label[1] + 5}" text-anchor="middle" class="axis-label">${d}</text>`;
}).join("")}
${chosen
  .map((a) => {
    const s = scoreAssessment(rubric, a);
    const color = COLORS[bundle.assessments.indexOf(a) % COLORS.length];
    return `<polygon points="${s.dimensions.map((d, i) => p(i, d.score / 100).join(",")).join(" ")}" fill="${color}" fill-opacity="${a.id === activeId ? ".15" : ".03"}" stroke="${color}" stroke-width="${a.id === activeId ? "2.5" : "1.5"}" ${a.id !== activeId ? 'stroke-dasharray="5 4"' : ""}/>`;
  })
  .join("")}
<text x="${cx + 5}" y="${cy - 3}" class="scale-label">0</text><text x="${cx + 5}" y="${cy - r + 5}" class="scale-label">100</text></svg>
<div class="legend">${chosen.map((a) => `<span><i style="background:${COLORS[bundle.assessments.indexOf(a) % COLORS.length]}"></i>${e(a.reviewer.name)}</span>`).join("")}</div>`;
}
function summary() {
  const a = active(),
    s = scoreAssessment(rubric, a),
    sum = DIMENSIONS.reduce((v, d) => v + a.weights[d], 0);
  return `<div class="profile-heading"><div><span class="eyebrow">Assessment profile</span><h2>Seven perspectives.<br>One research object.</h2></div><div class="score"><strong>${s.total.toFixed(1)}</strong><span>/ 100</span><small>${s.complete ? "All criteria rated" : "Provisional · incomplete"}</small></div></div>
<div class="profile-content"><div class="radar">${radar()}<label class="check"><input id="overlay" type="checkbox"${checked(overlay)}> Compare reviewers</label></div><div class="scores-table"><div class="table-heading"><span>Dimension</span><span>Score</span><span>Weight</span></div>
${s.dimensions.map((d) => `<div class="dimension-score"><button class="dimension-name" data-action="dimension" data-dimension="${d.id}"><b>${d.id}</b><span>${e(d.label)}<small>${d.answered}/${d.total} rated</small></span></button><strong>${d.score.toFixed(1)}</strong><label><span class="sr-only">${e(d.label)} weight</span><input type="number" min="0" max="1000000" step="0.1" data-weight="${d.id}" value="${a.weights[d.id]}"><small>${((100 * d.weight) / sum).toFixed(0)}%</small></label></div>`).join("")}
<button class="text-button" data-action="reset-weights">Reset equal weights</button><p class="caption">Weights affect the total, not the shape of the plot.</p></div></div>
<div class="progress-line"><span>${s.answered} of ${s.count} criteria rated</span><progress value="${s.answered}" max="${s.count}">${s.answered}/${s.count}</progress><span>${Math.round((s.answered / s.count) * 100)}%</span></div>`;
}
function evidenceEditor(c, r) {
  return `<div class="evidence-list">${(r.evidence ?? [])
    .map(
      (v, i) =>
        `<fieldset class="evidence-entry"><legend>Evidence ${i + 1}</legend><label>Locator / link<input data-criterion="${c.id}" data-evidence="${i}" data-key="locator" value="${e(v.locator)}" placeholder="URL, DOI, or local path"></label>${v.locator ? `<div class="evidence-link">${urlLink(v.locator, "Open evidence")}</div>` : ""}<label>What this supports<textarea rows="2" data-criterion="${c.id}" data-evidence="${i}" data-key="description">${e(v.description)}</textarea></label><label>How it was found<input data-criterion="${c.id}" data-evidence="${i}" data-key="discovery_path" value="${e(v.discovery_path)}" placeholder="Research object → README → linked file"></label><div class="form-row"><label>Access<select data-criterion="${c.id}" data-evidence="${i}" data-key="access_status">${options(
          [
            ["accessible", "Accessible"],
            ["inaccessible", "Inaccessible"],
            ["not_checked", "Not checked"],
          ],
          v.access_status,
        )}</select></label><button data-action="remove-evidence" data-criterion="${c.id}" data-index="${i}" class="text-button">Remove evidence</button></div></fieldset>`,
    )
    .join(
      "",
    )}</div><button class="secondary small" data-action="add-evidence" data-criterion="${c.id}">+ Add evidence</button>`;
}
function criterionCard(c) {
  const r = response(c.id),
    anchor = c.anchors.find((a) => a.value === r.score);
  const earlier = active().review_of
    ? bundle.assessments.find((a) => a.id === active().review_of)
    : null;
  const orig = earlier?.responses[c.id];
  return `<details class="criterion-card" id="criterion-${c.id}" data-card="${c.id}"><summary><span class="criterion-code">${c.id}</span><span class="criterion-title">${e(c.title)}<small>${e(c.principles.join(" · "))}${r.priority ? " · Marked for improvement" : ""}${r.feedback ? " · Feedback recorded" : ""}</small></span><span class="rating-pill ${anchor ? "rated" : ""}">${anchor ? `${r.score} / ${Math.max(...c.anchors.map((a) => a.value))}` : "Unanswered"}</span><span class="chevron">⌄</span></summary>
<div class="criterion-body"><p class="question">${e(c.question)}</p><p>${e(c.rationale)}</p><div class="guidance"><strong>Evidence to look for</strong><p>${e(c.evidence_guidance)}</p></div>
<fieldset class="anchor-list"><legend>Choose the best supported description</legend><label class="anchor${r.score === null ? " chosen" : ""}"><input type="radio" name="score-${c.id}" data-criterion="${c.id}" data-field="score" value=""${checked(r.score === null)}><span><b>Unanswered</b><small>Retains its place in the denominator; the assessment remains incomplete.</small></span></label>${c.anchors.map((a) => `<label class="anchor${r.score === a.value ? " chosen" : ""}"><input type="radio" name="score-${c.id}" data-criterion="${c.id}" data-field="score" value="${a.value}"${checked(r.score === a.value)}><span><b>${a.value} · ${e(a.label)}</b><small>${e(a.description)}</small></span></label>`).join("")}</fieldset>
<label>Rating rationale<textarea data-criterion="${c.id}" data-field="rationale" rows="3" placeholder="Explain how the evidence meets this anchor, including limitations.">${e(r.rationale)}</textarea></label>
<div class="form-row"><label>Evidence observation<select data-criterion="${c.id}" data-field="observation">${options(
    [
      ["not_assessed", "Not yet assessed"],
      ["observed", "Evidence inspected"],
      ["not_findable", "Not findable from the object"],
      ["inaccessible", "Found but inaccessible"],
      ["absent", "Demonstrably absent"],
    ],
    r.observation,
  )}</select></label><label>Evidence support <span class="optional">optional</span><select data-criterion="${c.id}" data-field="evidence_rating">${options(
    [
      ["", "Not provided"],
      ["insufficient", "Insufficient"],
      ["partial", "Partial"],
      ["sufficient", "Sufficient"],
      ["conflicting", "Conflicting"],
    ],
    r.evidence_rating,
  )}</select></label><label>Confidence in rating <span class="optional">optional</span><select data-criterion="${c.id}" data-field="confidence">${options(
    [
      ["", "Not provided"],
      ["low", "Low"],
      ["moderate", "Moderate"],
      ["high", "High"],
    ],
    r.confidence,
  )}</select></label></div>
<p class="caption">Evidence support and confidence describe this review. They do not add points.</p>
<h4>Evidence record</h4>${evidenceEditor(c, r)}
<div class="feedback"><label>Rubric feedback / applicability objection<textarea data-criterion="${c.id}" data-field="feedback" rows="2" placeholder="Ambiguous wording, missing anchors, or a criterion that does not fit this object…">${e(r.feedback)}</textarea></label><label class="check"><input type="checkbox" data-criterion="${c.id}" data-field="priority"${checked(r.priority)}> Mark for improvement</label></div>
${earlier ? `<details class="original"><summary>Earlier response · ${e(earlier.reviewer.name)}</summary><p>Rating: ${orig?.score ?? "Unanswered"} · ${e(orig?.rationale ?? "No rationale")}</p><p>Evidence support: ${e(orig?.evidence_rating ?? "Not provided")} · Confidence: ${e(orig?.confidence ?? "Not provided")}</p><ul>${(orig?.evidence ?? []).map((v) => `<li>${urlLink(v.locator)} — ${e(v.description)}<br>${e(v.discovery_path)}</li>`).join("")}</ul><p>Feedback: ${e(orig?.feedback ?? "")}</p><button data-action="select-review" data-id="${e(earlier.id)}" class="text-button">Open full earlier assessment</button></details>` : ""}
<div class="source-ref">Derived from ${e(c.principles.join(", "))} · ${urlLink(c.source.locator, "Manuscript source")}</div></div></details>`;
}
function criteriaPanel() {
  let entries = rubric.criteria.filter(
    (c) => dimension === "all" || c.dimension === dimension,
  );
  if (filter === "unanswered")
    entries = entries.filter((c) => response(c.id).score === null);
  if (filter === "priority")
    entries = entries.filter((c) => response(c.id).priority);
  if (filter === "feedback")
    entries = entries.filter((c) => response(c.id).feedback);
  const dims = rubric.dimensions.filter(
    (d) => dimension === "all" || d.id === dimension,
  );
  return `<div class="criteria-heading"><div><span class="eyebrow">The rubric</span><h2>${dimension === "all" ? "Assess the object" : e(dims[0].label)}</h2></div><label class="filter-label">Show<select id="criteria-filter">${options(
    [
      ["all", "All criteria"],
      ["unanswered", "Unanswered"],
      ["priority", "Marked for improvement"],
      ["feedback", "With rubric feedback"],
    ],
    filter,
  )}</select></label></div>
${dims
  .map((d) => {
    const cs = entries.filter((c) => c.dimension === d.id);
    if (!cs.length) return "";
    return `<section class="dimension-section"><div class="section-heading"><span class="dimension-letter">${d.id}</span><div><h3>${e(d.label)}</h3><p>${e(d.description)}</p></div></div><details class="principles"><summary>Read the ${e(d.label.toLowerCase())} principles</summary>${rubric.principles
      .filter((p) => p.dimension === d.id)
      .map(
        (p) =>
          `<p><strong>${e(p.code)} · ${e(p.level.toUpperCase())}</strong><br>${e(p.statement)}</p>`,
      )
      .join("")}</details>${cs.map(criterionCard).join("")}</section>`;
  })
  .join(
    "",
  )}${entries.length ? "" : '<div class="empty-state">No criteria match this filter.</div>'}`;
}
function render() {
  const open = [...document.querySelectorAll("details[open]")]
    .map((d) => d.id)
    .filter(Boolean);
  const a = active();
  root.innerHTML = `<header class="masthead"><a class="brand" href="#" aria-label="STAMPED rubric home"><span class="brand-mark">S<span>✳</span></span><span>STAMPED<small>Research object rubric</small></span></a><div class="header-meta"><span class="draft-tag">PILOT · v${e(rubric.version)}</span><span id="save-state">${storageFailed ? "Storage unavailable — export to save" : "Saved in this browser"}</span></div></header>
<div class="topline"><span>A practical perspective on reproducible research.</span><nav aria-label="File actions"><button data-action="new" class="text-button">New object</button><button data-action="example" class="text-button">Worked example ↗</button><button data-action="import" class="secondary small">Import JSON</button><button data-action="merge" class="text-button">Add reviews</button><button data-action="export" class="secondary small">Export JSON</button><button data-action="share" class="primary small">Share link</button></nav></div>
<p id="notice" class="notice" role="status"${notice ? "" : " hidden"}>${e(notice)}</p><input type="file" id="import-file" accept="application/json,.json" hidden>
<main id="workspace"><section class="object-panel"><span class="eyebrow">Research object</span><h1>${e(bundle.research_object.title)}</h1><div class="object-link">${urlLink(bundle.research_object.locator, bundle.research_object.locator || "Add a DOI, repository, directory, or publication below")}</div><details id="object-details" class="object-details"${bundle.research_object.locator ? "" : " open"}><summary>Edit object & assessment scope</summary><div class="form-row"><label>Title<input data-object="title" value="${e(bundle.research_object.title)}"></label><label>Entry point / locator<input data-object="locator" value="${e(bundle.research_object.locator)}" placeholder="https://doi.org/… or a repository / directory"></label></div><div class="form-row"><label>Object revision / version<input data-object="revision" value="${e(bundle.research_object.revision)}" placeholder="Commit, DOI version, or dated snapshot"></label><label>Assessment scope<textarea rows="2" data-object="scope" placeholder="What is included? Start at the object and follow its explicit references.">${e(bundle.research_object.scope)}</textarea></label></div></details></section>
<section class="reviewer-bar"><label>Viewing assessment<select id="reviewer-select">${bundle.assessments.map((r) => `<option value="${e(r.id)}"${selected(r.id, a.id)}>${e(r.reviewer.name)}${r.review_of ? " · follow-up" : ""}</option>`).join("")}</select></label><button data-action="add-reviewer" class="secondary small">+ Independent assessment</button><button data-action="follow-up" class="secondary small">+ Review this assessment</button><details id="reviewer-details"><summary>Identity & notes</summary><div class="reviewer-fields"><label>Reviewer display name<input data-reviewer="name" value="${e(a.reviewer.name)}"></label><label>Reviewer identity<input data-reviewer="id" value="${e(a.reviewer.id)}"></label><p class="caption">Self-declared identity. The same fields apply to every reviewer.</p><label>Overall assessment comment<textarea data-assessment="comment" rows="3">${e(a.comment)}</textarea></label><p class="caption">Assessment: ${e(a.id)}<br>Created ${e(a.created_at)}${a.review_of ? `<br>Reviews ${e(a.review_of)}` : ""}</p></div></details></section>
<section id="profile" class="profile-panel">${summary()}</section>
<div class="workbench"><aside class="sidebar"><span class="eyebrow">Explore dimensions</span><nav aria-label="Rubric dimensions"><button data-action="dimension" data-dimension="all" class="${dimension === "all" ? "active" : ""}"><b>✳</b>All dimensions</button>${rubric.dimensions.map((d) => `<button data-action="dimension" data-dimension="${d.id}" class="${dimension === d.id ? "active" : ""}"><b>${d.id}</b>${e(d.label)}</button>`).join("")}</nav><div class="sidebar-note"><strong>Evidence before inference.</strong><p>Begin at the research object. Record how each source was found, then choose the anchor it supports.</p></div><button data-action="report" class="secondary">Download report</button><button data-action="print" class="text-button">Print this view</button><button data-action="backup" class="text-button">Download previous workspace</button><button data-action="recovery" class="text-button">Download recovery file</button></aside><div id="criteria-panel">${criteriaPanel()}</div></div>
<details class="method" id="method"><summary>How to interpret this assessment</summary><p>Each criterion is divided by its maximum possible score, then averaged within its dimension. Dimension weights determine the overall total. Unanswered criteria earn no points and remain in the denominator; incomplete totals are provisional. Comments and applicability objections do not remove criteria. Evidence support and confidence do not affect scores. Reviewer scores are never automatically averaged.</p><p>This draft rubric is a STAMPED perspective on a research object, not a certification or universal measure of scientific quality. Its consistency between reviewers has not yet been established. Use the criterion feedback fields to report ambiguity and improve the rubric.</p><p>Manuscript source: ${urlLink(rubric.source.repository + "/blob/" + rubric.source.revision + "/" + rubric.source.path, rubric.source.revision)} · ${e(rubric.source.status)}<br>Rubric fingerprint: <code>${e(digest)}</code></p><p>All assessment data stays in this browser until you export it or share a link. Links contain the assessment and can be read by anyone who receives them. Local storage is convenience storage; export your work for durable retention.</p></details></main>
<footer><span>STAMPED / rubric laboratory</span><span>Built for observation, discussion, and improvement.</span></footer>`;
  open.forEach((id) => {
    const d = document.getElementById(id);
    if (d) d.open = true;
  });
}
function refreshScores() {
  document.querySelector("#profile").innerHTML = summary();
}
function refreshCard(id) {
  const old = document.getElementById("criterion-" + id);
  if (!old) return;
  const isOpen = old.open;
  const template = document.createElement("template");
  template.innerHTML = criterionCard(criterion(id));
  old.replaceWith(template.content);
  document.getElementById("criterion-" + id).open = isOpen;
}
async function share() {
  try {
    validate(bundle);
    const encoded = await encodeBundle(bundle);
    const url = new URL(location.href);
    url.search = "";
    url.hash = "assessment=" + encoded;
    if (url.href.length > MAX_SHARE_LENGTH) {
      toast(
        `This report would need ${url.href.length.toLocaleString()} URL characters, above this app’s ${MAX_SHARE_LENGTH.toLocaleString()}-character sharing budget. Export JSON to share the complete report; nothing was omitted.`,
      );
      return;
    }
    await navigator.clipboard.writeText(url.href);
    toast(
      `Complete assessment link copied (${url.href.length.toLocaleString()} characters). Anyone with the link can read its evidence and comments.`,
    );
  } catch (error) {
    toast(
      "Could not copy link: " + error.message + " You can export JSON instead.",
    );
  }
}
root.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === "dimension") {
      dimension = button.dataset.dimension;
      render();
      document
        .querySelector("#criteria-panel")
        .scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (action === "export") {
      validate(bundle);
      exportJSON();
    }
    if (action === "backup" || action === "recovery") {
      const raw = localStorage.getItem(
        STORAGE + (action === "backup" ? "-previous" : "-recovery"),
      );
      if (!raw)
        throw new Error(
          "No " +
            (action === "backup" ? "previous workspace" : "recovery file") +
            " is stored.",
        );
      download(raw, "application/json", "stamped-" + action + ".json");
    }
    if (action === "report") {
      validate(bundle);
      download(
        renderReport(bundle, rubric),
        "text/html",
        "stamped-report.html",
      );
    }
    if (action === "print") {
      document.querySelectorAll("details").forEach((d) => (d.open = true));
      window.print();
    }
    if (action === "share") await share();
    if (action === "import" || action === "merge") {
      importMode = action === "merge" ? "merge" : "open";
      document.querySelector("#import-file").click();
    }
    if (
      action === "new" &&
      (await ask(
        "Start a new research object? Export the current assessment first if you want to keep it outside this browser.",
      ))
    )
      replace(newBundle(rubric, digest), "New research object started.");
    if (
      action === "example" &&
      (await ask(
        "Open the worked REMoDNaV example? The current workspace will be kept as a local backup.",
      ))
    ) {
      const res = await fetch("/data/paper-remodnav.json");
      if (!res.ok) throw new Error("Worked example is unavailable.");
      replace(
        await res.json(),
        "Worked example loaded. Source inspection only; no computation was rerun.",
      );
    }
    if (action === "add-reviewer" || action === "follow-up") {
      const name = await ask(
        "Enter the reviewer identity used for this contribution.",
        true,
      );
      if (!name?.trim()) return;
      const next = newAssessment(
        name.trim(),
        action === "follow-up" ? active() : null,
      );
      bundle.assessments.push(next);
      activeId = next.id;
      save();
      render();
      toast(
        action === "follow-up"
          ? "Follow-up created from the earlier responses. The earlier assessment is preserved."
          : "Independent assessment created with unanswered criteria.",
      );
    }
    if (action === "select-review") {
      activeId = button.dataset.id;
      render();
    }
    if (action === "reset-weights") {
      active().weights = Object.fromEntries(DIMENSIONS.map((d) => [d, 1]));
      save();
      refreshScores();
    }
    if (action === "add-evidence") {
      const id = button.dataset.criterion;
      active().responses[id] ??= blankResponse();
      active().responses[id].evidence.push({
        locator: "",
        description: "",
        discovery_path: "",
        access_status: "not_checked",
      });
      save();
      refreshCard(id);
    }
    if (action === "remove-evidence") {
      const id = button.dataset.criterion;
      active().responses[id].evidence.splice(Number(button.dataset.index), 1);
      save();
      refreshCard(id);
    }
  } catch (error) {
    toast(error.message);
  }
});
root.addEventListener("change", async (event) => {
  const el = event.target;
  try {
    if (el.id === "import-file") {
      const file = el.files[0];
      if (!file) return;
      if (file.size > MAX_FILE_BYTES)
        throw new Error("JSON file exceeds 2 MB.");
      const value = validate(JSON.parse(await file.text()));
      if (importMode === "merge") {
        const combined = mergeBundles(normalizeBundle(bundle, digest), value);
        replace(
          combined,
          "Reviewer assessments combined without overwriting existing contributions.",
        );
      } else if (
        await ask(
          "Open this assessment bundle? The current workspace will be kept as a local backup.",
        )
      )
        replace(
          value,
          "Assessment imported. Review identities are self-declared.",
        );
      return;
    }
    if (el.id === "reviewer-select") {
      activeId = el.value;
      render();
      return;
    }
    if (el.id === "criteria-filter") {
      filter = el.value;
      document.querySelector("#criteria-panel").innerHTML = criteriaPanel();
      return;
    }
    if (el.id === "overlay") {
      overlay = el.checked;
      refreshScores();
      return;
    }
    if (el.dataset.weight) {
      const old = active().weights[el.dataset.weight],
        value = Number(el.value);
      if (!el.value || !Number.isFinite(value) || value < 0 || value > 1e6) {
        el.value = old;
        throw new Error("Weights must be between zero and 1,000,000.");
      }
      active().weights[el.dataset.weight] = value;
      if (DIMENSIONS.reduce((s, d) => s + active().weights[d], 0) === 0) {
        active().weights[el.dataset.weight] = old;
        el.value = old;
        throw new Error("At least one dimension must have a positive weight.");
      }
      save();
      refreshScores();
      return;
    }
    if (el.dataset.object) {
      bundle.research_object[el.dataset.object] = el.value;
      save();
      document.querySelector(".object-panel h1").textContent =
        bundle.research_object.title;
      document.querySelector(".object-link").innerHTML = urlLink(
        bundle.research_object.locator,
        bundle.research_object.locator || "Add an entry point below",
      );
      return;
    }
    if (el.dataset.reviewer) {
      if (!el.value.trim()) {
        el.value = active().reviewer[el.dataset.reviewer];
        throw new Error("Reviewer identity cannot be empty.");
      }
      active().reviewer[el.dataset.reviewer] = el.value.trim();
      save();
      render();
      return;
    }
    if (el.dataset.assessment) {
      active()[el.dataset.assessment] = el.value;
      save();
      return;
    }
    if (el.dataset.criterion) {
      const id = el.dataset.criterion;
      active().responses[id] ??= blankResponse();
      const r = active().responses[id];
      if (el.dataset.evidence !== undefined) {
        r.evidence[Number(el.dataset.evidence)][el.dataset.key] = el.value;
        save();
        return;
      }
      const field = el.dataset.field;
      r[field] =
        field === "score"
          ? el.value === ""
            ? null
            : Number(el.value)
          : field === "priority"
            ? el.checked
            : ["evidence_rating", "confidence"].includes(field)
              ? el.value || null
              : el.value;
      if (field === "score") {
        if (r.score !== null && r.observation === "not_assessed")
          r.observation = "observed";
        if (r.score === null) r.observation = "not_assessed";
      }
      if (field === "observation" && r.observation === "not_assessed")
        r.score = null;
      save();
      if (["score", "observation", "priority"].includes(field)) {
        refreshCard(id);
        refreshScores();
      }
    }
  } catch (error) {
    toast(error.message);
  }
});
// Persist text while typing without rebuilding the focused control.
root.addEventListener("input", (event) => {
  const el = event.target;
  if (
    !["TEXTAREA", "INPUT"].includes(el.tagName) ||
    ["radio", "checkbox", "number", "file"].includes(el.type)
  )
    return;
  if (el.dataset.object) bundle.research_object[el.dataset.object] = el.value;
  else if (el.dataset.assessment) active()[el.dataset.assessment] = el.value;
  else if (el.dataset.criterion) {
    const id = el.dataset.criterion;
    active().responses[id] ??= blankResponse();
    const r = active().responses[id];
    if (el.dataset.evidence !== undefined)
      r.evidence[Number(el.dataset.evidence)][el.dataset.key] = el.value;
    else r[el.dataset.field] = el.value;
  } else return;
  save();
});
async function start() {
  const [raw, schema] = await Promise.all([
    fetch("/data/rubric.json").then((r) => {
      if (!r.ok) throw new Error("Rubric missing; run npm run sync:schemas.");
      return r.text();
    }),
    fetch("/data/assessment-bundle.schema.json").then((r) => r.json()),
  ]);
  rubric = JSON.parse(raw);
  digest = await sha256(raw);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  validateStructure = ajv.compile(schema);
  bundle = newBundle(rubric, digest);
  let saved;
  try {
    saved = localStorage.getItem(STORAGE);
    if (saved) bundle = validate(JSON.parse(saved), true);
  } catch (error) {
    try {
      if (saved) localStorage.setItem(STORAGE + "-recovery", saved);
    } catch {}
    notice =
      "Saved workspace could not be loaded: " +
      error.message +
      " Use Download recovery file to retrieve the stored copy.";
  }
  if (location.hash.startsWith("#assessment="))
    try {
      const shared = validate(await decodeBundle(location.hash.slice(12)));
      backup();
      bundle = shared;
      activeId = bundle.assessments[0].id;
      save(false);
      history.replaceState(null, "", location.pathname + location.search);
      notice =
        "Shared assessment loaded and saved in this browser. Export JSON for durable retention.";
    } catch (error) {
      notice = "Shared assessment could not be loaded: " + error.message;
    }
  activeId = bundle.assessments[0].id;
  render();
}
start().catch((error) => {
  root.innerHTML = `<main class="startup-error"><h1>Unable to open the rubric</h1><p>${e(error.message)}</p><p>Run <code>npm run sync:schemas</code> from the website repository and reload.</p></main>`;
});
