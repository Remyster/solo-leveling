-- Alleen na WHATSAPP-MIGRATIE.sql uitvoeren. Leest uitsluitend metadata.
-- Toont geen taakinhoud, gebruikers-ID's, telefoonnummers of secrets.
do $$
declare
  trigger_count integer;
  trigger_events text[];
  trigger_body text;
  claim_body text;
begin
  select count(*), array_agg(event_manipulation order by event_manipulation)
  into trigger_count, trigger_events
  from information_schema.triggers
  where event_object_schema = 'public'
    and event_object_table = 'work_tasks'
    and trigger_name = 'work_task_whatsapp_insert';

  if trigger_count <> 1 or trigger_events <> array['INSERT']::text[] then
    raise exception 'WhatsApp-trigger moet uitsluitend AFTER INSERT zijn';
  end if;

  select pg_get_functiondef('public.work_task_whatsapp_insert()'::regprocedure)
  into trigger_body;
  if trigger_body not like '%new.project <> ''pwn''%'
     or trigger_body not like '%new.team_id is not null%'
     or trigger_body not like '%new.taaktype%'
     or trigger_body not like '%opt_in_confirmed_at is not null%'
     or trigger_body not like '%on conflict (task_id) do nothing%'
  then
    raise exception 'Persoonlijke-taakfilter, opt-in of deduplicatie ontbreekt';
  end if;

  select pg_get_functiondef(
    'public.work_claim_whatsapp_jobs(uuid)'::regprocedure
  ) into claim_body;
  if claim_body not like '%status = ''queued''%'
     or claim_body not like '%status = ''unknown''%'
     or claim_body like '%status in (''queued'', ''sending'')%'
  then
    raise exception 'Claimfunctie kan sending mogelijk onveilig opnieuw verzenden';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'work_whatsapp_events'
      and indexdef ilike '%unique%task_id%'
  ) then
    raise exception 'Unieke taakdeduplicatie ontbreekt';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('work_whatsapp_events', 'work_whatsapp_settings')
      and grantee in ('anon', 'authenticated')
  ) then
    raise exception 'WhatsApp-tabellen zijn direct toegankelijk voor clients';
  end if;
end;
$$;

select 'PASS: WhatsApp-schema en trigger metadata gecontroleerd' as resultaat;
