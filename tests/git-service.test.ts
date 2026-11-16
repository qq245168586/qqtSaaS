import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scryptSync} from 'node:crypto';
import {createGitServer,validateRoute} from '../tools/git-service.js';

test('Git endpoints are restricted to four repositories and smart protocol paths',()=>{
 assert.ok(validateRoute('/server.git/info/refs?service=git-upload-pack','GET'));
 assert.ok(validateRoute('/phase2.git/git-receive-pack','POST'));
 for(const path of ['/other.git/info/refs?service=git-upload-pack','/server.git/HEAD','/server.git/../../etc/passwd','/server.git/git-receive-pack?x=y'])assert.equal(validateRoute(path,'POST'),null);
});
test('all Git requests require a valid username and password',async()=>{
 const config={root:'/tmp',backend:'/nonexistent',username:'tester',salt:'sample',passwordHash:scryptSync('valid-pass','sample',64).toString('hex')};
 const server=createGitServer(config);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
 const address=server.address();assert.ok(address&&typeof address==='object');
 const url=`http://127.0.0.1:${address.port}/unknown`;
 assert.equal((await fetch(url)).status,401);
 assert.equal((await fetch(url,{headers:{Authorization:`Basic ${Buffer.from('tester:wrong').toString('base64')}`}})).status,401);
 assert.equal((await fetch(url,{headers:{Authorization:`Basic ${Buffer.from('tester:valid-pass').toString('base64')}`}})).status,404);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
