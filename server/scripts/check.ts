import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
let failed = false;
function scan(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path);
    else if (path.endsWith('.ts')) {
      const text = readFileSync(path, 'utf8');
      if (/@ts-(ignore|nocheck)/.test(text)) {
        console.error(`${path}: 禁止抑制类型检查`);
        failed = true;
      }
      const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (node.kind === ts.SyntaxKind.AnyKeyword) {
          console.error(`${path}: 禁止 any`);
          failed = true;
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }
}
scan('src');
scan('tests');
if (failed) process.exitCode = 1;
