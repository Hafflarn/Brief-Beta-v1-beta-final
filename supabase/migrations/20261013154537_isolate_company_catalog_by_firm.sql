-- A shared workspace is not a shared customer catalog.
alter function public.brief_beta_load(uuid) rename to load_before_catalog_isolation;
alter function public.load_before_catalog_isolation(uuid) set schema brief_beta_private;
create function public.brief_beta_load(workspace_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;s jsonb;companies jsonb;
begin
 m:=brief_beta_private.member(workspace_id);s:=brief_beta_private.load_before_catalog_isolation(workspace_id);
 select coalesce(jsonb_agg(case
 when c.owner_firm_id=m.firm_id and not m.external and brief_beta_private.rank(m.role)<=2 then j
 else jsonb_build_object('id',j->>'id','name',j->>'name','kind',j->>'kind','archived',coalesce(j->'archived','false'::jsonb),'shared',coalesce(j->'shared','false'::jsonb),'contactAccess',false,'contacts','[]'::jsonb) end),'[]'::jsonb)
 into companies from jsonb_array_elements(s->'companies') j left join public.bb_companies c on c.id::text=j->>'id'
 where (c.owner_firm_id=m.firm_id and not m.external and brief_beta_private.rank(m.role)<=2)
 or exists(select 1 from jsonb_array_elements(s->'projects') p where p->>'customer'=j->>'id');
 return s||jsonb_build_object('companies',companies);
end $$;
-- Knowing a foreign customer ID must not reveal contacts or make it selectable.
alter function public.brief_beta_contact_profile(uuid,uuid,text) rename to contact_profile_before_catalog_isolation;
alter function public.contact_profile_before_catalog_isolation(uuid,uuid,text) set schema brief_beta_private;
create function public.brief_beta_contact_profile(workspace_id uuid,company_id uuid,contact_id text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;
begin
 m:=brief_beta_private.member(workspace_id);
 if not exists(select 1 from public.bb_companies c where c.id=company_id and c.workspace=workspace_id and c.owner_firm_id=m.firm_id) then return null;end if;
 return brief_beta_private.contact_profile_before_catalog_isolation(workspace_id,company_id,contact_id);
end $$;
alter function public.brief_beta_company_organization(uuid,uuid) rename to company_organization_before_catalog_isolation;
alter function public.company_organization_before_catalog_isolation(uuid,uuid) set schema brief_beta_private;
create function public.brief_beta_company_organization(workspace_id uuid,company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;
begin
 m:=brief_beta_private.member(workspace_id);
 if not exists(select 1 from public.bb_companies c where c.id=company_id and c.workspace=workspace_id and c.owner_firm_id=m.firm_id) then return '[]'::jsonb;end if;
 return brief_beta_private.company_organization_before_catalog_isolation(workspace_id,company_id);
end $$;
alter function public.brief_beta_apply(uuid,bigint,jsonb) rename to apply_before_catalog_isolation;
alter function public.apply_before_catalog_isolation(uuid,bigint,jsonb) set schema brief_beta_private;
create function public.brief_beta_apply(workspace_id uuid,expected_revision bigint,command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;
begin
 m:=brief_beta_private.member(workspace_id);
 if command->>'kind'='save_project' and not exists(select 1 from public.bb_companies c where c.id::text=command->>'customer' and c.workspace=workspace_id and c.owner_firm_id=m.firm_id) then raise exception 'Du får bara välja ditt eget företags kunder.';end if;
 return brief_beta_private.apply_before_catalog_isolation(workspace_id,expected_revision,command);
end $$;
revoke all on function brief_beta_private.load_before_catalog_isolation(uuid),brief_beta_private.contact_profile_before_catalog_isolation(uuid,uuid,text),brief_beta_private.company_organization_before_catalog_isolation(uuid,uuid),brief_beta_private.apply_before_catalog_isolation(uuid,bigint,jsonb) from public,anon,authenticated;
revoke all on function public.brief_beta_load(uuid),public.brief_beta_contact_profile(uuid,uuid,text),public.brief_beta_company_organization(uuid,uuid),public.brief_beta_apply(uuid,bigint,jsonb) from public,anon;
grant execute on function public.brief_beta_load(uuid),public.brief_beta_contact_profile(uuid,uuid,text),public.brief_beta_company_organization(uuid,uuid),public.brief_beta_apply(uuid,bigint,jsonb) to authenticated;
