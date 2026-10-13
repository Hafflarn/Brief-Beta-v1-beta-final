alter table public.bb_firms add column logo_data text;
create function public.brief_beta_firm_logo(workspace_id uuid,image_data text) returns void language plpgsql security definer set search_path='' as $$
declare m public.bb_members; bytes bytea;
begin
 m:=brief_beta_private.member(workspace_id);
 if m.external or brief_beta_private.rank(m.role)>2 then raise exception 'Endast företagsledningen får ändra företagsloggan.';end if;
 if image_data is not null then
  if length(image_data)>700000 or image_data !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' then raise exception 'Välj en PNG-logga på högst 500 kB.';end if;
  bytes:=decode(substr(image_data,23),'base64');
  if octet_length(bytes)>512000 or encode(substring(bytes from 1 for 8),'hex')<>'89504e470d0a1a0a' then raise exception 'Ogiltig logotyp.';end if;
 end if;
 update public.bb_firms set logo_data=image_data where id=m.firm_id;
 update public.bb_workspaces set revision=revision+1 where id=workspace_id;
end $$;
alter function public.brief_beta_load(uuid) rename to load_before_firm_logo;
alter function public.load_before_firm_logo(uuid) set schema brief_beta_private;
create function public.brief_beta_load(workspace_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;s jsonb;brand jsonb;brands jsonb;orders jsonb;
begin
 m:=brief_beta_private.member(workspace_id);s:=brief_beta_private.load_before_firm_logo(workspace_id);
 select jsonb_build_object('id',f.id,'name',f.name,'organizationNumber',f.organization_number,'logo',f.logo_data) into brand from public.bb_firms f where f.id=m.firm_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'organizationNumber',f.organization_number,'logo',f.logo_data)),'[]'::jsonb) into brands from public.bb_firms f where f.id=m.firm_id or exists(select 1 from public.bb_orders o where o.firm_id=f.id and exists(select 1 from jsonb_array_elements(s->'orders') j where j->>'id'=o.id::text));
 select coalesce(jsonb_agg(j||jsonb_build_object('firmBrand',jsonb_build_object('id',f.id,'name',f.name,'organizationNumber',f.organization_number,'logo',f.logo_data))),'[]'::jsonb) into orders from jsonb_array_elements(s->'orders') j join public.bb_orders o on o.id::text=j->>'id' join public.bb_firms f on f.id=o.firm_id;
 return s||jsonb_build_object('firmBrand',brand,'printBrands',brands,'orders',orders);
end $$;
alter function public.brief_beta_firm_directory(uuid) rename to directory_before_firm_logo;
alter function public.directory_before_firm_logo(uuid) set schema brief_beta_private;
create function public.brief_beta_firm_directory(workspace_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;firms jsonb;
begin
 s:=brief_beta_private.directory_before_firm_logo(workspace_id);
 select coalesce(jsonb_agg(j||jsonb_build_object('logo',f.logo_data)),'[]'::jsonb) into firms from jsonb_array_elements(s->'firms') j join public.bb_firms f on f.id::text=j->>'id';
 return s||jsonb_build_object('firms',firms);
end $$;
revoke all on function brief_beta_private.load_before_firm_logo(uuid),brief_beta_private.directory_before_firm_logo(uuid) from public,anon,authenticated;
revoke all on function public.brief_beta_firm_logo(uuid,text),public.brief_beta_load(uuid),public.brief_beta_firm_directory(uuid) from public,anon;
grant execute on function public.brief_beta_firm_logo(uuid,text),public.brief_beta_load(uuid),public.brief_beta_firm_directory(uuid) to authenticated;
