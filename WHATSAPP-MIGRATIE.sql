-- Alleen uitvoeren nadat TEAM-MIGRATIE.sql en TAKEN-SUBTAKEN-MIGRATIE.sql actief zijn.
-- Idempotente server-side queue. Bestaande e-mail/pushtabellen en planners blijven intact.
begin;

create table if not exists public.work_whatsapp_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  enabled_at timestamptz,
  opt_in_confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  last_checked_at timestamptz
);
alter table public.work_whatsapp_settings
  add column if not exists enabled_at timestamptz,
  add column if not exists opt_in_confirmed_at timestamptz,
  add column if not exists last_checked_at timestamptz;

create table if not exists public.work_whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null unique references public.work_tasks(id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  deadline date,
  status text not null default 'queued',
  attempts integer not null default 0 check (attempts between 0 and 5),
  available_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_message_sid text,
  provider_status text,
  accepted_at timestamptz,
  sent_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 100),
  created_at timestamptz not null default now()
);
alter table public.work_whatsapp_events
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists provider_message_sid text,
  add column if not exists provider_status text,
  add column if not exists accepted_at timestamptz;

update public.work_whatsapp_events
set status = 'accepted', accepted_at = coalesce(accepted_at, sent_at)
where status = 'sent';

alter table public.work_whatsapp_events
  drop constraint if exists work_whatsapp_events_status_check;
alter table public.work_whatsapp_events
  add constraint work_whatsapp_events_status_check
  check (status in ('queued', 'sending', 'accepted', 'failed', 'unknown'));

create unique index if not exists work_whatsapp_provider_sid_once
  on public.work_whatsapp_events(provider_message_sid)
  where provider_message_sid is not null;
create index if not exists work_whatsapp_queue_ready
  on public.work_whatsapp_events(available_at, created_at)
  where status = 'queued';

alter table public.work_whatsapp_settings enable row level security;
alter table public.work_whatsapp_events enable row level security;
revoke all on public.work_whatsapp_settings, public.work_whatsapp_events
  from public, anon, authenticated;
grant all on public.work_whatsapp_settings, public.work_whatsapp_events
  to service_role;

-- AFTER INSERT betekent dat bewerken nooit een nieuw event maakt.
-- team_id sluit Team/Pret uit; taaktype sluit kleine subtaken uit.
-- Bij een queuefout blijft de taakopslag slagen en wordt alleen een code gelogd.
create or replace function public.work_task_whatsapp_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null
     or new.project <> 'pwn'
     or new.team_id is not null
     or coalesce(new.taaktype, 'taak') <> 'taak'
     or new.status = 'klaar'
     or not exists (
       select 1 from public.work_whatsapp_settings s
       where s.user_id = v_user_id
         and s.enabled is true
         and s.opt_in_confirmed_at is not null
     )
  then
    return new;
  end if;

  begin
    insert into public.work_whatsapp_events (
      user_id, task_id, title, deadline, status
    ) values (
      v_user_id, new.id, left(btrim(new.titel), 120), new.deadline, 'queued'
    )
    on conflict (task_id) do nothing;
  exception when others then
    raise warning 'work_whatsapp_enqueue_failed';
  end;
  return new;
end;
$$;
revoke all on function public.work_task_whatsapp_insert()
  from public, anon, authenticated;

drop trigger if exists work_task_whatsapp_insert on public.work_tasks;
create trigger work_task_whatsapp_insert
  after insert on public.work_tasks
  for each row
  execute function public.work_task_whatsapp_insert();

-- At-most-once provideraanroep:
-- * alleen queued wordt geclaimd;
-- * een verlopen sending-lease wordt unknown en nooit blind opnieuw verzonden;
-- * alleen expliciet geweigerde/retrybare providerresponses gaan terug naar queued.
create or replace function public.work_claim_whatsapp_jobs(p_user_id uuid)
returns setof public.work_whatsapp_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.work_whatsapp_settings
  set last_checked_at = now()
  where user_id = p_user_id and enabled is true;

  if not found then
    return;
  end if;

  update public.work_whatsapp_events
  set status = 'unknown',
      last_error = 'claim_expired_outcome_unknown',
      lease_token = null,
      lease_expires_at = null
  where user_id = p_user_id
    and status = 'sending'
    and lease_expires_at <= now();

  update public.work_whatsapp_events
  set status = 'failed', last_error = 'retry_limit'
  where user_id = p_user_id
    and status = 'queued'
    and attempts >= 5;

  return query
  with candidates as (
    select e.id
    from public.work_whatsapp_events e
    where e.user_id = p_user_id
      and e.status = 'queued'
      and e.available_at <= now()
      and e.attempts < 5
    order by e.created_at
    limit 10
    for update skip locked
  )
  update public.work_whatsapp_events e
  set status = 'sending',
      attempts = e.attempts + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + interval '2 minutes'
  from candidates c
  where e.id = c.id
  returning e.*;
end;
$$;
revoke all on function public.work_claim_whatsapp_jobs(uuid)
  from public, anon, authenticated;
grant execute on function public.work_claim_whatsapp_jobs(uuid)
  to service_role;

commit;

-- Controle zonder taakinhoud te tonen.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('work_whatsapp_settings', 'work_whatsapp_events')
order by table_name, ordinal_position;

select trigger_name, event_manipulation
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table = 'work_tasks'
  and trigger_name = 'work_task_whatsapp_insert';
