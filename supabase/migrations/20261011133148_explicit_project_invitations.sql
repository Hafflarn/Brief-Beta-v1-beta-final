begin;
-- Company contact sharing never grants project or order access.
create table public.bb_project_links (
 project_id uuid not null references public.bb_projects on delete cascade,
 firm_id uuid not null references public.bb_firms,
 invited_by uuid not null references public.bb_members,
 state text not null default 'pending' check(state in ('pending','accepted','declined','revoked')),
 local_number text check(length(trim(local_number)) between 1 and 100),
 updated_at timestamptz not null default now(),
 primary key(project_id,firm_id),check(state<>'accepted' or local_number is not null)
);
create table public.bb_order_links (
 order_id uuid not null references public.bb_orders on delete cascade,
 recipient uuid not null references public.bb_members,
 primary key(order_id,recipient)
);
alter table public.bb_project_links enable row level security;
alter table public.bb_order_links enable row level security;
revoke all on public.bb_project_links,public.bb_order_links from public,anon,authenticated;
create unique index bb_project_local_number on public.bb_project_links(firm_id,lower(trim(local_number))) where state='accepted';
create index bb_project_link_firm on public.bb_project_links(firm_id,state);
create index bb_order_link_recipient on public.bb_order_links(recipient);

create function brief_beta_private.linked_order(o public.bb_orders,m public.bb_members) returns boolean language sql stable security definer set search_path='' as $$
 select m.active and not m.deleted and not m.external and o.body->>'deletedAt' is null and exists(
 select 1 from public.bb_order_links l join public.bb_project_links p on p.project_id=o.project and p.firm_id=m.firm_id and p.state='accepted'
 where l.order_id=o.id and l.recipient=m.id);
$$;
create function public.brief_beta_project_links(workspace_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;
begin
 m:=brief_beta_private.member(workspace_id);
 if m.external or brief_beta_private.rank(m.role)>2 then raise exception 'Endast Admin, Platschef och Arbetsledare får hantera projektinbjudningar.';end if;
 return jsonb_build_object('invitations',coalesce((select jsonb_agg(jsonb_build_object('project',p.id,'name',p.name,'sourceNumber',p.number,'number',l.local_number,'firm',l.firm_id,'firmName',f.name,'ownerName',owner.name,'state',l.state,'incoming',l.firm_id=m.firm_id,'people',case when p.firm_id=m.firm_id and l.state='accepted' then coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'role',b.role)) from public.bb_members b where b.firm_id=l.firm_id and b.active and not b.deleted and not b.external),'[]') else '[]'::jsonb end,'orders',case when p.firm_id=m.firm_id then coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'title',o.body->>'title','recipients',coalesce((select jsonb_agg(ol.recipient) from public.bb_order_links ol join public.bb_members rm on rm.id=ol.recipient where ol.order_id=o.id and rm.firm_id=l.firm_id),'[]'))) from public.bb_orders o where o.project=p.id and o.body->>'deletedAt' is null),'[]') else '[]'::jsonb end) order by l.updated_at desc) from public.bb_project_links l join public.bb_projects p on p.id=l.project_id join public.bb_firms f on f.id=l.firm_id join public.bb_firms owner on owner.id=p.firm_id where p.firm_id=m.firm_id or l.firm_id=m.firm_id),'[]'));
end $$;
create function public.brief_beta_project_link_action(workspace_id uuid,project_id uuid,target uuid,action text,local_number text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;p public.bb_projects;l public.bb_project_links;rmember public.bb_members;n text;
begin
 m:=brief_beta_private.member(workspace_id);
 if m.external or brief_beta_private.rank(m.role)>2 then raise exception 'Du får inte hantera projektinbjudningar.';end if;
 -- Serialize per project and recipient firm, including local number collision checks.
 perform 1 from public.bb_firms where id=m.firm_id for update;
 select * into p from public.bb_projects where id=project_id for update;
 if p.id is null then raise exception 'Projektet finns inte.';end if;
 if action='invite' then
  if p.firm_id is distinct from m.firm_id or p.archived then raise exception 'Du får bara bjuda in till ditt eget aktiva projekt.';end if;
  if target=m.firm_id or not brief_beta_private.shared(m.firm_id,target) or not exists(select 1 from public.bb_members where firm_id=target and auth_user is not null and active and not deleted and not external and role in ('admin','site_manager','supervisor')) then raise exception 'Välj ett anslutet företag med ett aktivt ansvarigt konto.';end if;
  select * into l from public.bb_project_links pl where pl.project_id=p.id and pl.firm_id=target;
  if l.state in ('pending','accepted') then raise exception 'Projektinbjudan finns redan.';end if;
  insert into public.bb_project_links(project_id,firm_id,invited_by) values(p.id,target,m.id) on conflict on constraint bb_project_links_pkey do update set state='pending',local_number=null,invited_by=excluded.invited_by,updated_at=now();
 elsif action in ('share_order','unshare_order') then
  if p.firm_id is distinct from m.firm_id then raise exception 'Du får bara dela ditt eget projekts arbetsordrar.';end if;
  select * into rmember from public.bb_members where id=target and active and not deleted and not external;
  if not exists(select 1 from public.bb_project_links pl where pl.project_id=p.id and pl.firm_id=rmember.firm_id and pl.state='accepted') or not exists(select 1 from public.bb_orders o where o.id=nullif(local_number,'')::uuid and o.project=p.id and o.body->>'deletedAt' is null) then raise exception 'Välj en person i ett anslutet projekt och en arbetsorder i det projektet.';end if;
  if action='share_order' then insert into public.bb_order_links(order_id,recipient) values(local_number::uuid,target) on conflict do nothing;else delete from public.bb_order_links where order_id=local_number::uuid and recipient=target;end if;
 else
  select * into l from public.bb_project_links pl where pl.project_id=p.id and pl.firm_id=target for update;
  if l.project_id is null then raise exception 'Projektinbjudan saknas.';end if;
  if action in ('accept','decline') then
   if m.firm_id<>l.firm_id or l.state<>'pending' or p.archived then raise exception 'Endast mottagarföretaget får svara på en väntande inbjudan.';end if;
   if action='accept' then
    n:=brief_beta_private.text_value(local_number,100);
    if exists(select 1 from public.bb_projects own where own.firm_id=m.firm_id and lower(trim(own.number))=lower(n)) or exists(select 1 from public.bb_project_links other where other.firm_id=m.firm_id and other.state='accepted' and lower(trim(other.local_number))=lower(n)) then raise exception 'Det egna projektnumret används redan. Välj ett annat.';end if;
   end if;
   update public.bb_project_links pl set state=case action when 'accept' then 'accepted' else 'declined' end,local_number=n,updated_at=now() where pl.project_id=p.id and pl.firm_id=target;
  elsif action in ('revoke','renumber') then
   if action='renumber' then
    if m.firm_id<>l.firm_id or l.state<>'accepted' then raise exception 'Du får bara ändra ditt eget projektnummer.';end if;
    n:=brief_beta_private.text_value(local_number,100);
    if exists(select 1 from public.bb_projects own where own.firm_id=m.firm_id and lower(trim(own.number))=lower(n)) then raise exception 'Det egna projektnumret används redan.';end if;
    update public.bb_project_links pl set local_number=n,updated_at=now() where pl.project_id=p.id and pl.firm_id=target;
   else
    if m.firm_id not in (p.firm_id,l.firm_id) then raise exception 'Du saknar åtkomst till kopplingen.';end if;
    update public.bb_project_links pl set state='revoked',updated_at=now() where pl.project_id=p.id and pl.firm_id=target;
    delete from public.bb_order_links ol using public.bb_orders o,public.bb_members b where ol.order_id=o.id and ol.recipient=b.id and o.project=p.id and b.firm_id=target;
   end if;
  else raise exception 'Ogiltig åtgärd.';end if;
 end if;
 update public.bb_workspaces set revision=revision+1 where id in (p.workspace,m.workspace,(select workspace from public.bb_firms where id=case when rmember.id is null then target else rmember.firm_id end));
 return public.brief_beta_project_links(workspace_id);
exception when unique_violation then raise exception 'Det egna projektnumret används redan. Välj ett annat.';
end $$;

-- Own projects cannot collide with accepted project numbers in the same firm.
create function brief_beta_private.check_project_number() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.bb_firms where id=new.firm_id for update;
 if exists(select 1 from public.bb_project_links l where l.firm_id=new.firm_id and l.state='accepted' and lower(trim(l.local_number))=lower(trim(new.number))) then raise exception 'Det egna projektnumret används redan av ett anslutet projekt.';end if;
 return new;
end $$;
create trigger bb_project_number before insert or update of number on public.bb_projects for each row execute function brief_beta_private.check_project_number();

-- Keep the original own-firm loader and append only explicitly linked records.
alter function public.brief_beta_load(uuid) rename to load_before_project_links;
alter function public.load_before_project_links(uuid) set schema brief_beta_private;
create function public.brief_beta_load(workspace_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;s jsonb;projects jsonb;orders jsonb;companies jsonb;people jsonb;
begin
 m:=brief_beta_private.member(workspace_id);s:=brief_beta_private.load_before_project_links(workspace_id);
 select coalesce(jsonb_agg(o.body||jsonb_build_object('id',o.id,'project',o.project,'shared',true)),'[]') into orders from public.bb_orders o where o.firm_id<>m.firm_id and brief_beta_private.linked_order(o,m);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'number',l.local_number,'customerNumber',p.number,'customer',p.firm_id,'address',p.address,'archived',p.archived,'connections','[]'::jsonb,'shared',true,'diaryRead',false,'diaryWrite',false)),'[]') into projects from public.bb_project_links l join public.bb_projects p on p.id=l.project_id where l.firm_id=m.firm_id and l.state='accepted' and p.firm_id<>m.firm_id and not m.external and (brief_beta_private.rank(m.role)<3 or exists(select 1 from public.bb_orders o where o.project=p.id and brief_beta_private.linked_order(o,m)));
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'kind','Projektanslutning','archived',false,'contactAccess',false,'shared',true,'contacts','[]'::jsonb)),'[]') into companies from public.bb_firms f where exists(select 1 from jsonb_array_elements(projects) p where p->>'customer'=f.id::text);
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'firm',b.firm_id,'name',b.name,'role',b.role,'job','','employer','','phone','','email','','active',b.active,'deleted',b.deleted,'external',true,'joined',b.auth_user is not null)),'[]') into people from public.bb_members b where b.firm_id<>m.firm_id and exists(select 1 from jsonb_array_elements(orders) o where o->>'assignee'=b.id::text or o->>'issuedBy'=b.id::text or exists(select 1 from jsonb_array_elements(coalesce(o->'notes','[]')) n where n->>'author'=b.id::text));
 return s||jsonb_build_object('projects',(s->'projects')||projects,'orders',(s->'orders')||orders,'companies',(s->'companies')||companies,'people',(s->'people')||people);
end $$;

-- Shared orders expose only their own published note attachments, never project diary files.
alter function public.brief_beta_file_access(text,boolean) rename to file_access_before_project_links;
alter function public.file_access_before_project_links(text,boolean) set schema brief_beta_private;
create function public.brief_beta_file_access(object_name text,writing boolean default false) returns boolean language plpgsql stable security definer set search_path='' as $$
declare parts text[];
begin
 if brief_beta_private.file_access_before_project_links(object_name,writing) then return true;end if;
 if writing or auth.uid() is null then return false;end if;
 parts:=string_to_array(object_name,'/');if cardinality(parts)<>4 then return false;end if;
 return exists(select 1 from public.bb_orders o join public.bb_members m on m.auth_user=auth.uid() where o.id::text=parts[2] and o.workspace::text=parts[1] and brief_beta_private.linked_order(o,m) and exists(select 1 from jsonb_array_elements(coalesce(o.body->'notes','[]')) n cross join lateral jsonb_array_elements(coalesce(n->'files','[]')) f where f->>'path'=object_name));
end $$;
drop policy bb_files_read on storage.objects;
drop policy bb_files_upload on storage.objects;
create policy bb_files_read on storage.objects for select to authenticated using(bucket_id='brief-beta-files' and public.brief_beta_file_access(name));
create policy bb_files_upload on storage.objects for insert to authenticated with check(bucket_id='brief-beta-files' and owner_id=auth.uid()::text and public.brief_beta_file_access(name,true));
revoke all on function public.brief_beta_load(uuid),public.brief_beta_file_access(text,boolean),public.brief_beta_project_links(uuid),public.brief_beta_project_link_action(uuid,uuid,uuid,text,text) from public,anon;
grant execute on function public.brief_beta_load(uuid),public.brief_beta_file_access(text,boolean),public.brief_beta_project_links(uuid),public.brief_beta_project_link_action(uuid,uuid,uuid,text,text) to authenticated;
revoke all on all functions in schema brief_beta_private from public,anon,authenticated;
commit;
