import { scoreAssessment, escapeHTML as e, safeURL } from "./model.js";
const link = (value) =>
  safeURL(value) ? `<a href="${e(safeURL(value))}">${e(value)}</a>` : e(value);
function radarSVG(scores) {
  const point = (i, v) => [
    180 + Math.sin((i * 2 * Math.PI) / 7) * 110 * v,
    150 - Math.cos((i * 2 * Math.PI) / 7) * 110 * v,
  ];
  const polygon = (v) =>
    scores.dimensions.map((_, i) => point(i, v).join(",")).join(" ");
  return `<svg viewBox="0 0 360 310" width="360" role="img" aria-label="Seven dimension profile from zero to one hundred">${[0.25, 0.5, 0.75, 1].map((v) => `<polygon points="${polygon(v)}" fill="none" stroke="#dce2d8"/>`).join("")}${scores.dimensions
    .map((d, i) => {
      const p = point(i, 1.2);
      return `<text x="${p[0]}" y="${p[1] + 5}" text-anchor="middle">${d.id}</text>`;
    })
    .join(
      "",
    )}<polygon points="${scores.dimensions.map((d, i) => point(i, d.score / 100).join(",")).join(" ")}" fill="#267564" fill-opacity=".15" stroke="#267564" stroke-width="2"/></svg>`;
}
export function renderReport(bundle, rubric) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>STAMPED report · ${e(bundle.research_object.title)}</title>
<style>body{font:16px/1.6 system-ui;max-width:1000px;margin:40px auto;padding:0 24px;color:#183c36}h1,h2,h3{line-height:1.2}table{border-collapse:collapse;width:100%}td,th{padding:8px;text-align:left;border-bottom:1px solid #ddd}article{border-top:1px solid #ccc;margin:28px 0;padding-top:16px}small{color:#52645e}p,li{overflow-wrap:anywhere;white-space:pre-wrap}@media print{article{break-inside:avoid}button{display:none}}</style>
<h1>STAMPED assessment report</h1><h2>${e(bundle.research_object.title)}</h2>
<p>Object: ${link(bundle.research_object.locator)}<br>Revision: ${e(bundle.research_object.revision)}<br>Scope: ${e(bundle.research_object.scope)}</p>
<p>Rubric ${e(rubric.version)} · SHA-256 ${e(bundle.rubric_sha256)}<br>Manuscript: ${link(rubric.source.repository + "/blob/" + rubric.source.revision + "/" + rubric.source.path)} (${e(rubric.source.status)})</p>
<p>Each criterion is normalized by its maximum anchor, then averaged within its dimension. The overall score is the weighted mean of the seven dimensions. Unanswered criteria contribute zero with the denominator retained; this is an incomplete assessment, not an assertion of absent practice. Evidence support and confidence do not change scores. Scores describe STAMPED fulfillment under this draft rubric, not general scientific quality. Reviewer identities are self-declared.</p>
${bundle.assessments
  .map((a) => {
    const s = scoreAssessment(rubric, a);
    return `<section><h2>${e(a.reviewer.name)} · ${s.total.toFixed(1)} / 100</h2>
<p>${s.complete ? "All criteria rated" : "INCOMPLETE — provisional total"} · ${s.answered}/${s.count} rated<br>Reviewer ID: ${e(a.reviewer.id)} · Assessment ID: ${e(a.id)}<br>Created: ${e(a.created_at)} · Updated: ${e(a.updated_at)}<br>Review of: ${e(a.review_of ?? "Independent assessment")}</p>
${radarSVG(s)}<table><thead><tr><th>Dimension</th><th>Score / 100</th><th>Weight</th><th>Rated</th></tr></thead><tbody>${s.dimensions.map((d) => `<tr><td>${e(d.label)}</td><td>${d.score.toFixed(1)}</td><td>${d.weight}</td><td>${d.answered}/${d.total}</td></tr>`).join("")}</tbody></table>
<p>Overall comment: ${e(a.comment)}</p>
${rubric.criteria
  .map((c) => {
    const r = a.responses[c.id] ?? {};
    const anchor = c.anchors.find((v) => v.value === r.score);
    return `<article><h3>${e(c.id)} · ${e(c.title)}</h3><p>${e(c.question)}</p><p>Principles: ${e(c.principles.join(", "))} · Source: ${link(c.source.locator)}</p><p><strong>${anchor ? `${anchor.value}/${Math.max(...c.anchors.map((v) => v.value))} — ${e(anchor.label)}` : "Unanswered"}</strong>${anchor ? "<br>" + e(anchor.description) : ""}</p><p>Rationale: ${e(r.rationale)}<br>Observation: ${e(r.observation ?? "not_assessed")}<br>Evidence support: ${e(r.evidence_rating ?? "Not provided")} · Confidence: ${e(r.confidence ?? "Not provided")}</p><ul>${(r.evidence ?? []).map((v) => `<li>${link(v.locator)} — ${e(v.description)}<br>Discovery path: ${e(v.discovery_path)} · Access: ${e(v.access_status)}</li>`).join("")}</ul><p>Rubric feedback: ${e(r.feedback)}<br>Marked for improvement: ${r.priority ? "Yes" : "No"}</p></article>`;
  })
  .join("")}</section>`;
  })
  .join("")}
</html>`;
}
