# STAMPED research object rubric

A local-first assessment workspace for the seven STAMPED principles.
It loads versioned rubric data from the sibling `stamped-rubric-schema` repository.

## Run locally

Requires Node.js 22.12+ (tested with 24.10) and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite.
Bundled rubric data and the REMoDNaV worked example are committed, so running the app does not require the sibling repo.
The app makes no assessment-service requests and uses no remote fonts.

```sh
npm test
npm run build
npm run preview
```

To deliberately update bundled content from the sibling repository:

```sh
npm run sync:schemas
```

Or supply a different local schema checkout:

```sh
npm run sync:schemas -- /absolute/path/to/stamped-rubric-schema
```

Review and validate any changed rubric and examples before synchronization.
The catalog records its version, exact-byte SHA-256, and manuscript revision.
No upstream versions are picked up automatically.
The manuscript source is provisional until its definitive reconciliation; updating it requires a new rubric version and explicit handling of existing assessments.

## Assessment workflow

1. Enter the research object's locator, version and computational scope.
   It may be a paper DOI, repository, deposited publication or directory.
2. Name the reviewer.
   Every person or agent uses the same fields.
   Identities are self-declared; this local application does not authenticate contributors.
3. Read the principles, expand each criterion, and select its supported anchor.
   Record evidence, its discovery path, rationale and limitations.
   Evidence support and confidence are optional and do not contribute to scores.
4. Add an independent assessment for another reviewer, or create a follow-up from an existing assessment.
   Follow-ups preserve the earlier record and reference it.
   Earlier responses are expandable within each criterion.
5. Use **Add reviews** to combine JSON bundles for exactly the same object, revision, scope and rubric.
   Conflicting assessment IDs are rejected, never silently overwritten.
   **Import JSON** opens a separate workspace.
6. Adjust dimension weights if desired.
   The report includes the exact weights.
   Compare reviewer profiles with spider-plot overlays.
   Reviewers are not automatically averaged.
   Mark individual criteria for improvement if useful.
7. Record rubric feedback and applicability objections on criteria, plus an overall comment.
   Export the JSON bundle and standalone HTML report.

Draft edits are saved locally as you type.
Blank locator/evidence fields can be retained in a local draft; exporting a report requires valid record fields.
Storage failures are displayed.
Opening a new bundle retains one previous local backup, but browser storage is not a durable archive.
Export files regularly.

## Scoring

Each criterion contributes `score / maximum_anchor` to its dimension.
A dimension is the mean across all its criteria, multiplied by 100.
Binary and 0–3 criteria therefore have equal maximum contribution.
The total is the weighted mean of seven dimension scores; dimension weights default to one.

Unanswered criteria remain in the denominator and contribute zero to a clearly provisional total.
They remain distinct from explicit zero ratings.
Comments do not create exclusions.
Evidence quality and confidence never add points.

Scores describe fulfillment under this pilot STAMPED rubric.
They are not certification, general scientific quality, or a validated scale.
Compare the scope, rubric version, completion, weights, evidence and reviewer judgments.

## Sharing and reports

**Share link** compresses the complete bundle with gzip and URL-safe Base64 in `#assessment=v1.…`.
It preserves all reviews, evidence and feedback.
The fragment is not sent with the page request; the link itself still contains readable data for anyone receiving it.
The app uses an 8,000-character sharing budget as a conservative product limit, not a claim about every browser or messaging service.
Longer bundles use JSON export without dropping any content.
Imports are limited to 2 MB, including decompressed links.

The standalone HTML report contains all reviewers, exact weights, normalized scores, responses, evidence, uncertainty and feedback.
JSON is the lossless, re-importable assessment format.
A shared localhost URL only works on the same computer; deploy the static build to use links across computers later.

## Worked example

Choose **Worked example** to load the assessment of [paper-remodnav](https://github.com/psychoinformatics-de/paper-remodnav).
It records source inspection of a specific revision and its discoverable components.
The analysis pipeline and external data payloads were not executed or downloaded.
Consult its evidence and limitations before interpreting scores.
One assessment exercises the workflow; it does not establish reviewer agreement.

## Project layout

- `src/model.js`: scoring, review merging, bounded URL codec and semantic checks.
- `src/app.js`: browser workspace and JSON Schema validation.
- `src/report.js`: standalone, escaped HTML report generation.
- `public/data/`: deliberately synchronized rubric, schemas and example.
- `tests/`: scoring, persistence-format, sharing and validation regressions.

The rubric repository holds the LinkML model, JSON Schemas, assessor protocol, source mapping and reference Python validator.
Source STAMPED material is attributed there; the app bundles that same material under CC-BY-4.0.
Rubric construction used the Scholar Evaluation skill's anchor and evidence guidance, as documented and cited in the schema repository's `docs/rubric-method.md`.

Documentation is formatted with the pinned Snapper pre-commit hook:

```sh
uvx pre-commit install
uvx pre-commit run --all-files
```

Licensed under CC-BY-4.0; see `LICENSES/CC-BY-4.0.txt` and `REUSE.toml`.
