-- Exact organization-number lookup; no public directory of unconnected firms.
alter table public.bb_firms add column organization_number text;
create unique index bb_firms_organization_number on public.bb_firms(organization_number) where organization_number is not null;
create function brief_beta_private.normalize_organization_number(value text) returns text language plpgsql immutable set search_path='' as $$
declare n text; total integer:=0; digit integer; i integer;
begin
 if value is null or value !~ '^[0-9 -]+$' then raise exception 'Ange ett giltigt organisationsnummer med tio siffror.';end if;
 n:=regexp_replace(value,'[ -]','','g');
 if n !~ '^[0-9]{10}$' or n='0000000000' then raise exception 'Ange ett giltigt organisationsnummer med tio siffror.';end if;
 for i in 1..10 loop digit:=substr(n,i,1)::integer * case when i%2=1 then 2 else 1 end;total:=total+digit/10+digit%10;end loop;
 if total%10<>0 then raise exception 'Organisationsnumrets kontrollsiffra är felaktig.';end if;
 return n;
end $$;
alter table public.bb_firms add constraint bb_firms_valid_organization_number check(organization_number is null or organization_number=brief_beta_private.normalize_organization_number(organization_number));
create function public.brief_beta_firm_register(workspace_id uuid,organization_number text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;n text;existing text;
begin
 m:=brief_beta_private.member(workspace_id);
 if m.external or brief_beta_private.rank(m.role)>2 then raise exception 'Du får inte registrera företaget.';end if;
 n:=brief_beta_private.normalize_organization_number(organization_number);
 select f.organization_number into existing from public.bb_firms f where id=m.firm_id for update;
 if existing is not null and existing<>n then raise exception 'Företagets organisationsnummer är redan registrerat.';end if;
 update public.bb_firms f set organization_number=n where id=m.firm_id;
 update public.bb_workspaces set revision=revision+1 where id=workspace_id;
 return public.brief_beta_firm_directory(workspace_id);
exception when unique_violation then raise exception 'Organisationsnumret är redan registrerat för ett annat företag.';
end $$;
create or replace function public.brief_beta_firm_directory(workspace_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members; result jsonb;
begin
 m:=brief_beta_private.member(workspace_id);if m.external or brief_beta_private.rank(m.role)>2 then raise exception 'Endast Admin, Platschef och Arbetsledare får hantera företagsförfrågningar.';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'organizationNumber',f.organization_number,'own',f.id=m.firm_id,'shared',brief_beta_private.shared(m.firm_id,f.id),'people',case when brief_beta_private.shared(m.firm_id,f.id) then coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'role',b.role,'organizationLevel',b.organization_level,'job',b.job,'employer',b.employer,'phone',b.phone,'email',b.email) order by b.name) from public.bb_members b where b.firm_id=f.id and active and not deleted),'[]') else '[]'::jsonb end) order by f.name),'[]') into result from public.bb_firms f where (f.id=m.firm_id or brief_beta_private.shared(m.firm_id,f.id)) and exists(select 1 from public.bb_members b where b.firm_id=f.id and active and not deleted and auth_user is not null and not external);
 return jsonb_build_object('firms',result,'requests',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'sender',r.sender,'recipient',r.recipient,'senderName',sf.name,'senderNumber',sf.organization_number,'recipientName',rf.name,'recipientNumber',rf.organization_number,'role',r.requester_role,'state',r.state,'incoming',r.recipient=m.firm_id,'canRespond',r.recipient=m.firm_id,'at',r.created_at) order by r.created_at desc) from public.bb_firm_requests r join public.bb_firms sf on sf.id=r.sender join public.bb_firms rf on rf.id=r.recipient where r.sender=m.firm_id or r.recipient=m.firm_id),'[]'));
end $$;
create function public.brief_beta_firm_lookup(workspace_id uuid,organization_number text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;n text;result jsonb;
begin
 m:=brief_beta_private.member(workspace_id);
 if m.external or brief_beta_private.rank(m.role)>2 then raise exception 'Du får inte söka företag.';end if;
 n:=brief_beta_private.normalize_organization_number(organization_number);
 select jsonb_build_object('id',f.id,'name',f.name,'organizationNumber',f.organization_number,'own',f.id=m.firm_id,'shared',brief_beta_private.shared(m.firm_id,f.id),'people','[]'::jsonb) into result from public.bb_firms f where f.organization_number=n and exists(select 1 from public.bb_members b where b.firm_id=f.id and active and not deleted and not external and auth_user is not null);
 return result;
end $$;
create function brief_beta_private.firm_request(workspace_id uuid,target uuid,action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.bb_members;r public.bb_firm_requests;
begin
 m:=brief_beta_private.member(workspace_id);if m.external or brief_beta_private.rank(m.role)>2 then raise exception 'Du får inte hantera företagsförfrågningar.';end if;
 perform 1 from public.bb_firms where id=m.firm_id for update;
 if action='request' then
  if not exists(select 1 from public.bb_firms where id=m.firm_id and organization_number is not null) then raise exception 'Registrera ditt företags organisationsnummer först.';end if;
  if not exists(select 1 from public.bb_firms where id=target and organization_number is not null) then raise exception 'Företaget är inte anslutet till Brief.';end if;
  if target=m.firm_id or not exists(select 1 from public.bb_members where firm_id=target and active and not deleted and not external and auth_user is not null and role in ('admin','site_manager','supervisor')) then raise exception 'Företaget behöver ett aktivt arbetsledningskonto.';end if;
  if exists(select 1 from public.bb_firm_requests where state in ('pending','accepted') and ((sender=m.firm_id and recipient=target) or (recipient=m.firm_id and sender=target))) then raise exception 'En förfrågan eller godkänd koppling finns redan.';end if;
  insert into public.bb_firm_requests(sender,recipient,requester,requester_role) values(m.firm_id,target,m.id,m.role);
 else
  select * into r from public.bb_firm_requests where id=target for update;
  if r.id is null then raise exception 'Förfrågan saknas.';end if;
  if action in ('accept','decline') then
   if r.recipient<>m.firm_id  or r.state<>'pending' then raise exception 'Du saknar åtkomst till förfrågan.';end if;
   update public.bb_firm_requests set state=case action when 'accept' then 'accepted' else 'declined' end,responded_at=now(),responded_by=m.id where id=r.id;
  elsif action='revoke' then
   if m.firm_id not in (r.sender,r.recipient) or r.state not in ('pending','accepted') then raise exception 'Du saknar åtkomst till kopplingen.';end if;
   update public.bb_firm_requests set state='revoked',responded_at=now(),responded_by=m.id where id=r.id;
  else raise exception 'Ogiltigt svar.';end if;
 end if;
 update public.bb_workspaces set revision=revision+1 where id in (select workspace from public.bb_firms where id=m.firm_id or id=case when action='request' then target else case when r.sender=m.firm_id then r.recipient else r.sender end end);
 return public.brief_beta_firm_directory(workspace_id);
end $$;
create or replace function public.brief_beta_firm_request(workspace_id uuid,target uuid,action text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if action='request' then raise exception 'Sök företaget med organisationsnummer för att ansluta.';end if;
 return brief_beta_private.firm_request(workspace_id,target,action);
end $$;
create function public.brief_beta_firm_connect(workspace_id uuid,organization_number text) returns jsonb language plpgsql security definer set search_path='' as $$
declare found jsonb;
begin
 found:=public.brief_beta_firm_lookup(workspace_id,organization_number);
 if found is null then raise exception 'Företaget är inte anslutet till Brief.';end if;
 return brief_beta_private.firm_request(workspace_id,(found->>'id')::uuid,'request');
end $$;
-- Inbox records are per recipient. No client can choose the sender firm.
alter table public.bb_inbox drop constraint bb_inbox_kind_check;
alter table public.bb_inbox add constraint bb_inbox_kind_check check(kind in ('diary','completed','firm'));
alter table public.bb_inbox add column firm_request_id uuid references public.bb_firm_requests;
create index bb_inbox_firm_request on public.bb_inbox(firm_request_id);
create function brief_beta_private.firm_request_inbox() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' and new.state='pending' then
  insert into public.bb_inbox(workspace,recipient,kind,title,sender,firm_request_id)
  select m.workspace,m.id,'firm',f.name||' vill ansluta sitt företag',f.name,new.id from public.bb_members m join public.bb_firms f on f.id=new.sender where m.firm_id=new.recipient and m.active and not m.deleted and not m.external and m.auth_user is not null and m.role in ('admin','site_manager','supervisor');
 elsif tg_op='UPDATE' and new.state<>'pending' then
  update public.bb_inbox set read_at=coalesce(read_at,now()) where firm_request_id=new.id;
 end if;return new;
end $$;
create trigger bb_firm_request_inbox after insert or update on public.bb_firm_requests for each row execute function brief_beta_private.firm_request_inbox();
-- Require an organization number for every newly registered firm; existing firms complete it in the UI.
create function brief_beta_private.require_firm_organization_number() returns trigger language plpgsql set search_path='' as $$
begin
 new.organization_number:=brief_beta_private.normalize_organization_number(new.organization_number);return new;
end $$;
create trigger bb_firm_requires_organization_number before insert on public.bb_firms for each row execute function brief_beta_private.require_firm_organization_number();
revoke all on function brief_beta_private.normalize_organization_number(text),brief_beta_private.firm_request(uuid,uuid,text),brief_beta_private.firm_request_inbox(),brief_beta_private.require_firm_organization_number() from public,anon,authenticated;
revoke all on function public.brief_beta_firm_register(uuid,text),public.brief_beta_firm_lookup(uuid,text),public.brief_beta_firm_connect(uuid,text) from public,anon;
grant execute on function public.brief_beta_firm_register(uuid,text),public.brief_beta_firm_lookup(uuid,text),public.brief_beta_firm_connect(uuid,text) to authenticated;

-- Deliver existing unanswered requests as well, once per active manager.
insert into public.bb_inbox(workspace,recipient,kind,title,sender,firm_request_id)
select m.workspace,m.id,'firm',f.name||' vill ansluta sitt företag',f.name,r.id
from public.bb_firm_requests r join public.bb_firms f on f.id=r.sender join public.bb_members m on m.firm_id=r.recipient
where r.state='pending' and m.active and not m.deleted and not m.external and m.auth_user is not null and m.role in ('admin','site_manager','supervisor')
and not exists(select 1 from public.bb_inbox i where i.firm_request_id=r.id and i.recipient=m.id);
