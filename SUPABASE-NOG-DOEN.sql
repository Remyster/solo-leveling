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
-- (die anon_all-policy is bij de auth-ronde van 16-09-2026 vervangen door eigenaar_only)

-- 2026-10-06: tabel voor de Ritten-tab (logboek lease-auto). Al uitgevoerd via migratie
-- werkhub_work_stops, staat hier als naslag. Een regel is één stop (GPS-punt + tijd);
-- de rit ertussen leidt de app zelf af uit de volgorde.
create table if not exists public.work_stops (
  id uuid primary key default gen_random_uuid(),
  tijd timestamptz not null default now(),
  plaats text not null default '',          -- kort: "McDonald's", "thuis", "klus Castricum"
  soort text not null default 'prive',      -- prive | zakelijk
  lat numeric,
  lon numeric,
  nauwkeurig numeric,                       -- GPS-nauwkeurigheid in meters
  notitie text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists work_stops_tijd_idx on public.work_stops (tijd desc);
alter table public.work_stops enable row level security;
create policy eigenaar_only on public.work_stops for all to authenticated
  using (auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid)
  with check (auth.uid() = '4bad6ad7-741a-4d54-abfd-60e102df10a3'::uuid);
