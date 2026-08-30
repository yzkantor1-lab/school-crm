-- Extends the per-schedule default (sola_sync_schedules.default_purpose,
-- 20260730000024_sola_sync.sql) with which tuition plan a recurring schedule
-- belongs to, not just which fee type. Not every family pays on a
-- predictable date, so date-proximity guessing (tuition_merge_window_days,
-- see 20260830000032) isn't reliable for them — but once a schedule is
-- confirmed once (fee type + plan both set), every future payment from that
-- exact schedule is unambiguous by identity alone, no date guessing needed.
-- See app/api/sola/sync/import/route.ts's isScheduleConfirmed check.
alter table sola_sync_schedules
  add column if not exists default_tuition_plan_id uuid references tuition_plans(id) on delete set null;
