import assert from 'node:assert/strict';
type Row=Record<string,unknown>;
const base='https://114.215.185.184/api';
let token='';
function row(value:unknown):Row {assert.ok(value&&typeof value==='object'&&!Array.isArray(value));return value as Row;}
function items(value:Row):Row[]{assert.ok(Array.isArray(value.items));return value.items.map(row);}
async function call(method:string,path:string,body?:unknown,expected?:number):Promise<Row>{
  const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  const result=row(await response.json());
  if(expected!==undefined){assert.equal(response.status,expected,`${method} ${path}`);return result;}
  if(!response.ok)throw new Error(`${method} ${path}: HTTP ${response.status} ${String(result.message)}`);
  assert.equal(result.code,0);
  return row(result.data??{});
}
assert.equal((await call('GET','/auth/access-mode')).public_access,true);
const session=await call('POST','/auth/enter',{client:'desktop'});
assert.equal(row(session.user).public_access,true);
assert.equal(session.refresh_token,undefined);
assert.equal(typeof session.access_token,'string');token=String(session.access_token);
assert.equal(items(await call('GET','/companies')).length,2);
const existing=items(await call('GET','/delivery-notes?page_size=200'));
assert.ok(existing.some(n=>n.company_code==='tmy')&&existing.some(n=>n.company_code==='tri'),'共享列表需包含两家公司');
await call('GET','/users',undefined,403);
await call('GET','/backup/export',undefined,403);
await call('POST','/auth/change-password',{},403);
const employee=items(await call('GET','/employees?page_size=200')).find(e=>e.status==='active');assert.ok(employee);
const stamp=Date.now().toString();
const taskInput={title:`共享工作台验证-${stamp}`,content:'合成验证记录',company_code:'tmy',department_id:employee.department_id,assignee_employee_id:employee.id,status:'waiting_ship',priority:'normal',task_type:'order',expected_delivery_at:'2026-10-05 15:30'};
let taskId:string|undefined;
const noteIds:string[]=[];
try {
  const task=await call('POST','/tasks',taskInput);taskId=String(task.id);assert.equal(task.company_code,'tmy');
  const moved=await call('PUT',`/tasks/${taskId}`,{...taskInput,company_code:'tri'});assert.equal(moved.company_code,'tri');
  const from=await call('POST',`/delivery-notes/from-task/${taskId}`,{});noteIds.push(String(from.id));assert.equal(from.company_code,'tri');
  assert.equal((await call('POST',`/delivery-notes/from-task/${taskId}`,{})).id,from.id);
  const noteInput={company_code:'tmy',delivery_date:'2026-10-05',customer_name_snapshot:`共享验证-${stamp}`,items:[{product_name:'测试产品',unit:'份',quantity:'3',unit_price:'0.10'}]};
  await call('PUT',`/delivery-notes/${String(from.id)}`,{...noteInput,company_code:'tri'});
  const note=await call('POST','/delivery-notes',noteInput);noteIds.push(String(note.id));assert.equal(note.company_code,'tmy');assert.equal(note.total_amount,'0.30');
  const switched=await call('PUT',`/delivery-notes/${String(note.id)}`,{...noteInput,company_code:'tri'});
  assert.equal(switched.company_code,'tri');assert.notEqual(switched.note_number,note.note_number);assert.equal(switched.total_amount,'0.30');
  assert.ok(items(switched).every(i=>String(i.company_id)===String(switched.company_id)),'明细需跟随单据公司');
  await call('PATCH',`/delivery-notes/${String(note.id)}/printed`,{});
  const companyFilter=await call('GET','/delivery-notes?company_code=tri&page_size=200');
  assert.ok(items(companyFilter).some(n=>n.id===note.id),'目标公司列表能读到更换归属的单据');
  await call('PUT',`/delivery-notes/${String(note.id)}`,noteInput);
  const exported=await fetch(base+'/delivery-notes/export-batch',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({ids:[from.id,note.id]}),signal:AbortSignal.timeout(30000)});
  assert.ok(exported.ok,'两公司送货单应能一起导出');
  assert.match(exported.headers.get('Content-Type')??'',/spreadsheetml/);
  const binary=new Uint8Array(await exported.arrayBuffer());assert.equal(binary[0],80);assert.equal(binary[1],75);
  console.log('PASS: 无账号自动进入、两公司共享列表、公司归属编辑/重新编号、跨公司目录引用、任务转单幂等、明细归属及0.30金额；公开管理凭据接口已阻止。');
} finally {
  const errors:string[]=[];
  for(const id of noteIds){try{await call('DELETE',`/delivery-notes/${id}`);}catch{errors.push(`note:${id}`);}}
  if(taskId){try{await call('PATCH',`/tasks/${taskId}/status`,{status:'canceled'});await call('DELETE',`/tasks/${taskId}`);}catch{errors.push(`task:${taskId}`);}}
  if(errors.length)throw new Error(`合成记录待清理：${errors.join(',')}`);
  token='';
}
