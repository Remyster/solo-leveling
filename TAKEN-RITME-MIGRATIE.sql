-- v35.1 (10 nov 2026, al uitgevoerd): vaste taak eenmalig verzetten zonder dat het ritme verschuift.
-- ritme_datum = de oorspronkelijke ritmedag van deze keer; leeg = deadline is de ritmedag.
alter table public.work_tasks add column if not exists ritme_datum date;
