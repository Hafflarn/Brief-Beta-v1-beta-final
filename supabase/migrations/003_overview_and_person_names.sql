begin;
-- Approved overview and employee directory update.
-- Existing names are preserved; enforce full names for new or changed names.
create or replace function brief_beta_private.require_person_names() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' or new.name is distinct from old.name then
  if trim(new.name) !~ '^[^[:space:]]+([[:space:]]+[^[:space:]]+)+$' then
   raise exception 'Ange både förnamn och efternamn.';
  end if;
 end if;
 return new;
end $$;
drop trigger if exists bb_require_person_names on public.bb_members;
create trigger bb_require_person_names before insert or update of name on public.bb_members
for each row execute function brief_beta_private.require_person_names();

create or replace function brief_beta_private.allowed(o public.bb_orders,m public.bb_members,writing boolean default false) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare target public.bb_members; participant boolean; level integer;
begin
 if not m.active or m.deleted or o.workspace<>m.workspace then return false; end if;
 select * into target from public.bb_members where id=nullif(o.body->>'assignee','')::uuid;
 level:=case when target.id is null then 2 else brief_beta_private.rank(target.role) end;
 -- No numeric classification is stored on orders; the assignee's locked role determines access.
 if not writing and not m.external and o.body->>'deletedAt' is null then return true; end if;
 if brief_beta_private.rank(m.role)>level then return false; end if;
 if o.body->>'deletedAt' is not null then return not writing and not m.external and m.role in ('admin','supervisor'); end if;
 select exists(select 1 from jsonb_array_elements(coalesce(o.body->'participants','[]')) p where p->>'user'=m.id::text) into participant;
 if m.external then
  return (o.body->>'assignee'=m.id::text or participant) and (not writing or o.body->>'assignee'=m.id::text or exists(select 1 from jsonb_array_elements(o.body->'participants') p where p->>'user'=m.id::text and p->>'acceptedAt' is not null));
 end if;
 if not writing then return true; end if;
 return m.role in ('admin','supervisor') or o.body->>'assignee'=m.id::text or exists(select 1 from jsonb_array_elements(o.body->'participants') p where p->>'user'=m.id::text and p->>'acceptedAt' is not null);
end $$;

-- Employee directory: only active signed-in internal members can search.
-- Return basic work identity; no contact details, auth IDs, roles or order data.
create or replace function public.brief_beta_search_directory(workspace_id uuid, company_query text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor public.bb_members; term text; result jsonb;
begin
 actor:=brief_beta_private.member(workspace_id);
 if actor.external then raise exception 'Du saknar åtkomst till personalkatalogen.'; end if;
 term:=lower(trim(coalesce(company_query,'')));
 if length(term)<2 then return '[]'::jsonb; end if;
 if length(term)>200 then raise exception 'Söktexten är för lång.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'job',b.job,'employer',b.employer) order by b.employer,b.name),'[]') into result
 from (select distinct on (auth_user,lower(employer)) id,name,job,employer
 from public.bb_members
 where active and not deleted and not external and auth_user is not null
 and strpos(lower(employer),term)>0
 order by auth_user,lower(employer),joined_at desc,id limit 100) b;
 return result;
end $$;
revoke all on function public.brief_beta_search_directory(uuid,text) from public,anon;
grant execute on function public.brief_beta_search_directory(uuid,text) to authenticated;

create or replace function brief_beta_private.require_contact_names() returns trigger
language plpgsql set search_path='' as $$
declare contact jsonb;
begin
 for contact in select value from jsonb_array_elements(new.contacts) loop
  if tg_op='INSERT' or not exists(select 1 from jsonb_array_elements(old.contacts) previous where previous->>'id'=contact->>'id' and previous->>'name'=contact->>'name') then
   if trim(coalesce(contact->>'name','')) !~ '^[^[:space:]]+([[:space:]]+[^[:space:]]+)+$' then
    raise exception 'Ange både förnamn och efternamn på kontaktpersoner.';
   end if;
  end if;
 end loop;
 return new;
end $$;
drop trigger if exists bb_require_contact_names on public.bb_companies;
create trigger bb_require_contact_names before insert or update of contacts on public.bb_companies
for each row execute function brief_beta_private.require_contact_names();

commit;
