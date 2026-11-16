import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
type Row = Record<string, unknown>;
function row(value:unknown):Row {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Row;
}
const credentials=row(JSON.parse(readFileSync(process.env.HANDOFF_PATH ?? '.local-secrets/cloud-handoff.json','utf8')) as unknown);
const passwords=row(credentials.app_passwords);
const base='https://114.215.185.184/api';
let token='';
async function request(path:string,body?:unknown):Promise<Row> {
  const response=await fetch(base+path,{
    method:body===undefined?'GET':'POST',
    headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:AbortSignal.timeout(75000),
  });
  const result=row(await response.json());
  if(!response.ok)throw new Error(`请求 ${path} 失败：HTTP ${response.status}，${String(result.message)}`);
  return row(result.data ?? {});
}
const auth=await request('/auth/login',{company_code:'tmy',username:credentials.app_username,password:passwords.tmy,client:'desktop'});
assert.equal(typeof auth.access_token,'string');
token=String(auth.access_token);
try {
  const departments=await request('/departments?page_size=200');
  const categories=await request('/categories?page_size=200');
  const name=(data:Row,id:unknown):string=>{
    assert.ok(Array.isArray(data.items));
    return String(data.items.map(row).find(item=>String(item.id)===String(id))?.name??'');
  };
  // Synthetic examples only; never submit historical orders or save generated drafts.
  const result=await request('/ai/parse',{text:'请分别提取以下4笔独立测试订单：\n1. 测试甲定制6寸生日蛋糕，2026年10月1日15:30交付。\n2. 测试乙门店供应配送吐司面包20条，2026年10月2日08:00送达。\n3. 测试丙订购鲜面条50份，2026年10月3日配送，具体时间尚未确定。\n4. 测试丁茶歇布置，2026年10月4日14:00交付。'});
  assert.ok(Array.isArray(result.items));
  assert.equal(result.items.length,4,'应识别4笔独立订单');
  const items=result.items.map(row);
  const itemFor=(word:string):Row=>{const item=items.find(i=>(String(i.title)+' '+String(i.content)).includes(word));assert.ok(item,`缺少${word}样例`);return item;};
  const cake=itemFor('蛋糕'),bread=itemFor('吐司'),noodles=itemFor('面条'),tea=itemFor('茶歇');
  assert.equal(name(categories,cake.category_id),'定制蛋糕');
  assert.equal(name(categories,bread.category_id),'门店供应配送');
  assert.equal(name(categories,tea.category_id),'茶歇');
  assert.match(name(departments,cake.department_id),/蛋糕/);
  assert.match(name(departments,bread.department_id),/面包/);
  assert.match(name(departments,noodles.department_id),/制面/);
  assert.equal(cake.expected_delivery_at,'2026-10-01 15:30');
  assert.equal(bread.expected_delivery_at,'2026-10-02 08:00');
  assert.equal(noodles.expected_delivery_at,null,'无明确时间不得编造');
  assert.ok(String(noodles.note).includes('10'),'应保留原预计日期');
  assert.equal(tea.expected_delivery_at,'2026-10-04 14:00');
  console.log('PASS: 4个合成订单真实AI解析；3分类、蛋糕/面包/制面部门、分钟时间和缺失时间处理符合预期；未保存任务。');
} finally {
  await request('/auth/logout',{client:'desktop',refresh_token:auth.refresh_token});
  token='';
}
