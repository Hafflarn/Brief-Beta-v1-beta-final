-- Firm IDs are authoritative. Display names never grant access.
create table public.bb_firms(id uuid primary key default gen_random_uuid(), workspace uuid not null references public.bb_workspaces, name text not null, unique(workspace,name));
alter table public.bb_firms enable row level security;
revoke all on public.bb_firms from public,anon,authenticated;
insert into public.bb_firms(workspace,name) select distinct workspace,employer from public.bb_members;
alter table public.bb_members add column firm_id uuid references public.bb_firms;
update public.bb_members m set firm_id=f.id from public.bb_firms f where f.workspace=m.workspace and f.name=m.employer;
alter table public.bb_members alter column firm_id set not null;
alter table public.bb_orders add column firm_id uuid references public.bb_firms;
update public.bb_orders o set firm_id=m.firm_id from public.bb_members m where m.id::text=o.body->>'issuedBy' and m.workspace=o.workspace;
alter table public.bb_projects add column firm_id uuid references public.bb_firms;
update public.bb_projects p set firm_id=m.firm_id from public.bb_members m where m.id=p.site_manager and m.workspace=p.workspace;
update public.bb_projects p set firm_id=(select o.firm_id from public.bb_orders o where o.project=p.id and o.firm_id is not null order by o.id limit 1) where p.firm_id is null;
update public.bb_projects p set firm_id=(select f.id from public.bb_firms f join public.bb_members m on m.firm_id=f.id where f.workspace=p.workspace and not m.external and m.role='admin' order by m.id limit 1) where p.firm_id is null;
alter table public.bb_companies add column linked_firm_id uuid references public.bb_firms;
alter table public.bb_companies add column owner_firm_id uuid references public.bb_firms;
update public.bb_companies c set owner_firm_id=(select m.firm_id from public.bb_members m where m.workspace=c.workspace and m.active and not m.deleted and not m.external and m.role='admin' order by m.id limit 1);

-- Ambiguous company names are not auto-linked.
update public.bb_companies c set linked_firm_id=(select min(f.id::text)::uuid from public.bb_firms f where lower(trim(f.name))=lower(trim(c.name)) having count(*)=1);
create table public.bb_firm_requests(id uuid primary key default gen_random_uuid(), sender uuid not null references public.bb_firms, recipient uuid not null references public.bb_firms, requester uuid not null references public.bb_members, requester_role text not null check(requester_role in ('admin','site_manager','supervisor')), state text not null default 'pending' check(state in ('pending','accepted','declined','revoked')), created_at timestamptz not null default now(), responded_at timestamptz, responded_by uuid references public.bb_members, check(sender<>recipient));
create unique index bb_one_firm_relationship on public.bb_firm_requests(least(sender,recipient),greatest(sender,recipient)) where state in ('pending','accepted');
alter table public.bb_firm_requests enable row level security;
revoke all on public.bb_firm_requests from public,anon,authenticated;
create function brief_beta_private.shared(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$select a=b or exists(select 1 from public.bb_firm_requests r where r.state='accepted' and ((r.sender=a and r.recipient=b) or (r.sender=b and r.recipient=a)))$$;
create function brief_beta_private.manager_in_firm(actor uuid,f uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.bb_members m where m.auth_user=actor and m.firm_id=f and m.active and not m.deleted and not m.external and m.role in ('admin','site_manager','supervisor'))$$;
-- Populate new rows from server-controlled ownership; never accept a browser firm ID.
create function brief_beta_private.assign_firm() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.bb_members;
begin
 if tg_table_name='bb_orders' then
  select * into m from public.bb_members where id::text=new.body->>'issuedBy' and workspace=new.workspace;
  if tg_op='INSERT' then new.firm_id:=m.firm_id; else new.firm_id:=old.firm_id; end if;
  if m.firm_id is distinct from new.firm_id then raise exception 'Orderns företagskoppling är låst.'; end if;
  if exists(select 1 from public.bb_projects p where p.id=new.project and p.firm_id is distinct from new.firm_id) then raise exception 'Välj ett projekt i ditt företag.'; end if;
  if exists(select 1 from public.bb_members b where (b.id::text=new.body->>'assignee' or exists(select 1 from jsonb_array_elements(coalesce(new.body->'participants','[]')) x where x->>'user'=b.id::text)) and (b.firm_id is distinct from new.firm_id or b.workspace<>new.workspace)) then raise exception 'Utförare och deltagare måste arbeta på samma företag som arbetsordern.'; end if;
 elsif tg_table_name='bb_projects' then
  if tg_op='INSERT' then select * into m from public.bb_members where auth_user=auth.uid() and workspace=new.workspace and active and not deleted; new.firm_id:=m.firm_id; else new.firm_id:=old.firm_id; end if;
 elsif tg_table_name='bb_companies' then
  if tg_op='INSERT' then select * into m from public.bb_members where auth_user=auth.uid() and workspace=new.workspace and active and not deleted;new.owner_firm_id:=m.firm_id;else new.owner_firm_id:=old.owner_firm_id;new.linked_firm_id:=old.linked_firm_id;end if;
 elsif tg_table_name='bb_members' then
  if tg_op='UPDATE' then new.firm_id:=old.firm_id; end if;
  select f.name into new.employer from public.bb_firms f where f.id=new.firm_id and f.workspace=new.workspace;
  if new.employer is null then raise exception 'Välj ett giltigt företag.'; end if;
 end if;
 return new;
end $$;
create trigger bb_order_firm before insert or update on public.bb_orders for each row execute function brief_beta_private.assign_firm();
create trigger bb_project_firm before insert or update on public.bb_projects for each row execute function brief_beta_private.assign_firm();
create trigger bb_company_firm before insert or update on public.bb_companies for each row execute function brief_beta_private.assign_firm();
create trigger bb_member_firm before insert or update on public.bb_members for each row execute function brief_beta_private.assign_firm();
CREATE OR REPLACE FUNCTION brief_beta_private.allowed(o bb_orders, m bb_members, writing boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare target public.bb_members; participant boolean; level integer;
begin
 if not m.active or m.deleted or o.workspace<>m.workspace or o.firm_id is distinct from m.firm_id then return false; end if;
 select * into target from public.bb_members where id=nullif(o.body->>'assignee','')::uuid;
 level:=case when target.id is null then 2 else brief_beta_private.rank(target.role) end;
 -- No numeric classification is stored on orders; the assignee's locked role determines access.
 if not writing and not m.external and o.body->>'deletedAt' is null then return true; end if;
 if brief_beta_private.rank(m.role)>level then return false; end if;
 if o.body->>'deletedAt' is not null then return not writing and not m.external and m.role in ('admin','site_manager','supervisor'); end if;
 select exists(select 1 from jsonb_array_elements(coalesce(o.body->'participants','[]')) p where p->>'user'=m.id::text) into participant;
 if m.external then
  return (o.body->>'assignee'=m.id::text or participant) and (not writing or o.body->>'assignee'=m.id::text or exists(select 1 from jsonb_array_elements(o.body->'participants') p where p->>'user'=m.id::text and p->>'acceptedAt' is not null));
 end if;
 if not writing then return true; end if;
 return m.role in ('admin','site_manager','supervisor') or o.body->>'assignee'=m.id::text or exists(select 1 from jsonb_array_elements(o.body->'participants') p where p->>'user'=m.id::text and p->>'acceptedAt' is not null);
end $function$;
CREATE OR REPLACE FUNCTION public.brief_beta_bootstrap()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u auth.users; w uuid; n text; j text; e text; p text;
begin
 select * into u from auth.users where id=auth.uid() for update;
 if u.id is null or u.email_confirmed_at is null then raise exception 'Bekräfta din e-post först.'; end if;
 n:=brief_beta_private.text_value(u.raw_user_meta_data->>'full_name',150,false);
 j:=brief_beta_private.text_value(u.raw_user_meta_data->>'job_title',150,false);
 e:=brief_beta_private.text_value(u.raw_user_meta_data->>'company_name',200,false);
 p:=brief_beta_private.text_value(u.raw_user_meta_data->>'phone',40,false);
 -- Confirmed Auth email is authoritative, never trust a browser email for membership claims.
 update public.bb_members set email=lower(u.email),job=case when job='' then j else job end,employer=case when employer='' then e else employer end,phone=case when phone='' then p else phone end where auth_user=u.id and not deleted;
 if exists(select 1 from public.bb_members where auth_user=u.id and active and not deleted and (job='' or employer='' or phone='')) then raise exception 'Komplettera namn, yrkesroll, företag och telefon i din profil.'; end if;
 update public.bb_members set auth_user=u.id,joined_at=now(),name=coalesce(nullif(n,''),name),
 job=coalesce(nullif(j,''),job),employer=coalesce(nullif(e,''),employer),phone=coalesce(nullif(p,''),phone)
 where auth_user is null and email=lower(u.email) and not deleted and active;
 if not exists(select 1 from public.bb_members where auth_user=u.id and active and not deleted) then raise exception 'Kontot måste skapas av Admin, Platschef eller Arbetsledare.'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.created_at)
 from public.bb_workspaces b join public.bb_members m on m.workspace=b.id where m.auth_user=u.id and m.active and not m.deleted),'[]');
end $function$;
CREATE OR REPLACE FUNCTION brief_beta_private.project_diary_access(p bb_projects, m bb_members, writing boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select m.active and not m.deleted and m.workspace=p.workspace and m.firm_id=p.firm_id and (not writing or not p.archived) and
 ((not m.external and m.role in ('admin','site_manager','supervisor')) or (not writing and p.verifier=m.id) or
 (not m.external and exists(select 1 from public.bb_orders o where o.project=p.id and o.body->>'deletedAt' is null and brief_beta_private.allowed(o,m,true) and (not writing or o.body->>'status'<>'Avslutad'))));
$function$;
CREATE OR REPLACE FUNCTION brief_beta_private.load_before_project_diary(workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.bb_members; people jsonb; companies jsonb; projects jsonb; orders jsonb; rev bigint; matches jsonb;
begin
 m:=brief_beta_private.member(workspace_id);
 perform brief_beta_private.expire(workspace_id);
 select revision into rev from public.bb_workspaces where id=workspace_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'firm',b.firm_id,'role',b.role,'organizationLevel',b.organization_level,'job',b.job,'employer',b.employer,'phone',b.phone,'email',b.email,'active',b.active,'deleted',b.deleted,'external',b.external,'joined',b.auth_user is not null) order by b.name),'[]') into people
 from public.bb_members b where b.workspace=workspace_id and b.firm_id=m.firm_id and (not m.external or b.id=m.id or exists(select 1 from public.bb_orders o where brief_beta_private.allowed(o,m) and
 (o.body->>'assignee'=b.id::text or o.body->>'issuedBy'=b.id::text or exists(select 1 from jsonb_array_elements(o.body->'participants') p where p->>'user'=b.id::text))));
 select coalesce(jsonb_agg(body||jsonb_build_object('id',id,'project',project) order by body->>'issuedAt' desc),'[]') into orders from public.bb_orders o where brief_beta_private.allowed(o,m);
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'number',p.number,'customerNumber',p.customer_number,'customer',p.customer,'name',p.name,'address',p.address,'archived',p.archived,
 'connections',case when not m.external and m.role in ('admin','site_manager','supervisor') then p.connections else '[]'::jsonb end) order by p.number),'[]') into projects from public.bb_projects p
 where p.workspace=workspace_id and p.firm_id=m.firm_id and ((not m.external and m.role in ('admin','site_manager','supervisor')) or exists(select 1 from public.bb_orders o where o.project=p.id and brief_beta_private.allowed(o,m)));
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'kind',c.kind,'archived',c.archived,'linkedFirm',c.linked_firm_id,'contactAccess',coalesce(((c.linked_firm_id is null and c.owner_firm_id=m.firm_id) or brief_beta_private.shared(m.firm_id,c.linked_firm_id)),false),'contacts',
 case when not m.external and m.role in ('admin','site_manager','supervisor') and ((c.linked_firm_id is null and c.owner_firm_id=m.firm_id) or brief_beta_private.shared(m.firm_id,c.linked_firm_id)) then c.contacts else '[]'::jsonb end) order by c.name),'[]') into companies from public.bb_companies c
 where c.workspace=workspace_id and ((not m.external and m.role in ('admin','site_manager','supervisor')) or exists(select 1 from public.bb_projects p join public.bb_orders o on o.project=p.id where p.customer=c.id and brief_beta_private.allowed(o,m)));
 matches:='[]'::jsonb;
 return jsonb_build_object('user',m.id,'workspace',workspace_id,'revision',rev,'people',people,'companies',companies,'projects',projects,'orders',orders,'contactLinks',matches,'diaryReports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'order',r.order_id,'author',r.author,'date',r.report_date,'submittedAt',r.submitted_at,'updatedAt',r.updated_at,'header',r.header,'content',r.content) order by r.report_date desc,r.updated_at desc) from public.bb_build_reports r join public.bb_orders o on o.id=r.order_id where r.workspace=workspace_id and brief_beta_private.allowed(o,m) and (r.submitted_at is not null or r.author=m.id)),'[]'::jsonb),'inbox',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'order',i.order_id,'report',i.report_id,'kind',i.kind,'at',i.created_at,'readAt',i.read_at,'title',i.title,'sender',i.sender) order by i.created_at desc) from public.bb_inbox i where i.workspace=workspace_id and i.recipient=m.id),'[]'::jsonb));
end $function$;
alter function public.brief_beta_apply(uuid,bigint,jsonb) rename to apply_before_company_access;
alter function public.apply_before_company_access(uuid,bigint,jsonb) set schema brief_beta_private;
create function public.brief_beta_apply(workspace_id uuid,expected_revision bigint,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members; t public.bb_members; c public.bb_companies; kind text:=command->>'kind'; p public.bb_projects;
begin
 m:=brief_beta_private.member(workspace_id);
 if kind in ('save_company','archive_company') then
  select * into c from public.bb_companies where id=nullif(command->>'id','')::uuid;
  if c.id is not null and c.owner_firm_id is distinct from m.firm_id then raise exception 'Du får bara ändra ditt eget företags registrerade kunder.';end if;
 end if;
 if kind='invite_member' then raise exception 'Skapa kontot med ett tilldelat lösenord via kontohanteringen.'; end if;
 if kind in ('edit_member','deactivate_member','activate_member','delete_member') then
  select * into t from public.bb_members where id=(command->>'id')::uuid;
  if t.firm_id is distinct from m.firm_id then raise exception 'Du får bara hantera ditt eget företags konton.'; end if;
 end if;
 if kind='purge_orders' and exists(select 1 from public.bb_orders o where o.id in (select value::uuid from jsonb_array_elements_text(command->'ids')) and o.firm_id is distinct from m.firm_id) then raise exception 'Du saknar åtkomst till arbetsordern.'; end if;
 if kind in ('save_project','archive_project','save_project_diary','ack_project_diary') then
  select * into p from public.bb_projects where id=nullif(command->>'id','')::uuid;
  if p.id is not null and p.firm_id is distinct from m.firm_id then raise exception 'Projektet tillhör ett annat företag.'; end if;
  if kind='save_project' and exists(select 1 from public.bb_members b where b.id in (nullif(command->>'siteManager','')::uuid,nullif(command->>'verifier','')::uuid) and b.firm_id is distinct from m.firm_id) then raise exception 'Välj ansvariga i ditt eget företag.'; end if;
 end if;
 return brief_beta_private.apply_before_company_access(workspace_id,expected_revision,command);
end $$;
revoke all on function public.brief_beta_apply(uuid,bigint,jsonb) from public,anon;
grant execute on function public.brief_beta_apply(uuid,bigint,jsonb) to authenticated;
create or replace function public.brief_beta_contact_profile(workspace_id uuid,company_id uuid,contact_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members; c public.bb_companies; ct jsonb; b public.bb_members;
begin
 m:=brief_beta_private.member(workspace_id);if m.external or brief_beta_private.rank(m.role)>2 then raise exception 'Du saknar åtkomst till företagsbanken.';end if;
 select * into c from public.bb_companies where id=company_id and workspace=workspace_id;
 if c.id is null then return null;end if;
 if ((c.linked_firm_id is null and c.owner_firm_id=m.firm_id) or brief_beta_private.shared(m.firm_id,c.linked_firm_id)) is not true then return null;end if;
 select value into ct from jsonb_array_elements(c.contacts) where value->>'id'=contact_id;
 if ct is null then return null;end if;
 select * into b from public.bb_members where firm_id=coalesce(c.linked_firm_id,m.firm_id) and active and not deleted and email=lower(trim(ct->>'email')) order by id limit 1;
 if b.id is null then return null;end if;
 return jsonb_build_object('id',b.id,'name',b.name,'role',b.role,'organizationLevel',b.organization_level,'job',b.job,'employer',b.employer,'phone',b.phone,'email',b.email);
end $$;
create or replace function public.brief_beta_company_organization(workspace_id uuid,company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;c public.bb_companies;f uuid;result jsonb;ct jsonb;profile jsonb;
begin
 m:=brief_beta_private.member(workspace_id);if m.external or brief_beta_private.rank(m.role)>2 then raise exception 'Du saknar åtkomst till företagsbanken.';end if;
 select * into c from public.bb_companies where id=company_id and workspace=workspace_id;
 if c.id is null then raise exception 'Företaget finns inte i arbetsytan.';end if;
 f:=c.linked_firm_id;
 if ((f is null and c.owner_firm_id=m.firm_id) or brief_beta_private.shared(m.firm_id,f)) is not true then return '[]'::jsonb;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'role',b.role,'organizationLevel',b.organization_level,'job',b.job,'employer',b.employer,'phone',b.phone,'email',b.email) order by b.name),'[]') into result from public.bb_members b where b.firm_id=f and active and not deleted;
 for ct in select value from jsonb_array_elements(c.contacts) loop
  profile:=public.brief_beta_contact_profile(workspace_id,company_id,ct->>'id');
  if profile is null then result:=result||jsonb_build_array(ct||jsonb_build_object('id','contact:'||(ct->>'id'),'role',coalesce(ct->>'organizationRole','client'),'employer',c.name,'job',''));end if;
 end loop;
 return result;
end $$;
create or replace function public.brief_beta_search_directory(workspace_id uuid,company_query text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;result jsonb;
begin
 m:=brief_beta_private.member(workspace_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'job',b.job,'employer',b.employer)),'[]') into result from public.bb_members b where b.firm_id=m.firm_id and b.active and not b.deleted and strpos(lower(b.employer),lower(trim(company_query)))>0;
 return result;
end $$;
create function public.brief_beta_firm_directory(workspace_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members; result jsonb;
begin
 m:=brief_beta_private.member(workspace_id);if m.external or brief_beta_private.rank(m.role)>2 then raise exception 'Endast Admin, Platschef och Arbetsledare får hantera företagsförfrågningar.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'own',f.id=m.firm_id,'shared',brief_beta_private.shared(m.firm_id,f.id),'people',case when brief_beta_private.shared(m.firm_id,f.id) then coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'role',b.role,'organizationLevel',b.organization_level,'job',b.job,'employer',b.employer,'phone',b.phone,'email',b.email) order by b.name) from public.bb_members b where b.firm_id=f.id and active and not deleted),'[]') else '[]'::jsonb end) order by f.name),'[]') into result from public.bb_firms f where exists(select 1 from public.bb_members b where b.firm_id=f.id and active and not deleted and auth_user is not null and not external);
 return jsonb_build_object('firms',result,'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'sender',r.sender,'recipient',r.recipient,'senderName',sf.name,'recipientName',rf.name,'role',r.requester_role,'state',r.state,'incoming',r.recipient=m.firm_id,'canRespond',r.recipient=m.firm_id and r.requester_role=m.role,'at',r.created_at) order by r.created_at desc) from public.bb_firm_requests r join public.bb_firms sf on sf.id=r.sender join public.bb_firms rf on rf.id=r.recipient where r.sender=m.firm_id or r.recipient=m.firm_id),'[]'));
end $$;
create function public.brief_beta_firm_request(workspace_id uuid,target uuid,action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;r public.bb_firm_requests;
begin
 m:=brief_beta_private.member(workspace_id);if m.external or brief_beta_private.rank(m.role)>2 then raise exception 'Du får inte hantera företagsförfrågningar.';end if;
 perform 1 from public.bb_firms where id=m.firm_id for update;
 if action='request' then
  if target=m.firm_id or not exists(select 1 from public.bb_members where firm_id=target and active and not deleted and not external and auth_user is not null and role=m.role) then raise exception 'Företaget behöver ett aktivt konto med samma roll som du.';end if;
  if exists(select 1 from public.bb_firm_requests where state in ('pending','accepted') and ((sender=m.firm_id and recipient=target) or (recipient=m.firm_id and sender=target))) then raise exception 'En förfrågan eller godkänd koppling finns redan.';end if;
  insert into public.bb_firm_requests(sender,recipient,requester,requester_role) values(m.firm_id,target,m.id,m.role);
 else
  select * into r from public.bb_firm_requests where id=target for update;
  if r.id is null then raise exception 'Förfrågan saknas.';end if;
  if action in ('accept','decline') then
   if r.recipient<>m.firm_id or r.requester_role<>m.role or r.state<>'pending' then raise exception 'En mottagare med samma roll måste svara på förfrågan.';end if;
   update public.bb_firm_requests set state=case action when 'accept' then 'accepted' else 'declined' end,responded_at=now(),responded_by=m.id where id=r.id;
  elsif action='revoke' then
   if m.firm_id not in (r.sender,r.recipient) or r.state not in ('pending','accepted') then raise exception 'Du saknar åtkomst till kopplingen.';end if;
   update public.bb_firm_requests set state='revoked',responded_at=now(),responded_by=m.id where id=r.id;
  else raise exception 'Ogiltigt svar.';end if;
 end if;
 update public.bb_workspaces set revision=revision+1 where id in (select workspace from public.bb_firms where id=m.firm_id or id=case when action='request' then target else case when r.sender=m.firm_id then r.recipient else r.sender end end);
 return public.brief_beta_firm_directory(workspace_id);
end $$;
-- Account provisioning can be called only by the authenticated server, with a validated actor.
create function public.brief_beta_account_context(workspace_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;
begin m:=brief_beta_private.member(workspace_id);if m.external or brief_beta_private.rank(m.role)>2 then raise exception 'Du får inte skapa konton.';end if;return jsonb_build_object('firm',m.firm_id,'employer',m.employer,'role',m.role);end $$;
create function public.brief_beta_register_account(actor uuid,workspace_id uuid,expected_revision bigint,new_user uuid,details jsonb) returns void language plpgsql security definer set search_path='' as $$
declare m public.bb_members;rev bigint;
begin
 select * into m from public.bb_members where auth_user=actor and workspace=workspace_id and active and not deleted and not external;
 if m.id is null or brief_beta_private.rank(m.role)>2 then raise exception 'Du får inte skapa konton.';end if;
 if details->>'role' not in ('admin','site_manager','supervisor','worker') or (m.role<>'admin' and brief_beta_private.rank(details->>'role')<brief_beta_private.rank(m.role)) then raise exception 'Du får inte tilldela den rollen.';end if;
 if not exists(select 1 from auth.users where id=new_user and lower(email)=lower(trim(details->>'email'))) then raise exception 'Kontot måste skapas först.';end if;
 select revision into rev from public.bb_workspaces where id=workspace_id for update;
 if rev is distinct from expected_revision then raise exception 'Arbetsytan har ändrats. Uppdatera och försök igen.';end if;
 insert into public.bb_members(workspace,firm_id,auth_user,email,name,role,job,employer,phone,joined_at,organization_level) values(workspace_id,m.firm_id,new_user,lower(trim(details->>'email')),brief_beta_private.text_value(details->>'name',150),details->>'role',brief_beta_private.text_value(details->>'job',150),m.employer,brief_beta_private.text_value(details->>'phone',40),now(),case when details->>'role'='site_manager' then coalesce(details->>'organizationLevel','management') else 'management' end);
 update public.bb_workspaces set revision=revision+1 where id=workspace_id;
end $$;
-- A public Auth signup cannot set app_metadata, so it cannot bypass controlled provisioning.
create function brief_beta_private.guard_account_creation() returns trigger language plpgsql set search_path='' as $$begin if coalesce((new.raw_app_meta_data->>'brief_provisioned')::boolean,false) is not true then raise exception 'Konton skapas av Admin, Platschef eller Arbetsledare.';end if;return new;end $$;
create trigger brief_controlled_signup before insert on auth.users for each row execute function brief_beta_private.guard_account_creation();
create function public.brief_beta_password_suggestion_dismiss() returns void language plpgsql security definer set search_path='' as $$begin if auth.uid() is null then raise exception 'Logga in först.';end if;update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}')||jsonb_build_object('brief_password_suggested',false) where id=auth.uid();end $$;
CREATE OR REPLACE FUNCTION public.brief_beta_load(workspace_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.bb_members; result jsonb;
begin
 m:=brief_beta_private.member(workspace_id);result:=brief_beta_private.load_before_project_diary(workspace_id);
 result:=result||jsonb_build_object('projects',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'number',p.number,'customerNumber',p.customer_number,'customer',p.customer,'name',p.name,'address',p.address,'archived',p.archived,'siteManager',p.site_manager,'verifier',p.verifier,'diaryRead',brief_beta_private.project_diary_access(p,m),'diaryWrite',brief_beta_private.project_diary_access(p,m,true),'connections',case when not m.external and m.role in ('admin','site_manager','supervisor') then p.connections else '[]'::jsonb end) order by p.number) from public.bb_projects p where p.workspace=workspace_id and (brief_beta_private.project_diary_access(p,m) or exists(select 1 from public.bb_orders o where o.project=p.id and brief_beta_private.allowed(o,m)))),'[]'::jsonb));
 result:=result||jsonb_build_object('companies',coalesce((select jsonb_agg(j) from (select value j from jsonb_array_elements(result->'companies') union all select jsonb_build_object('id',c.id,'name',c.name,'kind',c.kind,'archived',c.archived,'contacts','[]'::jsonb) from public.bb_companies c where c.workspace=workspace_id and not exists(select 1 from jsonb_array_elements(result->'companies') v where v->>'id'=c.id::text) and exists(select 1 from public.bb_projects p where p.customer=c.id and brief_beta_private.project_diary_access(p,m))) all_companies),'[]'::jsonb));
 return result||jsonb_build_object('passwordChangeSuggested',coalesce((select (raw_app_meta_data->>'brief_password_suggested')::boolean from auth.users where id=auth.uid()),false),'diaryReports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'project',r.project_id,'order',r.order_id,'number',r.report_number,'author',r.author,'date',r.report_date,'submittedAt',r.submitted_at,'updatedAt',r.updated_at,'header',r.header,'content',r.content,'acknowledgements',r.acknowledgements) order by r.report_date desc,r.report_number desc) from public.bb_build_reports r join public.bb_projects p on p.id=r.project_id left join public.bb_orders o on o.id=r.order_id where r.workspace=workspace_id and (r.submitted_at is not null or r.author=m.id) and (brief_beta_private.project_diary_access(p,m) or brief_beta_private.allowed(o,m))),'[]'::jsonb),'inbox',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'project',i.project_id,'order',i.order_id,'report',i.report_id,'kind',i.kind,'at',i.created_at,'readAt',i.read_at,'title',i.title,'sender',i.sender) order by i.created_at desc) from public.bb_inbox i where i.workspace=workspace_id and i.recipient=m.id),'[]'::jsonb));
end $function$;

revoke all on function public.brief_beta_firm_directory(uuid) from public,anon;grant execute on function public.brief_beta_firm_directory(uuid) to authenticated;

revoke all on function public.brief_beta_firm_request(uuid,uuid,text) from public,anon;grant execute on function public.brief_beta_firm_request(uuid,uuid,text) to authenticated;

revoke all on function public.brief_beta_account_context(uuid) from public,anon;grant execute on function public.brief_beta_account_context(uuid) to authenticated;

revoke all on function public.brief_beta_password_suggestion_dismiss() from public,anon;grant execute on function public.brief_beta_password_suggestion_dismiss() to authenticated;
revoke all on function public.brief_beta_register_account(uuid,uuid,bigint,uuid,jsonb) from public,anon,authenticated;grant execute on function public.brief_beta_register_account(uuid,uuid,bigint,uuid,jsonb) to service_role;
revoke all on all functions in schema brief_beta_private from public,anon,authenticated;

create index bb_members_firm on public.bb_members(firm_id);create index bb_orders_firm on public.bb_orders(firm_id);create index bb_projects_firm on public.bb_projects(firm_id);create index bb_firm_requests_sender on public.bb_firm_requests(sender,state);create index bb_firm_requests_recipient on public.bb_firm_requests(recipient,state);create index bb_companies_linked_firm on public.bb_companies(linked_firm_id);create index bb_companies_owner_firm on public.bb_companies(owner_firm_id);
