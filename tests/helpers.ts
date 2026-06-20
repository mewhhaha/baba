import { applyBundle, generate } from "../src/mod.ts";

export {
  applyBundle,
  BabaError,
  compile,
  formatDiagnostic,
  generate,
  parseGrammar,
  parseMetadata,
  validateGrammar,
} from "../src/mod.ts";
export {
  collectReachabilityDiagnostics,
  generateTreeSitterGrammar,
  generateTreeSitterHighlightsQuery,
  generateTreeSitterQueries,
  parseEbnf,
  parseTreeSitterMetadata,
} from "../src/advanced.ts";
export { main } from "../src/cli.ts";

export function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

export function assertEquals<T>(
  actual: T,
  expected: T,
  message?: string,
): void {
  if (actual !== expected) {
    throw new Error(
      message ??
        `Expected ${JSON.stringify(actual)} to equal ${
          JSON.stringify(expected)
        }`,
    );
  }
}

export function assertIncludes(actual: string, expected: string): void {
  assert(
    actual.includes(expected),
    `Expected ${JSON.stringify(actual)} to include ${expected}`,
  );
}

export function assertNotIncludes(actual: string, expected: string): void {
  assert(
    !actual.includes(expected),
    `Expected ${JSON.stringify(actual)} not to include ${expected}`,
  );
}

export function assertThrowsIncludes(
  action: () => unknown,
  expected: string,
): void {
  let message = "";
  try {
    action();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertIncludes(message, expected);
}

export async function assertRejectsIncludes(
  action: () => Promise<unknown>,
  expected: string,
): Promise<void> {
  let message = "";
  try {
    await action();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertIncludes(message, expected);
}

export async function captureConsoleLog(
  action: () => Promise<void>,
): Promise<string[]> {
  const original = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    await action();
  } finally {
    console.log = original;
  }
  return logs;
}

export async function captureConsoleError(
  action: () => Promise<void>,
): Promise<string[]> {
  const original = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    await action();
  } finally {
    console.error = original;
  }
  return logs;
}

export async function assertMissing(path: string): Promise<void> {
  try {
    await Deno.stat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  throw new Error(`Expected ${path} to be missing`);
}

export async function denoCheck(path: string): Promise<void> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["check", path],
  });
  const output = await command.output();
  if (!output.success) {
    const decoder = new TextDecoder();
    throw new Error(
      `${decoder.decode(output.stdout)}${decoder.decode(output.stderr)}`,
    );
  }
}

export async function runCommand(
  commandName: string,
  args: string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
  const command = new Deno.Command(commandName, { args, cwd, env });
  const output = await command.output();
  const decoder = new TextDecoder();
  const stdout = decoder.decode(output.stdout);
  const stderr = decoder.decode(output.stderr);
  if (!output.success) {
    throw new Error(`${stdout}${stderr}`);
  }
  return { stdout, stderr };
}

export async function treeSitterAccepts(
  source: string,
  sample: string,
  name = "tiny",
): Promise<boolean> {
  const dir = await Deno.makeTempDir();
  try {
    const bundle = generate(source, { name });
    await applyBundle(bundle, { root: dir });
    const samplePath = `${dir}/sample.${name}`;
    await Deno.writeTextFile(samplePath, sample);
    const env = {
      HOME: `${dir}/home`,
      XDG_CACHE_HOME: `${dir}/cache`,
    };
    await runCommand("tree-sitter", ["generate"], dir, env);
    await runCommand(
      "tree-sitter",
      ["build", "-o", `${dir}/parser.so`],
      dir,
      env,
    );
    const parseCommand = new Deno.Command("tree-sitter", {
      args: [
        "parse",
        "--lib-path",
        `${dir}/parser.so`,
        "--lang-name",
        name,
        samplePath,
      ],
      cwd: dir,
      env,
    });
    const output = await parseCommand.output();
    const decoder = new TextDecoder();
    const stdout = decoder.decode(output.stdout);
    const stderr = decoder.decode(output.stderr);
    if (!output.success) return false;
    return !stdout.includes("ERROR") &&
      !stdout.includes("MISSING") &&
      !stderr.includes("ERROR") &&
      !stderr.includes("MISSING");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

export async function fixtureSamples(
  fixture: string,
  kind: "valid" | "invalid",
): Promise<string[]> {
  const dir = `fixtures/${fixture}/${kind}`;
  const samples: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile) continue;
    samples.push(await Deno.readTextFile(`${dir}/${entry.name}`));
  }
  return samples;
}

export const explicitGrammar = `
  token ident = /[A-Za-z_][A-Za-z0-9_]*/ ;
  token integer = /[0-9]+/ ;
  skip whitespace = /[ \\t\\r\\n]+/ ;

  module = "fn" name:ident "(" ")" body:block ;
  block = "{" value:integer "}" ;
`;
