-- WerkHub v22: gewone taken en ongedateerde subtaken voor tussendoor.
-- Veilig om opnieuw uit te voeren. Wijzigt geen bestaande RLS-policies.

alter table if exists public.work_tasks
  add column if not exists taaktype text not null default 'taak';

update public.work_tasks
set taaktype = 'taak'
where taaktype is null;

alter table public.work_tasks
  drop constraint if exists work_tasks_taaktype_check;

alter table public.work_tasks
  add constraint work_tasks_taaktype_check
  check (taaktype in ('taak', 'subtaak'));

-- Nieuwe subtaken worden door de app zonder deadline of tijd opgeslagen.
-- Bestaande taken worden niet stilzwijgend omgezet of inhoudelijk gewijzigd.

select taaktype, count(*)
from public.work_tasks
group by taaktype
order by taaktype;
