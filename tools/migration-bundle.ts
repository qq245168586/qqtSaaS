import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
const source=process.argv[2],output=process.argv[3];
if(!source||!output)throw new Error('Supply verified snapshot directory and a new bundle directory');
mkdirSync(output,{recursive:true,mode:0o700});
const plans=[['delivery.sqlite',['customer_categories','customers','products','personnel','delivery_notes','print_templates']],['tasks.sqlite',['departments','employees','categories','tasks','task_images']]] as const;
for(const [filename,tables]of plans){
 const target=join(output,filename);if(existsSync(target))throw new Error('Bundle already exists');
 const db=new DatabaseSync(target);
 try{
  db.prepare('ATTACH DATABASE ? AS source').run(`file:${join(resolve(source),filename)}?mode=ro`);
  const available=new Set(db.prepare("SELECT name FROM source.sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
  db.exec('BEGIN');
  for(const name of tables)if(available.has(name))db.exec(`CREATE TABLE "${name}" AS SELECT * FROM source."${name}"`);
  db.exec('COMMIT');
 }finally{db.close();chmodSync(target,0o600);}
}
process.stdout.write('Migration-only SQLite files prepared; old password/API settings excluded.\n');
