interface FileEntry {
  readonly path: string;
  readonly size: number;
}

interface SizeReport {
  readonly generatedAt: string;
  readonly root: string;
  readonly generatedWasmLoaderSourceBytes: number;
  readonly repository: {
    readonly fileCount: number;
    readonly bytes: number;
    readonly topLevel: readonly SizeBucket[];
    readonly largestFiles: readonly FileEntry[];
  };
  readonly publishPayload: {
    readonly includePatterns: readonly string[];
    readonly fileCount: number;
    readonly bytes: number;
    readonly generatedExampleBytes: number;
    readonly largestFiles: readonly FileEntry[];
  };
  readonly examples: {
    readonly generatedBytes: number;
    readonly generatedBytesByExample: readonly SizeBucket[];
    readonly generatedBytesByExtension: readonly SizeBucket[];
    readonly largestGeneratedFiles: readonly FileEntry[];
    readonly duplicateGeneratedBytes: number;
    readonly duplicateGeneratedGroups: readonly DuplicateGroup[];
    readonly wasmRepresentations: readonly WasmRepresentation[];
  };
  readonly budget?: SizeBudgetResult;
}

interface SizeBucket {
  readonly name: string;
  readonly bytes: number;
  readonly fileCount: number;
}

interface DuplicateGroup {
  readonly hash: string;
  readonly bytes: number;
  readonly paths: readonly string[];
}

interface WasmRepresentation {
  readonly example: string;
  readonly wasmBinaryBytes: number;
  readonly embeddedTextBytes: number;
  readonly ratioMilli: number | null;
}

interface CliOptions {
  readonly root: string;
  readonly jsonPath?: string;
  readonly jsonStdout: boolean;
  readonly budgetPath?: string;
}

interface SizeBudgets {
  readonly publishPayloadBytes?: number;
  readonly publishGeneratedExampleBytes?: number;
  readonly largestPublishFileBytes?: number;
  readonly generatedWasmLoaderSourceBytes?: number;
}

interface SizeBudgetResult {
  readonly path: string;
  readonly ok: boolean;
  readonly checks: readonly SizeBudgetCheck[];
}

interface SizeBudgetCheck {
  readonly name: string;
  readonly actual: number;
  readonly limit: number;
  readonly ok: boolean;
}

const DEFAULT_EXCLUDES = new Set([".git"]);

export async function buildSizeReport(root = "."): Promise<SizeReport> {
  const normalizedRoot = stripTrailingSlash(root);
  const allFiles = await listFiles(normalizedRoot);
  const repositoryFiles = await excludeIgnoredRepositoryFiles(
    normalizedRoot,
    allFiles,
  );
  const denoConfig = JSON.parse(
    await Deno.readTextFile(joinPath(normalizedRoot, "deno.json")),
  ) as { publish?: { include?: string[] } };
  const includePatterns = denoConfig.publish?.include ?? [];
  const publishFiles = allFiles.filter((file) =>
    includePatterns.some((pattern) => matchesGlob(file.path, pattern))
  );
  const generatedFiles = allFiles.filter((file) =>
    file.path.startsWith("examples/") && file.path.includes("/generated/")
  );
  const generatedWasmLoader = allFiles.find((file) =>
    file.path === "src/runtime/generated_wasm.ts"
  );
  if (generatedWasmLoader === undefined) {
    throw new Error(
      "Size report could not find src/runtime/generated_wasm.ts.",
    );
  }
  const generatedWasmLoaderSourceBytes = generatedWasmLoader.size;

  return {
    generatedAt: new Date().toISOString(),
    root: normalizedRoot,
    generatedWasmLoaderSourceBytes,
    repository: {
      fileCount: repositoryFiles.length,
      bytes: sumBytes(repositoryFiles),
      topLevel: buckets(
        repositoryFiles,
        (path) => path.split("/")[0] || ".",
      ),
      largestFiles: largest(repositoryFiles, 20),
    },
    publishPayload: {
      includePatterns,
      fileCount: publishFiles.length,
      bytes: sumBytes(publishFiles),
      generatedExampleBytes: sumBytes(
        publishFiles.filter((file) =>
          file.path.startsWith("examples/") && file.path.includes("/generated/")
        ),
      ),
      largestFiles: largest(publishFiles, 20),
    },
    examples: {
      generatedBytes: sumBytes(generatedFiles),
      generatedBytesByExample: buckets(
        generatedFiles,
        (path) => path.split("/")[1] ?? "unknown",
      ),
      generatedBytesByExtension: buckets(
        generatedFiles,
        (path) => extensionName(path),
      ),
      duplicateGeneratedBytes: await duplicateBytes(
        generatedFiles,
        normalizedRoot,
      ),
      duplicateGeneratedGroups: await duplicateGroups(
        generatedFiles,
        normalizedRoot,
      ),
      largestGeneratedFiles: largest(generatedFiles, 20),
      wasmRepresentations: await wasmRepresentations(allFiles, normalizedRoot),
    },
  };
}

async function excludeIgnoredRepositoryFiles(
  root: string,
  files: readonly FileEntry[],
): Promise<FileEntry[]> {
  const ignorePath = joinPath(root, ".gitignore");
  const source = await Deno.readTextFile(ignorePath);
  const patterns: string[] = [];
  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("!")) {
      throw new Error(
        `Size report cannot interpret negated gitignore pattern '${line}' in ${ignorePath}.`,
      );
    }
    let pattern = line;
    if (pattern.startsWith("/")) {
      pattern = pattern.slice(1);
    }
    if (pattern.endsWith("/")) {
      pattern = `${pattern}**`;
    }
    patterns.push(pattern);
  }
  return files.filter((file) =>
    !patterns.some((pattern) => matchesGlob(file.path, pattern))
  );
}

export async function applySizeBudgets(
  report: SizeReport,
  budgetPath: string,
): Promise<SizeReport> {
  const budgets = JSON.parse(
    await Deno.readTextFile(budgetPath),
  ) as SizeBudgets;
  const checks = budgetChecks(report, budgets);
  return {
    ...report,
    budget: {
      path: budgetPath,
      checks,
      ok: checks.every((check) => check.ok),
    },
  };
}

function budgetChecks(
  report: SizeReport,
  budgets: SizeBudgets,
): SizeBudgetCheck[] {
  const checks: SizeBudgetCheck[] = [];
  addBudgetCheck(
    checks,
    "publishPayloadBytes",
    report.publishPayload.bytes,
    budgets.publishPayloadBytes,
  );
  addBudgetCheck(
    checks,
    "publishGeneratedExampleBytes",
    report.publishPayload.generatedExampleBytes,
    budgets.publishGeneratedExampleBytes,
  );
  addBudgetCheck(
    checks,
    "largestPublishFileBytes",
    report.publishPayload.largestFiles[0]?.size ?? 0,
    budgets.largestPublishFileBytes,
  );
  addBudgetCheck(
    checks,
    "generatedWasmLoaderSourceBytes",
    report.generatedWasmLoaderSourceBytes,
    budgets.generatedWasmLoaderSourceBytes,
  );
  return checks;
}

function addBudgetCheck(
  checks: SizeBudgetCheck[],
  name: string,
  actual: number,
  limit: number | undefined,
): void {
  if (limit === undefined) return;
  checks.push({ name, actual, limit, ok: actual <= limit });
}

function renderHumanReport(report: SizeReport): string {
  const lines = [
    "Baba size report",
    `Root: ${report.root}`,
    `Repository: ${
      formatBytes(report.repository.bytes)
    } across ${report.repository.fileCount} files`,
    `Publish include payload: ${
      formatBytes(report.publishPayload.bytes)
    } across ${report.publishPayload.fileCount} files`,
    `Generated example bytes in publish payload: ${
      formatBytes(report.publishPayload.generatedExampleBytes)
    }`,
    `Generated Wasm loader source: ${
      formatBytes(report.generatedWasmLoaderSourceBytes)
    }`,
    "",
    "Top-level repository bytes:",
    ...report.repository.topLevel.map((bucket) =>
      `  ${bucket.name}: ${
        formatBytes(bucket.bytes)
      } (${bucket.fileCount} files)`
    ),
    "",
    "Generated example bytes by example:",
    ...report.examples.generatedBytesByExample.map((bucket) =>
      `  ${bucket.name}: ${
        formatBytes(bucket.bytes)
      } (${bucket.fileCount} files)`
    ),
    "",
    "Generated example bytes by extension:",
    ...report.examples.generatedBytesByExtension.map((bucket) =>
      `  ${bucket.name}: ${
        formatBytes(bucket.bytes)
      } (${bucket.fileCount} files)`
    ),
    "",
    `Duplicate generated bytes: ${
      formatBytes(report.examples.duplicateGeneratedBytes)
    }`,
    `Local generated example bytes: ${
      formatBytes(report.examples.generatedBytes)
    }`,
    "",
    "Largest publish payload files:",
    ...report.publishPayload.largestFiles.map((file) =>
      `  ${formatBytes(file.size)}  ${file.path}`
    ),
  ];
  if (report.examples.wasmRepresentations.length > 0) {
    lines.push("", "Wasm binary versus embedded text:");
    for (const entry of report.examples.wasmRepresentations) {
      lines.push(
        `  ${entry.example}: ${formatBytes(entry.wasmBinaryBytes)} .wasm, ${
          formatBytes(entry.embeddedTextBytes)
        } embedded text, ratio ${
          entry.ratioMilli === null
            ? "n/a"
            : (entry.ratioMilli / 1000).toFixed(2)
        }`,
      );
    }
  }
  if (report.budget) {
    lines.push("", `Size budgets: ${report.budget.ok ? "ok" : "failed"}`);
    for (const check of report.budget.checks) {
      lines.push(
        `  ${check.ok ? "ok" : "FAIL"} ${check.name}: ${
          formatBytes(check.actual)
        } <= ${formatBytes(check.limit)}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

async function listFiles(root: string): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
  async function visit(relativeDir: string): Promise<void> {
    const absoluteDir = relativeDir === "" ? root : joinPath(root, relativeDir);
    for await (const entry of Deno.readDir(absoluteDir)) {
      if (DEFAULT_EXCLUDES.has(entry.name)) continue;
      const relativePath = relativeDir === ""
        ? entry.name
        : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory) {
        await visit(relativePath);
      } else if (entry.isFile) {
        const stat = await Deno.stat(joinPath(root, relativePath));
        files.push({ path: relativePath, size: stat.size });
      }
    }
  }
  await visit("");
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function buckets(
  files: readonly FileEntry[],
  nameForPath: (path: string) => string,
): SizeBucket[] {
  const values = new Map<string, { bytes: number; fileCount: number }>();
  for (const file of files) {
    const name = nameForPath(file.path);
    const current = values.get(name) ?? { bytes: 0, fileCount: 0 };
    current.bytes += file.size;
    current.fileCount += 1;
    values.set(name, current);
  }
  return [...values.entries()].map(([name, value]) => ({
    name,
    ...value,
  })).sort((left, right) =>
    right.bytes - left.bytes || left.name.localeCompare(right.name)
  );
}

function largest(files: readonly FileEntry[], count: number): FileEntry[] {
  return [...files].sort((left, right) =>
    right.size - left.size || left.path.localeCompare(right.path)
  ).slice(0, count);
}

async function duplicateBytes(
  files: readonly FileEntry[],
  root: string,
): Promise<number> {
  return (await duplicateGroups(files, root)).reduce(
    (sum, group) => sum + group.bytes,
    0,
  );
}

async function duplicateGroups(
  files: readonly FileEntry[],
  root: string,
): Promise<DuplicateGroup[]> {
  const byHash = new Map<string, FileEntry[]>();
  for (const file of files) {
    const hash = await fileHash(joinPath(root, file.path));
    byHash.set(hash, [...(byHash.get(hash) ?? []), file]);
  }
  const groups: DuplicateGroup[] = [];
  for (const [hash, group] of byHash) {
    if (group.length < 2) continue;
    const firstSize = group[0].size;
    groups.push({
      hash,
      bytes: firstSize * (group.length - 1),
      paths: group.map((file) => file.path),
    });
  }
  return groups.sort((left, right) =>
    right.bytes - left.bytes || left.hash.localeCompare(right.hash)
  );
}

async function wasmRepresentations(
  files: readonly FileEntry[],
  root: string,
): Promise<WasmRepresentation[]> {
  const byExample = new Map<string, { wasm: number; embedded: number }>();
  for (const file of files) {
    if (!file.path.startsWith("examples/")) continue;
    const example = file.path.split("/")[1] ?? "unknown";
    const current = byExample.get(example) ?? { wasm: 0, embedded: 0 };
    if (file.path.endsWith(".wasm")) current.wasm += file.size;
    if (file.path.endsWith(".ts")) {
      const source = await Deno.readTextFile(joinPath(root, file.path));
      if (source.includes("wasmBytes = new Uint8Array")) {
        current.embedded += file.size;
      }
    }
    byExample.set(example, current);
  }
  return [...byExample.entries()]
    .filter(([, value]) => value.wasm > 0 || value.embedded > 0)
    .map(([example, value]) => ({
      example,
      wasmBinaryBytes: value.wasm,
      embeddedTextBytes: value.embedded,
      ratioMilli: value.wasm === 0
        ? null
        : Math.round(value.embedded * 1000 / value.wasm),
    }))
    .sort((left, right) => left.example.localeCompare(right.example));
}

async function fileHash(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function sumBytes(files: readonly FileEntry[]): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}

function extensionName(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "(none)";
  return name.slice(dot);
}

function matchesGlob(path: string, pattern: string): boolean {
  return globToRegExp(pattern).test(path);
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index++;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

function joinPath(left: string, right: string): string {
  if (left === "." || left === "") return right;
  return `${stripTrailingSlash(left)}/${right}`;
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  for (let index = 0; index < units.length; index++) {
    if (value < 1024 || index === units.length - 1) {
      return `${value.toFixed(1)} ${units[index]}`;
    }
    value /= 1024;
  }
  return `${bytes} B`;
}

function parseArgs(args: readonly string[]): CliOptions {
  let root = ".";
  let jsonPath: string | undefined;
  let jsonStdout = false;
  let budgetPath: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") {
      root = args[++index] ?? root;
    } else if (arg === "--budget") {
      budgetPath = args[++index] ?? budgetPath;
    } else if (arg === "--json") {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        jsonPath = next;
        index++;
      } else {
        jsonStdout = true;
      }
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: deno run --allow-read --allow-write scripts/size_report.ts [--root DIR] [--budget PATH] [--json [PATH]]",
      );
      Deno.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { root, jsonPath, jsonStdout, budgetPath };
}

if (import.meta.main) {
  const options = parseArgs(Deno.args);
  const baseReport = await buildSizeReport(options.root);
  const report = options.budgetPath
    ? await applySizeBudgets(baseReport, options.budgetPath)
    : baseReport;
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.jsonPath) {
    await Deno.writeTextFile(options.jsonPath, json);
  }
  console.log(
    options.jsonStdout ? json.trimEnd() : renderHumanReport(report).trimEnd(),
  );
  if (report.budget && !report.budget.ok) Deno.exit(1);
}
