begin;
create table if not exists public.bb_build_reports (
 id uuid primary key default gen_random_uuid(), workspace uuid not null references public.bb_workspaces,
 order_id uuid not null references public.bb_orders on delete cascade,
 author uuid not null references public.bb_members, report_date date not null,
 submitted_at timestamptz, updated_at timestamptz not null default now(),
 header jsonb not null, content jsonb not null,
 check(jsonb_typeof(content)='object' and octet_length(content::text)<=100000)
);
create index if not exists bb_build_reports_order on public.bb_build_reports(order_id,report_date);
create table if not exists public.bb_inbox (
 id uuid primary key default gen_random_uuid(), workspace uuid not null references public.bb_workspaces,
 recipient uuid not null references public.bb_members, order_id uuid not null references public.bb_orders on delete cascade,
 report_id uuid references public.bb_build_reports on delete cascade,
 kind text not null check(kind in ('diary','completed')), created_at timestamptz not null default now(), read_at timestamptz,
 title text not null, sender text not null
);
create index if not exists bb_inbox_recipient on public.bb_inbox(workspace,recipient,created_at desc);
create unique index if not exists bb_inbox_report on public.bb_inbox(report_id) where report_id is not null;
alter table public.bb_build_reports enable row level security;
alter table public.bb_inbox enable row level security;
revoke all on public.bb_build_reports,public.bb_inbox from public,anon,authenticated;
-- All reads/writes use the authenticated, workspace-checked Brief RPCs. No client has table privileges.
create or replace function brief_beta_private.diary_header(o public.bb_orders,m public.bb_members) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('project',p.name,'projectNumber',p.number,'orderNumber',o.body->>'number','customer',c.name,
 'address',coalesce(nullif(o.body->>'address',''),p.address),'author',m.name,'siteManager',creator.name,'siteManagerId',creator.id)
 from public.bb_projects p join public.bb_companies c on c.id=p.customer
 join public.bb_members creator on creator.id=nullif(o.body->>'issuedBy','')::uuid and creator.workspace=o.workspace
 where p.id=o.project and p.workspace=o.workspace;
$$;
create or replace function brief_beta_private.diary_content(input jsonb,submitted boolean) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb:='{}'; k text; staff jsonb:='[]'; r jsonb; weather jsonb;
begin
 if input is null or jsonb_typeof(input)<>'object' then raise exception 'Ogiltig dagboksrapport.'; end if;
 foreach k in array array['work','deliveries','equipment','deviations','decisions','safety','quality','nextDay'] loop
  result:=result||jsonb_build_object(k,brief_beta_private.text_value(input->>k,10000,submitted and k='work'));
 end loop;
 weather:=coalesce(input->'weather','[]');
 if jsonb_typeof(weather)<>'array' or jsonb_array_length(weather)>5 then raise exception 'Ogiltigt väder.'; end if;
 for r in select v from jsonb_array_elements(weather) v loop
  if jsonb_typeof(r)<>'string' or r#>>'{}' not in ('Sol','Molnigt','Regn','Snö','Blåsigt') then raise exception 'Ogiltigt väder.'; end if;
 end loop;
 if input->>'temperature' is not null and input->>'temperature'<>'' and ((input->>'temperature')::numeric not between -80 and 80) then raise exception 'Temperaturen måste vara mellan -80 och 80.'; end if;
 if jsonb_typeof(coalesce(input->'personnel','[]'))<>'array' or jsonb_array_length(coalesce(input->'personnel','[]'))>50 then raise exception 'Högst 50 personalrader.'; end if;
 for r in select v from jsonb_array_elements(coalesce(input->'personnel','[]')) v loop
  if jsonb_typeof(r)<>'object' then raise exception 'Ogiltig personalrad.'; end if;
  if coalesce(nullif(r->>'count','')::numeric,0) not between 0 and 10000 or coalesce(nullif(r->>'count','')::numeric,0)<>trunc(coalesce(nullif(r->>'count','')::numeric,0)) or coalesce(nullif(r->>'hours','')::numeric,0) not between 0 and 100000 then raise exception 'Ogiltigt antal eller timmar.'; end if;
  staff:=staff||jsonb_build_array(jsonb_build_object('trade',brief_beta_private.text_value(r->>'trade',150,false),'company',brief_beta_private.text_value(r->>'company',200,false),'count',coalesce(nullif(r->>'count','')::numeric,0),'hours',coalesce(nullif(r->>'hours','')::numeric,0)));
 end loop;
 return result||jsonb_build_object('weather',weather,'temperature',coalesce(input->>'temperature',''),'personnel',staff,'files',coalesce(input->'files','[]'));
end $$;
revoke all on function brief_beta_private.diary_header(public.bb_orders,public.bb_members),brief_beta_private.diary_content(jsonb,boolean) from public,anon,authenticated;
create or replace function public.brief_beta_load(workspace_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.bb_members; people jsonb; companies jsonb; projects jsonb; orders jsonb; rev bigint; matches jsonb;
begin
 m:=brief_beta_private.member(workspace_id);
 perform brief_beta_private.expire(workspace_id);
 select revision into rev from public.bb_workspaces where id=workspace_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'role',b.role,'job',b.job,'employer',b.employer,'phone',b.phone,'email',b.email,'active',b.active,'deleted',b.deleted,'external',b.external,'joined',b.auth_user is not null) order by b.name),'[]') into people
 from public.bb_members b where b.workspace=workspace_id and (not m.external or b.id=m.id or exists(select 1 from public.bb_orders o where brief_beta_private.allowed(o,m) and
 (o.body->>'assignee'=b.id::text or o.body->>'issuedBy'=b.id::text or exists(select 1 from jsonb_array_elements(o.body->'participants') p where p->>'user'=b.id::text))));
 select coalesce(jsonb_agg(body||jsonb_build_object('id',id,'project',project) order by body->>'issuedAt' desc),'[]') into orders from public.bb_orders o where brief_beta_private.allowed(o,m);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'number',p.number,'customerNumber',p.customer_number,'customer',p.customer,'name',p.name,'address',p.address,'archived',p.archived,
 'connections',case when not m.external and m.role in ('admin','supervisor') then p.connections else '[]'::jsonb end) order by p.number),'[]') into projects from public.bb_projects p
 where p.workspace=workspace_id and ((not m.external and m.role in ('admin','supervisor')) or exists(select 1 from public.bb_orders o where o.project=p.id and brief_beta_private.allowed(o,m)));
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'kind',c.kind,'archived',c.archived,'contacts',
 case when not m.external and m.role in ('admin','supervisor') then c.contacts else '[]'::jsonb end) order by c.name),'[]') into companies from public.bb_companies c
 where c.workspace=workspace_id and ((not m.external and m.role in ('admin','supervisor')) or exists(select 1 from public.bb_projects p join public.bb_orders o on o.project=p.id where p.customer=c.id and brief_beta_private.allowed(o,m)));
 -- Resolve exact email/phone matches, never names. Ambiguous distinct auth identities produce no link.
 select coalesce(jsonb_agg(x),'[]') into matches from (
 select jsonb_build_object('contact',ct->>'id','company',c.id,'authUser',min(b.auth_user::text)) x
 from public.bb_companies c cross join lateral jsonb_array_elements(c.contacts) ct join public.bb_members b
 on b.active and not b.deleted and b.auth_user is not null and
 ((nullif(lower(trim(ct->>'email')),'') is not null and lower(trim(ct->>'email'))=b.email) or
 (nullif(brief_beta_private.phone(ct->>'phone'),'') is not null and brief_beta_private.phone(ct->>'phone')=brief_beta_private.phone(b.phone)))
 where c.workspace=workspace_id and not m.external and m.role in ('admin','supervisor')
 group by c.id,ct->>'id' having count(distinct b.auth_user)=1) s;
 return jsonb_build_object('user',m.id,'workspace',workspace_id,'revision',rev,'people',people,'companies',companies,'projects',projects,'orders',orders,'contactLinks',matches,'diaryReports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'order',r.order_id,'author',r.author,'date',r.report_date,'submittedAt',r.submitted_at,'updatedAt',r.updated_at,'header',r.header,'content',r.content) order by r.report_date desc,r.updated_at desc) from public.bb_build_reports r join public.bb_orders o on o.id=r.order_id where r.workspace=workspace_id and brief_beta_private.allowed(o,m) and (r.submitted_at is not null or r.author=m.id)),'[]'::jsonb),'inbox',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'order',i.order_id,'report',i.report_id,'kind',i.kind,'at',i.created_at,'readAt',i.read_at,'title',i.title,'sender',i.sender) order by i.created_at desc) from public.bb_inbox i where i.workspace=workspace_id and i.recipient=m.id),'[]'::jsonb));
end $$;
CREATE OR REPLACE FUNCTION public.brief_beta_apply(workspace_id uuid, expected_revision bigint, command jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.bb_members; t public.bb_members; o public.bb_orders; b jsonb; x jsonb; p public.bb_projects; c public.bb_companies;
 kind text:=command->>'kind'; ident uuid; rev bigint; stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); audit text; ids uuid[]; file jsonb; value text; changed boolean; q public.bb_orders; report public.bb_build_reports; report_id uuid; submitted boolean; diary_recipient uuid;
begin
 m:=brief_beta_private.member(workspace_id);
 select revision into rev from public.bb_workspaces where id=workspace_id for update;
 if rev<>expected_revision or expected_revision is null then raise exception 'Arbetsytan har ändrats. Uppdatera och försök igen.'; end if;
 if kind='self_contact' then
  update public.bb_members set phone=brief_beta_private.text_value(command->>'phone',40) where auth_user=m.auth_user and not deleted;
 elsif kind in ('invite_member','edit_member','deactivate_member','activate_member','delete_member') then
  if m.external or m.role='worker' then raise exception 'Du får inte hantera profiler.'; end if;
  if kind='invite_member' then
   value:=lower(trim(command->>'email'));
   if value is null or value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Ange en giltig e-postadress.'; end if;
   if brief_beta_private.rank(command->>'role')<=brief_beta_private.rank(m.role) or command->>'role' not in ('supervisor','worker') then raise exception 'Du får bara skapa profiler med lägre behörighet.'; end if;
   if coalesce((command->>'external')::boolean,false) and command->>'role'<>'worker' then raise exception 'Externa profiler ska vara utförare.'; end if;
   insert into public.bb_members(workspace,email,name,role,job,employer,phone,external)
   values(workspace_id,value,brief_beta_private.text_value(command->>'name',150),command->>'role',brief_beta_private.text_value(command->>'job',150),brief_beta_private.text_value(command->>'employer',200),brief_beta_private.text_value(command->>'phone',40),coalesce((command->>'external')::boolean,false));
  else
   select * into t from public.bb_members where workspace=workspace_id and id=(command->>'id')::uuid and not deleted for update;
   if t.id is null or brief_beta_private.rank(t.role)<=brief_beta_private.rank(m.role) then raise exception 'Du får bara ändra lägre rollers profiler.'; end if;
   if kind='edit_member' then
    if command ? 'role' and command->>'role'<>t.role then raise exception 'Systemrollen är låst. Skapa en ny profil.'; end if;
    update public.bb_members set name=brief_beta_private.text_value(command->>'name',150),job=brief_beta_private.text_value(command->>'job',150),employer=brief_beta_private.text_value(command->>'employer',200),phone=brief_beta_private.text_value(command->>'phone',40) where id=t.id;
   else
    update public.bb_members set active=(kind='activate_member'),deleted=(kind='delete_member') where id=t.id;
    if kind<>'activate_member' then
     for q in select * from public.bb_orders where workspace=workspace_id and body->>'assignee'=t.id::text and body->>'status'<>'Avslutad' loop
      select * into t from public.bb_members where id=(q.body->>'issuedBy')::uuid and active and not deleted;
      b:=jsonb_set(q.body,'{assignee}',case when t.id is null then 'null'::jsonb else to_jsonb(t.id::text) end);
      b:=brief_beta_private.event(b,m.name,'uppdaterade arbetsordern.'); update public.bb_orders set body=b where id=q.id;
     end loop;
    end if;
   end if;
  end if;
 elsif kind in ('save_company','archive_company','save_project','archive_project') then
  if m.external or m.role='worker' then raise exception 'Du får inte hantera företag eller projekt.'; end if;
  ident:=coalesce(nullif(command->>'id','')::uuid,gen_random_uuid());
  if kind in ('save_company','archive_company') then
   select * into c from public.bb_companies where id=ident;
   if c.id is not null and c.workspace<>workspace_id then raise exception 'Fel arbetsyta.'; end if;
   if kind='archive_company' then update public.bb_companies set archived=true where id=ident and workspace=workspace_id;
   else
    x:=coalesce(command->'contacts','[]');
    if jsonb_typeof(x)<>'array' or jsonb_array_length(x)<1 then raise exception 'Lägg till minst en kontaktperson.'; end if;
    for file in select v from jsonb_array_elements(x) v loop
     perform brief_beta_private.text_value(file->>'name',150);
     perform brief_beta_private.text_value(file->>'phone',40,false); perform brief_beta_private.text_value(file->>'email',200,false);
     if nullif(file->>'id','') is null then raise exception 'Kontakt saknar ID.'; end if;
    end loop;
    insert into public.bb_companies(id,workspace,name,kind,contacts) values(ident,workspace_id,brief_beta_private.text_value(command->>'name',200),brief_beta_private.text_value(command->>'companyKind',100),x)
    on conflict(id) do update set name=excluded.name,kind=excluded.kind,contacts=excluded.contacts;
   end if;
  else
   select * into p from public.bb_projects where id=ident;
   if p.id is not null and p.workspace<>workspace_id then raise exception 'Fel arbetsyta.'; end if;
   if kind='archive_project' then update public.bb_projects set archived=true where id=ident and workspace=workspace_id;
   else
    if not exists(select 1 from public.bb_companies where id=(command->>'customer')::uuid and workspace=workspace_id and not archived) then raise exception 'Välj beställare.'; end if;
    x:=coalesce(command->'connections','[]');
    if jsonb_typeof(x)<>'array' then raise exception 'Ogiltiga anknytningar.'; end if;
    for file in select v from jsonb_array_elements(x) v loop
     if not exists(select 1 from public.bb_companies where id=nullif(file->>'company','')::uuid and workspace=workspace_id) and not exists(select 1 from public.bb_members where id=nullif(file->>'person','')::uuid and workspace=workspace_id and not deleted) then raise exception 'Anknytning saknar företag eller person.'; end if;
     perform brief_beta_private.text_value(file->>'function',150,false);
    end loop;
    insert into public.bb_projects(id,workspace,customer,number,customer_number,name,address,connections)
    values(ident,workspace_id,(command->>'customer')::uuid,brief_beta_private.text_value(command->>'number',100),brief_beta_private.text_value(command->>'customerNumber',100),brief_beta_private.text_value(command->>'name',200),brief_beta_private.text_value(command->>'address',300,false),x)
    on conflict(id) do update set customer=excluded.customer,number=excluded.number,customer_number=excluded.customer_number,name=excluded.name,address=excluded.address,connections=excluded.connections;
   end if;
  end if;
 elsif kind='purge_orders' then
  if m.external or m.role<>'admin' then raise exception 'Endast Admin får radera permanent.'; end if;
  select array_agg(id) into ids from public.bb_orders where workspace=workspace_id and body->>'deletedAt' is not null and
  (coalesce((command->>'all')::boolean,false) or id::text in (select jsonb_array_elements_text(coalesce(command->'ids','[]'))));
  perform brief_beta_private.purge(coalesce(ids,'{}'));
 elsif kind='read_inbox' then
  update public.bb_inbox set read_at=now() where id=(command->>'id')::uuid and workspace=workspace_id and recipient=m.id;
  if not found then raise exception 'Inkorgsposten är inte tillgänglig.'; end if;
 elsif kind='save_diary' then
  select * into o from public.bb_orders where id=(command->>'id')::uuid for update;
  if o.id is null or not brief_beta_private.allowed(o,m,true) or o.body->>'deletedAt' is not null or o.body->>'status'='Avslutad' then raise exception 'Du får inte skriva rapport för denna order.'; end if;
  if not coalesce((o.body->>'buildingDiary')::boolean,false) then raise exception 'Byggdagbok är inte aktiverad.'; end if;
  submitted:=coalesce((command->>'submit')::boolean,false);
  report_id:=coalesce(nullif(command->>'report','')::uuid,gen_random_uuid());
  select * into report from public.bb_build_reports where id=report_id for update;
  if report.id is not null and (report.author<>m.id or report.order_id<>o.id or report.workspace<>workspace_id or report.submitted_at is not null) then raise exception 'Rapporten är låst eller tillhör en annan upprättare.'; end if;
  x:=brief_beta_private.diary_content(command->'content',submitted);
  file:=x->'files';
  if jsonb_typeof(file)<>'array' or jsonb_array_length(file)>5 then raise exception 'Högst fem bilagor per rapport.'; end if;
  for b in select v from jsonb_array_elements(file) v loop
   if not (report.id is not null and coalesce(report.content->'files','[]') @> jsonb_build_array(b)) then
    if b->>'path' is distinct from workspace_id::text||'/'||o.id::text||'/'||m.id::text||'/'||(b->>'id')::uuid::text or coalesce(b->>'bucket','brief-beta-files')<>'brief-beta-files' then raise exception 'Ogiltig bilaga.'; end if;
    if not exists(select 1 from storage.objects where bucket_id='brief-beta-files' and name=b->>'path' and owner_id=auth.uid()::text) then raise exception 'Bilagan är inte uppladdad av dig.'; end if;
   end if;
   perform brief_beta_private.text_value(b->>'name',255); perform brief_beta_private.text_value(b->>'type',150);
  end loop;
  if command->>'date' is null then raise exception 'Ange rapportdatum.'; end if;
  insert into public.bb_build_reports(id,workspace,order_id,author,report_date,submitted_at,header,content)
  values(report_id,workspace_id,o.id,m.id,(command->>'date')::date,case when submitted then now() end,brief_beta_private.diary_header(o,m),x)
  on conflict(id) do update set report_date=excluded.report_date,submitted_at=excluded.submitted_at,header=excluded.header,content=excluded.content,updated_at=now();
  if submitted then
   diary_recipient:=nullif(o.body->>'issuedBy','')::uuid;
   insert into public.bb_inbox(workspace,recipient,order_id,report_id,kind,title,sender) values(workspace_id,diary_recipient,o.id,report_id,'diary',(o.body->>'number')||' · '||(o.body->>'title'),m.name);
   update public.bb_orders set body=brief_beta_private.event(o.body,m.name,'sparade en byggdagboksrapport.') where id=o.id;
  end if;
 elsif kind in ('create_order','duplicate_order','edit_order') then
  if m.external or m.role='worker' then raise exception 'Du får inte skapa eller redigera orderuppgifter.'; end if;
  if kind='duplicate_order' then
   select * into o from public.bb_orders where id=(command->>'id')::uuid;
   if o.id is null or not brief_beta_private.allowed(o,m) or o.body->>'deletedAt' is not null then raise exception 'Du saknar åtkomst.'; end if;
   x:=o.body; ident:=gen_random_uuid();
  else x:=command; ident:=coalesce(nullif(command->>'id','')::uuid,gen_random_uuid()); end if;
  if kind='edit_order' then
   select * into o from public.bb_orders where id=ident for update;
   if o.id is null or not brief_beta_private.allowed(o,m,true) or o.body->>'status'='Avslutad' then raise exception 'Ordern får inte redigeras. Återöppna först om den är avslutad.'; end if;
   b:=o.body;
  else
   if exists(select 1 from public.bb_orders where id=ident) then raise exception 'Order-ID används redan.'; end if;
   b:=jsonb_build_object('id',ident,'status','Ej påbörjad','issuedBy',m.id,'issuedAt',stamp,'participants','[]'::jsonb,'notes','[]'::jsonb,'events','[]'::jsonb); end if;
  select * into p from public.bb_projects where id=(x->>'project')::uuid and workspace=workspace_id and not archived;
  if p.id is null then raise exception 'Välj ett aktivt projekt.'; end if;
  select * into t from public.bb_members where id=nullif(x->>'assignee','')::uuid and workspace=workspace_id and active and not deleted;
  if t.id is null or brief_beta_private.rank(t.role)<brief_beta_private.rank(m.role) then raise exception 'Tilldela din egen rollnivå eller lägre.'; end if;
  b:=b||jsonb_build_object('project',p.id,'number',brief_beta_private.text_value(x->>'number',100),'title',brief_beta_private.text_value(x->>'title',200),
  'description',brief_beta_private.text_value(x->>'description',10000,false),'address',brief_beta_private.text_value(x->>'address',300,false),'assignee',t.id,
  'due',brief_beta_private.text_value(x->>'due',30,false),'priority',coalesce(x->>'priority','Normal'));
  b:=b||jsonb_build_object('start',brief_beta_private.text_value(x->>'start',30,false),'access',brief_beta_private.text_value(x->>'access',2000,false),
   'controls',brief_beta_private.order_controls(case when kind='duplicate_order' then x->'controls' else b->'controls' end,x->'controls',x->>'selfLabels',kind='duplicate_order'));
  b:=b||jsonb_build_object('buildingDiary',coalesce((x->>'buildingDiary')::boolean,(b->>'buildingDiary')::boolean,false));
  if b->>'start'<>'' then perform (b->>'start')::date; end if;
  if b->>'start'<>'' and b->>'due'<>'' and (b->>'start')::date>(b->>'due')::date then raise exception 'Planerat färdigt måste vara efter planerad start.'; end if;
  if b->>'priority' not in ('Låg','Normal','Hög') then raise exception 'Ogiltig prioritet.'; end if;
  if b->>'due'<>'' then perform (b->>'due')::date; end if;
  if kind='duplicate_order' then b:=b||jsonb_build_object('number',left(x->>'number',92)||' (kopia)'); end if;
  b:=brief_beta_private.event(b,m.name,case when kind='edit_order' then 'uppdaterade arbetsordern.' else 'skapade arbetsordern.' end);
  insert into public.bb_orders(id,workspace,project,body) values(ident,workspace_id,p.id,b) on conflict(id) do update set project=excluded.project,body=excluded.body;
 else
  select * into o from public.bb_orders where id=(command->>'id')::uuid for update;
  if o.id is null or not brief_beta_private.allowed(o,m) then raise exception 'Du saknar åtkomst till arbetsordern.'; end if;
  b:=o.body;
  if kind in ('trash_order','restore_order') then
   if m.external or m.role='worker' then raise exception 'Du får inte ta bort eller återställa order.'; end if;
   if kind='trash_order' then
    if b->>'deletedAt' is not null then raise exception 'Ordern ligger redan i papperskorgen.'; end if;
    b:=b||jsonb_build_object('deletedAt',stamp); audit:='flyttade arbetsordern till papperskorgen.';
   else
    if b->>'deletedAt' is null then raise exception 'Ordern ligger inte i papperskorgen.'; end if;
    b:=b-'deletedAt'; audit:='återställde arbetsordern.';
   end if;
  elsif kind='join_order' then
   if b->>'deletedAt' is not null then raise exception 'Ordern är borttagen.'; end if;
   if b->>'assignee'=m.id::text then raise exception 'Du är redan utförare.'; end if;
   if m.external and not exists(select 1 from jsonb_array_elements(b->'participants') v where v->>'user'=m.id::text) then raise exception 'Du behöver en inbjudan.'; end if;
   if exists(select 1 from jsonb_array_elements(b->'participants') v where v->>'user'=m.id::text and v->>'acceptedAt' is not null) then raise exception 'Du är redan deltagare.'; end if;
   select v into file from jsonb_array_elements(b->'participants') v where v->>'user'=m.id::text limit 1;
   file:=coalesce(file,jsonb_build_object('user',m.id,'invitedBy',m.id,'invitedAt',stamp))||jsonb_build_object('acceptedAt',stamp);
   select coalesce(jsonb_agg(v),'[]') into x from jsonb_array_elements(b->'participants') v where v->>'user'<>m.id::text;
   b:=jsonb_set(b,'{participants}',x||jsonb_build_array(file)); audit:='anslöt till arbetsordern.';
  else
   if not brief_beta_private.allowed(o,m,true) or b->>'deletedAt' is not null then raise exception 'Anslut till ordern innan du uppdaterar den.'; end if;
   if kind='set_status' then
    value:=command->>'status';
    if value=b->>'status' then raise exception 'Ordern har redan den statusen.'; end if;
    if value not in ('Ej påbörjad','Påbörjad','Avslutad') then raise exception 'Ogiltig status.'; end if;
    if b->>'status'='Avslutad' and (m.role='worker' or m.external) then raise exception 'Endast Admin eller arbetsledare kan återöppna.'; end if;
    if b->>'status'='Avslutad' and value<>'Påbörjad' then raise exception 'Återöppna till Påbörjad.'; end if;
    if value='Ej påbörjad' then raise exception 'Status kan ändras till Påbörjad eller Avslutad.'; end if;
    if value='Avslutad' and brief_beta_private.self_checks_remaining(b)>0 then raise exception 'Egenkontrollen måste vara utförd före avslut.'; end if;
    if value='Påbörjad' and b->>'startedAt' is null then b:=b||jsonb_build_object('startedAt',stamp); end if;
    b:=b||jsonb_build_object('status',value);
    if value='Avslutad' then
     b:=b||jsonb_build_object('completedAt',stamp); value:=brief_beta_private.text_value(command->>'comment',10000,false);
     if value<>'' then b:=jsonb_set(b,'{notes}',coalesce(b->'notes','[]')||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',stamp,'author',m.id,'text',value,'files','[]'::jsonb))); end if;
     insert into public.bb_inbox(workspace,recipient,order_id,kind,title,sender) values(workspace_id,(b->>'issuedBy')::uuid,o.id,'completed',(b->>'number')||' · '||(b->>'title'),m.name);
     audit:='avslutade arbetsordern.';
    else
     if o.body->>'status'='Avslutad' then audit:='återöppnade arbetsordern.'; else audit:='startade arbetsordern.'; end if;
     b:=b-'completedAt';
    end if;
   elsif kind='set_access' then
    if b->>'status'='Avslutad' then raise exception 'Återöppna först.'; end if;
    if command ? 'keysReceived' then b:=b||jsonb_build_object('keysReceived',(command->>'keysReceived')::boolean); end if;
    if command ? 'keysReturned' then b:=b||jsonb_build_object('keysReturned',(command->>'keysReturned')::boolean); end if;
    audit:='uppdaterade nycklar och tillträde.';
   elsif kind='set_control' then
    if b->>'status'='Avslutad' then raise exception 'Återöppna först.'; end if;
    value:=command->>'control';
    if value not in ('risk','self','final') or value is null or not coalesce((b->'controls'->value->>'enabled')::boolean,false) then raise exception 'Kontrollen är inte aktiverad.'; end if;
    if not exists(select 1 from jsonb_array_elements(b->'controls'->value->'items') v where v->>'id'=command->>'item') then raise exception 'Kontrollpunkten saknas.'; end if;
    if jsonb_typeof(command->'done') is distinct from 'boolean' then raise exception 'Ange kontrollens resultat.'; end if;
    select jsonb_agg(case when v->>'id'=command->>'item' then v||jsonb_build_object('done',(command->>'done')::boolean,'comment',brief_beta_private.text_value(command->>'comment',2000,false),'author',m.id,'at',stamp) else v end) into x from jsonb_array_elements(b->'controls'->value->'items') v;
    b:=jsonb_set(b,array['controls',value,'items'],x);
    audit:='uppdaterade en kontrollpunkt.';
   elsif kind='invite_order' then
    if b->>'status'='Avslutad' then raise exception 'Återöppna först.'; end if;
    select * into t from public.bb_members where id=(command->>'member')::uuid and workspace=workspace_id and active and not deleted;
    if t.id is null or brief_beta_private.rank(t.role)<brief_beta_private.rank(m.role) or brief_beta_private.rank(t.role)>coalesce((select brief_beta_private.rank(role) from public.bb_members where id=nullif(b->>'assignee','')::uuid),2) or (t.external and (m.external or m.role='worker')) then raise exception 'Du får inte bjuda in den profilen.'; end if;
    if t.id::text=b->>'assignee' or exists(select 1 from jsonb_array_elements(b->'participants') v where v->>'user'=t.id::text) then raise exception 'Personen finns redan på ordern.'; end if;
    b:=jsonb_set(b,'{participants}',coalesce(b->'participants','[]')||jsonb_build_array(jsonb_build_object('user',t.id,'invitedBy',m.id,'invitedAt',stamp))); audit:='bjöd in '||t.name||'.';
   elsif kind='add_note' then
    if b->>'status'='Avslutad' then raise exception 'Återöppna först.'; end if;
    value:=brief_beta_private.text_value(command->>'text',10000,false); x:=coalesce(command->'files','[]');
    if jsonb_typeof(x)<>'array' or jsonb_array_length(x)>5 or (value='' and x='[]'::jsonb) then raise exception 'Skriv en kommentar eller välj högst fem filer.'; end if;
    for file in select v from jsonb_array_elements(x) v loop
     if file->>'path' is distinct from workspace_id::text||'/'||o.id::text||'/'||m.id::text||'/'||(file->>'id')::uuid::text then raise exception 'Ogiltig bilaga.'; end if;
     if not exists(select 1 from storage.objects where bucket_id='brief-beta-files' and name=file->>'path' and owner_id=auth.uid()::text) then raise exception 'Bilagan är inte uppladdad av dig.'; end if;
     perform brief_beta_private.text_value(file->>'name',255); perform brief_beta_private.text_value(file->>'type',150);
    end loop;
    if command ? 'phase' and command->>'phase' not in ('Före','Under','Efter','Handlingar') then raise exception 'Ogiltigt bildavsnitt.'; end if;
    if command->>'hours' is not null and ((command->>'hours')::numeric<0 or (command->>'hours')::numeric>1000) then raise exception 'Ogiltig tidsåtgång.'; end if;
    b:=jsonb_set(b,'{notes}',coalesce(b->'notes','[]')||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',stamp,'author',m.id,'text',value,'files',x,'phase',coalesce(command->>'phase','Under'),'hours',case when command->>'hours' is null then null else (command->>'hours')::numeric end))); audit:='lade till en kommentar.';
   else raise exception 'Okänd åtgärd.'; end if;
  end if;
  b:=brief_beta_private.event(b,m.name,audit); update public.bb_orders set body=b where id=o.id;
 end if;
 update public.bb_workspaces set revision=revision+1 where id=workspace_id;
 return public.brief_beta_load(workspace_id);
end $function$

;

revoke all on function public.brief_beta_load(uuid),public.brief_beta_apply(uuid,bigint,jsonb) from public,anon;
grant execute on function public.brief_beta_load(uuid),public.brief_beta_apply(uuid,bigint,jsonb) to authenticated;
create or replace function public.brief_beta_file_access(object_name text,writing boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare parts text[]; m public.bb_members; o public.bb_orders;
begin
 parts:=string_to_array(object_name,'/');
 if cardinality(parts)<>4 or auth.uid() is null then return false; end if;
 select * into o from public.bb_orders where id::text=parts[2] and workspace::text=parts[1];
 if o.id is null or o.body->>'deletedAt' is not null then return false; end if;
 select * into m from public.bb_members where workspace=o.workspace and auth_user=auth.uid() and active and not deleted;
 if m.id is null or not brief_beta_private.allowed(o,m,writing) then return false; end if;
 if writing then return parts[3]=m.id::text and o.body->>'status'<>'Avslutad'; end if;
 return exists(select 1 from jsonb_array_elements(o.body->'notes') n cross join lateral jsonb_array_elements(n->'files') f where f->>'path'=object_name) or exists(select 1 from public.bb_build_reports r cross join lateral jsonb_array_elements(r.content->'files') f where r.order_id=o.id and r.workspace=o.workspace and (r.submitted_at is not null or r.author=m.id) and f->>'path'=object_name);
end $$;
create or replace function public.brief_beta_cleanup() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform brief_beta_private.expire();
 -- Also collect abandoned uploads older than one day; never remove recently uploaded pending files.
 insert into public.bb_file_cleanup(path,bucket) select so.name,so.bucket_id from storage.objects so where so.bucket_id='brief-beta-files' and so.created_at<now()-interval '1 day' and not exists(select 1 from public.bb_orders o cross join lateral jsonb_array_elements(o.body->'notes') n cross join lateral jsonb_array_elements(n->'files') f where f->>'path'=so.name and coalesce(f->>'bucket','brief-beta-files')=so.bucket_id) and not exists(select 1 from public.bb_build_reports r cross join lateral jsonb_array_elements(r.content->'files') f where f->>'path'=so.name and coalesce(f->>'bucket','brief-beta-files')=so.bucket_id) on conflict do nothing;
 return coalesce((select jsonb_agg(jsonb_build_object('path',path,'bucket',bucket)) from (select path,bucket from public.bb_file_cleanup order by created_at limit 100) s),'[]');
end $$;

commit;
