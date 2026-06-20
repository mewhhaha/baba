import type { RegexAst } from "./ast.ts";
import { isRegexNullable } from "./ast.ts";

export { isRegexNullable };

export function regexCanMatchEmpty(ast: RegexAst): boolean {
  return isRegexNullable(ast);
}
