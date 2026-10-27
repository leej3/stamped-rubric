import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(
  process.argv[2] ?? resolve(root, "../stamped-rubric-schema"),
);
const destination = resolve(root, "public/data");
await mkdir(destination, { recursive: true });
const rubric = await readFile(resolve(source, "rubric.json"));
const digest = createHash("sha256").update(rubric).digest("hex");
await writeFile(resolve(destination, "rubric.json"), rubric);
for (const file of ["rubric.schema.json", "assessment-bundle.schema.json"])
  await writeFile(
    resolve(destination, file),
    await readFile(resolve(source, "schemas", file)),
  );
const example = JSON.parse(
  await readFile(resolve(source, "examples/paper-remodnav.json"), "utf8"),
);
if (example.rubric_sha256 && example.rubric_sha256 !== digest)
  throw new Error(
    "Example refers to a different rubric fingerprint. Reassess before synchronizing.",
  );
example.rubric_sha256 = digest;
await writeFile(
  resolve(destination, "paper-remodnav.json"),
  JSON.stringify(example, null, 2) + "\n",
);
await writeFile(
  resolve(destination, "catalog.json"),
  JSON.stringify(
    {
      rubric_version: JSON.parse(rubric).version,
      rubric_sha256: digest,
      source_directory: "stamped-rubric-schema",
      manuscript: JSON.parse(rubric).source,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Synchronized rubric ${JSON.parse(rubric).version} (${digest}) and worked example.`,
);
