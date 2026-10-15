-- ============================================================
-- 002 — QR KOD ORQALI DAVOMAT
-- ------------------------------------------------------------
-- Ish joyidagi ekran (kiosk) har 15 soniyada yangi QR kod chiqaradi.
-- Har bir QR kod 45 soniya amal qiladi. Xodim uni telefon bilan
-- skanerlaydi: birinchi marta — "Keldi", ikkinchi marta — "Ketdi".
--
-- Barcha tekshiruvlar shu yerda, serverda bajariladi. Xodim endi
-- davomat yozuvini to'g'ridan-to'g'ri qo'sha olmaydi — faqat QR orqali.
--
-- Supabase → SQL Editor ga to'liq nusxalab, "Run" bosing.
-- ============================================================

-- ─── 1. Kiosklar (QR ko'rsatadigan ekranlar) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.qr_kiosks (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name         TEXT NOT NULL,
  branch       TEXT,
  secret_hash  TEXT NOT NULL,           -- sha256(maxfiy kalit), hex ko'rinishida
  is_active    BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 2. Qisqa muddatli QR tokenlar ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qr_tokens (
  token       TEXT PRIMARY KEY,
  kiosk_id    UUID REFERENCES public.qr_kiosks(id) ON DELETE CASCADE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qr_tokens_expires ON public.qr_tokens(expires_at);

ALTER TABLE public.qr_kiosks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_tokens ENABLE ROW LEVEL SECURITY;

-- Kiosklarni faqat admin ko'radi/o'zgartiradi. Tokenlarga API orqali hech kim
-- to'g'ridan-to'g'ri kira olmaydi (siyosat yo'q) — faqat quyidagi funksiyalar.
DROP POLICY IF EXISTS "kiosks_admin_all" ON public.qr_kiosks;
CREATE POLICY "kiosks_admin_all" ON public.qr_kiosks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ─── 3. Davomatga qaysi kioskdan kelgan/ketgani ───────────────────────────
ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS kiosk_in_id  UUID REFERENCES public.qr_kiosks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS kiosk_out_id UUID REFERENCES public.qr_kiosks(id) ON DELETE SET NULL;

-- ─── 4. Xodim endi davomatni o'zi yoza olmaydi (faqat QR orqali) ──────────
-- Admin avvalgidek "sessions_admin_all" orqali tuzata oladi.
DROP POLICY IF EXISTS "sessions_own_insert" ON public.attendance_sessions;
DROP POLICY IF EXISTS "sessions_own_update" ON public.attendance_sessions;


-- ============================================================
-- FUNKSIYALAR
-- ============================================================

DROP FUNCTION IF EXISTS public.kiosk_issue_token(UUID, TEXT);
DROP FUNCTION IF EXISTS public.kiosk_recent(UUID, TEXT);
DROP FUNCTION IF EXISTS public.qr_check_in_out(TEXT);

-- Kiosk kalitini tekshirish (ichki yordamchi)
CREATE OR REPLACE FUNCTION public.kiosk_auth(p_kiosk_id UUID, p_secret TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.qr_kiosks k
    WHERE k.id = p_kiosk_id
      AND k.is_active
      AND k.secret_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
  );
$$;
REVOKE ALL ON FUNCTION public.kiosk_auth(UUID, TEXT) FROM PUBLIC, anon, authenticated;


-- Kiosk yangi QR token oladi (har 15 soniyada chaqiriladi)
CREATE OR REPLACE FUNCTION public.kiosk_issue_token(p_kiosk_id UUID, p_secret TEXT)
RETURNS TABLE (qr_token TEXT, valid_until TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_token TEXT;
  v_until TIMESTAMPTZ;
BEGIN
  IF NOT public.kiosk_auth(p_kiosk_id, p_secret) THEN
    RAISE EXCEPTION 'KIOSK_AUTH_FAILED';
  END IF;

  -- Eski tokenlarni tozalash
  DELETE FROM public.qr_tokens t WHERE t.expires_at < NOW() - INTERVAL '5 minutes';

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_until := NOW() + INTERVAL '45 seconds';

  INSERT INTO public.qr_tokens (token, kiosk_id, expires_at)
  VALUES (v_token, p_kiosk_id, v_until);

  RETURN QUERY SELECT v_token::TEXT, v_until::TIMESTAMPTZ;
END;
$$;
GRANT EXECUTE ON FUNCTION public.kiosk_issue_token(UUID, TEXT) TO anon, authenticated;


-- Kiosk ekranida "oxirgi kelgan/ketganlar" ro'yxati
CREATE OR REPLACE FUNCTION public.kiosk_recent(p_kiosk_id UUID, p_secret TEXT)
RETURNS TABLE (full_name TEXT, action TEXT, happened_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.kiosk_auth(p_kiosk_id, p_secret) THEN
    RAISE EXCEPTION 'KIOSK_AUTH_FAILED';
  END IF;

  RETURN QUERY
  SELECT x.f_name::TEXT, x.f_action::TEXT, x.f_at::TIMESTAMPTZ FROM (
    SELECT e.full_name AS f_name, 'in'::TEXT AS f_action, s.check_in_at AS f_at
      FROM public.attendance_sessions s JOIN public.employees e ON e.id = s.employee_id
     WHERE s.kiosk_in_id = p_kiosk_id AND s.check_in_at > NOW() - INTERVAL '12 hours'
    UNION ALL
    SELECT e.full_name, 'out'::TEXT, s.check_out_at
      FROM public.attendance_sessions s JOIN public.employees e ON e.id = s.employee_id
     WHERE s.kiosk_out_id = p_kiosk_id AND s.check_out_at > NOW() - INTERVAL '12 hours'
  ) x
  ORDER BY x.f_at DESC
  LIMIT 8;
END;
$$;
GRANT EXECUTE ON FUNCTION public.kiosk_recent(UUID, TEXT) TO anon, authenticated;


-- Xodim QR ni skanerlaydi: ochiq ish bo'lmasa — KELDI, bo'lsa — KETDI
CREATE OR REPLACE FUNCTION public.qr_check_in_out(p_token TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_kiosk   UUID;
  v_emp     public.employees%ROWTYPE;
  v_sess    public.attendance_sessions%ROWTYPE;
  v_rate    NUMERIC;
  v_secs    INTEGER;
  v_breaks  INTEGER;
  v_earned  NUMERIC;
BEGIN
  -- 1. QR haqiqiy va eskirmaganmi?
  SELECT t.kiosk_id INTO v_kiosk
    FROM public.qr_tokens t
   WHERE t.token = p_token AND t.expires_at > NOW();
  IF v_kiosk IS NULL THEN
    RAISE EXCEPTION 'QR_EXPIRED';
  END IF;

  -- 2. Kim skanerladi?
  SELECT * INTO v_emp FROM public.employees WHERE user_id = auth.uid() LIMIT 1;
  IF v_emp.id IS NULL THEN
    RAISE EXCEPTION 'NOT_EMPLOYEE';
  END IF;
  IF v_emp.status NOT IN ('active', 'trial') THEN
    RAISE EXCEPTION 'EMPLOYEE_INACTIVE';
  END IF;

  -- 3. Ikki marta tez-tez bosilishidan himoya (1 daqiqa)
  IF EXISTS (
    SELECT 1 FROM public.attendance_sessions s
     WHERE s.employee_id = v_emp.id
       AND GREATEST(s.check_in_at, COALESCE(s.check_out_at, s.check_in_at)) > NOW() - INTERVAL '1 minute'
  ) THEN
    RAISE EXCEPTION 'TOO_SOON';
  END IF;

  -- 4. Ochiq ish bormi?
  SELECT * INTO v_sess
    FROM public.attendance_sessions s
   WHERE s.employee_id = v_emp.id AND s.status = 'open'
   ORDER BY s.check_in_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_sess.id IS NULL THEN
    -- KELDI
    SELECT r.hourly_rate INTO v_rate
      FROM public.salary_rates r
     WHERE r.employee_id = v_emp.id AND r.effective_to IS NULL
     ORDER BY r.effective_from DESC
     LIMIT 1;

    INSERT INTO public.attendance_sessions
      (employee_id, check_in_at, status, hourly_rate_snapshot, kiosk_in_id)
    VALUES
      (v_emp.id, NOW(), 'open', COALESCE(v_rate, 0), v_kiosk)
    RETURNING * INTO v_sess;

    RETURN json_build_object(
      'action', 'in',
      'session_id', v_sess.id,
      'at', v_sess.check_in_at,
      'full_name', v_emp.full_name
    );
  END IF;

  -- KETDI: ishlagan vaqt (tanaffuslarsiz) va topgan puli
  v_secs := FLOOR(EXTRACT(EPOCH FROM (NOW() - v_sess.check_in_at)));
  SELECT COALESCE(SUM(FLOOR(EXTRACT(EPOCH FROM (b.ended_at - b.started_at)))), 0)
    INTO v_breaks
    FROM public.breaks b
   WHERE b.session_id = v_sess.id AND b.ended_at IS NOT NULL;
  v_secs   := GREATEST(0, v_secs - v_breaks);
  v_earned := ROUND(v_secs / 3600.0 * COALESCE(v_sess.hourly_rate_snapshot, 0));

  UPDATE public.attendance_sessions
     SET check_out_at   = NOW(),
         worked_seconds = v_secs,
         earned_amount  = v_earned,
         status         = 'closed',
         kiosk_out_id   = v_kiosk,
         updated_at     = NOW()
   WHERE id = v_sess.id;

  RETURN json_build_object(
    'action', 'out',
    'session_id', v_sess.id,
    'check_in_at', v_sess.check_in_at,
    'at', NOW(),
    'worked_seconds', v_secs,
    'earned_amount', v_earned,
    'full_name', v_emp.full_name
  );
END;
$$;
REVOKE ALL ON FUNCTION public.qr_check_in_out(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qr_check_in_out(TEXT) TO authenticated;
