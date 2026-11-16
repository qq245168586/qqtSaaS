import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('migration preflight is read-only and flags dates without inventing a time',()=>{
 const directory=mkdtempSync(join(tmpdir(),'tmy-preflight-'));
 try{
 const file=join(directory,'tasks.sqlite');const db=new DatabaseSync(file);
 db.exec(`CREATE TABLE departments(id INTEGER);CREATE TABLE employees(id INTEGER);CREATE TABLE tasks(id INTEGER,department_id INTEGER,assignee_id INTEGER,due_date TEXT);INSERT INTO departments VALUES(1);INSERT INTO employees VALUES(1);INSERT INTO tasks VALUES(1,1,1,'2026-10-01')`);db.close();
 const before=readFileSync(file);
 const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','tools/migration-preflight.ts','--task-db',file],{encoding:'utf8'})) as {cloud_writes:number;sources:Array<{warnings:string[]}>};
 assert.equal(result.cloud_writes,0);
 assert.ok(result.sources[0]?.warnings.some(w=>w.includes('without time')));
 assert.ok(result.sources[0]?.warnings.some(w=>w.includes('company')));
 assert.deepEqual(readFileSync(file),before);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
