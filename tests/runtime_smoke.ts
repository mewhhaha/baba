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
  await applyBundle(generate(grammar, { targets: ["typescript"] }), { root });
  for (const runtime of runtimes) {
    if (runtime === "deno") {
      await writeRunner(`${root}/deno_smoke.ts`, "./typescript/mod.ts");
      await run("deno", ["run", "--allow-read", `${root}/deno_smoke.ts`], root);
    } else if (runtime === "bun") {
      await writeRunner(`${root}/bun_smoke.ts`, "./typescript/mod.ts");
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
              rootDir: "typescript",
              outDir: "node",
              rewriteRelativeImportExtensions: true,
            },
            include: ["typescript/**/*.ts"],
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
      await writeRunner(`${root}/node_smoke.mjs`, "./node/mod.js");
      await run("node", [`${root}/node_smoke.mjs`], root);
    } else {
      throw new Error(`Unknown runtime '${runtime}'`);
    }
  }
} finally {
  await Deno.remove(root, { recursive: true });
}

async function writeRunner(path: string, specifier: string): Promise<void> {
  await Deno.writeTextFile(
    path,
    `import { lex, parse } from ${JSON.stringify(specifier)};

const source = "let value = 42;";
const lexed = lex(source);
if (lexed.diagnostics.length !== 0) {
  throw new Error("lex failed");
}
const parsed = parse(source);
if (!parsed.ok) {
  throw new Error("parse failed");
}
if (parsed.root.fields.name.text !== "value") {
  throw new Error("unexpected name field");
}
`,
  );
}

async function run(
  commandName: string,
  args: readonly string[],
  cwd: string,
): Promise<void> {
  const command = new Deno.Command(commandName, { args: [...args], cwd });
  const output = await command.output();
  if (output.success) return;
  const decoder = new TextDecoder();
  throw new Error(
    `${commandName} ${args.join(" ")} failed\n${decoder.decode(output.stdout)}${
      decoder.decode(output.stderr)
    }`,
  );
}
