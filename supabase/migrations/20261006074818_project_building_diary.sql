begin;
alter table public.bb_projects add column site_manager uuid references public.bb_members, add column verifier uuid references public.bb_members;
update public.bb_projects p set site_manager=coalesce((select nullif(o.body->>'issuedBy','')::uuid from public.bb_orders o where o.project=p.id order by o.body->>'issuedAt' limit 1),(select m.id from public.bb_members m where m.workspace=p.workspace and m.role='admin' and m.active and not m.deleted order by m.id limit 1));
alter table public.bb_build_reports add column project_id uuid references public.bb_projects, add column report_number bigint, add column acknowledgements jsonb not null default '{}';
update public.bb_build_reports r set project_id=o.project from public.bb_orders o where o.id=r.order_id;
with numbered as (select id,row_number() over(partition by project_id order by report_date,updated_at,id) n from public.bb_build_reports) update public.bb_build_reports r set report_number=n.n from numbered n where r.id=n.id;
alter table public.bb_build_reports alter column project_id set not null, alter column order_id drop not null, drop constraint bb_build_reports_order_id_fkey, add constraint bb_build_reports_order_id_fkey foreign key(order_id) references public.bb_orders on delete set null;
create unique index bb_reports_project_number on public.bb_build_reports(project_id,report_number);
alter table public.bb_inbox add column project_id uuid references public.bb_projects;
update public.bb_inbox i set project_id=r.project_id from public.bb_build_reports r where i.report_id=r.id;
alter table public.bb_inbox alter column order_id drop not null, drop constraint bb_inbox_order_id_fkey, add constraint bb_inbox_order_id_fkey foreign key(order_id) references public.bb_orders on delete set null;
-- Compatibility for open browser tabs still using the order-level command.
create function brief_beta_private.attach_legacy_report_project() returns trigger language plpgsql set search_path='' as $$
begin
 if new.project_id is null then select project into new.project_id from public.bb_orders where id=new.order_id and workspace=new.workspace; end if;
 if new.report_number is null then select coalesce(max(report_number),0)+1 into new.report_number from public.bb_build_reports where project_id=new.project_id; end if;
 return new;
end $$;
create trigger bb_report_project_defaults before insert on public.bb_build_reports for each row execute function brief_beta_private.attach_legacy_report_project();
create function brief_beta_private.attach_inbox_project() returns trigger language plpgsql set search_path='' as $$
begin
 if new.project_id is null and new.report_id is not null then select project_id into new.project_id from public.bb_build_reports where id=new.report_id and workspace=new.workspace; end if;return new;
end $$;
create trigger bb_inbox_project_defaults before insert on public.bb_inbox for each row execute function brief_beta_private.attach_inbox_project();
revoke all on function brief_beta_private.attach_legacy_report_project(),brief_beta_private.attach_inbox_project() from public,anon,authenticated;
create index bb_inbox_project on public.bb_inbox(project_id);
create index bb_projects_site_manager on public.bb_projects(site_manager);
create index bb_projects_verifier on public.bb_projects(verifier);
create or replace function brief_beta_private.project_diary_access(p public.bb_projects,m public.bb_members,writing boolean default false) returns boolean language sql stable set search_path='' as $$
 select m.active and not m.deleted and m.workspace=p.workspace and (not writing or not p.archived) and
 ((not m.external and m.role in ('admin','supervisor')) or (not writing and p.verifier=m.id) or
 (not m.external and exists(select 1 from public.bb_orders o where o.project=p.id and o.body->>'deletedAt' is null and brief_beta_private.allowed(o,m,true) and (not writing or o.body->>'status'<>'Avslutad'))));
$$;
alter function public.brief_beta_load(uuid) set schema brief_beta_private;
alter function brief_beta_private.brief_beta_load(uuid) rename to load_before_project_diary;
alter function public.brief_beta_apply(uuid,bigint,jsonb) set schema brief_beta_private;
alter function brief_beta_private.brief_beta_apply(uuid,bigint,jsonb) rename to apply_before_project_diary;
revoke all on function brief_beta_private.load_before_project_diary(uuid),brief_beta_private.apply_before_project_diary(uuid,bigint,jsonb),brief_beta_private.project_diary_access(public.bb_projects,public.bb_members,boolean) from public,anon,authenticated;
create function public.brief_beta_load(workspace_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members; result jsonb;
begin
 m:=brief_beta_private.member(workspace_id);result:=brief_beta_private.load_before_project_diary(workspace_id);
 result:=result||jsonb_build_object('projects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'number',p.number,'customerNumber',p.customer_number,'customer',p.customer,'name',p.name,'address',p.address,'archived',p.archived,'siteManager',p.site_manager,'verifier',p.verifier,'diaryRead',brief_beta_private.project_diary_access(p,m),'diaryWrite',brief_beta_private.project_diary_access(p,m,true),'connections',case when not m.external and m.role in ('admin','supervisor') then p.connections else '[]'::jsonb end) order by p.number) from public.bb_projects p where p.workspace=workspace_id and (brief_beta_private.project_diary_access(p,m) or exists(select 1 from public.bb_orders o where o.project=p.id and brief_beta_private.allowed(o,m)))),'[]'::jsonb));
 result:=result||jsonb_build_object('companies',coalesce((select jsonb_agg(j) from (select value j from jsonb_array_elements(result->'companies') union all select jsonb_build_object('id',c.id,'name',c.name,'kind',c.kind,'archived',c.archived,'contacts','[]'::jsonb) from public.bb_companies c where c.workspace=workspace_id and not exists(select 1 from jsonb_array_elements(result->'companies') v where v->>'id'=c.id::text) and exists(select 1 from public.bb_projects p where p.customer=c.id and brief_beta_private.project_diary_access(p,m))) all_companies),'[]'::jsonb));
 return result||jsonb_build_object('diaryReports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'project',r.project_id,'order',r.order_id,'number',r.report_number,'author',r.author,'date',r.report_date,'submittedAt',r.submitted_at,'updatedAt',r.updated_at,'header',r.header,'content',r.content,'acknowledgements',r.acknowledgements) order by r.report_date desc,r.report_number desc) from public.bb_build_reports r join public.bb_projects p on p.id=r.project_id left join public.bb_orders o on o.id=r.order_id where r.workspace=workspace_id and (r.submitted_at is not null or r.author=m.id) and (brief_beta_private.project_diary_access(p,m) or brief_beta_private.allowed(o,m))),'[]'::jsonb),'inbox',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'project',i.project_id,'order',i.order_id,'report',i.report_id,'kind',i.kind,'at',i.created_at,'readAt',i.read_at,'title',i.title,'sender',i.sender) order by i.created_at desc) from public.bb_inbox i where i.workspace=workspace_id and i.recipient=m.id),'[]'::jsonb));
end $$;
create function public.brief_beta_apply(workspace_id uuid,expected_revision bigint,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members; p public.bb_projects; r public.bb_build_reports; rev bigint; content jsonb; normalized jsonb; staff jsonb:='[]'; item jsonb; k text; number bigint; recipient uuid; report_id uuid; submitted boolean; result jsonb; manager uuid; chosen_verifier uuid; ack text;
begin
 m:=brief_beta_private.member(workspace_id);
 if command->>'kind' not in ('save_project_diary','ack_project_diary','save_project') then return brief_beta_private.apply_before_project_diary(workspace_id,expected_revision,command); end if;
 select revision into rev from public.bb_workspaces where id=workspace_id for update;
 if expected_revision is null or rev<>expected_revision then raise exception 'Arbetsytan har ändrats. Uppdatera och försök igen.'; end if;
 if command->>'kind'='save_project' then
  manager:=coalesce(nullif(command->>'siteManager','')::uuid,m.id);chosen_verifier:=nullif(command->>'verifier','')::uuid;
  if not exists(select 1 from public.bb_members where id=manager and workspace=workspace_id and active and not deleted and not external and role in ('admin','supervisor')) then raise exception 'Välj en aktiv ansvarig platschef.'; end if;
  if chosen_verifier is not null and not exists(select 1 from public.bb_members where id=chosen_verifier and workspace=workspace_id and active and not deleted) then raise exception 'Välj en aktiv beställare/kontrollant.'; end if;
  report_id:=coalesce(nullif(command->>'id','')::uuid,gen_random_uuid());
  result:=brief_beta_private.apply_before_project_diary(workspace_id,expected_revision,command||jsonb_build_object('id',report_id));
  update public.bb_projects set site_manager=manager,verifier=chosen_verifier where id=report_id and workspace=workspace_id;
  return public.brief_beta_load(workspace_id);
 end if;
 select * into p from public.bb_projects where id=(command->>'id')::uuid and workspace=workspace_id for update;
 if p.id is null then raise exception 'Projektet är inte tillgängligt.'; end if;
 report_id:=coalesce(nullif(command->>'report','')::uuid,gen_random_uuid());select * into r from public.bb_build_reports where id=report_id for update;
 if command->>'kind'='ack_project_diary' then
  if r.id is null or r.project_id<>p.id or r.workspace<>workspace_id or r.submitted_at is null then raise exception 'Rapporten är inte tillgänglig för kvittens.'; end if;
  ack:=command->>'ack';
  if ack='siteManager' then recipient:=nullif(r.header->>'siteManagerId','')::uuid;
  elsif ack='verifier' then recipient:=nullif(r.header->>'verifierId','')::uuid;
  else raise exception 'Ogiltig kvittens.'; end if;
  if recipient is distinct from m.id or not brief_beta_private.project_diary_access(p,m) then raise exception 'Endast angiven mottagare får kvittera.'; end if;
  if r.acknowledgements ? ack then raise exception 'Rapporten är redan kvitterad.'; end if;
  update public.bb_build_reports set acknowledgements=acknowledgements||jsonb_build_object(ack,jsonb_build_object('name',m.name,'member',m.id,'at',now())) where id=r.id;
 else
  if not brief_beta_private.project_diary_access(p,m,true) then raise exception 'Du får inte skriva rapport för detta projekt.'; end if;
  if r.id is not null and (r.workspace<>workspace_id or r.project_id<>p.id or r.author<>m.id or r.submitted_at is not null) then raise exception 'Rapporten är låst eller tillhör en annan upprättare.'; end if;
  if not exists(select 1 from public.bb_members where id=p.site_manager and workspace=workspace_id and active and not deleted and not external and role in ('admin','supervisor')) then raise exception 'Ange ansvarig platschef i projektet först.'; end if;
  submitted:=coalesce((command->>'submit')::boolean,false);content:=command->'content';
  normalized:=brief_beta_private.diary_content(content,false);
  foreach k in array array['ongoing','completed','ata','directives','notifications','inspections','drawings','controlPlan','selfChecks','safetyRound','safetyActions','safetyCompleted','other'] loop
   normalized:=normalized||jsonb_build_object(k,brief_beta_private.text_value(content->>k,10000,false));
  end loop;
  if submitted and coalesce(nullif(normalized->>'ongoing',''),nullif(normalized->>'completed',''),nullif(normalized->>'work','')) is null then raise exception 'Beskriv pågående eller färdigställda arbeten.'; end if;
  for item in select v from jsonb_array_elements(normalized->'personnel') v loop
   k:=coalesce(nullif(content->'personnel'->jsonb_array_length(staff)->>'type',''),'Egen');
   if k not in ('Egen','UE','Ej angivet') then raise exception 'Ogiltig personaltyp.'; end if;
   staff:=staff||jsonb_build_array(item||jsonb_build_object('type',k));
  end loop;
  normalized:=jsonb_set(normalized,'{personnel}',staff);
  if jsonb_typeof(normalized->'files')<>'array' or jsonb_array_length(normalized->'files')>5 then raise exception 'Högst fem bilagor per rapport.'; end if;
  for item in select v from jsonb_array_elements(normalized->'files') v loop
   if not (r.id is not null and coalesce(r.content->'files','[]') @> jsonb_build_array(item)) then
    if item->>'path' is distinct from workspace_id::text||'/'||p.id::text||'/'||m.id::text||'/'||(item->>'id')::uuid::text or coalesce(item->>'bucket','brief-beta-files')<>'brief-beta-files' then raise exception 'Ogiltig bilaga.'; end if;
    if not exists(select 1 from storage.objects where bucket_id='brief-beta-files' and name=item->>'path' and owner_id=auth.uid()::text) then raise exception 'Bilagan är inte uppladdad av dig.'; end if;
   end if;
   perform brief_beta_private.text_value(item->>'name',255);perform brief_beta_private.text_value(item->>'type',150);
  end loop;
  number:=r.report_number;if number is null then select coalesce(max(report_number),0)+1 into number from public.bb_build_reports where project_id=p.id; end if;
  content:=case when r.id is not null then r.header else (select jsonb_build_object('project',p.name,'projectNumber',p.number,'customerNumber',p.customer_number,'orderNumber','','customer',c.name,'address',p.address,'author',m.name,'siteManager',sm.name,'siteManagerId',sm.id,'verifier',vm.name,'verifierId',vm.id) from public.bb_companies c join public.bb_members sm on sm.id=p.site_manager left join public.bb_members vm on vm.id=p.verifier where c.id=p.customer) end;
  insert into public.bb_build_reports(id,workspace,project_id,order_id,author,report_date,report_number,submitted_at,header,content) values(report_id,workspace_id,p.id,r.order_id,m.id,(command->>'date')::date,number,case when submitted then now() end,content,normalized)
  on conflict(id) do update set report_date=excluded.report_date,submitted_at=excluded.submitted_at,content=excluded.content,updated_at=now();
  if submitted then
   recipient:=nullif(content->>'siteManagerId','')::uuid;
   insert into public.bb_inbox(workspace,recipient,project_id,order_id,report_id,kind,title,sender) values(workspace_id,recipient,p.id,r.order_id,report_id,'diary',p.number||' · '||p.name||' · Dagrapport '||number,m.name);
  end if;
 end if;
 update public.bb_workspaces set revision=revision+1 where id=workspace_id;
 return public.brief_beta_load(workspace_id);
end $$;
revoke all on function public.brief_beta_load(uuid),public.brief_beta_apply(uuid,bigint,jsonb) from public,anon;
grant execute on function public.brief_beta_load(uuid),public.brief_beta_apply(uuid,bigint,jsonb) to authenticated;
-- Project attachments stay readable even when their original work order is removed.
create or replace function public.brief_beta_file_access(object_name text,writing boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare parts text[]; m public.bb_members; o public.bb_orders; p public.bb_projects;
begin
 parts:=string_to_array(object_name,'/');if cardinality(parts)<>4 or auth.uid() is null then return false; end if;
 select * into m from public.bb_members where workspace::text=parts[1] and auth_user=auth.uid() and active and not deleted;if m.id is null then return false; end if;
 select * into p from public.bb_projects where workspace=m.workspace and id::text=parts[2];
 if p.id is not null then
  if writing then return parts[3]=m.id::text and brief_beta_private.project_diary_access(p,m,true); end if;
  return brief_beta_private.project_diary_access(p,m) and exists(select 1 from public.bb_build_reports r cross join lateral jsonb_array_elements(r.content->'files') f where r.project_id=p.id and (r.submitted_at is not null or r.author=m.id) and f->>'path'=object_name);
 end if;
 select * into o from public.bb_orders where workspace=m.workspace and id::text=parts[2];
 if writing then return o.id is not null and o.body->>'deletedAt' is null and o.body->>'status'<>'Avslutad' and parts[3]=m.id::text and brief_beta_private.allowed(o,m,true); end if;
 return (o.id is not null and o.body->>'deletedAt' is null and brief_beta_private.allowed(o,m) and exists(select 1 from jsonb_array_elements(o.body->'notes') n cross join lateral jsonb_array_elements(n->'files') f where f->>'path'=object_name)) or exists(select 1 from public.bb_build_reports r join public.bb_projects pr on pr.id=r.project_id cross join lateral jsonb_array_elements(r.content->'files') f where r.workspace=m.workspace and (r.submitted_at is not null or r.author=m.id) and (brief_beta_private.project_diary_access(pr,m) or (o.id is not null and brief_beta_private.allowed(o,m))) and f->>'path'=object_name);
end $$;
create or replace function brief_beta_private.purge(ids uuid[]) returns integer language plpgsql security definer set search_path='' as $$
declare amount integer;
begin
 insert into public.bb_file_cleanup(path,bucket)
 select f->>'path',coalesce(f->>'bucket','brief-beta-files') from public.bb_orders o cross join lateral jsonb_array_elements(coalesce(o.body->'notes','[]')) n cross join lateral jsonb_array_elements(coalesce(n->'files','[]')) f
 where o.id=any(ids) and f->>'path' is not null and not exists(select 1 from public.bb_build_reports r cross join lateral jsonb_array_elements(coalesce(r.content->'files','[]')) rf where rf->>'path'=f->>'path') on conflict do nothing;
 delete from public.bb_orders where id=any(ids);get diagnostics amount=row_count;return amount;
end $$;
commit;
