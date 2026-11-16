import {DatabaseSync} from 'node:sqlite';
import {writeFileSync,existsSync} from 'node:fs';
const source=process.argv[2],destination=process.argv[3];
if(!source||!destination)throw new Error('Supply local task snapshot and private env output path');
if(existsSync(destination))throw new Error('Output already exists');
const db=new DatabaseSync(source,{readOnly:true});
try{
 const read=(key:string):string=>String(db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value??'').trim();
 const base=read('api_base_url'),key=read('api_key'),model=read('model');
 if(!base||!key||!model)throw new Error('Existing AI configuration is incomplete');
 const url=new URL(base);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('Existing API URL needs manual review');
 // systemd EnvironmentFile quoting; reject line breaks rather than interpreting arbitrary content.
 const quote=(value:string):string=>{if(/[\r\n\u0000]/.test(value))throw new Error('Invalid environment value');return '"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';};
 writeFileSync(destination,`AI_API_BASE_URL=${quote(base)}\nAI_API_KEY=${quote(key)}\nAI_MODEL_NAME=${quote(model)}\n`,{mode:0o600});
 process.stdout.write('Existing AI configuration prepared in a private environment file; secret not printed.\n');
}finally{db.close();}
