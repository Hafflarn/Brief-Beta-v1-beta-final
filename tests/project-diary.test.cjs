const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
test('Project diary preserves order history, validates new fields, private drafts and recipient-only acknowledgements',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(fs.readFileSync('tests/beta.test.cjs','utf8').match(/const stub = `([\s\S]*?)`;/)[1]);
 for(const f of ['001_brief_v1_beta.sql','003_overview_and_person_names.sql','20261003142406_order_sections.sql','20261005175637_building_diary_and_inbox.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 const [w,admin,worker,colleague,company,project,otherProject]=Array.from({length:7},()=>crypto.randomUUID());
 await db.query('insert into bb_workspaces(id,name) values($1,$2)',[w,'Brief']);
 for(const [user,name,role] of [[admin,'Anna Andersson','admin'],[worker,'Erik Svensson','worker'],[colleague,'Sara Nilsson','worker']]){
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[user,user+'@test.se']);
  await db.query('insert into bb_members(id,workspace,auth_user,email,name,role,employer,job) values($1,$2,$1,$3,$4,$5,$6,$7)',[user,w,user+'@test.se',name,role,'Brief','Snickare']);
 }
 await db.query('insert into bb_companies(id,workspace,name) values($1,$2,$3)',[company,w,'Beställare AB']);
 for(const id of [project,otherProject])await db.query('insert into bb_projects(id,workspace,customer,number,customer_number,name,address) values($1,$2,$3,$4,$5,$6,$7)',[id,w,company,id.slice(0,6),'KUND-1','Större projekt','Storgatan 1']);
 const as=async actor=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated')};
 const load=async()=> (await db.query('select brief_beta_load($1) s',[w])).rows[0].s;
 let revision=0;const act=async c=>{const s=(await db.query('select brief_beta_apply($1,$2,$3) s',[w,revision,JSON.stringify(c)])).rows[0].s;revision=s.revision;return s};
 await as(admin);let s=await act({kind:'create_order',project,number:'AO-1',title:'Byta kök',assignee:worker,buildingDiary:true});const order=s.orders[0].id;
 await as(worker);const legacy=crypto.randomUUID(),legacyFile={id:crypto.randomUUID(),name:'gammal.txt',type:'text/plain'};legacyFile.path=[w,order,worker,legacyFile.id].join('/');
 await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name,owner_id) values('brief-beta-files',$1,$2)",[legacyFile.path,worker]);await as(worker);
 s=await act({kind:'add_note',id:order,text:'Gemensam bilaga',files:[legacyFile]});s=await act({kind:'save_diary',id:order,report:legacy,date:'2026-10-05',content:{work:'Gamla arbeten',personnel:[{trade:'Snickare',company:'Brief',count:2,hours:16}],files:[legacyFile]},submit:true});
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261006074818_project_building_diary.sql','utf8'));
 await as(admin);s=await load();assert.equal(s.diaryReports[0].project,project);assert.equal(s.diaryReports[0].number,1);assert.equal(s.diaryReports[0].header.orderNumber,'AO-1');assert.equal(s.inbox[0].project,project);assert.equal(s.projects.find(p=>p.id===project).siteManager,admin);
 s=await act({kind:'save_project',id:project,number:'EGET-42',customerNumber:'KUND-1',name:'Större projekt',customer:company,address:'Storgatan 1',connections:[],siteManager:admin,verifier:colleague});
 await as(worker);const report=crypto.randomUUID(),file={id:crypto.randomUUID(),name:'foto.txt',type:'text/plain'};file.path=[w,project,worker,file.id].join('/');
 await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name,owner_id) values('brief-beta-files',$1,$2)",[file.path,worker]);await as(worker);
 const content={ongoing:'Montering',completed:'Rivning klar',ata:'ÄTA 12 från beställare',directives:'Beställare 2026-10-06',notifications:'Kontrollant informerad',inspections:'Besiktning 7/10',drawings:'A-40 rev B',controlPlan:'KP-1',selfChecks:'Kontroll 1 godkänd',safetyRound:'Utförd',safetyActions:'Räcke',safetyCompleted:'Räcke klart',other:'Övrigt',personnel:[{type:'Egen',trade:'Snickare',company:'Brief',count:2,hours:16},{type:'UE',trade:'Elektriker',company:'UE',count:1,hours:8}],files:[file]};
 s=await act({kind:'save_project_diary',id:project,report,date:'2026-10-06',content,submit:false,header:{author:'Fake'}});const saved=s.diaryReports.find(r=>r.id===report);assert.equal(saved.header.author,'Erik Svensson');assert.equal(saved.number,2);assert.equal(saved.content.ata,content.ata);assert.equal(saved.content.personnel[1].type,'UE');assert(!saved.order);
 await as(admin);assert(!(await load()).diaryReports.some(r=>r.id===report));assert.equal((await db.query('select brief_beta_file_access($1) ok',[file.path])).rows[0].ok,false);
 await as(colleague);assert(!(await load()).diaryReports.some(r=>r.id===report));await assert.rejects(()=>act({kind:'save_project_diary',id:project,report,date:'2026-10-06',content,submit:true}),/Du får inte skriva/);
 await as(worker);await assert.rejects(()=>act({kind:'save_project_diary',id:project,report,date:'2026-10-06',content:{...content,personnel:[{type:'Fake'}]},submit:true}),/personaltyp/);
 await assert.rejects(()=>act({kind:'save_project_diary',id:otherProject,report,date:'2026-10-06',content,submit:true}),/Du får inte skriva/);
 s=await act({kind:'save_project_diary',id:project,report,date:'2026-10-06',content,submit:true});assert(s.diaryReports.find(r=>r.id===report).submittedAt);
 await assert.rejects(()=>act({kind:'save_project_diary',id:project,report,date:'2026-10-06',content,submit:true}),/låst/);
 await assert.rejects(()=>act({kind:'ack_project_diary',id:project,report,ack:'siteManager'}),/angiven mottagare/);
 await as(colleague);s=await act({kind:'ack_project_diary',id:project,report,ack:'verifier'});assert.equal(s.diaryReports.find(r=>r.id===report).acknowledgements.verifier.member,colleague);
 await as(admin);s=await act({kind:'ack_project_diary',id:project,report,ack:'siteManager'});assert.equal(s.diaryReports.find(r=>r.id===report).acknowledgements.siteManager.member,admin);
 await assert.rejects(()=>act({kind:'ack_project_diary',id:project,report,ack:'siteManager'}),/redan kvitterad/);
 s=await act({kind:'trash_order',id:order});s=await act({kind:'purge_orders',ids:[order]});assert(s.diaryReports.some(r=>r.id===legacy));assert(!s.diaryReports.find(r=>r.id===legacy).order);assert(s.inbox.some(i=>i.report===legacy));
 assert.equal((await db.query('select brief_beta_file_access($1) ok',[legacyFile.path])).rows[0].ok,true);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from bb_file_cleanup where path=$1',[legacyFile.path])).rows[0].n,0);await as(admin);
 assert.equal((await db.query('select brief_beta_file_access($1) ok',[file.path])).rows[0].ok,true);
 // Legacy open browser tabs can still save a report during deployment.
 s=await act({kind:'create_order',project,number:'AO-2',title:'Gammal klient',assignee:admin,buildingDiary:true});const oldClientOrder=s.orders[0].id;
 s=await act({kind:'save_diary',id:oldClientOrder,date:'2026-10-06',content:{work:'Kompatibilitet',files:[]},submit:true});assert(s.diaryReports.some(r=>r.order===oldClientOrder&&r.project===project&&r.number===3));
 await db.exec('reset role;set role anon');await assert.rejects(()=>db.query('select brief_beta_load($1)',[w]),/permission denied/);
});
