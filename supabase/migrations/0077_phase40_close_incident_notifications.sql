-- A resolved incident should stop looking outstanding. The stale-incident
-- notifications already delivered for it are marked read when the incident is
-- resolved or dismissed, so the inbox and its unread count stop advertising a
-- problem that is closed.
--
-- This lives on the incident row rather than in the notification pass so every
-- path that closes an incident clears them: the recovery flow, a direct update,
-- or anything added later. Notifications stay in the table as history; they are
-- only marked read.

create or replace function public.close_incident_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.workspace_notifications
  set read_at = now()
  where incident_id = new.id
    and read_at is null;

  return new;
end;
$$;

comment on function public.close_incident_notifications() is
  'Marks the unread notifications for an incident read when that incident is resolved or dismissed.';

revoke all on function public.close_incident_notifications() from public, anon, authenticated;

drop trigger if exists app_release_incidents_close_notifications
  on public.app_release_incidents;
create trigger app_release_incidents_close_notifications
  after update of status on public.app_release_incidents
  for each row
  when (
    new.status in ('resolved', 'dismissed')
    and old.status is distinct from new.status
  )
  execute function public.close_incident_notifications();
