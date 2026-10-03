begin;
-- Order sections preserve existing documentation and enforce completion in the database.
create or replace function brief_beta_private.order_controls(previous jsonb, settings jsonb, labels text, reset_answers boolean default false) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb:='{}'; k text; section jsonb; items jsonb; label text; item jsonb; enabled boolean;
begin
 if settings is not null and jsonb_typeof(settings)<>'object' then raise exception 'Ogiltiga kontrollval.'; end if;
 foreach k in array array['risk','self','final'] loop
  section:=coalesce(previous->k,jsonb_build_object('enabled',false,'items','[]'::jsonb));
  enabled:=coalesce((settings->k->>'enabled')::boolean,(section->>'enabled')::boolean,false);
  items:=coalesce(section->'items','[]');
  if reset_answers then select coalesce(jsonb_agg(jsonb_build_object('id',v->>'id','label',v->>'label','done',false,'comment','')),'[]') into items from jsonb_array_elements(items) v; end if;
  if k='self' and labels is not null then
   if length(labels)>5000 then raise exception 'Kontrollpunkterna är för långa.'; end if;
   foreach label in array string_to_array(labels,E'\n') loop
    label:=trim(label);
    if label<>'' and not exists(select 1 from jsonb_array_elements(items) v where v->>'label'=label) then
     perform brief_beta_private.text_value(label,300);
     items:=items||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'label',label,'done',false,'comment',''));
    end if;
   end loop;
  end if;
  if enabled and jsonb_array_length(items)=0 then
   if k='self' then raise exception 'Lägg till minst en egenkontrollpunkt.'; end if;
   items:=jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'label',case k when 'risk' then 'Riskbedömning dokumenterad' else 'Slutkontroll utförd' end,'done',false,'comment',''));
  end if;
  if jsonb_array_length(items)>50 then raise exception 'Högst 50 punkter per kontroll.'; end if;
  result:=result||jsonb_build_object(k,jsonb_build_object('enabled',enabled,'items',items));
 end loop;
 return result;
end $$;
create or replace function brief_beta_private.self_checks_remaining(body jsonb) returns integer
language sql immutable set search_path='' as $$
 select case when coalesce((body->'controls'->'self'->>'enabled')::boolean,false) then greatest(1,jsonb_array_length(coalesce(body->'controls'->'self'->'items','[]'))) - (select count(*)::integer from jsonb_array_elements(coalesce(body->'controls'->'self'->'items','[]')) i where coalesce((i->>'done')::boolean,false)) else 0 end;
$$;
revoke all on function brief_beta_private.order_controls(jsonb,jsonb,text,boolean), brief_beta_private.self_checks_remaining(jsonb) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.brief_beta_apply(workspace_id uuid, expected_revision bigint, command jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.bb_members; t public.bb_members; o public.bb_orders; b jsonb; x jsonb; p public.bb_projects; c public.bb_companies;
 kind text:=command->>'kind'; ident uuid; rev bigint; stamp text:=to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); audit text; ids uuid[]; file jsonb; value text; changed boolean; q public.bb_orders;
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
commit;
