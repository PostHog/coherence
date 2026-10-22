/**
 * Every module specifier a TypeScript or JavaScript file names, read with the
 * TypeScript compiler's parser rather than a pattern: a static import or
 * export from, a dynamic import(), a require(), an import type, and an
 * import x = require(), in either quote. What reads a plugin's imports (the
 * structural test, an eject's guard) reads them here, so a form one pattern
 * missed cannot pass both.
 */

import { createRequire } from "node:module";
import type * as TS from "typescript";

/** One specifier as written: its text, and where its string literal starts and ends in the file, quotes included. */
export interface Specifier {
  text: string;
  start: number;
  end: number;
}

let compiler: typeof TS | undefined;

function typescript(): typeof TS {
  if (compiler !== undefined) return compiler;
  try {
    compiler = createRequire(import.meta.url)("typescript") as typeof TS;
    return compiler;
  } catch {
    throw new Error("the TypeScript compiler is not installed (an optional dependency), and a plugin's imports are read with its parser: npm install --save-dev typescript");
  }
}

export function moduleSpecifiers(file: string, text: string): Specifier[] {
  const ts = typescript();
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: Specifier[] = [];
  const take = (node: TS.Node | undefined): void => {
    if (node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) found.push({ text: node.text, start: node.getStart(source), end: node.getEnd() });
  };
  const visit = (node: TS.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) take(node.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) take(node.moduleReference.expression);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) take(node.arguments[0]);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) take(node.argument.literal);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
