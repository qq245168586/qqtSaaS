import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,chmodSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
const delivery=process.argv[2],tasks=process.argv[3],target=process.argv[4];
if(!delivery||!tasks||!target)throw new Error('Usage: snapshot-legacy <delivery DB> <task DB> <new output directory>');
mkdirSync(target,{recursive:true,mode:0o700});
for(const [name,source]of [['delivery.sqlite',delivery],['tasks.sqlite',tasks]] as const){
 const destination=join(resolve(target),name);
 if(existsSync(destination))throw new Error('Refusing to overwrite existing snapshot');
 const db=new DatabaseSync(source,{readOnly:true});
 try{await backup(db,destination);chmodSync(destination,0o600);}finally{db.close();}
 const verify=new DatabaseSync(destination,{readOnly:true});
 try{const result=verify.prepare('PRAGMA quick_check').get();if(!result||Object.values(result)[0]!=='ok')throw new Error('Snapshot integrity check failed');}finally{verify.close();}
}
process.stdout.write('Two consistent read-only source snapshots created and verified; source databases unchanged.\n');
