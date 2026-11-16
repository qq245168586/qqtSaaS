import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
// Git credential helper: output is consumed by Git, never logged by deploy scripts.
const operation=process.argv[2];
if(operation==='get') {
 let input='';
 for await(const chunk of process.stdin)input+=String(chunk);
 const fields=new Map(input.trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)] as const;}));
 const parsed:unknown=JSON.parse(readFileSync(fileURLToPath(new URL('../../.local-secrets/server-handoff.json',import.meta.url)),'utf8'));
 if(!parsed||typeof parsed!=='object')throw new Error('Missing credential handoff');
 const config=parsed as Record<string,unknown>;
 const url=new URL(String(config.git_url));
 if(fields.get('protocol')==='https'&&fields.get('host')===url.host) {
  process.stdout.write(`username=${String(config.git_username)}\npassword=${String(config.git_password)}\n\n`);
 }
}
