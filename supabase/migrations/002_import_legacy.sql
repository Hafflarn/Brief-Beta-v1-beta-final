-- OPTIONAL: run after 001 in an existing Brief v0.2 database.
-- Copies existing data without deleting or changing legacy tables. Repeatable by original IDs.
begin;
do $$
begin
 if to_regclass('public.brief_companies') is null then raise notice 'No legacy Brief database found; nothing imported.'; return; end if;
 insert into public.bb_workspaces(id,name,revision,created_at) select id,name,revision,created_at from public.brief_companies on conflict do nothing;
 insert into public.bb_members(id,workspace,auth_user,email,name,role,employer,joined_at)
 select m.id,m.company_id,m.auth_user,m.email,m.name,case m.role when 'admin' then 'admin' else 'worker' end,c.name,case when m.auth_user is not null then m.created_at end
 from public.brief_members m join public.brief_companies c on c.id=m.company_id on conflict do nothing;
 insert into public.bb_companies(id,workspace,name,kind) select id,company_id,name,'Beställare' from public.brief_customers on conflict do nothing;
 insert into public.bb_projects(id,workspace,customer,number,customer_number,name,address)
 select id,company_id,customer_id,number,customer_project,name,address from public.brief_projects on conflict do nothing;
 insert into public.bb_orders(id,workspace,project,body)
 select o.id,o.company_id,o.project_id,jsonb_build_object('id',o.id,'project',o.project_id,'number','AO-'||left(o.id::text,8),'title',o.title,'description',o.description,'address',p.address,'assignee',o.assignee,'issuedBy',o.issued_by,'issuedAt',o.issued_at,'due',o.due,'priority',o.priority,'status',case o.status when 'Slutförd' then 'Avslutad' when 'Pågående' then 'Påbörjad' else 'Ej påbörjad' end,
 'completedAt',case when o.status='Slutförd' then coalesce((select max(at) from public.brief_events e where e.order_id=o.id),o.issued_at) end,
 'participants',(select coalesce(jsonb_agg(jsonb_build_object('user',member_id,'invitedBy',invited_by,'invitedAt',invited_at,'acceptedAt',accepted_at)),'[]') from public.brief_participants t where t.order_id=o.id),
 'events',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'at',at,'text',text) order by at),'[]') from public.brief_events e where e.order_id=o.id),
 'notes',(select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'at',n.at,'author',n.author,'text',n.text,'files',(select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'type',f.type,'path',f.path,'bucket','brief-files')),'[]') from public.brief_files f where f.note_id=n.id)) order by n.at),'[]') from public.brief_notes n where n.order_id=o.id))
 from public.brief_orders o join public.brief_projects p on p.id=o.project_id on conflict do nothing;
 -- Retire the old API; it must not bypass the new role model after migration.
 revoke execute on function public.brief_bootstrap(),public.brief_load(),public.brief_apply(bigint,jsonb),public.brief_file_access(text,boolean) from authenticated,anon,public;
end $$;
drop policy if exists brief_files_read on storage.objects;
drop policy if exists brief_files_upload on storage.objects;
drop policy if exists bb_legacy_files_read on storage.objects;
create policy bb_legacy_files_read on storage.objects for select to authenticated
 using(bucket_id='brief-files' and public.brief_beta_file_access(name));
commit;
