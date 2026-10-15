-- ============================================================
-- 005 — YANGI QURILMADAN KIRISHNI ADMIN TASDIQLASHI
-- ------------------------------------------------------------
-- Xodim email va parol bilan kirganda, agar bu telefon/brauzer
-- hali tasdiqlanmagan bo'lsa — adminga so'rov boradi va xodim
-- admin tasdiqlamaguncha ichkariga kira olmaydi.
-- Boshqa telefondan kirsa — yana yangi so'rov.
--
-- QR orqali davomat ham faqat tasdiqlangan qurilmadan ishlaydi.
--
-- 002_qr_attendance.sql dan KEYIN ishga tushiring.
-- Supabase → SQL Editor ga to'liq nusxalab, "Run" bosing.
-- ============================================================

-- ─── 1. Xodim qurilmalari ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employee_devices (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  employee_id   UUID REFERENCES public.employees(id) ON DELETE CASCADE,
  device_id     TEXT NOT NULL,                 -- brauzerda saqlanadigan tasodifiy kod
  device_label  TEXT,                          -- "iPhone · Safari" kabi
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at  TIMESTAMPTZ DEFAULT NOW(),
  decided_at    TIMESTAMPTZ,
  decided_by    UUID REFERENCES auth.users(id),
  last_seen_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_employee_devices_status ON public.employee_devices(status);

ALTER TABLE public.employee_devices ENABLE ROW LEVEL SECURITY;

-- Admin hammasini ko'radi va tasdiqlaydi
DROP POLICY IF EXISTS "devices_admin_all" ON public.employee_devices;
CREATE POLICY "devices_admin_all" ON public.employee_devices
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- Xodim faqat o'z qurilmalarini ko'radi (o'zgartira olmaydi — faqat funksiya orqali)
DROP POLICY IF EXISTS "devices_own_select" ON public.employee_devices;
CREATE POLICY "devices_own_select" ON public.employee_devices
  FOR SELECT USING (user_id = auth.uid());


-- ─── 2. Kirishda qurilmani tekshirish ─────────────────────────────────────
-- Qaytaradi: 'approved' | 'pending' | 'rejected'
CREATE OR REPLACE FUNCTION public.device_check_in(p_device_id TEXT, p_label TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid    UUID := auth.uid();
  v_emp    public.employees%ROWTYPE;
  v_status TEXT;
  v_id     UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;
  IF p_device_id IS NULL OR length(p_device_id) < 16 THEN
    RAISE EXCEPTION 'BAD_DEVICE';
  END IF;

  -- Adminlar uchun tasdiq shart emas
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.role = 'admin') THEN
    RETURN 'approved';
  END IF;

  SELECT * INTO v_emp FROM public.employees e WHERE e.user_id = v_uid LIMIT 1;

  SELECT d.status INTO v_status
    FROM public.employee_devices d
   WHERE d.user_id = v_uid AND d.device_id = p_device_id;

  IF v_status IS NULL THEN
    -- Yangi qurilma: so'rov yaratamiz va adminga xabar beramiz
    INSERT INTO public.employee_devices (user_id, employee_id, device_id, device_label, status)
    VALUES (v_uid, v_emp.id, p_device_id, left(p_label, 120), 'pending')
    RETURNING id INTO v_id;

    INSERT INTO public.notifications (employee_id, target_role, type, title, message, data)
    VALUES (
      v_emp.id, 'admin', 'device_request',
      'Yangi qurilmadan kirish so''rovi',
      COALESCE(v_emp.full_name, 'Xodim') || ' — ' || COALESCE(left(p_label, 120), 'noma''lum qurilma'),
      jsonb_build_object('device_row_id', v_id)
    );
    RETURN 'pending';
  END IF;

  UPDATE public.employee_devices d
     SET last_seen_at = NOW(), device_label = COALESCE(left(p_label, 120), d.device_label)
   WHERE d.user_id = v_uid AND d.device_id = p_device_id;

  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION public.device_check_in(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.device_check_in(TEXT, TEXT) TO authenticated;


-- ─── 3. QR davomat endi qurilma tasdig'ini ham talab qiladi ───────────────
DROP FUNCTION IF EXISTS public.qr_check_in_out(TEXT);

-- Xodim QR ni skanerlaydi: ochiq ish bo'lmasa — KELDI, bo'lsa — KETDI
CREATE OR REPLACE FUNCTION public.qr_check_in_out(p_token TEXT, p_device_id TEXT)
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

  -- 2b. Qurilma admin tomonidan tasdiqlanganmi?
  IF NOT EXISTS (
    SELECT 1 FROM public.employee_devices d
     WHERE d.user_id = auth.uid() AND d.device_id = p_device_id AND d.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'DEVICE_NOT_APPROVED';
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
REVOKE ALL ON FUNCTION public.qr_check_in_out(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qr_check_in_out(TEXT, TEXT) TO authenticated;
