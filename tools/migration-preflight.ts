import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';

interface TableReport {name:string;count:number}
interface SourceReport {path:string;size:number;sha256:string;tables:TableReport[];warnings:string[]}
function arg(name:string):string|undefined {const at=process.argv.indexOf(name);return at<0?undefined:process.argv[at+1];}
function inspect(path:string,kind:'delivery'|'task'):SourceReport {
 const absolute=resolve(path);
 const db=new DatabaseSync(absolute,{readOnly:true});
 const warnings:string[]=[];
 try {
 db.exec('BEGIN');
 const integrity=db.prepare('PRAGMA quick_check').all();
 if(integrity.some(r=>Object.values(r)[0]!=='ok'))throw new Error(`${kind}: database integrity check failed`);
 const allowed=kind==='delivery'?['delivery_notes','customers','customer_categories','products','personnel','print_templates']:['tasks','departments','employees','categories','task_images'];
 const present=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
 if(!present.has(kind==='delivery'?'delivery_notes':'tasks'))throw new Error(`${kind}: wrong database type`);
 const tables=allowed.filter(t=>present.has(t)).map(name=>({name,count:Number(db.prepare(`SELECT count(*) n FROM "${name}"`).get()?.n??0)}));
 if(kind==='task'){
 const legacy=Number(db.prepare("SELECT count(*) n FROM tasks WHERE due_date != '' AND length(due_date)=10").get()?.n??0);
 if(legacy)warnings.push(`${legacy} task(s) contain a date without time; preserve original requirement in migration note, do not invent midnight.`);
 const orphan=Number(db.prepare('SELECT count(*) n FROM tasks t LEFT JOIN departments d ON d.id=t.department_id LEFT JOIN employees e ON e.id=t.assignee_id WHERE d.id IS NULL OR e.id IS NULL').get()?.n??0);
 if(orphan)warnings.push(`${orphan} task(s) have missing department or employee links.`);
 warnings.push('Task source has no company_id. Explicit target company is required before import.');
 } else {
 let invalid=0,legacyNumbers=0;
 for(const row of db.prepare('SELECT payload FROM delivery_notes').iterate()) {
  try{const value:unknown=JSON.parse(String(row.payload));if(!value||typeof value!=='object'){invalid++;continue;}
   const note=value as Record<string,unknown>;
   if(!['tri','tmy'].includes(String(note.companyId))||!Array.isArray(note.items))invalid++;
   if(!/^(TRI|TMY)\d{15}$/.test(String(note.number)))legacyNumbers++;
  }catch{invalid++;}
 }
 if(invalid)warnings.push(`${invalid} invalid delivery payload(s) need repair before import.`);
 if(legacyNumbers)warnings.push(`${legacyNumbers} historical note number(s) differ from new format; preserve originals, do not renumber.`);
 }
 db.exec('COMMIT');
 return {path:absolute,size:statSync(absolute).size,sha256:createHash('sha256').update(readFileSync(absolute)).digest('hex'),tables,warnings};
 } finally {db.close();}
}
const delivery=arg('--delivery-db'),task=arg('--task-db'),output=arg('--output');
if(!delivery&&!task)throw new Error('Supply --delivery-db and/or --task-db pointing to backup copies');
const report={generated_at:new Date().toISOString(),mode:'read-only-preflight',cloud_writes:0,sources:[...(delivery?[inspect(delivery,'delivery')]:[]),...(task?[inspect(task,'task')]:[])]};
const json=JSON.stringify(report,null,2);
if(output)writeFileSync(resolve(output),json,{mode:0o600});else process.stdout.write(json+'\n');
