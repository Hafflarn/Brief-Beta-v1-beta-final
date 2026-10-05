begin;
create index if not exists bb_build_reports_author on public.bb_build_reports(author);
create index if not exists bb_build_reports_workspace on public.bb_build_reports(workspace);
create index if not exists bb_inbox_order on public.bb_inbox(order_id);
create index if not exists bb_inbox_member on public.bb_inbox(recipient);
commit;
