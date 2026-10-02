-- Brief v0.2. Run once in a new Supabase project's SQL Editor.
begin;
create schema if not exists brief_private;
revoke all on schema brief_private from public, anon, authenticated;

create table public.brief_companies (
 id uuid primary key default gen_random_uuid(), name text not null,
 revision bigint not null default 0, created_at timestamptz not null default now()
);
create table public.brief_members (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.brief_companies,
 auth_user uuid unique references auth.users, email text not null unique,
 name text not null check(length(trim(name)) between 1 and 150),
 role text not null check(role in ('admin','employee')),
 created_at timestamptz not null default now(),
 check(email=lower(trim(email)))
);
create table public.brief_customers (
 id uuid primary key, company_id uuid not null references public.brief_companies,
 name text not null check(length(trim(name)) between 1 and 200),
 prefix text not null check(prefix ~ '^[0-9]{4}$'), unique(company_id,prefix)
);
create table public.brief_customer_projects (
 company_id uuid not null references public.brief_companies,
 number text not null check(length(trim(number)) between 1 and 100), primary key(company_id,number)
);
create table public.brief_projects (
 id uuid primary key, company_id uuid not null references public.brief_companies,
 number text not null, customer_project text not null,
 customer_id uuid not null references public.brief_customers,
 name text not null check(length(trim(name)) between 1 and 200),
 address text not null check(length(trim(address)) between 1 and 300), comment text not null default '',
 unique(company_id,number), check(number ~ '^[0-9]{4}-.+$')
);
create table public.brief_orders (
 id uuid primary key, company_id uuid not null references public.brief_companies,
 project_id uuid not null references public.brief_projects,
 title text not null check(length(trim(title)) between 1 and 200),
 description text not null check(length(trim(description)) between 1 and 10000),
 due date not null, priority text not null check(priority in ('Låg','Normal','Hög')),
 assignee uuid not null references public.brief_members,
 issued_by uuid not null references public.brief_members, issued_at timestamptz not null default now(),
 accepted_at timestamptz, status text not null default 'Ej påbörjad' check(status in ('Ej påbörjad','Pågående','Slutförd'))
);
create table public.brief_participants (
 order_id uuid not null references public.brief_orders,
 member_id uuid not null references public.brief_members,
 invited_by uuid not null references public.brief_members,
 invited_at timestamptz not null default now(), accepted_at timestamptz,
 primary key(order_id,member_id)
);
create table public.brief_notes (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.brief_orders,
 author uuid not null references public.brief_members, at timestamptz not null default now(),
 text text not null check(length(text)<=10000)
);
create table public.brief_files (
 id uuid primary key, note_id uuid not null references public.brief_notes,
 name text not null check(length(name) between 1 and 255), type text not null,
 path text not null unique
);
create table public.brief_events (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.brief_orders,
 actor uuid not null references public.brief_members, at timestamptz not null default now(), text text not null
);
create index brief_orders_project on public.brief_orders(project_id);
create index brief_notes_order on public.brief_notes(order_id);
create index brief_events_order on public.brief_events(order_id);
create index brief_files_note on public.brief_files(note_id);
create index brief_members_company on public.brief_members(company_id);

-- No browser CRUD grants: access is exclusively through the authorized RPCs.
alter table public.brief_companies enable row level security;
alter table public.brief_members enable row level security;
alter table public.brief_customers enable row level security;
alter table public.brief_customer_projects enable row level security;
alter table public.brief_projects enable row level security;
alter table public.brief_orders enable row level security;
alter table public.brief_participants enable row level security;
alter table public.brief_notes enable row level security;
alter table public.brief_files enable row level security;
alter table public.brief_events enable row level security;
revoke all on public.brief_companies, public.brief_members, public.brief_customers,
 public.brief_customer_projects, public.brief_projects, public.brief_orders,
 public.brief_participants, public.brief_notes, public.brief_files, public.brief_events from anon, authenticated;

create function brief_private.current_member() returns public.brief_members
language plpgsql security definer set search_path='' as $$
declare m public.brief_members;
begin
 if auth.uid() is null then raise exception 'Logga in först.'; end if;
 select * into m from public.brief_members where auth_user=auth.uid();
 if m.id is null then raise exception 'Ditt konto saknar en arbetsyta.'; end if;
 return m;
end $$;

create function brief_private.allowed_order(o public.brief_orders, m public.brief_members, writing boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select o.company_id=m.company_id and (
  m.role='admin' or (o.assignee=m.id and (not writing or o.accepted_at is not null))
  or exists(select 1 from public.brief_participants p where p.order_id=o.id and p.member_id=m.id and (not writing or p.accepted_at is not null))
 );
$$;

create function brief_private.immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Historik och dagbok kan inte ändras eller raderas.'; end $$;
create trigger brief_events_immutable before update or delete on public.brief_events for each row execute function brief_private.immutable();
create trigger brief_notes_immutable before update or delete on public.brief_notes for each row execute function brief_private.immutable();
create trigger brief_files_immutable before update or delete on public.brief_files for each row execute function brief_private.immutable();

-- A confirmed email can claim only the invitation matching that email.
-- New, uninvited accounts create their own isolated company.
create function public.brief_bootstrap() returns void
language plpgsql security definer set search_path='' as $$
declare u auth.users; m public.brief_members; c uuid;
begin
 select * into u from auth.users where id=auth.uid() for update;
 if u.id is null or u.email_confirmed_at is null then raise exception 'Bekräfta din e-postadress innan du loggar in.'; end if;
 if exists(select 1 from public.brief_members where auth_user=u.id) then return; end if;
 select * into m from public.brief_members where email=lower(u.email) for update;
 if m.id is not null then
  if m.auth_user is not null then raise exception 'E-postadressen är redan kopplad till ett konto.'; end if;
  update public.brief_members set auth_user=u.id where id=m.id;
  update public.brief_companies set revision=revision+1 where id=m.company_id;
 else
  insert into public.brief_companies(name) values(left(coalesce(nullif(trim(u.raw_user_meta_data->>'company_name'),''),'Brief'),200)) returning id into c;
  insert into public.brief_members(company_id,auth_user,email,name,role)
  values(c,u.id,lower(u.email),left(coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'),''),u.email),150),'admin');
 end if;
end $$;

create function public.brief_load() returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.brief_members; projects jsonb; people jsonb; customers jsonb; cp jsonb; rev bigint;
begin
 m:=brief_private.current_member();
 select revision into rev from public.brief_companies where id=m.company_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role,'joined',auth_user is not null)
  || case when m.role='admin' or id=m.id then jsonb_build_object('email',email) else '{}'::jsonb end order by created_at),'[]')
 into people from public.brief_members where company_id=m.company_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'prefix',prefix) order by name),'[]') into customers from public.brief_customers where company_id=m.company_id;
 select coalesce(jsonb_agg(number order by number),'[]') into cp from public.brief_customer_projects where company_id=m.company_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'number',p.number,'customerProject',p.customer_project,'customer',p.customer_id,'name',p.name,'address',p.address,'comment',p.comment,'orders',
  (select coalesce(jsonb_agg(jsonb_build_object(
   'id',o.id,'title',o.title,'description',o.description,'due',o.due,'priority',o.priority,'assignee',o.assignee,'issuedBy',o.issued_by,'issuedAt',o.issued_at,'acceptedAt',o.accepted_at,'status',o.status,
   'participants',(select coalesce(jsonb_agg(jsonb_build_object('user',t.member_id,'invitedBy',t.invited_by,'invitedAt',t.invited_at,'acceptedAt',t.accepted_at) order by t.invited_at),'[]') from public.brief_participants t where t.order_id=o.id),
   'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'at',e.at,'text',e.text) order by e.at,e.id),'[]') from public.brief_events e where e.order_id=o.id),
   'notes',(select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'at',n.at,'author',n.author,'text',n.text,'files',
    (select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'type',f.type,'path',f.path,'data','')),'[]') from public.brief_files f where f.note_id=n.id)
   ) order by n.at desc),'[]') from public.brief_notes n where n.order_id=o.id)
  ) order by o.issued_at desc),'[]') from public.brief_orders o where o.project_id=p.id and brief_private.allowed_order(o,m))
 ) order by p.number),'[]') into projects from public.brief_projects p
 where p.company_id=m.company_id and (m.role='admin' or exists(select 1 from public.brief_orders o where o.project_id=p.id and brief_private.allowed_order(o,m)));
 return jsonb_build_object('user',m.id,'company',m.company_id,'revision',rev,'state',jsonb_build_object('people',people,'customers',customers,'customerProjects',cp,'projects',projects));
end $$;

create function public.brief_apply(expected_revision bigint, command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.brief_members; o public.brief_orders; p public.brief_projects; target public.brief_members;
 kind text:=command->>'kind'; rev bigint; at_time timestamptz:=clock_timestamp();
 person_email text; customer_id uuid; project_id uuid; order_id uuid; note_id uuid; file jsonb; state text; audit text;
begin
 m:=brief_private.current_member();
 select revision into rev from public.brief_companies where id=m.company_id for update;
 if expected_revision is null or rev<>expected_revision then raise exception 'Någon annan har ändrat arbetsytan. Tryck Uppdatera och försök igen.'; end if;
 if kind in ('invite_member','create_customer','create_customer_project','create_order') and m.role<>'admin' then raise exception 'Endast arbetsledare kan göra detta.'; end if;
 if kind='invite_member' then
  person_email:=lower(trim(command->>'email'));
  if person_email is null or person_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Ange kollegans e-postadress.'; end if;
  if exists(select 1 from public.brief_members where email=person_email) then raise exception 'E-postadressen har redan en arbetsyta eller inbjudan.'; end if;
  insert into public.brief_members(company_id,email,name,role) values(m.company_id,person_email,trim(command->>'name'),command->>'role');
 elsif kind='create_customer' then
  insert into public.brief_customers(id,company_id,name,prefix) values((command->>'id')::uuid,m.company_id,trim(command->>'name'),command->>'prefix');
 elsif kind='create_customer_project' then
  insert into public.brief_customer_projects(company_id,number) values(m.company_id,trim(command->>'number'));
 elsif kind='create_order' then
  project_id:=(command->'project'->>'id')::uuid;
  select * into p from public.brief_projects where id=project_id;
  if p.id is null then
   select id into customer_id from public.brief_customers where company_id=m.company_id and prefix=left(command->'project'->>'number',4);
   if customer_id is null then raise exception 'Projektnumret saknar registrerat beställarprefix.'; end if;
   insert into public.brief_projects(id,company_id,number,customer_project,customer_id,name,address,comment)
   values(project_id,m.company_id,trim(command->'project'->>'number'),trim(command->'project'->>'customerProject'),customer_id,trim(command->'project'->>'name'),trim(command->'project'->>'address'),coalesce(command->'project'->>'comment','')) returning * into p;
  end if;
  if p.company_id<>m.company_id then raise exception 'Du saknar åtkomst till projektet.'; end if;
  select * into target from public.brief_members where id=(command->'order'->>'assignee')::uuid and company_id=m.company_id and role='employee';
  if target.id is null then raise exception 'Välj en utförare från företagets egen personal.'; end if;
  order_id:=(command->'order'->>'id')::uuid;
  insert into public.brief_orders(id,company_id,project_id,title,description,due,priority,assignee,issued_by,issued_at)
  values(order_id,m.company_id,project_id,trim(command->'order'->>'title'),trim(command->'order'->>'description'),(command->'order'->>'due')::date,command->'order'->>'priority',target.id,m.id,at_time);
  insert into public.brief_events(order_id,actor,at,text) values(order_id,m.id,at_time,m.name||' skapade arbetsordern.'),(order_id,m.id,at_time+interval '1 microsecond',m.name||' skickade arbetsordern till '||target.name||'.');
 else
  select * into o from public.brief_orders where id=(command->>'order')::uuid for update;
  if o.id is null or not brief_private.allowed_order(o,m) then raise exception 'Du saknar åtkomst till arbetsordern.'; end if;
  if kind='accept_order' then
   if o.assignee<>m.id or o.accepted_at is not null then raise exception 'Endast ansvarig utförare kan acceptera en väntande order.'; end if;
   update public.brief_orders set accepted_at=at_time where id=o.id;
   audit:='accepterade arbetsordern.';
  elsif kind='accept_invitation' then
   update public.brief_participants set accepted_at=at_time where order_id=o.id and member_id=m.id and accepted_at is null;
   if not found then raise exception 'Du har ingen väntande inbjudan.'; end if;
   audit:='accepterade inbjudan.';
  else
   if not brief_private.allowed_order(o,m,true) then raise exception 'Acceptera arbetsordern eller inbjudan först.'; end if;
   if kind='set_status' then
    state:=command->>'status';
    if not ((o.status='Ej påbörjad' and state='Pågående' and o.accepted_at is not null) or (o.status='Pågående' and state='Slutförd') or (o.status='Slutförd' and state='Pågående')) then raise exception 'Statusändringen är inte tillåten.'; end if;
    update public.brief_orders set status=state where id=o.id;
    audit:=case when state='Slutförd' then 'markerade arbetsordern som slutförd.' when o.status='Slutförd' then 'återöppnade arbetsordern.' else 'startade arbetsordern.' end;
   elsif kind='invite_colleague' then
    if o.status='Slutförd' then raise exception 'Återöppna arbetsordern först.'; end if;
    select * into target from public.brief_members where id=(command->>'member')::uuid and company_id=m.company_id and role='employee' and id<>o.assignee;
    if target.id is null then raise exception 'Välj en kollega från företagets egen personal.'; end if;
    insert into public.brief_participants(order_id,member_id,invited_by,invited_at) values(o.id,target.id,m.id,at_time);
    audit:='bjöd in '||target.name||'.';
   elsif kind='add_note' then
    if o.status='Slutförd' then raise exception 'Återöppna arbetsordern först.'; end if;
    if jsonb_typeof(command->'files') is distinct from 'array' or jsonb_array_length(command->'files')>5 then raise exception 'Högst 5 bilagor per anteckning.'; end if;
    if coalesce(length(trim(command->>'text')),0)=0 and jsonb_array_length(command->'files')=0 then raise exception 'Anteckningen är tom.'; end if;
    insert into public.brief_notes(order_id,author,at,text) values(o.id,m.id,at_time,coalesce(trim(command->>'text'),'')) returning id into note_id;
    for file in select value from jsonb_array_elements(command->'files') loop
     if file->>'path' is distinct from (m.company_id::text||'/'||o.id::text||'/'||m.id::text||'/'||(file->>'id')::uuid::text) then raise exception 'Ogiltig bilaga.'; end if;
     if not exists(select 1 from storage.objects s where s.bucket_id='brief-files' and s.name=file->>'path' and s.owner_id=auth.uid()::text) then raise exception 'Bilagan har inte laddats upp av dig.'; end if;
     insert into public.brief_files(id,note_id,name,type,path) values((file->>'id')::uuid,note_id,file->>'name',coalesce(file->>'type','application/octet-stream'),file->>'path');
    end loop;
    audit:='lade till en dagboksanteckning med '||jsonb_array_length(command->'files')||' filer.';
   else raise exception 'Okänd åtgärd.';
   end if;
  end if;
  insert into public.brief_events(order_id,actor,at,text) values(o.id,m.id,at_time,m.name||' '||audit);
 end if;
 update public.brief_companies set revision=revision+1 where id=m.company_id;
 return public.brief_load();
end $$;

create function public.brief_file_access(object_name text, writing boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare m public.brief_members; o public.brief_orders; parts text[];
begin
 if auth.uid() is null then return false; end if;
 select * into m from public.brief_members where auth_user=auth.uid();
 if m.id is null then return false; end if;
 parts:=string_to_array(object_name,'/');
 if array_length(parts,1)<>4 or parts[1]<>m.company_id::text then return false; end if;
 select * into o from public.brief_orders where id::text=parts[2];
 if o.id is null then return false; end if;
 if writing then return o.status<>'Slutförd' and parts[3]=m.id::text and brief_private.allowed_order(o,m,true); end if;
 return brief_private.allowed_order(o,m) and exists(select 1 from public.brief_files f join public.brief_notes n on n.id=f.note_id where f.path=object_name and n.order_id=o.id);
end $$;

insert into storage.buckets(id,name,public,file_size_limit) values('brief-files','brief-files',false,2097152)
on conflict(id) do update set public=false,file_size_limit=2097152;
create policy brief_files_read on storage.objects for select to authenticated
using(bucket_id='brief-files' and public.brief_file_access(name));
create policy brief_files_upload on storage.objects for insert to authenticated
with check(bucket_id='brief-files' and owner_id=auth.uid()::text and public.brief_file_access(name,true));
-- Updates and deletes are intentionally unavailable to browser clients.

revoke all on function public.brief_bootstrap() from public,anon;
revoke all on function public.brief_load() from public,anon;
revoke all on function public.brief_apply(bigint,jsonb) from public,anon;
revoke all on function public.brief_file_access(text,boolean) from public,anon;
grant execute on function public.brief_bootstrap(),public.brief_load(),public.brief_apply(bigint,jsonb),public.brief_file_access(text,boolean) to authenticated;
revoke all on all functions in schema brief_private from public,anon,authenticated;
commit;
