import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
type Row=Record<string,unknown>;
const path=process.env.HANDOFF_PATH??'.local-secrets/cloud-handoff.json';
const handoff=JSON.parse(readFileSync(path,'utf8')) as Row;
const base=String(handoff.git_url).replace('/git/','/api');
let token='';
async function request(method:string,url:string,body?:unknown,expected=200,auth=token):Promise<Row>{
 const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(auth?{Authorization:`Bearer ${auth}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value:unknown=await response.json();
 assert.equal(response.status,expected,`${method} ${url}: HTTP ${response.status}`);
 assert.ok(value&&typeof value==='object');
 const result=value as Row;
 if(expected<300){assert.equal(result.code,0);return (result.data??{}) as Row;}
 assert.notEqual(result.code,0);return result;
}
const login=(company:string,password:string)=>request('POST','/auth/login',{company_code:company,username:'admin',password,client:'desktop'},201,'');
const passwords=(typeof handoff.app_passwords==='object'&&handoff.app_passwords?handoff.app_passwords:{}) as Record<string,string>;
for(const company of ['tri','tmy']){
 let auth=await login(company,passwords[company]??String(handoff.app_initial_password));
 token=String(auth.access_token);
 if((auth.user as Row).must_change_password){
  const next=randomBytes(24).toString('base64url');
  await request('POST','/auth/change-password',{current_password:String(handoff.app_initial_password),new_password:next},201);
  passwords[company]=next;handoff.app_passwords=passwords;writeFileSync(path,JSON.stringify(handoff,null,2),{mode:0o600});
  auth=await login(company,next);token=String(auth.access_token);
 }
}
const tri=await login('tri',passwords.tri??'');
token=String(tri.access_token);const triToken=token;
const tmy=await login('tmy',passwords.tmy??'');const tmyToken=String(tmy.access_token);
await request('GET','/tasks',undefined,401,'');
const departments=await request('GET','/departments?page_size=200');
const dept=(departments.items as Row[])[0];assert.ok(dept);
const stamp=Date.now().toString();
const employee=await request('POST','/employees',{name:`联调员工-${stamp}`,department_id:dept.id,status:'active'},201);
const input={title:`云端联调-${stamp}`,content:'隔离测试记录',department_id:dept.id,assignee_employee_id:employee.id,status:'todo',priority:'normal',task_type:'order',expected_delivery_at:'2026-10-01 15:30'};
const task=await request('POST','/tasks',input,201);assert.ok(task.id);
await request('POST','/tasks',{...input,company_id:'2'},400);
await request('GET',`/tasks/${String(task.id)}`,undefined,404,tmyToken);
await request('PATCH',`/tasks/${String(task.id)}/status`,{status:'delivered'},400);
for(const status of ['doing','waiting_ship'])await request('PATCH',`/tasks/${String(task.id)}/status`,{status});
const draft=await request('POST',`/delivery-notes/from-task/${String(task.id)}`,{},201);
const duplicate=await request('POST',`/delivery-notes/from-task/${String(task.id)}`,{},201);assert.equal(draft.id,duplicate.id);
const note=await request('PUT',`/delivery-notes/${String(draft.id)}`,{delivery_date:'2026-10-01',customer_name_snapshot:'联调客户',is_draft:0,items:[{product_name:'测试产品',unit:'份',quantity:'3',unit_price:'0.10'}]});
assert.equal(note.total_amount,'0.30');assert.ok(note.note_number);
await request('GET',`/delivery-notes/${String(draft.id)}`,undefined,404,tmyToken);
await request('DELETE',`/employees/${String(employee.id)}`,undefined,400);
for(const status of ['shipped','delivered','canceled'])await request('PATCH',`/tasks/${String(task.id)}/status`,{status});
await request('PATCH',`/tasks/${String(task.id)}/status`,{status:'todo'},400);
const refreshed=await request('POST','/auth/refresh',{client:'desktop',refresh_token:tri.refresh_token},201,'');assert.ok(refreshed.access_token);
await request('POST','/auth/refresh',{client:'desktop',refresh_token:tri.refresh_token},401,'');
token=triToken;
await request('DELETE',`/delivery-notes/${String(draft.id)}`);
await request('DELETE',`/tasks/${String(task.id)}`);
await request('DELETE',`/employees/${String(employee.id)}`);
process.stdout.write('PASS: real MySQL login/change-password, tenant isolation, input validation, status machine, deletion protection, idempotent conversion, decimal money, refresh rotation; test records cleaned.\n');
