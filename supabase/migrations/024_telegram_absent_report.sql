-- ============================================================
-- 024 — TELEGRAM: KELMAGANLAR VA KUNLIK HISOBOT (SERVERSIZ)
-- ------------------------------------------------------------
-- pg_cron har 15 daqiqada tekshiradi:
--   • Ish boshlanganiga 30 daqiqa bo'lsa ham kelmagan xodimlar →
--     "🚫 Kelmadi: Ali (09:00 da kelishi kerak edi)"  (har kuni bir marta)
--   • Belgilangan soatda (standart 22:00) kunlik hisobot:
--     kim keldi, kim kelmadi, kim hali ishda
--
-- 023 dan KEYIN ishga tushiring. Supabase → SQL Editor → "Run".
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE private.telegram_settings
  ADD COLUMN IF NOT EXISTS notify_absent BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS absent_after_min INT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS daily_report BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS report_hour INT NOT NULL DEFAULT 22;

-- Bir xabar ikki marta ketmasligi uchun
CREATE TABLE IF NOT EXISTS private.tg_sent (
  kind        TEXT NOT NULL,          -- 'absent' | 'daily'
  day         DATE NOT NULL,
  employee_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (kind, day, employee_id)
);
REVOKE ALL ON private.tg_sent FROM PUBLIC, anon, authenticated;

-- Bugun (Toshkent) ishga kelishi kerak bo'lgan xodimlar va ish boshlanish vaqti
CREATE OR REPLACE FUNCTION private.tg_scheduled_today()
RETURNS TABLE (employee_id UUID, full_name TEXT, branch TEXT, shift_start TIME)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = private, public
AS $$
  SELECT DISTINCT ON (e.id) e.id, e.full_name,
         COALESCE(b.name, NULLIF(e.branch, ''), '—'), w.shift_start
    FROM public.employees e
    JOIN public.work_schedules w ON w.employee_id = e.id AND COALESCE(w.is_active, TRUE)
    LEFT JOIN public.branches b ON b.id = e.branch_id
   WHERE e.status IN ('active', 'trial')
     AND w.shift_start IS NOT NULL
     AND to_char(NOW() AT TIME ZONE 'Asia/Tashkent', 'Dy') = ANY(w.work_days)
   ORDER BY e.id, w.shift_start;
$$;

-- ─── 1. Kelmaganlar ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.tg_check_absent()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  s       private.telegram_settings;
  v_now   TIMESTAMP := NOW() AT TIME ZONE 'Asia/Tashkent';
  v_today DATE := (NOW() AT TIME ZONE 'Asia/Tashkent')::DATE;
  v_lines TEXT;
  v_ids   UUID[];
BEGIN
  SELECT * INTO s FROM private.telegram_settings WHERE id = 1;
  IF NOT (COALESCE(s.enabled, FALSE) AND s.notify_absent) THEN RETURN; END IF;

  SELECT string_agg(format('• %s — %s da kelishi kerak edi (%s)',
                           private.tg_escape(t.full_name), to_char(t.shift_start, 'HH24:MI'),
                           private.tg_escape(t.branch)), E'\n' ORDER BY t.shift_start, t.full_name),
         array_agg(t.employee_id)
    INTO v_lines, v_ids
    FROM private.tg_scheduled_today() t
   WHERE v_now::TIME >= t.shift_start + make_interval(mins => s.absent_after_min)
     AND NOT EXISTS (
       SELECT 1 FROM public.attendance_sessions a
        WHERE a.employee_id = t.employee_id
          AND (a.check_in_at AT TIME ZONE 'Asia/Tashkent')::DATE = v_today)
     AND NOT EXISTS (
       SELECT 1 FROM private.tg_sent x
        WHERE x.kind = 'absent' AND x.day = v_today AND x.employee_id = t.employee_id);

  IF v_lines IS NULL THEN RETURN; END IF;

  PERFORM private.tg_send(format(E'🚫 <b>Kelmadi</b> (%s daqiqadan ko''p kechikdi):\n%s', s.absent_after_min, v_lines));
  INSERT INTO private.tg_sent (kind, day, employee_id)
  SELECT 'absent', v_today, unnest(v_ids) ON CONFLICT DO NOTHING;
END;
$$;

-- ─── 2. Kunlik hisobot ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.tg_daily_report(p_force BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  s        private.telegram_settings;
  v_now    TIMESTAMP := NOW() AT TIME ZONE 'Asia/Tashkent';
  v_today  DATE := (NOW() AT TIME ZONE 'Asia/Tashkent')::DATE;
  v_came   TEXT;
  v_ncame  INT;
  v_absent TEXT;
  v_nabs   INT;
  v_open   TEXT;
BEGIN
  SELECT * INTO s FROM private.telegram_settings WHERE id = 1;
  IF NOT p_force THEN
    IF NOT (COALESCE(s.enabled, FALSE) AND s.daily_report) THEN RETURN; END IF;
    IF EXTRACT(HOUR FROM v_now) < s.report_hour THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM private.tg_sent WHERE kind = 'daily' AND day = v_today) THEN RETURN; END IF;
  END IF;

  -- Kelganlar: birinchi kelgan va oxirgi ketgan vaqti
  SELECT count(*), string_agg(line, E'\n' ORDER BY first_in)
    INTO v_ncame, v_came
    FROM (
      SELECT min(a.check_in_at) AS first_in,
             format('• %s — %s–%s', private.tg_escape(e.full_name),
                    to_char(min(a.check_in_at) AT TIME ZONE 'Asia/Tashkent', 'HH24:MI'),
                    CASE WHEN bool_or(a.check_out_at IS NULL) THEN 'hali ishda'
                         ELSE to_char(max(a.check_out_at) AT TIME ZONE 'Asia/Tashkent', 'HH24:MI') END) AS line
        FROM public.attendance_sessions a
        JOIN public.employees e ON e.id = a.employee_id
       WHERE (a.check_in_at AT TIME ZONE 'Asia/Tashkent')::DATE = v_today
       GROUP BY e.id, e.full_name
    ) x;

  -- Kelmaganlar (bugun ish kuni bo'lganlar)
  SELECT count(*), string_agg(format('• %s', private.tg_escape(t.full_name)), E'\n' ORDER BY t.full_name)
    INTO v_nabs, v_absent
    FROM private.tg_scheduled_today() t
   WHERE NOT EXISTS (
     SELECT 1 FROM public.attendance_sessions a
      WHERE a.employee_id = t.employee_id
        AND (a.check_in_at AT TIME ZONE 'Asia/Tashkent')::DATE = v_today);

  PERFORM private.tg_send(format(E'📊 <b>Kunlik hisobot — %s</b>\n\n✅ Keldi: %s kishi\n%s\n\n🚫 Kelmadi: %s kishi\n%s',
    to_char(v_today, 'DD.MM.YYYY'),
    COALESCE(v_ncame, 0), COALESCE(v_came, '—'),
    COALESCE(v_nabs, 0), COALESCE(v_absent, '—')));

  IF NOT p_force THEN
    INSERT INTO private.tg_sent (kind, day) VALUES ('daily', v_today) ON CONFLICT DO NOTHING;
  END IF;
END;
$$;

-- ─── 3. Har 15 daqiqada ishga tushadi ─────────────────────────────────────
CREATE OR REPLACE FUNCTION private.tg_tick()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  BEGIN PERFORM private.tg_check_absent(); EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN PERFORM private.tg_daily_report(); EXCEPTION WHEN OTHERS THEN NULL; END;
  -- Eski yozuvlarni tozalash
  DELETE FROM private.tg_sent WHERE day < CURRENT_DATE - 30;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('fritto-telegram-tick')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fritto-telegram-tick');
END $$;
SELECT cron.schedule('fritto-telegram-tick', '*/15 * * * *', 'SELECT private.tg_tick()');

-- ─── 4. Admin panel: holat va saqlash (yangi sozlamalar bilan) ────────────
CREATE OR REPLACE FUNCTION public.admin_telegram_status()
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE s private.telegram_settings;
BEGIN
  IF NOT public.caller_is_admin() THEN RAISE EXCEPTION 'ADMIN_ONLY'; END IF;
  SELECT * INTO s FROM private.telegram_settings WHERE id = 1;
  RETURN json_build_object(
    'has_token', s.bot_token IS NOT NULL,
    'token_hint', CASE WHEN s.bot_token IS NULL THEN NULL ELSE split_part(s.bot_token, ':', 1) || ':•••' END,
    'chat_id', s.chat_id, 'enabled', s.enabled,
    'notify_in', s.notify_in, 'notify_out', s.notify_out,
    'notify_absent', s.notify_absent, 'absent_after_min', s.absent_after_min,
    'daily_report', s.daily_report, 'report_hour', s.report_hour
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_telegram_save_extra(
  p_notify_absent BOOLEAN, p_absent_after_min INT, p_daily_report BOOLEAN, p_report_hour INT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF NOT public.caller_is_admin() THEN RAISE EXCEPTION 'ADMIN_ONLY'; END IF;
  UPDATE private.telegram_settings SET
    notify_absent    = COALESCE(p_notify_absent, TRUE),
    absent_after_min = LEAST(GREATEST(COALESCE(p_absent_after_min, 30), 5), 240),
    daily_report     = COALESCE(p_daily_report, TRUE),
    report_hour      = LEAST(GREATEST(COALESCE(p_report_hour, 22), 0), 23),
    updated_at       = NOW()
  WHERE id = 1;
END;
$$;

-- Hisobotni hozir yuborib ko'rish
CREATE OR REPLACE FUNCTION public.admin_telegram_report_now()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF NOT public.caller_is_admin() THEN RAISE EXCEPTION 'ADMIN_ONLY'; END IF;
  PERFORM private.tg_daily_report(TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_telegram_save_extra(BOOLEAN, INT, BOOLEAN, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_telegram_report_now() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_telegram_save_extra(BOOLEAN, INT, BOOLEAN, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_telegram_report_now() TO authenticated;
