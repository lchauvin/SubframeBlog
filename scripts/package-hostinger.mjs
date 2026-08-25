import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { ZipArchive } from "archiver";

const root = process.cwd();
const outputArg = process.argv.indexOf("--output");
const outputPath = path.resolve(
  outputArg >= 0 && process.argv[outputArg + 1]
    ? process.argv[outputArg + 1]
    : path.join(root, "..", "astroblog-hostinger.zip"),
);

const relativeOutput = path.relative(root, outputPath);
if (relativeOutput === "" || (!relativeOutput.startsWith("..") && !path.isAbsolute(relativeOutput))) {
  throw new Error("The deployment ZIP must be created outside the project directory.");
}

const required = [
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "instrumentation.ts",
  "app",
  "src",
  "scripts",
  "drizzle",
  "catalog/deep-sky.json",
];
await Promise.all(required.map((entry) => fsp.access(path.join(root, entry))));

const excludedRoots = new Set([
  ".git",
  ".cursor",
  ".next",
  ".vscode",
  "coverage",
  "data",
  "design",
  "dist",
  "node_modules",
  "out",
  "screenshots",
]);

function includeEntry(entry) {
  const normalized = entry.name.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts = normalized.split("/");
  if (excludedRoots.has(parts[0])) return false;

  const basename = parts.at(-1) ?? "";
  if (basename === ".env") return false;
  if (basename.startsWith(".env.") && basename !== ".env.example") return false;
  if (basename.endsWith(".zip")) return false;
  if (basename.endsWith(".db") || basename.includes(".db-")) return false;

  // Handover notes and deployment docs. Nothing reads them at runtime, and the
  // copies that matter live in the repository.
  if (basename.endsWith(".md")) return false;

  // Frame drafts produced by the WBPP importer, which are authoring input for
  // the admin rather than anything the server reads. Restricted to the project
  // root, where they are written, so a nested fixture of the same shape would
  // still ship.
  if (parts.length === 1 && /-frame\.json$/i.test(basename)) return false;

  return entry;
}

await fsp.mkdir(path.dirname(outputPath), { recursive: true });
await fsp.rm(outputPath, { force: true });

const output = fs.createWriteStream(outputPath, { flags: "wx" });
const archive = new ZipArchive({ zlib: { level: 9 } });

try {
  await new Promise((resolve, reject) => {
    output.once("close", resolve);
    output.once("error", reject);
    archive.once("error", reject);
    archive.on("warning", (error) => {
      if (error.code !== "ENOENT") reject(error);
    });

    archive.pipe(output);
    archive.directory(root, false, includeEntry);
    void archive.finalize();
  });
} catch (error) {
  output.destroy();
  await fsp.rm(outputPath, { force: true });
  throw error;
}

const stat = await fsp.stat(outputPath);
console.log(`Created ${outputPath}`);
console.log(`${(stat.size / 1024 / 1024).toFixed(1)} MB`);
console.log("Upload this ZIP to Hostinger; package.json is at the archive root.");
