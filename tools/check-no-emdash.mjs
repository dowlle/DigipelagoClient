// Guard: no em dashes (U+2014) in user-facing string content.
//
// Em dashes are an AI-writing tell, so they must never appear in text the player
// sees. This parses every src file with the TypeScript compiler and flags an em
// dash ONLY inside string literals, template strings, and JSX text — i.e. the
// content that renders. Comments are intentionally ignored (not reader-visible).
//
// Run via `npm run check:dashes`. Zero runtime deps beyond the installed
// `typescript` package. Exits non-zero (with file:line) on any violation.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const EM_DASH = '—';
const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/** Recursively collect .ts/.tsx files under a directory. */
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The node kinds whose text is shown to the user (never comments). */
function isContentNode(node) {
  return (
    node.kind === ts.SyntaxKind.StringLiteral ||
    node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
    node.kind === ts.SyntaxKind.TemplateHead ||
    node.kind === ts.SyntaxKind.TemplateMiddle ||
    node.kind === ts.SyntaxKind.TemplateTail ||
    node.kind === ts.SyntaxKind.JsxText
  );
}

const violations = [];
for (const file of walk(SRC)) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (isContentNode(node) && typeof node.text === 'string' && node.text.includes(EM_DASH)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      violations.push(`${file}:${line + 1}  ${node.text.trim().slice(0, 80)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (violations.length) {
  console.error(`Found ${violations.length} em dash(es) in user-facing content. Use commas, periods, or colons instead:\n`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log('OK: no em dashes in user-facing string content.');
