const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const crypto=require('node:crypto');
test('Overview migration enforces names, reads company orders and limits directory data',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const stub=fs.readFileSync('tests/beta.test.cjs','utf8').match(/const stub = `([\s\S]*?)`;/)[1];
 await db.exec(stub);await db.exec(fs.readFileSync('supabase/migrations/001_brief_v1_beta.sql','utf8'));
 const migration=fs.readFileSync('supabase/migrations/003_overview_and_person_names.sql','utf8');await db.exec(migration);await db.exec(migration);
 const w=crypto.randomUUID(),other=crypto.randomUUID(),worker=crypto.randomUUID(),admin=crypto.randomUUID(),external=crypto.randomUUID();
 await db.query('insert into bb_workspaces(id,name) values($1,$3),($2,$4)',[w,other,'Brief Bygg','Elfabriken']);
 for(const [id,workspace,name,role,employer,isExternal] of [[worker,w,'Erik Svensson','worker','Brief Bygg',false],[admin,w,'Samuel Fredriksson','admin','Brief Bygg',false],[external,w,'Extern Person','worker','Extern',true],[crypto.randomUUID(),other,'Emma Johansson','worker','Elfabriken',false]]){
  await db.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3)',[id,id+'@example.se',JSON.stringify({full_name:name})]);
  await db.query('insert into bb_members(id,workspace,auth_user,email,name,role,employer,external,job) values($1,$2,$1,$3,$4,$5,$6,$7,$8)',[id,workspace,id+'@example.se',name,role,employer,isExternal,'Yrkesroll']);
 }
 await assert.rejects(()=>db.query('update bb_members set name=$1 where id=$2',['Erik',worker]),/förnamn och efternamn/);
 await assert.rejects(()=>db.query('insert into bb_companies(workspace,name,contacts) values($1,$2,$3)',[w,'Felaktig kontakt',JSON.stringify([{id:'test',name:'Anna'}])]),/förnamn och efternamn/);
 await db.query('insert into bb_companies(workspace,name,contacts) values($1,$2,$3)',[w,'Giltig kontakt',JSON.stringify([{id:'test',name:'Anna Andersson'}])]);
 const company=crypto.randomUUID(),project=crypto.randomUUID(),order=crypto.randomUUID();
 await db.query('insert into bb_companies(id,workspace,name) values($1,$2,$3)',[company,w,'Beställare']);
 await db.query('insert into bb_projects(id,workspace,customer,number,customer_number,name) values($1,$2,$3,$4,$5,$6)',[project,w,company,'EGET-1','KUND-999','Projekt']);
 await db.query('insert into bb_orders(id,workspace,project,body) values($1,$2,$3,$4)',[order,w,project,JSON.stringify({assignee:admin,status:'Ej påbörjad',participants:[],notes:[]})]);
 const allowed=async(writing)=> (await db.query('select brief_beta_private.allowed(o,m,$3) as ok from bb_orders o,bb_members m where o.id=$1 and m.id=$2',[order,worker,writing])).rows[0].ok;
 assert.equal(await allowed(false),true);assert.equal(await allowed(true),false);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[worker]);
 await db.exec('set role authenticated');
 const rows=(await db.query('select public.brief_beta_search_directory($1,$2) as people',[w,'elfab'])).rows[0].people;
 assert.equal(rows.length,1);assert.equal(rows[0].name,'Emma Johansson');assert.deepEqual(Object.keys(rows[0]).sort(),['employer','id','job','name']);
 await assert.rejects(()=>db.query('select public.brief_beta_search_directory($1,$2)',[other,'Brief']),/aktiv profil/);
 await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[external]);await db.exec('set role authenticated');
 await assert.rejects(()=>db.query('select public.brief_beta_search_directory($1,$2)',[w,'elfab']),/personalkatalogen/);
});
