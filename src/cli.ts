import {
  generateLexicalManifest,
  generateTokenizerSource,
  generateTreeSitterGrammar,
  generateTreeSitterInjectionsQuery,
  generateTreeSitterRainbowsQuery,
  parseTreeSitterMetadata,
} from "./generate.ts";
import { EbnfError, formatEbnfError, parseEbnf } from "./parser.ts";

interface Options {
  input?: string;
  outDir?: string;
  treeSitterMeta?: string;
  treeSitterOut?: string;
  name: string;
  help: boolean;
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    if (error instanceof EbnfError) {
      console.error(formatEbnfError(error));
      Deno.exit(1);
    }
    throw error;
  }
}

export async function main(args: string[]): Promise<void> {
  const options = parseArgs(args);
  if (options.help) {
    console.log(helpText());
    return;
  }
  if (!options.input) {
    throw new Error("Missing grammar input. Run with --help for usage.");
  }

  const source = await Deno.readTextFile(options.input);
  const grammar = parseEbnf(source);
  const manifest = generateLexicalManifest(grammar);
  const tokenizer = generateTokenizerSource(grammar);
  const metadata = options.treeSitterMeta
    ? parseTreeSitterMetadata(await Deno.readTextFile(options.treeSitterMeta))
    : undefined;
  const treeSitter = generateTreeSitterGrammar(grammar, {
    name: options.name,
    metadata,
  });
  const rainbows = generateTreeSitterRainbowsQuery(grammar, { metadata });
  const injections = generateTreeSitterInjectionsQuery(grammar, { metadata });

  if (!options.outDir) {
    console.log(manifest.trimEnd());
  }

  if (options.outDir) {
    await Deno.mkdir(options.outDir, { recursive: true });
    await Deno.writeTextFile(`${options.outDir}/lexical.json`, manifest);
    await Deno.writeTextFile(`${options.outDir}/tokenizer.ts`, tokenizer);
    await Deno.writeTextFile(`${options.outDir}/grammar.js`, treeSitter);
    await writeOptionalTextFile(`${options.outDir}/rainbows.scm`, rainbows);
    await writeOptionalTextFile(`${options.outDir}/injections.scm`, injections);
  }

  if (options.treeSitterOut) {
    await writeTreeSitterOutput(
      options.treeSitterOut,
      treeSitter,
      rainbows,
      injections,
    );
  }
}

function parseArgs(args: string[]): Options {
  const options: Options = { name: "grammar", help: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "-h":
      case "--help":
        options.help = true;
        break;
      case "--out": {
        const outDir = args[++i];
        if (!outDir) throw new Error("Expected directory after --out");
        options.outDir = outDir;
        break;
      }
      case "--name": {
        const name = args[++i];
        if (!name) throw new Error("Expected language name after --name");
        options.name = name;
        break;
      }
      case "--ts-meta": {
        const treeSitterMeta = args[++i];
        if (!treeSitterMeta) {
          throw new Error("Expected metadata path after --ts-meta");
        }
        options.treeSitterMeta = treeSitterMeta;
        break;
      }
      case "--ts-out": {
        const treeSitterOut = args[++i];
        if (!treeSitterOut) throw new Error("Expected path after --ts-out");
        options.treeSitterOut = treeSitterOut;
        break;
      }
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option '${arg}'`);
        if (options.input) throw new Error(`Unexpected extra input '${arg}'`);
        options.input = arg;
    }
  }

  return options;
}

function helpText(): string {
  return `baba - generate language scaffolding from EBNF

Usage:
  deno run --allow-read --allow-write src/cli.ts <grammar.ebnf> --out generated

Outputs:
  lexical.json   Keyword and symbol manifest
  tokenizer.ts   Standalone generated TypeScript tokenizer
  grammar.js     Generated tree-sitter grammar
  rainbows.scm   Generated tree-sitter rainbow-bracket query when metadata enables it
  injections.scm Generated tree-sitter injection query when metadata enables it

Options:
  --ts-meta      JSON metadata for tree-sitter-specific conflicts, precedence, fields, aliases, node shaping, and queries
  --ts-out       Additional output path for the production tree-sitter grammar`;
}

function parentDir(path: string): string | null {
  const normalized = path.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  if (slash === -1) return null;
  return normalized.slice(0, slash) || ".";
}

async function writeTreeSitterOutput(
  treeSitterOut: string,
  grammar: string,
  rainbows: string,
  injections: string,
): Promise<void> {
  const parent = parentDir(treeSitterOut);
  if (parent) await Deno.mkdir(parent, { recursive: true });
  await Deno.writeTextFile(treeSitterOut, grammar);
  if (!parent) return;

  const queryDir = `${parent}/queries`;
  if (rainbows || injections) await Deno.mkdir(queryDir, { recursive: true });
  await writeOptionalTextFile(`${queryDir}/rainbows.scm`, rainbows);
  await writeOptionalTextFile(`${queryDir}/injections.scm`, injections);
}

async function writeOptionalTextFile(
  path: string,
  content: string,
): Promise<void> {
  if (content) {
    await Deno.writeTextFile(path, content);
    return;
  }
  await removeIfExists(path);
}

async function removeIfExists(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
}
