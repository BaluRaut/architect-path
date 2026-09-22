import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const modulesDir = join(here, "..", "modules");
const folders = existsSync(modulesDir)
  ? readdirSync(modulesDir).filter((f) => /^\d\d-/.test(f)).sort()
  : [];
const args = process.argv.slice(2);
const wanted = args.find((a) => !a.startsWith("--"));
const which = args.includes("--solution") ? "solution" : "exercise";

/** Modules that are planned but not written yet still appear, marked. */
const PLANNED: Record<string, string> = {
  "01-system-design": "design exercise, rubric-graded",
  "02-typescript": "type contracts and the validation boundary",
  "03-node-internals": "event loop, streams, backpressure",
  "07-vector-tiles": "tile pipeline and large data delivery",
  "08-aws-architecture": "reference architecture in Terraform",
  "09-kubernetes": "the subset that matters",
  "10-mcp-server": "building one, not governing one",
  "11-geoai": "language to tool to PostGIS to map",
  "12-observability": "traces and the testing pyramid",
};

function label(folder: string): string {
  return folder.replace(/^(\d\d)-/, "$1  ").replace(/-/g, " ");
}

if (args.includes("--list") || !wanted) {
  console.log("\nModules\n───────");
  const built = new Set(folders);
  const all = [...new Set([...folders, ...Object.keys(PLANNED)])].sort();
  for (const f of all) {
    if (built.has(f)) {
      const db = existsSync(join(modulesDir, f, "NEEDS_DB"));
      console.log(`  ${label(f).padEnd(30)} ready${db ? "   [needs the database]" : ""}`);
    } else {
      console.log(`  ${label(f).padEnd(30)} planned  ${PLANNED[f] ?? ""}`);
    }
  }
  console.log("\nRun one:         npm run m -- 05");
  console.log("Run a solution:  npm run m -- 05 --solution");
  console.log("Start the db:    npm run db:up && npm run seed");
  process.exit(0);
}

const folder = folders.find((f) => f === wanted || f.startsWith(String(wanted).padStart(2, "0") + "-"));
if (!folder) {
  const planned = Object.keys(PLANNED).find((f) => f.startsWith(String(wanted).padStart(2, "0") + "-"));
  if (planned) {
    console.error(`Module ${wanted} is planned but not written yet: ${PLANNED[planned]}`);
    console.error("Run `npm run list` to see what is ready.");
    process.exit(1);
  }
  console.error(`No module matches "${wanted}". Try: npm run list`);
  process.exit(1);
}

const file = join(modulesDir, folder, `${which}.ts`);
if (!existsSync(file)) {
  console.error(`Missing ${file}`);
  process.exit(1);
}

console.log(`▶ ${folder}/${which}.ts`);
await import(pathToFileURL(file).href);
