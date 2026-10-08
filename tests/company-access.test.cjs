const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
test('Firm access, controlled signup and mutually approved contact sharing',async t=>{
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
 await as(a);s=await load(w);assert.equal(s.orders.length,1);assert(!s.people.some(x=>x.id===foreigner));assert.equal(s.companies[0].contacts.length,0);
 const firmA=s.people.find(x=>x.id===a).firm;
 const directory=async workspace=>(await db.query('select brief_beta_firm_directory($1) s',[workspace])).rows[0].s;
 const request=async (workspace,target,action)=>(await db.query('select brief_beta_firm_request($1,$2,$3) s',[workspace,target,action])).rows[0].s;
 let d=await directory(w);const firmB=d.firms.find(x=>x.name==='Firma B'&&x.id!==firmA).id;
 assert.equal(d.firms.find(x=>x.id===firmB).people.length,0);
 assert.deepEqual((await db.query('select brief_beta_company_organization($1,$2) s',[w,c])).rows[0].s,[]);
 assert.equal((await db.query('select brief_beta_contact_profile($1,$2,$3) s',[w,c,'remote'])).rows[0].s,null);
 await assert.rejects(()=>act({kind:'invite_member',role:'worker'}),/Kontohanteringen|kontohanteringen/);
 await assert.rejects(()=>act({kind:'create_order',project:p,number:'AO-2',title:'Läckage',assignee:foreigner}),/samma företag/);
 await as(foreigner);assert.equal((await load(w)).orders.length,0);await assert.rejects(()=>act({kind:'add_note',id:order,text:'Otillåtet',files:[]}),/åtkomst/);
 assert.equal((await db.query('select brief_beta_file_access($1) ok',[w+'/'+order+'/'+worker+'/x'])).rows[0].ok,false);
 await as(a);d=await request(w,firmB,'request');const r=d.requests[0];assert.equal(r.state,'pending');assert.equal(d.firms.find(x=>x.id===firmB).people.length,0);
 await as(site);await assert.rejects(()=>request(w2,r.id,'accept'),/samma roll/);
 await as(b);d=await request(w2,r.id,'accept');assert(d.firms.find(x=>x.id===firmA).people.some(x=>x.id===worker));assert.equal((await load(w2)).orders.length,0);
 await as(a);d=await directory(w);assert(d.firms.find(x=>x.id===firmB).people.some(x=>x.id===b));assert.equal((await load(w)).companies[0].contacts.length,1);
 await request(w,r.id,'revoke');d=await directory(w);assert.equal(d.firms.find(x=>x.id===firmB).people.length,0);assert.equal((await load(w)).companies[0].contacts.length,0);
 revision=(await load(w)).revision;
 await as(worker);await assert.rejects(()=>directory(w),/Endast/);await assert.rejects(()=>request(w,firmB,'request'),/hantera/);
 // Neither anonymous Auth inserts nor user-controlled metadata can provision accounts.
 await db.exec('reset role');await assert.rejects(()=>db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[crypto.randomUUID(),'rogue@test.se',JSON.stringify({brief_provisioned:true})]),/Konton skapas/);
 const newUser=crypto.randomUUID();await db.query('insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,$2,now(),$3)',[newUser,'new@test.se',JSON.stringify({brief_provisioned:true,brief_password_suggested:true})]);
 await db.exec('set role authenticated');await assert.rejects(()=>db.query('select brief_beta_register_account($1,$2,$3,$4,$5)',[a,w,revision,newUser,'{}']),/permission denied/);
 await db.exec('reset role;set role service_role');await db.query('select brief_beta_register_account($1,$2,$3,$4,$5)',[a,w,revision,newUser,JSON.stringify({name:'Ny Kollegan',email:'new@test.se',role:'worker',job:'Montör',phone:'0701231234'})]);
 await as(newUser);s=await load(w);assert.equal(s.passwordChangeSuggested,true);assert.equal(s.people.find(x=>x.id===s.user).firm,firmA);
 await db.query('select brief_beta_password_suggestion_dismiss()');assert.equal((await load(w)).passwordChangeSuggested,false);
 await db.exec('reset role;set role anon');await assert.rejects(()=>directory(w),/permission denied/);
});
