import { applyBundle, generate } from "../src/mod.ts";

const grammar = `
  token IDENT = /[A-Za-z_][A-Za-z0-9_]*/ ;
  token INTEGER = /[0-9]+/ ;
  skip WS = /[ \\t\\r\\n]+/ ;

  module = "let" name:IDENT "=" value:INTEGER ";" ;
`;

const runtimes = Deno.args.length ? Deno.args : ["deno"];
const root = await Deno.makeTempDir();
try {
  await applyBundle(generate(grammar, { targets: ["typescript", "wasm"] }), {
    root,
  });
  await Deno.writeTextFile(
    `${root}/deno.json`,
    JSON.stringify(
      {
        imports: {
          "@mewhhaha/baba/runtime":
            new URL("../src/runtime/mod.ts", import.meta.url)
              .href,
        },
      },
      null,
      2,
    ),
  );
  for (const runtime of runtimes) {
    if (runtime === "deno") {
      await writeRunner(
        `${root}/deno_smoke.ts`,
        "./typescript/mod.ts",
        "./wasm/mod.ts",
      );
      await run("deno", ["run", "--allow-read", `${root}/deno_smoke.ts`], root);
    } else if (runtime === "bun") {
      await writeRunner(
        `${root}/bun_smoke.ts`,
        "./typescript/mod.ts",
        "./wasm/mod.ts",
      );
      await run("bun", ["run", `${root}/bun_smoke.ts`], root);
    } else if (runtime === "node") {
      await Deno.writeTextFile(
        `${root}/tsconfig.node.json`,
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              strict: true,
              rootDir: ".",
              outDir: "node",
              rewriteRelativeImportExtensions: true,
            },
            include: ["typescript/**/*.ts", "wasm/**/*.ts"],
          },
          null,
          2,
        ),
      );
      await run(
        "npx",
        [
          "--yes",
          "--package",
          "typescript@5.9.3",
          "tsc",
          "-p",
          `${root}/tsconfig.node.json`,
        ],
        root,
      );
      await writeRunner(
        `${root}/node_smoke.mjs`,
        "./node/typescript/mod.js",
        "./node/wasm/mod.js",
      );
      await run("node", [`${root}/node_smoke.mjs`], root);
    } else {
      throw new Error(`Unknown runtime '${runtime}'`);
    }
  }
} finally {
  await Deno.remove(root, { recursive: true });
}

async function writeRunner(
  path: string,
  typeScriptSpecifier: string,
  wasmSpecifier: string,
): Promise<void> {
  await Deno.writeTextFile(
    path,
    `import { lex as lexTypeScript, parse as parseTypeScript } from ${
      JSON.stringify(typeScriptSpecifier)
    };
import { lex as lexWasm, parse as parseWasm } from ${
      JSON.stringify(wasmSpecifier)
    };

const source = "let value = 42;";
for (const [name, lex, parse] of [
  ["typescript", lexTypeScript, parseTypeScript],
  ["wasm", lexWasm, parseWasm],
]) {
  const lexed = lex(source);
  if (lexed.diagnostics.length !== 0) {
    throw new Error(name + " lex failed");
  }
  const parsed = parse(source);
  if (!parsed.ok) {
    throw new Error(name + " parse failed");
  }
  if (parsed.root.fields.name.text !== "value") {
    throw new Error(name + " unexpected name field");
  }
}
`,
  );
}

async function run(
  commandName: string,
  args: readonly string[],
  cwd: string,
): Promise<void> {
  const command = new Deno.Command(commandName, {
    args: [...args],
    cwd,
    env: commandName === "npx" ? { NPM_CONFIG_CACHE: `${cwd}/.npm-cache` } : {},
  });
  const output = await command.output();
  if (output.success) return;
  const decoder = new TextDecoder();
  throw new Error(
    `${commandName} ${args.join(" ")} failed\n${decoder.decode(output.stdout)}${
      decoder.decode(output.stderr)
    }`,
  );
}
