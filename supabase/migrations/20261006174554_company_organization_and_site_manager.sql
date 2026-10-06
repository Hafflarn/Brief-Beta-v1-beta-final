-- Add Platschef at the existing Arbetsledare permission level. Roles remain server controlled.
alter table public.bb_members drop constraint bb_members_role_check;
alter table public.bb_members add constraint bb_members_role_check check(role in ('admin','site_manager','supervisor','worker'));
alter table public.bb_members add column organization_level text not null default 'management' check(organization_level in ('client','management'));
create or replace function brief_beta_private.rank(r text) returns integer language sql immutable set search_path='' as $$
 select case r when 'admin' then 1 when 'site_manager' then 2 when 'supervisor' then 2 when 'worker' then 3 else 99 end;
$$;
-- Patch only the app's existing role checks, preserving signatures and execution grants.
do $migration$
declare f record; definition text;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='brief_beta_private' and p.proname in ('allowed','apply_before_project_diary','load_before_project_diary','project_diary_access'))
 or (n.nspname='public' and p.proname in ('brief_beta_apply','brief_beta_load','brief_beta_contact_profile')) loop
  definition:=pg_get_functiondef(f.oid);
  definition:=replace(definition,$replace$('admin','supervisor')$replace$,$replace$('admin','site_manager','supervisor')$replace$);
  definition:=replace(definition,$replace$('supervisor','worker')$replace$,$replace$('site_manager','supervisor','worker')$replace$);
  definition:=replace(definition,$replace$'role',b.role,'job'$replace$,$replace$'role',b.role,'organizationLevel',b.organization_level,'job'$replace$);
  definition:=replace(definition,'phone,external)','phone,external,organization_level)');
  definition:=replace(definition,$replace$coalesce((command->>'external')::boolean,false));$replace$,$replace$coalesce((command->>'external')::boolean,false),case when command->>'role'='site_manager' then coalesce(nullif(command->>'organizationLevel',''),'management') else 'management' end);$replace$);
  definition:=replace(definition,$replace$'name',b.name,'job'$replace$,$replace$'name',b.name,'role',b.role,'organizationLevel',b.organization_level,'job'$replace$);
  execute definition;
 end loop;
end $migration$;
create or replace function public.brief_beta_company_organization(workspace_id uuid,company_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.bb_members; c public.bb_companies; ct jsonb; profile jsonb; result jsonb:='[]'; person jsonb; b public.bb_members; linked_ids uuid[]:='{}';
begin
 m:=brief_beta_private.member(workspace_id);
 if m.external or brief_beta_private.rank(m.role)>2 then raise exception 'Du saknar åtkomst till företagsbanken.'; end if;
 select * into c from public.bb_companies where id=company_id and workspace=workspace_id;
 if c.id is null then raise exception 'Företaget finns inte i arbetsytan.'; end if;
 for ct in select value from jsonb_array_elements(c.contacts) loop
  profile:=public.brief_beta_contact_profile(workspace_id,company_id,ct->>'id');
  person:=coalesce(profile,jsonb_build_object('name',ct->>'name','phone',coalesce(ct->>'phone',''),'email',coalesce(ct->>'email',''),'employer',c.name,'job',''));
  person:=person||jsonb_build_object('id','contact:'||(ct->>'id'),'role',coalesce(profile->>'role',ct->>'organizationRole','client'),'organizationLevel',coalesce(profile->>'organizationLevel','management'));
  result:=result||jsonb_build_array(person);
  -- A linked profile is shown once, with current profile contact details.
  for b in select * from public.bb_members where workspace=workspace_id and active and not deleted
   and ((nullif(lower(trim(person->>'email')),'') is not null and email=lower(trim(person->>'email'))) or
   (nullif(brief_beta_private.phone(person->>'phone'),'') is not null and brief_beta_private.phone(phone)=brief_beta_private.phone(person->>'phone'))) loop
   linked_ids:=array_append(linked_ids,b.id);
  end loop;
 end loop;
 for b in select * from public.bb_members where workspace=workspace_id and active and not deleted
 and lower(trim(employer))=lower(trim(c.name)) and not(id=any(linked_ids)) order by name loop
  result:=result||jsonb_build_array(jsonb_build_object('id',b.id,'name',b.name,'role',b.role,'organizationLevel',b.organization_level,'job',b.job,'employer',b.employer,'email',b.email,'phone',b.phone));
 end loop;
 return result;
end $$;
revoke all on function public.brief_beta_company_organization(uuid,uuid) from public,anon,authenticated;
grant execute on function public.brief_beta_company_organization(uuid,uuid) to authenticated;
