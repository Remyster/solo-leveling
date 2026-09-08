-- WerkHub — Supabase-setup (project "Vaste laten" / mdslvdrsggpksqrbtwci)
--
-- STATUS: onderstaande policies zijn op 2026-09-07 door Remy uitgevoerd.
-- Bewaard als naslag; opnieuw draaien geeft een "policy already exists"-fout.
--
-- Nog wel te doen (niet in SQL, maar in het dashboard):
--   Project Settings → Edge Functions → Secrets → nieuwe secret
--   naam:   ANTHROPIC_API_KEY
--   waarde: je sk-ant-... key
--   Zonder die secret geeft de ai-proxy een 500 en werkt de AI-scan niet.
--
-- De privé bucket 'werkhub-docs' en de upload-policy staan er al.
-- Deze twee regels ontbreken nog:
--   * SELECT  → nodig om een tijdelijke (signed) link naar een bon/offerte te maken
--   * DELETE  → nodig om het bestand mee te verwijderen als je een document weggooit
-- Zonder deze twee werkt uploaden wel, maar geeft "bestand ↗" een foutmelding.

create policy anon_read_werkhub_docs on storage.objects
  for select to anon using (bucket_id = 'werkhub-docs');

create policy anon_delete_werkhub_docs on storage.objects
  for delete to anon using (bucket_id = 'werkhub-docs');

-- 2026-09-08: tabel voor de Uren-tab (workload). Al uitgevoerd, staat hier als naslag.
create table if not exists public.work_load (
  id uuid primary key default gen_random_uuid(),
  datum date not null default current_date,
  code text not null,                       -- bijv. AKF, DWAT
  uren numeric not null default 0,
  werkzaamheden text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists work_load_datum_idx on public.work_load (datum desc);
alter table public.work_load enable row level security;
create policy anon_all on public.work_load for all using (true) with check (true);
