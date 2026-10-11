const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
test('Explicit project invitations and per-person order access across companies',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(fs.readFileSync('tests/beta.test.cjs','utf8').match(/const stub = `([\s\S]*?)`;/)[1]);
 await db.exec("alter table auth.users add column raw_app_meta_data jsonb default '{}';grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid() to authenticated,service_role;");
 for(const f of ['001_brief_v1_beta.sql','003_overview_and_person_names.sql','20261003142406_order_sections.sql','20261005175637_building_diary_and_inbox.sql','20261006074818_project_building_diary.sql','20261006174554_company_organization_and_site_manager.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 const ids=Array.from({length:12},()=>crypto.randomUUID());const [w,w2,a,b,worker,foreigner,supervisor,site,c,p,c2,p2]=ids;
 for(const [id,name] of [[w,'Firma A'],[w2,'Firma B']])await db.query('insert into bb_workspaces(id,name) values($1,$2)',[id,name]);
 for(const [id,workspace,name,role,firm] of [[a,w,'Anna Andersson','admin','Firma A'],[b,w2,'Bertil Berg','admin','Firma B'],[worker,w,'Wera Wall','worker','Firma A'],[foreigner,w,'Fredrik Främmande','worker','Firma C'],[supervisor,w,'Sara Svensson','supervisor','Firma A'],[site,w2,'Peter Persson','site_manager','Firma B']]){
  await db.query('insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values($1,$2,now(),$3)',[id,id+'@test.se',JSON.stringify({full_name:name,company_name:firm,job_title:'Snickare',phone:'0701234567'})]);
  await db.query('insert into bb_members(id,workspace,auth_user,email,name,role,employer,job,phone) values($1,$2,$1,$3,$4,$5,$6,$7,$8)',[id,workspace,id+'@test.se',name,role,firm,'Snickare','0701234567']);
 }
 for(const [company,workspace,name,project,admin] of [[c,w,'Firma B',p,a],[c2,w2,'Firma A',p2,b]]){
  await db.query('insert into bb_companies(id,workspace,name,contacts) values($1,$2,$3,$4)',[company,workspace,name,JSON.stringify([{id:'remote',name:'Bertil Berg',email:b+'@test.se',phone:'0701234567'}])]);
  await db.query('insert into bb_projects(id,workspace,customer,number,customer_number,name,site_manager) values($1,$2,$3,$4,$5,$6,$7)',[project,workspace,company,'E1','K1','Projekt',admin]);
 }
 const as=async actor=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated');};
 const load=async workspace=>(await db.query('select brief_beta_load($1) s',[workspace])).rows[0].s;
 let revision=0;const act=async cmd=>{const s=(await db.query('select brief_beta_apply($1,$2,$3) s',[w,revision,JSON.stringify(cmd)])).rows[0].s;revision=s.revision;return s;};
 await as(a);let s=await act({kind:'create_order',project:p,number:'AO-1',title:'Arbete',assignee:worker});const order=s.orders[0].id;
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261008183000_company_access_and_accounts.sql','utf8'));

 await db.exec(fs.readFileSync('supabase/migrations/20261011133148_explicit_project_invitations.sql','utf8'));
 const link=async(workspace,project,target,action,number=null)=>(await db.query('select brief_beta_project_link_action($1,$2,$3,$4,$5) s',[workspace,project,target,action,number])).rows[0].s;
 const dir=async(workspace)=>(await db.query('select brief_beta_firm_directory($1) s',[workspace])).rows[0].s;
 const contact=async(workspace,target,action)=>(await db.query('select brief_beta_firm_request($1,$2,$3) s',[workspace,target,action])).rows[0].s;
 await as(a);s=await load(w);const firmA=s.people.find(x=>x.id===a).firm;const firmB=(await dir(w)).firms.find(x=>x.name==='Firma B').id;
 await assert.rejects(()=>link(w,p,firmB,'invite'),/anslutet företag/);
 const req=(await contact(w,firmB,'request')).requests[0];await as(b);await contact(w2,req.id,'accept');
 s=await load(w2);assert.equal(s.orders.length,0);assert.equal(s.projects.length,1); // Contact acceptance exposes neither foreign projects nor orders.
 await as(a);await link(w,p,firmB,'invite');await as(b);assert.equal((await load(w2)).projects.length,1);
 await assert.rejects(()=>link(w2,p,firmB,'accept',''),/Obligatorisk|obligatorisk/);
 await assert.rejects(()=>link(w2,p,firmB,'accept','E1'),/används redan/);
 await link(w2,p,firmB,'accept','B-LOCAL-42');s=await load(w2);assert.equal(s.projects.find(x=>x.id===p).number,'B-LOCAL-42');assert.equal(s.projects.find(x=>x.id===p).customerNumber,'E1');assert.equal(s.orders.length,0);assert.equal(s.projects.find(x=>x.id===p).connections.length,0);assert.equal(s.projects.find(x=>x.id===p).diaryRead,false);
 await as(a);await link(w,p,site,'share_order',order);await as(b);assert.equal((await load(w2)).orders.length,0); // A different colleague cannot read a personally linked order.
 await as(site);s=await load(w2);assert.equal(s.orders.length,1);assert.equal(s.orders[0].shared,true);assert.equal(s.people.find(x=>x.id===worker).email,'');
 await assert.rejects(()=>db.query('select brief_beta_apply($1,$2,$3)',[w2,s.revision,JSON.stringify({kind:'add_note',id:order,text:'Forbidden',files:[]})]),/åtkomst/);
 await assert.rejects(()=>link(w2,p,firmB,'invite'),/eget/);
 // Exact note attachment references are readable, project-diary paths are not.
 await db.exec('reset role');const path=w+'/'+order+'/'+worker+'/test.pdf';await db.query("update bb_orders set body=jsonb_set(body,'{notes}',$2) where id=$1",[order,JSON.stringify([{id:'note',author:worker,text:'Shared',files:[{name:'test.pdf',path}]}])]);
 await as(site);assert.equal((await db.query('select brief_beta_file_access($1) ok',[path])).rows[0].ok,true);assert.equal((await db.query('select brief_beta_file_access($1,true) ok',[path])).rows[0].ok,false);assert.equal((await db.query('select brief_beta_file_access($1) ok',[w+'/'+p+'/'+a+'/diary.pdf'])).rows[0].ok,false);
 await as(a);await link(w,p,site,'unshare_order',order);await as(site);assert.equal((await load(w2)).orders.length,0);assert.equal((await db.query('select brief_beta_file_access($1) ok',[path])).rows[0].ok,false);
 await as(b);await link(w2,p,firmB,'renumber','B-LOCAL-43');assert.equal((await load(w2)).projects.find(x=>x.id===p).number,'B-LOCAL-43');
 // Creating an own project cannot reuse an already chosen shared project number.
 s=await load(w2);await assert.rejects(()=>db.query('select brief_beta_apply($1,$2,$3)',[w2,s.revision,JSON.stringify({kind:'save_project',customer:c2,number:'B-LOCAL-43',customerNumber:'C-NEW',name:'Collision',siteManager:b,connections:[]})]),/projektnumret används/);
 await as(a);await link(w,p,site,'share_order',order);await as(b);await link(w2,p,firmB,'revoke');s=await load(w2);assert(!s.projects.some(x=>x.id===p));await as(site);assert.equal((await load(w2)).orders.length,0);
 await as(worker);await assert.rejects(()=>link(w,p,firmB,'invite'),/får inte/);
 await db.exec('reset role;set role anon');await assert.rejects(()=>db.query('select brief_beta_project_links($1)',[w]),/permission denied/);
});
