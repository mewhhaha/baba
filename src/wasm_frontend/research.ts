import {
  WASM_ABI_VERSION,
  WASM_HOST_OWNERSHIP_CALLER_MANAGED,
  WASM_LEX_RESULT_I32_COUNT,
  WASM_MAX_PAGES,
  WASM_PAGE_BYTES,
  WASM_RESULT_LIFETIME_CALLER_BUFFER,
  WASM_SOURCE_ENCODING_UTF16,
  WASM_SPAN_UNIT_UTF16,
  WASM_TARGET_KIND,
  WASM_TOKEN_RECORD_I32_COUNT,
} from "../targets/runtime/wasm_abi.ts";

export type WasmFrontendCandidateStatus =
  | "baseline"
  | "candidate"
  | "watch";

export type WasmFrontendAbiFit =
  | "native-baba"
  | "direct-raw-exports"
  | "direct-with-care"
  | "needs-proof";

export type WasmFrontendRuntimeFit =
  | "none"
  | "configurable"
  | "managed-runtime"
  | "host-runtime";

export type WasmFrontendDistribution =
  | "in-package"
  | "package-dependency"
  | "external-toolchain";

export type WasmFrontendPackageFit =
  | "recommended"
  | "acceptable-optional"
  | "too-heavy"
  | "external-only";

export interface WasmFrontendRequirements {
  readonly abiName: "baba-wasm-abi";
  readonly abiVersion: number;
  readonly targetKind: typeof WASM_TARGET_KIND;
  readonly targetProfile: "core-3-nonweb";
  readonly pointerWidth: "wasm32";
  readonly memoryExport: "memory";
  readonly memoryPageBytes: number;
  readonly maxPages: number;
  readonly sourceEncoding: number;
  readonly spanUnit: number;
  readonly hostOwnershipModel: number;
  readonly resultLifetimeModel: number;
  readonly lexResultI32Count: number;
  readonly tokenRecordI32Count: number;
  readonly requiredExports: readonly string[];
  readonly forbiddenDefaultDependencies: readonly string[];
}

export interface WasmFrontendCandidate {
  readonly id: string;
  readonly name: string;
  readonly status: WasmFrontendCandidateStatus;
  readonly priority: number;
  readonly command: string | null;
  readonly distribution: WasmFrontendDistribution;
  readonly packageFit: WasmFrontendPackageFit;
  readonly abiFit: WasmFrontendAbiFit;
  readonly runtimeFit: WasmFrontendRuntimeFit;
  readonly sourceUrls: readonly string[];
  readonly notes: readonly string[];
  readonly requiredSpikeChecks: readonly string[];
}

export interface WasmFrontendRecommendation {
  readonly keepAsOracle: string;
  readonly packagedCompiler: string;
  readonly firstErgonomicSpike: string;
  readonly optionalDependencySpikes: readonly string[];
  readonly externalComparisonSpikes: readonly string[];
  readonly watchOnly: readonly string[];
}

export const babaWasmFrontendRequirements: WasmFrontendRequirements = {
  abiName: "baba-wasm-abi",
  abiVersion: WASM_ABI_VERSION,
  targetKind: WASM_TARGET_KIND,
  targetProfile: "core-3-nonweb",
  pointerWidth: "wasm32",
  memoryExport: "memory",
  memoryPageBytes: WASM_PAGE_BYTES,
  maxPages: WASM_MAX_PAGES,
  sourceEncoding: WASM_SOURCE_ENCODING_UTF16,
  spanUnit: WASM_SPAN_UNIT_UTF16,
  hostOwnershipModel: WASM_HOST_OWNERSHIP_CALLER_MANAGED,
  resultLifetimeModel: WASM_RESULT_LIFETIME_CALLER_BUFFER,
  lexResultI32Count: WASM_LEX_RESULT_I32_COUNT,
  tokenRecordI32Count: WASM_TOKEN_RECORD_I32_COUNT,
  requiredExports: [
    "memory",
    "lex_one",
    "parser_action",
    "parser_goto",
    "lex_all",
    "load_plan",
    "abi_version",
    "plan_version",
    "semantics_version",
    "reset",
    "input_base",
    "max_pages",
    "source_encoding",
    "span_unit",
    "lex_result_i32_count",
    "token_record_i32_count",
    "host_ownership_model",
    "result_lifetime_model",
  ],
  forbiddenDefaultDependencies: [
    "mandatory WASI host for parser core",
    "mandatory browser or DOM host API",
    "mandatory component model adapter",
    "hidden host-owned parser state",
  ],
};

export const wasmFrontendCandidates: readonly WasmFrontendCandidate[] = [
  {
    id: "current-baba-emitter",
    name: "Baba direct binary emitter",
    status: "baseline",
    priority: 0,
    command: null,
    distribution: "in-package",
    packageFit: "recommended",
    abiFit: "native-baba",
    runtimeFit: "none",
    sourceUrls: [
      "docs/wasm-abi.md",
      "src/targets/runtime/wasm_core_runtime.ts",
    ],
    notes: [
      "Current correctness oracle for the raw parser/lexer ABI.",
      "Keeps DFA and LR tables in generated core Wasm with no language runtime.",
    ],
    requiredSpikeChecks: [
      "Generated parser.wasm validates with WebAssembly.validate.",
      "Generated abi.json matches babaWasmFrontendRequirements.",
      "No TypeScript parser runtime is emitted into the public bundle.",
    ],
  },
  {
    id: "baba-wasm-builder",
    name: "Baba typed Wasm builder",
    status: "candidate",
    priority: 1,
    command: null,
    distribution: "in-package",
    packageFit: "recommended",
    abiFit: "direct-raw-exports",
    runtimeFit: "none",
    sourceUrls: [
      "src/targets/runtime/wasm_core_runtime.ts",
      "src/targets/runtime/language.ts",
    ],
    notes: [
      "Preferred packaged path: extract Baba's existing binary emission into a small typed builder/compiler owned by this package.",
      "Keeps generation deterministic, dependency-free, and aligned with the current abi.json contract.",
      "Can add a WAT/debug dump without requiring a WAT-to-Wasm dependency in the public package.",
    ],
    requiredSpikeChecks: [
      "Represent modules, sections, types, locals, structured control flow, and data segments explicitly.",
      "Emit the same parser.wasm bytes or semantically equivalent bytes for a fixture grammar.",
      "Reject malformed builder state before binary emission instead of relying only on WebAssembly.validate.",
    ],
  },
  {
    id: "webassemblyjs-wasm-gen",
    name: "webassemblyjs wasm-gen",
    status: "candidate",
    priority: 2,
    command: null,
    distribution: "package-dependency",
    packageFit: "acceptable-optional",
    abiFit: "direct-with-care",
    runtimeFit: "none",
    sourceUrls: [
      "https://github.com/xtuc/webassemblyjs",
      "https://www.npmjs.com/package/@webassemblyjs/wasm-gen",
      "https://www.npmjs.com/package/@webassemblyjs/ast",
    ],
    notes: [
      "Smallest external dependency family found for emitting Wasm binaries from JavaScript.",
      "Provides a binary format printer and AST helpers, but still requires Baba to own validation and ABI shaping.",
      "Useful as an optional spike if it removes meaningful encoder complexity without widening the public dependency graph too much.",
    ],
    requiredSpikeChecks: [
      "Build the minimal Baba ABI fixture without adding runtime imports.",
      "Compare dependency size and emitted bytes against the in-package builder.",
      "Verify maintenance and Deno/JSR compatibility before making it a default dependency.",
    ],
  },
  {
    id: "wabt-js",
    name: "WABT JavaScript build",
    status: "watch",
    priority: 3,
    command: null,
    distribution: "package-dependency",
    packageFit: "acceptable-optional",
    abiFit: "direct-with-care",
    runtimeFit: "none",
    sourceUrls: [
      "https://github.com/AssemblyScript/wabt.js",
      "https://www.npmjs.com/package/wabt",
      "https://github.com/WebAssembly/wabt",
    ],
    notes: [
      "Can compile WAT to Wasm inside JavaScript, which is attractive for debug-first backend bring-up.",
      "The npm package is multi-megabyte, so it should be debug/test tooling unless it materially simplifies the compiler.",
    ],
    requiredSpikeChecks: [
      "Emit WAT for the minimal Baba ABI fixture and compile it without external native tools.",
      "Measure package-size cost against the in-package builder.",
      "Keep WABT out of the published runtime path unless it clearly pays for itself.",
    ],
  },
  {
    id: "binaryen-js",
    name: "Binaryen.js",
    status: "watch",
    priority: 4,
    command: null,
    distribution: "package-dependency",
    packageFit: "too-heavy",
    abiFit: "direct-with-care",
    runtimeFit: "configurable",
    sourceUrls: [
      "https://github.com/AssemblyScript/binaryen.js",
      "https://github.com/WebAssembly/binaryen",
      "https://www.npmjs.com/package/binaryen",
    ],
    notes: [
      "Powerful in-package compiler/optimizer option, but the npm package is too large for Baba's minimal package goal.",
      "Best used as an optional benchmark or optimizer experiment, not as a default dependency.",
    ],
    requiredSpikeChecks: [
      "Measure whether optimization reduces parser.wasm enough to justify dependency size.",
      "Verify Deno/JSR loading behavior before considering any optional integration.",
      "Keep generated raw exports and memory shape identical to abi.json.",
    ],
  },
  {
    id: "assemblyscript",
    name: "AssemblyScript",
    status: "watch",
    priority: 5,
    command: "asc",
    distribution: "package-dependency",
    packageFit: "too-heavy",
    abiFit: "direct-with-care",
    runtimeFit: "configurable",
    sourceUrls: [
      "https://www.assemblyscript.org/compiler.html",
      "https://www.assemblyscript.org/runtime.html",
      "https://www.npmjs.com/package/assemblyscript",
    ],
    notes: [
      "Ergonomic syntax, but not the preferred packaged path because the compiler package depends on Binaryen.",
      "The compiler can emit Wasm binary and WAT, optimize for speed or size, import memory, and choose runtime variants.",
      "Useful as a comparison if we want to test whether TypeScript-like generated runtime code beats the small builder approach.",
    ],
    requiredSpikeChecks: [
      "Compile a no-allocation or unmanaged minimal ABI fixture with --runtime stub or an equivalent low-runtime mode.",
      "Export exactly the Baba core functions and memory, with no extra required imports beyond an allowed memory import when explicitly enabled.",
      "Reject as a default dependency unless package size becomes compatible with Baba's minimal goal.",
    ],
  },
  {
    id: "rust",
    name: "Rust",
    status: "watch",
    priority: 6,
    command: "cargo",
    distribution: "external-toolchain",
    packageFit: "external-only",
    abiFit: "direct-raw-exports",
    runtimeFit: "configurable",
    sourceUrls: [
      "https://doc.rust-lang.org/rustc/platform-support/wasm32-unknown-unknown.html",
      "https://doc.rust-lang.org/rustc/platform-support/wasm32v1-none.html",
    ],
    notes: [
      "Best production-control fallback when ABI stability matters more than frontend ergonomics.",
      "wasm32-unknown-unknown makes minimal host assumptions and can produce bare-bones Wasm binaries.",
      "Default target features can change over time, so portable builds need explicit feature gates or wasm32v1-none where it fits.",
    ],
    requiredSpikeChecks: [
      "Build a no_std minimal ABI fixture for wasm32-unknown-unknown or wasm32v1-none.",
      "Reject panicking, allocator, or formatting paths in the generated parser core unless they are explicitly measured.",
      "Validate export names, import section, and target features in the produced Wasm.",
    ],
  },
  {
    id: "zig",
    name: "Zig",
    status: "watch",
    priority: 7,
    command: "zig",
    distribution: "external-toolchain",
    packageFit: "external-only",
    abiFit: "direct-raw-exports",
    runtimeFit: "none",
    sourceUrls: [
      "https://ziglang.org/documentation/master/#WebAssembly",
    ],
    notes: [
      "Good size and ABI-control spike because Zig supports wasm32-freestanding builds and explicit exports.",
      "Less ergonomic for generated parser logic than AssemblyScript, but simpler than Rust for raw exported functions.",
    ],
    requiredSpikeChecks: [
      "Build with wasm32-freestanding, no entry point, and explicit exported Baba ABI functions.",
      "Keep memory ownership identical to the generated abi.json descriptor.",
      "Compare binary size after release-small or equivalent optimization.",
    ],
  },
  {
    id: "grain",
    name: "Grain",
    status: "watch",
    priority: 8,
    command: "grain",
    distribution: "external-toolchain",
    packageFit: "external-only",
    abiFit: "needs-proof",
    runtimeFit: "managed-runtime",
    sourceUrls: [
      "https://grain-lang.org/docs/tooling/grain_cli",
      "https://grain-lang.org/docs/getting_grain",
    ],
    notes: [
      "Ergonomic language-level candidate that compiles directly to WebAssembly.",
      "The CLI exposes release, WAT output, memory sizing, memory import, no-GC, and Wasm feature toggles.",
      "Do not promote until a spike proves raw exports, memory layout, and runtime size for Baba's i32-only ABI.",
    ],
    requiredSpikeChecks: [
      "Find or define the supported way to export raw functions with the exact Baba ABI names.",
      "Measure release output with --no-gc and without debug/runtime type information.",
      "Verify the module does not require a Grain-specific host runtime for parser-core calls.",
    ],
  },
  {
    id: "tinygo",
    name: "TinyGo",
    status: "watch",
    priority: 9,
    command: "tinygo",
    distribution: "external-toolchain",
    packageFit: "external-only",
    abiFit: "needs-proof",
    runtimeFit: "host-runtime",
    sourceUrls: [
      "https://tinygo.org/docs/guides/webassembly/",
      "https://tinygo.org/docs/guides/webassembly/wasm/",
    ],
    notes: [
      "Useful comparison point if Go syntax becomes attractive for generated runtime code.",
      "Browser Wasm docs use GOOS=js GOARCH=wasm and wasm_exec.js, which is not a natural fit for Baba's raw parser core.",
    ],
    requiredSpikeChecks: [
      "Prefer a WASI-free or custom-target raw export path before considering this viable.",
      "Reject any output that requires wasm_exec.js for the core parser/lexer ABI.",
      "Measure startup and binary size against AssemblyScript and Zig before promoting.",
    ],
  },
];

export const wasmFrontendRecommendation: WasmFrontendRecommendation = {
  keepAsOracle: "current-baba-emitter",
  packagedCompiler: "baba-wasm-builder",
  firstErgonomicSpike: "baba-wasm-builder",
  optionalDependencySpikes: [
    "webassemblyjs-wasm-gen",
    "wabt-js",
  ],
  externalComparisonSpikes: [
    "assemblyscript",
    "rust",
    "zig",
    "grain",
    "tinygo",
  ],
  watchOnly: [
    "binaryen-js",
    "assemblyscript",
    "grain",
    "tinygo",
  ],
};
