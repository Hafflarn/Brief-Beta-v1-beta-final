const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
test('Platschef keeps supervisor permissions, locked registration roles and company contact privacy',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(fs.readFileSync('tests/beta.test.cjs','utf8').match(/const stub = `([\s\S]*?)`;/)[1]);
 for(const f of ['001_brief_v1_beta.sql','003_overview_and_person_names.sql','20261003142406_order_sections.sql','20261005175637_building_diary_and_inbox.sql','20261006074818_project_building_diary.sql','20261006174554_company_organization_and_site_manager.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 const [w,admin,worker,supervisor,company,project,foreignCompany]=Array.from({length:7},()=>crypto.randomUUID());
 await db.query('insert into bb_workspaces(id,name) values($1,$2)',[w,'Brief']);
 for(const [user,name,role] of [[admin,'Anna Andersson','admin'],[worker,'Erik Svensson','worker'],[supervisor,'Sara Nilsson','supervisor']]){
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[user,user+'@test.se']);
  await db.query('insert into bb_members(id,workspace,auth_user,email,name,role,employer,job,phone) values($1,$2,$1,$3,$4,$5,$6,$7,$8)',[user,w,user+'@test.se',name,role,'Bygg AB','Snickare','0701234567'+user.slice(0,2)]);
 }
 await db.query('insert into bb_companies(id,workspace,name,contacts) values($1,$2,$3,$4)',[company,w,'Bygg AB',JSON.stringify([{id:'worker-contact',name:'Gammalt namn',email:worker+'@test.se',phone:'',organizationRole:'client'},{id:'client',name:'Karin Berg',email:'karin@kund.se',phone:'0701111111',organizationRole:'site_manager_client'}])]);
 await db.query('insert into bb_projects(id,workspace,customer,number,customer_number,name,address,site_manager) values($1,$2,$3,$4,$5,$6,$7,$8)',[project,w,company,'E1','K1','Projekt','Adress',admin]);
 const as=async actor=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated')};
 let revision=0;const act=async c=>{const s=(await db.query('select brief_beta_apply($1,$2,$3) s',[w,revision,JSON.stringify(c)])).rows[0].s;revision=s.revision;return s};
 const org=async (id=company)=>(await db.query('select brief_beta_company_organization($1,$2) s',[w,id])).rows[0].s;
 await as(admin);let s=await act({kind:'invite_member',role:'site_manager',organizationLevel:'client',name:'Johan Ek',email:'johan@bygg.se',phone:'0702222222',job:'Platschef',employer:'Bygg AB'});
 const site=s.people.find(p=>p.email==='johan@bygg.se');assert.equal(site.role,'site_manager');assert.equal(site.organizationLevel,'client');
 await assert.rejects(()=>act({kind:'invite_member',role:'site_manager',organizationLevel:'fake',name:'Test Person',email:'bad@bygg.se',phone:'070',job:'Platschef',employer:'Bygg AB'}),/check constraint/);
 // Attach an Auth identity to the invited profile, as bootstrap does after verified registration.
 await db.exec('reset role');await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[site.id,site.email]);await db.query('update bb_members set auth_user=id where id=$1',[site.id]);await as(site.id);
 s=await act({kind:'save_project',id:project,number:'E1',customerNumber:'K1',customer:company,name:'Projekt',address:'Adress',connections:[],siteManager:site.id});assert.equal(s.projects[0].siteManager,site.id);
 s=await act({kind:'create_order',project,number:'AO1',title:'Test',assignee:worker});assert(s.orders.length);
 s=await act({kind:'save_project_diary',id:project,date:'2026-10-06',content:{ongoing:'Arbete',files:[]},submit:true});assert(s.diaryReports[0].submittedAt);
 const rows=await org();assert(rows.some(p=>p.id===site.id&&p.role==='site_manager'&&p.organizationLevel==='client'));
 assert.equal(rows.filter(p=>p.email===worker+'@test.se').length,1);assert.equal(rows.find(p=>p.email===worker+'@test.se').name,'Erik Svensson');assert.equal(rows.find(p=>p.email===worker+'@test.se').role,'worker');assert(rows.find(p=>p.id==='contact:client').phone);
 await assert.rejects(()=>org(foreignCompany),/arbetsytan/);
 await assert.rejects(()=>act({kind:'invite_member',role:'site_manager',name:'Other Person',email:'other@bygg.se',phone:'070',job:'Platschef',employer:'Bygg AB'}),/lägre behörighet/);
 await as(supervisor);await assert.rejects(()=>act({kind:'edit_member',id:site.id,name:'Johan Ek',job:'Platschef',employer:'Bygg AB',phone:'070'}),/lägre rollers/);
 await as(admin);await assert.rejects(()=>act({kind:'edit_member',id:site.id,role:'worker',name:'Johan Ek',job:'Platschef',employer:'Bygg AB',phone:'070'}),/låst/);
 await as(worker);await assert.rejects(()=>org(),/åtkomst/);await assert.rejects(()=>act({kind:'invite_member',role:'site_manager'}),/hantera profiler/);
 await db.exec('reset role;set role anon');await assert.rejects(()=>org(),/permission denied/);
});
