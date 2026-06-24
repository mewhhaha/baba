import type { GeneratedBundle, GeneratedFile } from "./ast.ts";
import { BabaError } from "./errors.ts";

interface OutputManifest {
  generator: string;
  manifestVersion: 1;
  files: Record<
    string,
    {
      hash: string;
      ownership: "generated";
      encoding?: "utf-8" | "binary";
      kind?: GeneratedFile["kind"];
    }
  >;
}

/** Applies a generated bundle to a directory using baba ownership manifests. */
export async function applyBundle(
  bundle: GeneratedBundle,
  options: { root: string },
): Promise<void> {
  await writeGeneratedFiles(
    options.root,
    bundle.files,
    bundle.cleanupPaths ?? [],
  );
}

async function writeGeneratedFiles(
  rootDir: string,
  files: GeneratedFile[],
  cleanupPaths: string[],
): Promise<void> {
  await Deno.mkdir(rootDir, { recursive: true });
  const previous = await readManifest(rootDir);
  for (const file of files) validateBundlePath(file.path);
  for (const cleanupPath of cleanupPaths) validateBundlePath(cleanupPath);
  for (const previousPath of Object.keys(previous?.files ?? {})) {
    validateBundlePath(previousPath);
  }
  assertNoBundlePathCollisions(files.map((file) => file.path));
  const nextPaths = new Set(files.map((file) => file.path));
  const stalePaths = previous
    ? Object.keys(previous.files).filter((path) => !nextPaths.has(path))
    : [];
  const removePaths = [...new Set([...cleanupPaths, ...stalePaths])];

  for (const file of files) {
    await assertCanOverwrite(`${rootDir}/${file.path}`, file.path, previous);
  }
  for (const cleanupPath of removePaths) {
    await assertCanRemove(`${rootDir}/${cleanupPath}`, cleanupPath, previous);
  }

  const stagedWrites: Array<{ finalPath: string; tempPath: string }> = [];
  let manifestTempPath: string | null = null;
  try {
    for (const file of files) {
      const path = `${rootDir}/${file.path}`;
      const parent = parentDir(path);
      if (parent) await Deno.mkdir(parent, { recursive: true });
      const tempPath = temporarySiblingPath(path);
      await Deno.writeFile(tempPath, generatedFileBytes(file));
      stagedWrites.push({ finalPath: path, tempPath });
    }

    const manifestFiles: OutputManifest["files"] = {};
    for (const file of files) {
      manifestFiles[file.path] = {
        hash: await hashBytes(generatedFileBytes(file)),
        ownership: "generated",
        encoding: file.encoding,
        kind: file.kind,
      };
    }
    const manifest: OutputManifest = {
      generator: "@mewhhaha/baba",
      manifestVersion: 1,
      files: manifestFiles,
    };
    manifestTempPath = temporarySiblingPath(manifestPath(rootDir));
    await Deno.writeTextFile(
      manifestTempPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    for (const staged of stagedWrites) {
      await Deno.rename(staged.tempPath, staged.finalPath);
    }
    for (const cleanupPath of removePaths) {
      await removeIfExists(`${rootDir}/${cleanupPath}`);
    }
    await Deno.rename(manifestTempPath, manifestPath(rootDir));
    manifestTempPath = null;
  } catch (error) {
    for (const staged of stagedWrites) {
      await removeIfExists(staged.tempPath);
    }
    if (manifestTempPath) await removeIfExists(manifestTempPath);
    throw error;
  }
}

function validateBundlePath(path: string): void {
  if (
    path.length === 0 ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path)
  ) {
    throwInvalidBundlePath(path);
  }
  for (const component of path.split("/")) {
    if (component === "" || component === "." || component === "..") {
      throwInvalidBundlePath(path);
    }
  }
}

function throwInvalidBundlePath(path: string): never {
  throw new BabaError({
    code: "OUTPUT_INVALID_PATH",
    message: `Refusing unsafe generated path '${path}'.`,
  });
}

function assertNoBundlePathCollisions(paths: readonly string[]): void {
  const seen = new Set(paths);
  for (const path of seen) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) {
      const ancestor = parts.slice(0, index).join("/");
      if (seen.has(ancestor)) {
        throw new BabaError({
          code: "OUTPUT_PATH_COLLISION",
          message:
            `Generated output path '${ancestor}' collides with nested path '${path}'.`,
        });
      }
    }
  }
}

async function assertCanOverwrite(
  path: string,
  relativePath: string,
  manifest: OutputManifest | null,
): Promise<void> {
  let current: Uint8Array;
  try {
    current = await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }

  const manifestEntry = manifest?.files[relativePath];
  if (!manifestEntry) {
    throwOverwriteRefused("overwrite", relativePath);
  }
  const currentHash = await hashBytes(current);
  if (manifestEntry.hash === currentHash) return;
  throwOverwriteRefused("overwrite", relativePath);
}

async function assertCanRemove(
  path: string,
  relativePath: string,
  manifest: OutputManifest | null,
): Promise<void> {
  let current: Uint8Array;
  try {
    current = await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }

  const manifestEntry = manifest?.files[relativePath];
  if (!manifestEntry) throwOverwriteRefused("remove", relativePath);
  const currentHash = await hashBytes(current);
  if (manifestEntry.hash === currentHash) return;
  throwOverwriteRefused("remove", relativePath);
}

function throwOverwriteRefused(
  action: "overwrite" | "remove",
  path: string,
): never {
  throw new BabaError({
    code: "OUTPUT_REFUSED",
    message:
      `Refusing to ${action} modified or unowned file '${path}'. Move it aside or delete it before regenerating.`,
  });
}

async function readManifest(rootDir: string): Promise<OutputManifest | null> {
  try {
    const parsed = JSON.parse(await Deno.readTextFile(manifestPath(rootDir)));
    if (
      parsed?.generator !== "@mewhhaha/baba" ||
      parsed?.manifestVersion !== 1 ||
      typeof parsed?.files !== "object" ||
      parsed.files === null
    ) {
      return null;
    }
    return parsed as OutputManifest;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

function manifestPath(rootDir: string): string {
  return `${rootDir}/.baba-manifest.json`;
}

function generatedFileBytes(file: GeneratedFile): Uint8Array {
  return file.encoding === "binary"
    ? file.content
    : new TextEncoder().encode(file.content);
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    copy.buffer as ArrayBuffer,
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parentDir(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  if (slash === -1) return null;
  return normalized.slice(0, slash) || ".";
}

function temporarySiblingPath(path: string): string {
  return `${path}.tmp-${crypto.randomUUID()}`;
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}
