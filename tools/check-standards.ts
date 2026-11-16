import ts from 'typescript';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const ignored=new Set(['node_modules','dist','dist-electron','release','.git','.local-secrets','test-results','playwright-report','artifacts']);
const failures:string[]=[];
let files=0;
function scan(directory:string):void {
 for(const item of readdirSync(directory,{withFileTypes:true})){
  if(ignored.has(item.name))continue;
  const path=join(directory,item.name);
  if(item.isDirectory()){scan(path);continue;}
  if(!/\.(ts|tsx|cts|mts)$/.test(item.name))continue;
  const content=readFileSync(path,'utf8');files++;
  const ast=ts.createSourceFile(path,content,ts.ScriptTarget.Latest,true,item.name.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const visit=(node:ts.Node):void=>{if(node.kind===ts.SyntaxKind.AnyKeyword){const loc=ast.getLineAndCharacterOfPosition(node.getStart(ast));failures.push(`${path}:${loc.line+1} explicit any`);}ts.forEachChild(node,visit);};visit(ast);
  if(/@ts-(ignore|nocheck)/.test(content))failures.push(`${path}: TypeScript checking suppression`);
 }
}
for(const directory of ['server','desktop','web','tools','tests'])scan(directory);
if(failures.length){process.stderr.write(failures.join('\n')+'\n');process.exitCode=1;}
else process.stdout.write(`Standards passed: ${files} TypeScript files; no explicit any or checking suppression.\n`);
