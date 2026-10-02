-- Brief v1 Beta. Additive, repeatable installation; legacy Brief tables are retained.
begin;
create schema if not exists brief_beta_private;
revoke all on schema brief_beta_private from public, anon, authenticated;
create table if not exists public.bb_workspaces (
 id uuid primary key default gen_random_uuid(), name text not null, revision bigint not null default 0,
 created_at timestamptz not null default now()
);
create table if not exists public.bb_members (
 id uuid primary key default gen_random_uuid(), workspace uuid not null references public.bb_workspaces,
 auth_user uuid references auth.users, email text not null, name text not null,
 role text not null check(role in ('admin','supervisor','worker')), job text not null default '',
 employer text not null default '', phone text not null default '', external boolean not null default false,
 active boolean not null default true, deleted boolean not null default false, joined_at timestamptz,
 check(email=lower(trim(email))), check(length(name) between 1 and 150),
 check(length(job)<=150 and length(employer)<=200 and length(phone)<=40)
);
create unique index if not exists bb_member_email on public.bb_members(workspace,email) where not deleted;
create unique index if not exists bb_member_auth on public.bb_members(workspace,auth_user) where not deleted;
create table if not exists public.bb_companies (
 id uuid primary key default gen_random_uuid(), workspace uuid not null references public.bb_workspaces,
 name text not null check(length(trim(name)) between 1 and 200), kind text not null default 'Beställare',
 contacts jsonb not null default '[]', archived boolean not null default false,
 check(jsonb_typeof(contacts)='array' and jsonb_array_length(contacts)<=100)
);
create table if not exists public.bb_projects (
 id uuid primary key default gen_random_uuid(), workspace uuid not null references public.bb_workspaces,
 customer uuid not null references public.bb_companies, number text not null,
 customer_number text not null, name text not null, address text not null default '',
 connections jsonb not null default '[]', archived boolean not null default false,
 check(length(number) between 1 and 100 and length(customer_number) between 1 and 100),
 check(length(name) between 1 and 200 and length(address)<=300),
 check(jsonb_typeof(connections)='array' and jsonb_array_length(connections)<=100), unique(workspace,number)
);
create table if not exists public.bb_orders (
 id uuid primary key default gen_random_uuid(), workspace uuid not null references public.bb_workspaces,
 project uuid not null references public.bb_projects, body jsonb not null,
 check(jsonb_typeof(body)='object' and octet_length(body::text)<=1000000)
);
create index if not exists bb_orders_workspace on public.bb_orders(workspace);
create table if not exists public.bb_file_cleanup (
 path text not null, bucket text not null default 'brief-beta-files', created_at timestamptz not null default now(), primary key(bucket,path)
);
alter table public.bb_workspaces enable row level security;
alter table public.bb_members enable row level security;
alter table public.bb_companies enable row level security;
alter table public.bb_projects enable row level security;
alter table public.bb_orders enable row level security;
alter table public.bb_file_cleanup enable row level security;
revoke all on public.bb_workspaces, public.bb_members, public.bb_companies, public.bb_projects, public.bb_orders, public.bb_file_cleanup from public,anon,authenticated;

create or replace function brief_beta_private.rank(r text) returns integer language sql immutable set search_path='' as $$
 select case r when 'admin' then 1 when 'supervisor' then 2 when 'worker' then 3 else 99 end;
$$;
create or replace function brief_beta_private.phone(v text) returns text language sql immutable set search_path='' as $$
 select case when digits like '0046%' then '0'||substr(digits,5) when digits like '46%' and length(digits)>=10 then '0'||substr(digits,3) else digits end from (select regexp_replace(coalesce(v,''),'[^0-9]','','g') digits) s;
$$;
create or replace function brief_beta_private.text_value(v text, maximum integer, required boolean default true) returns text
language plpgsql immutable set search_path='' as $$
begin
 v:=trim(coalesce(v,''));
 if length(v)>maximum or (required and length(v)=0) then raise exception 'Ett obligatoriskt fält saknas eller är för långt.'; end if;
 return v;
end $$;
create or replace function brief_beta_private.member(w uuid) returns public.bb_members
language plpgsql security definer set search_path='' as $$
declare m public.bb_members;
begin
 select * into m from public.bb_members where workspace=w and auth_user=auth.uid() and active and not deleted;
 if m.id is null then raise exception 'Du saknar en aktiv profil i arbetsytan.'; end if;
 return m;
end $$;
create or replace function brief_beta_private.allowed(o public.bb_orders,m public.bb_members,writing boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare target public.bb_members; participant boolean; level integer;
begin
 if not m.active or m.deleted or o.workspace<>m.workspace then return false; end if;
 select * into target from public.bb_members where id=nullif(o.body->>'assignee','')::uuid;
 level:=case when target.id is null then 2 else brief_beta_private.rank(target.role) end;
 -- No numeric classification is stored on orders; the assignee's locked role determines access.
 if brief_beta_private.rank(m.role)>level then return false; end if;
 if o.body->>'deletedAt' is not null then return not writing and not m.external and m.role in ('admin','supervisor'); end if;
 select exists(select 1 from jsonb_array_elements(coalesce(o.body->'participants','[]')) p where p->>'user'=m.id::text) into participant;
 if m.external then
  return (o.body->>'assignee'=m.id::text or participant) and (not writing or o.body->>'assignee'=m.id::text or exists(select 1 from jsonb_array_elements(o.body->'participants') p where p->>'user'=m.id::text and p->>'acceptedAt' is not null));
 end if;
 if not writing then return true; end if;
 return m.role in ('admin','supervisor') or o.body->>'assignee'=m.id::text or exists(select 1 from jsonb_array_elements(o.body->'participants') p where p->>'user'=m.id::text and p->>'acceptedAt' is not null);
end $$;
create or replace function brief_beta_private.event(b jsonb, actor text, action text) returns jsonb language sql set search_path='' as $$
 select jsonb_set(b,'{events}',coalesce(b->'events','[]')||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',clock_timestamp(),'text',actor||' '||action)));
$$;
create or replace function brief_beta_private.purge(ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare amount integer;
begin
 insert into public.bb_file_cleanup(path,bucket)
 select f->>'path',coalesce(f->>'bucket','brief-beta-files') from public.bb_orders o cross join lateral jsonb_array_elements(coalesce(o.body->'notes','[]')) n
 cross join lateral jsonb_array_elements(coalesce(n->'files','[]')) f
 where o.id=any(ids) and f->>'path' is not null on conflict do nothing;
 delete from public.bb_orders where id=any(ids); get diagnostics amount=row_count; return amount;
end $$;
create or replace function brief_beta_private.expire(w uuid default null) returns integer
language plpgsql security definer set search_path='' as $$
declare ids uuid[]; amount integer;
begin
 select array_agg(id) into ids from public.bb_orders where (w is null or workspace=w) and
 (body->>'deletedAt')::timestamptz <= now()-interval '14 days';
 amount:=brief_beta_private.purge(coalesce(ids,'{}'));
 if amount>0 then update public.bb_workspaces set revision=revision+1 where w is null or id=w; end if;
 return amount;
end $$;
create or replace function public.brief_beta_bootstrap() returns jsonb
language plpgsql security definer set search_path='' as $$
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
 if not exists(select 1 from public.bb_members where auth_user=u.id) then
  if n='' or j='' or e='' or p='' then raise exception 'Komplettera namn, yrkesroll, företag och telefon i din profil.'; end if;
  insert into public.bb_workspaces(name) values(e) returning id into w;
  insert into public.bb_members(workspace,auth_user,email,name,role,job,employer,phone,joined_at)
  values(w,u.id,lower(u.email),n,'admin',j,e,p,now());
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name) order by b.created_at)
 from public.bb_workspaces b join public.bb_members m on m.workspace=b.id where m.auth_user=u.id and m.active and not m.deleted),'[]');
end $$;
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
 return jsonb_build_object('user',m.id,'workspace',workspace_id,'revision',rev,'people',people,'companies',companies,'projects',projects,'orders',orders,'contactLinks',matches);
end $$;

create or replace function public.brief_beta_contact_profile(workspace_id uuid, company_id uuid, contact_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.bb_members; ct jsonb; ids uuid[]; b public.bb_members;
begin
 m:=brief_beta_private.member(workspace_id);
 if m.external or m.role='worker' then raise exception 'Du saknar åtkomst till företagsbanken.'; end if;
 select x into ct from public.bb_companies c cross join lateral jsonb_array_elements(c.contacts) x where c.workspace=workspace_id and c.id=company_id and x->>'id'=contact_id;
 if ct is null then return null; end if;
 select array_agg(distinct auth_user) into ids from public.bb_members where active and not deleted and auth_user is not null and
 ((nullif(lower(trim(ct->>'email')),'') is not null and email=lower(trim(ct->>'email'))) or
 (nullif(brief_beta_private.phone(ct->>'phone'),'') is not null and brief_beta_private.phone(phone)=brief_beta_private.phone(ct->>'phone')));
 if cardinality(ids)<>1 or ids is null then return null; end if;
 select * into b from public.bb_members where auth_user=ids[1] and active and not deleted order by (workspace=workspace_id) desc limit 1;
 return jsonb_build_object('name',b.name,'job',b.job,'employer',b.employer,'phone',b.phone,'email',b.email);
end $$;

create or replace function public.brief_beta_apply(workspace_id uuid, expected_revision bigint, command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
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
    b:=b||jsonb_build_object('status',value);
    if value='Avslutad' then
     b:=b||jsonb_build_object('completedAt',stamp); value:=brief_beta_private.text_value(command->>'comment',10000,false);
     if value<>'' then b:=jsonb_set(b,'{notes}',coalesce(b->'notes','[]')||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',stamp,'author',m.id,'text',value,'files','[]'::jsonb))); end if;
     audit:='avslutade arbetsordern.';
    else
     if o.body->>'status'='Avslutad' then audit:='återöppnade arbetsordern.'; else audit:='startade arbetsordern.'; end if;
     b:=b-'completedAt';
    end if;
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
    b:=jsonb_set(b,'{notes}',coalesce(b->'notes','[]')||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'at',stamp,'author',m.id,'text',value,'files',x))); audit:='lade till en kommentar.';
   else raise exception 'Okänd åtgärd.'; end if;
  end if;
  b:=brief_beta_private.event(b,m.name,audit); update public.bb_orders set body=b where id=o.id;
 end if;
 update public.bb_workspaces set revision=revision+1 where id=workspace_id;
 return public.brief_beta_load(workspace_id);
end $$;

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
 return exists(select 1 from jsonb_array_elements(o.body->'notes') n cross join lateral jsonb_array_elements(n->'files') f where f->>'path'=object_name);
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('brief-beta-files','brief-beta-files',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf','text/plain'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists bb_files_read on storage.objects;
drop policy if exists bb_files_upload on storage.objects;
create policy bb_files_read on storage.objects for select to authenticated using(bucket_id='brief-beta-files' and public.brief_beta_file_access(name));
create policy bb_files_upload on storage.objects for insert to authenticated with check(bucket_id='brief-beta-files' and owner_id=auth.uid()::text and public.brief_beta_file_access(name,true));

create or replace function public.brief_beta_cleanup() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform brief_beta_private.expire();
 -- Also collect abandoned uploads older than one day; never remove recently uploaded pending files.
 insert into public.bb_file_cleanup(path,bucket) select so.name,so.bucket_id from storage.objects so where so.bucket_id='brief-beta-files' and so.created_at<now()-interval '1 day' and not exists(select 1 from public.bb_orders o cross join lateral jsonb_array_elements(o.body->'notes') n cross join lateral jsonb_array_elements(n->'files') f where f->>'path'=so.name and coalesce(f->>'bucket','brief-beta-files')=so.bucket_id) on conflict do nothing;
 return coalesce((select jsonb_agg(jsonb_build_object('path',path,'bucket',bucket)) from (select path,bucket from public.bb_file_cleanup order by created_at limit 100) s),'[]');
end $$;
create or replace function public.brief_beta_cleanup_ack(paths jsonb) returns void language sql security definer set search_path='' as $$
 delete from public.bb_file_cleanup q where exists(select 1 from jsonb_array_elements(paths) p where p->>'path'=q.path and p->>'bucket'=q.bucket);
$$;
revoke all on all functions in schema brief_beta_private from public,anon,authenticated;
revoke all on function public.brief_beta_bootstrap(),public.brief_beta_load(uuid),public.brief_beta_apply(uuid,bigint,jsonb),public.brief_beta_contact_profile(uuid,uuid,text),public.brief_beta_file_access(text,boolean),public.brief_beta_cleanup(),public.brief_beta_cleanup_ack(jsonb) from public,anon,authenticated;
grant execute on function public.brief_beta_bootstrap(),public.brief_beta_load(uuid),public.brief_beta_apply(uuid,bigint,jsonb),public.brief_beta_contact_profile(uuid,uuid,text),public.brief_beta_file_access(text,boolean) to authenticated;
grant execute on function public.brief_beta_cleanup(),public.brief_beta_cleanup_ack(jsonb) to service_role;
commit;
