-- OPTIONAL DESTRUCTIVE STEP. Run only AFTER checking migrated data and exporting a backup.
-- Does not remove Storage objects; imported old files are still needed by the new app.
begin;
do $$ begin
 if to_regclass('public.brief_orders') is not null then
 if exists(select 1 from public.brief_orders o where not exists(select 1 from public.bb_orders b where b.id=o.id)) then
  raise exception 'Legacy orders missing from new tables. Verify import before retiring old tables. Orders deliberately deleted in the new app also trigger this safeguard.';
 end if;
 end if;
end $$;
drop function if exists public.brief_apply(bigint,jsonb);
drop function if exists public.brief_load();
drop function if exists public.brief_bootstrap();
drop function if exists public.brief_file_access(text,boolean);
drop schema if exists brief_private cascade;
drop table if exists public.brief_files, public.brief_notes, public.brief_events, public.brief_participants, public.brief_orders, public.brief_projects, public.brief_customer_projects, public.brief_customers, public.brief_members, public.brief_companies cascade;
commit;
