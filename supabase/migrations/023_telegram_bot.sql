-- ============================================================
-- 023 — TELEGRAM BOT: KIM KELDI / KIM KETDI (SERVERSIZ)
-- ------------------------------------------------------------
-- Xodim QR skanerlaganda baza o'zi Telegram'ga xabar yuboradi (pg_net).
-- Alohida server kerak emas.
--
-- Sozlash admin panelda: Sozlamalar → Telegram bot
--   1) @BotFather → /newbot → tokenni oling
--   2) Botni guruhga qo'shing va guruhga biror xabar yozing
--   3) Admin panelda tokenni qo'ying → «Guruhni topish» → saqlang
--
-- Token API orqali hech kimga qaytarilmaydi (faqat "bor/yo'q").
-- Supabase → SQL Editor → nusxalab "Run".
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS private;

-- ─── 1. Sozlamalar (tashqaridan o'qib bo'lmaydigan sxemada) ───────────────
CREATE TABLE IF NOT EXISTS private.telegram_settings (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bot_token   TEXT,
  chat_id     TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  notify_in   BOOLEAN NOT NULL DEFAULT TRUE,
  notify_out  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO private.telegram_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
REVOKE ALL ON private.telegram_settings FROM PUBLIC, anon, authenticated;

-- HTML belgilarni xavfsiz qilish
CREATE OR REPLACE FUNCTION private.tg_escape(t TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(replace(replace(COALESCE(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
$$;

-- Xabar yuborish (javobni kutmaydi — davomat sekinlashmaydi)
CREATE OR REPLACE FUNCTION private.tg_send(p_text TEXT, p_chat TEXT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, extensions, public
AS $$
DECLARE
  s private.telegram_settings;
BEGIN
  SELECT * INTO s FROM private.telegram_settings WHERE id = 1;
  IF s.bot_token IS NULL OR COALESCE(p_chat, s.chat_id) IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN net.http_post(
    url     := 'https://api.telegram.org/bot' || s.bot_token || '/sendMessage',
    body    := jsonb_build_object('chat_id', COALESCE(p_chat, s.chat_id), 'text', p_text,
                                  'parse_mode', 'HTML', 'disable_web_page_preview', true),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
END;
$$;
REVOKE ALL ON FUNCTION private.tg_send(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ─── 2. Keldi / Ketdi xabari ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.tg_attendance_notify()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  s        private.telegram_settings;
  v_emp    RECORD;
  v_branch TEXT;
  v_local  TIMESTAMP;
  v_start  TIME;
  v_late   INT;
  v_secs   INT;
  v_text   TEXT;
BEGIN
  SELECT * INTO s FROM private.telegram_settings WHERE id = 1;
  IF NOT COALESCE(s.enabled, FALSE) THEN
    RETURN NEW;
  END IF;

  SELECT e.full_name, e.position, e.branch, e.branch_id INTO v_emp
    FROM public.employees e WHERE e.id = NEW.employee_id;

  -- KELDI
  IF TG_OP = 'INSERT' AND s.notify_in THEN
    SELECT b.name INTO v_branch FROM public.branches b
     WHERE b.id = COALESCE(NEW.branch_in_id, v_emp.branch_id);
    v_local := NEW.check_in_at AT TIME ZONE 'Asia/Tashkent';

    -- Kechikdimi? (bugungi ish jadvali bo'yicha, 10 daqiqagacha kechiriladi)
    SELECT w.shift_start INTO v_start
      FROM public.work_schedules w
     WHERE w.employee_id = NEW.employee_id
       AND COALESCE(w.is_active, TRUE)
       AND to_char(v_local, 'Dy') = ANY(w.work_days)
     LIMIT 1;
    IF v_start IS NOT NULL THEN
      v_late := FLOOR(EXTRACT(EPOCH FROM (v_local::TIME - v_start)) / 60);
    END IF;

    v_text := format(E'🟢 <b>Keldi:</b> %s\n📍 %s · %s',
      private.tg_escape(v_emp.full_name),
      private.tg_escape(COALESCE(v_branch, NULLIF(v_emp.branch, ''), '—')),
      to_char(v_local, 'HH24:MI'));
    IF v_late IS NOT NULL AND v_late > 10 THEN
      v_text := v_text || format(E'\n⚠️ %s daqiqa kechikdi', v_late);
    END IF;
    PERFORM private.tg_send(v_text);

  -- KETDI
  ELSIF TG_OP = 'UPDATE' AND s.notify_out
        AND OLD.check_out_at IS NULL AND NEW.check_out_at IS NOT NULL THEN
    SELECT b.name INTO v_branch FROM public.branches b
     WHERE b.id = COALESCE(NEW.branch_out_id, NEW.branch_in_id, v_emp.branch_id);
    v_secs := COALESCE(NEW.worked_seconds, EXTRACT(EPOCH FROM (NEW.check_out_at - NEW.check_in_at))::INT);
    v_text := format(E'🔴 <b>Ketdi:</b> %s\n📍 %s · %s–%s\n⏱ %s soat %s daqiqa ishladi',
      private.tg_escape(v_emp.full_name),
      private.tg_escape(COALESCE(v_branch, NULLIF(v_emp.branch, ''), '—')),
      to_char(NEW.check_in_at AT TIME ZONE 'Asia/Tashkent', 'HH24:MI'),
      to_char(NEW.check_out_at AT TIME ZONE 'Asia/Tashkent', 'HH24:MI'),
      v_secs / 3600, (v_secs % 3600) / 60);
    PERFORM private.tg_send(v_text);
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Telegram'dagi xato davomatni hech qachon to'xtatmasin
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tg_attendance ON public.attendance_sessions;
CREATE TRIGGER trg_tg_attendance
  AFTER INSERT OR UPDATE OF check_out_at ON public.attendance_sessions
  FOR EACH ROW EXECUTE FUNCTION private.tg_attendance_notify();

-- ─── 3. Admin panel uchun funksiyalar ─────────────────────────────────────
-- Holat (token qaytarilmaydi)
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
    'notify_in', s.notify_in, 'notify_out', s.notify_out
  );
END;
$$;

-- Saqlash (p_token NULL bo'lsa — eski token qoladi)
CREATE OR REPLACE FUNCTION public.admin_telegram_save(
  p_token TEXT, p_chat_id TEXT, p_enabled BOOLEAN, p_notify_in BOOLEAN DEFAULT TRUE, p_notify_out BOOLEAN DEFAULT TRUE
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, public
AS $$
BEGIN
  IF NOT public.caller_is_admin() THEN RAISE EXCEPTION 'ADMIN_ONLY'; END IF;
  IF NULLIF(trim(p_token), '') IS NOT NULL AND trim(p_token) !~ '^[0-9]+:[A-Za-z0-9_-]{20,}$' THEN
    RAISE EXCEPTION 'BAD_TOKEN';
  END IF;
  UPDATE private.telegram_settings SET
    bot_token  = COALESCE(NULLIF(trim(p_token), ''), bot_token),
    chat_id    = NULLIF(trim(p_chat_id), ''),
    enabled    = COALESCE(p_enabled, FALSE),
    notify_in  = COALESCE(p_notify_in, TRUE),
    notify_out = COALESCE(p_notify_out, TRUE),
    updated_at = NOW()
  WHERE id = 1;
END;
$$;

-- Botga yozilgan guruh/chatlarni topish: 1-qadam — so'rov yuborish
CREATE OR REPLACE FUNCTION public.admin_telegram_find_chats_start(p_token TEXT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, extensions, public
AS $$
DECLARE v_token TEXT;
BEGIN
  IF NOT public.caller_is_admin() THEN RAISE EXCEPTION 'ADMIN_ONLY'; END IF;
  v_token := COALESCE(NULLIF(trim(p_token), ''), (SELECT bot_token FROM private.telegram_settings WHERE id = 1));
  IF v_token IS NULL THEN RAISE EXCEPTION 'NO_TOKEN'; END IF;
  RETURN net.http_get('https://api.telegram.org/bot' || v_token || '/getUpdates');
END;
$$;

-- 2-qadam — javobdan chatlar ro'yxatini olish
CREATE OR REPLACE FUNCTION public.admin_telegram_find_chats_result(p_request_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, extensions, public
AS $$
DECLARE
  r      RECORD;
  v_body JSONB;
BEGIN
  IF NOT public.caller_is_admin() THEN RAISE EXCEPTION 'ADMIN_ONLY'; END IF;
  SELECT status_code, content INTO r FROM net._http_response WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN json_build_object('pending', true); END IF;
  IF r.status_code = 401 OR r.status_code = 404 THEN RAISE EXCEPTION 'BAD_TOKEN'; END IF;
  v_body := r.content::JSONB;
  RETURN json_build_object('pending', false, 'chats', COALESCE((
    SELECT json_agg(DISTINCT jsonb_build_object(
             'id', c->>'id',
             'title', COALESCE(c->>'title', concat_ws(' ', c->>'first_name', c->>'last_name')),
             'type', c->>'type'))
      FROM jsonb_array_elements(v_body->'result') u,
           LATERAL (SELECT COALESCE(u->'message'->'chat', u->'my_chat_member'->'chat') AS c) x
     WHERE c IS NOT NULL
  ), '[]'::json));
END;
$$;

-- Sinov xabari
CREATE OR REPLACE FUNCTION public.admin_telegram_test()
RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE v_id BIGINT;
BEGIN
  IF NOT public.caller_is_admin() THEN RAISE EXCEPTION 'ADMIN_ONLY'; END IF;
  v_id := private.tg_send(E'✅ <b>FRITTO</b> bot ulandi!\nBu yerga kim kelgani va ketgani haqida xabarlar keladi.');
  IF v_id IS NULL THEN RAISE EXCEPTION 'NOT_CONFIGURED'; END IF;
  RETURN v_id;
END;
$$;

-- Sinov natijasi (Telegram xato qaytardimi?)
CREATE OR REPLACE FUNCTION public.admin_telegram_request_result(p_request_id BIGINT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = private, extensions, public
AS $$
DECLARE r RECORD;
BEGIN
  IF NOT public.caller_is_admin() THEN RAISE EXCEPTION 'ADMIN_ONLY'; END IF;
  SELECT status_code, content INTO r FROM net._http_response WHERE id = p_request_id;
  IF NOT FOUND THEN RETURN json_build_object('pending', true); END IF;
  RETURN json_build_object('pending', false, 'ok', r.status_code = 200,
                           'error', CASE WHEN r.status_code <> 200 THEN (r.content::JSONB)->>'description' END);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_telegram_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_telegram_save(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_telegram_find_chats_start(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_telegram_find_chats_result(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_telegram_test() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_telegram_request_result(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_telegram_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_telegram_save(TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_telegram_find_chats_start(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_telegram_find_chats_result(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_telegram_test() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_telegram_request_result(BIGINT) TO authenticated;
