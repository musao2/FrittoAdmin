-- ============================================================
-- 007 — FILIALLAR, QOG'OZDAGI QR VA JOYLASHUV (GPS) TEKSHIRUVI
-- ------------------------------------------------------------
-- Admin filial yaratadi: nomi, manzili, joylashuvi (kenglik/uzunlik)
-- va ruxsat etilgan radius (metr). Har bir filialning o'z doimiy QR kodi
-- bor — uni qog'ozga chiqarib devorga yopishtiriladi.
--
-- Xodim QR ni skanerlaganda telefon joylashuvi yuboriladi va SERVER
-- filialgacha masofani hisoblaydi. Radiusdan tashqarida bo'lsa — rad.
-- Qurilma ham admin tomonidan tasdiqlangan bo'lishi shart (005).
--
-- 005_device_approval.sql dan KEYIN ishga tushiring.
-- Supabase → SQL Editor ga to'liq nusxalab, "Run" bosing.
-- ============================================================

-- ─── 1. Filiallar ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.branches (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT,
  latitude    DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude   DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  radius_m    INTEGER NOT NULL DEFAULT 50 CHECK (radius_m BETWEEN 10 AND 1000),
  -- Qog'ozdagi QR ichidagi kod. Yangilansa — eski chop etilgan QR ishlamay qoladi.
  qr_code     TEXT NOT NULL UNIQUE
              DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

-- Faqat admin ko'radi va boshqaradi (xodim QR kodini ko'ra olmaydi — faqat funksiya orqali)
DROP POLICY IF EXISTS "branches_admin_all" ON public.branches;
CREATE POLICY "branches_admin_all" ON public.branches
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ─── 2. Davomatga: qaysi filialda, qancha masofadan ──────────────────────
ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS branch_in_id    UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch_out_id   UUID REFERENCES public.branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS in_distance_m   INTEGER,
  ADD COLUMN IF NOT EXISTS out_distance_m  INTEGER,
  ADD COLUMN IF NOT EXISTS in_location     JSONB,   -- {lat, lng, accuracy}
  ADD COLUMN IF NOT EXISTS out_location    JSONB;


-- ─── 3. Ikki nuqta orasidagi masofa (metr) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.distance_m(lat1 DOUBLE PRECISION, lng1 DOUBLE PRECISION,
                                             lat2 DOUBLE PRECISION, lng2 DOUBLE PRECISION)
RETURNS DOUBLE PRECISION
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;


-- ─── 4. Xodim qog'ozdagi QR ni skanerlaydi ────────────────────────────────
-- Ochiq ish bo'lmasa — KELDI, bo'lsa — KETDI.
-- Xatolar: QR_INVALID, NOT_EMPLOYEE, EMPLOYEE_INACTIVE, DEVICE_NOT_APPROVED,
--          LOCATION_REQUIRED, LOW_ACCURACY:<metr>, TOO_FAR:<metr>:<radius>, TOO_SOON
CREATE OR REPLACE FUNCTION public.branch_check_in_out(
  p_code TEXT, p_device_id TEXT,
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_accuracy DOUBLE PRECISION
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_branch  public.branches%ROWTYPE;
  v_emp     public.employees%ROWTYPE;
  v_sess    public.attendance_sessions%ROWTYPE;
  v_dist    INTEGER;
  v_loc     JSONB;
  v_rate    NUMERIC;
  v_secs    INTEGER;
  v_breaks  INTEGER;
  v_earned  NUMERIC;
BEGIN
  -- 1. QR haqiqiymi?
  SELECT * INTO v_branch FROM public.branches b WHERE b.qr_code = p_code AND b.is_active;
  IF v_branch.id IS NULL THEN
    RAISE EXCEPTION 'QR_INVALID';
  END IF;

  -- 2. Kim skanerladi?
  SELECT * INTO v_emp FROM public.employees e WHERE e.user_id = auth.uid() LIMIT 1;
  IF v_emp.id IS NULL THEN
    RAISE EXCEPTION 'NOT_EMPLOYEE';
  END IF;
  IF v_emp.status NOT IN ('active', 'trial') THEN
    RAISE EXCEPTION 'EMPLOYEE_INACTIVE';
  END IF;

  -- 3. Qurilma tasdiqlanganmi?
  IF NOT EXISTS (
    SELECT 1 FROM public.employee_devices d
     WHERE d.user_id = auth.uid() AND d.device_id = p_device_id AND d.status = 'approved'
  ) THEN
    RAISE EXCEPTION 'DEVICE_NOT_APPROVED';
  END IF;

  -- 4. Joylashuv: filial radiusi ichidami?
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RAISE EXCEPTION 'LOCATION_REQUIRED';
  END IF;
  IF p_accuracy IS NOT NULL AND p_accuracy > 150 THEN
    RAISE EXCEPTION 'LOW_ACCURACY:%', ROUND(p_accuracy);
  END IF;
  v_dist := ROUND(public.distance_m(v_branch.latitude, v_branch.longitude, p_lat, p_lng));
  IF v_dist > v_branch.radius_m THEN
    RAISE EXCEPTION 'TOO_FAR:%:%', v_dist, v_branch.radius_m;
  END IF;
  v_loc := jsonb_build_object('lat', p_lat, 'lng', p_lng, 'accuracy', p_accuracy);

  -- 5. Ikki marta tez-tez bosilishidan himoya (1 daqiqa)
  IF EXISTS (
    SELECT 1 FROM public.attendance_sessions s
     WHERE s.employee_id = v_emp.id
       AND GREATEST(s.check_in_at, COALESCE(s.check_out_at, s.check_in_at)) > NOW() - INTERVAL '1 minute'
  ) THEN
    RAISE EXCEPTION 'TOO_SOON';
  END IF;

  -- 6. Ochiq ish bormi?
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
      (employee_id, check_in_at, status, hourly_rate_snapshot, branch_in_id, in_distance_m, in_location)
    VALUES
      (v_emp.id, NOW(), 'open', COALESCE(v_rate, 0), v_branch.id, v_dist, v_loc)
    RETURNING * INTO v_sess;

    RETURN json_build_object(
      'action', 'in', 'session_id', v_sess.id, 'at', v_sess.check_in_at,
      'full_name', v_emp.full_name, 'branch', v_branch.name, 'distance_m', v_dist
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
         branch_out_id  = v_branch.id,
         out_distance_m = v_dist,
         out_location   = v_loc,
         updated_at     = NOW()
   WHERE id = v_sess.id;

  RETURN json_build_object(
    'action', 'out', 'session_id', v_sess.id, 'check_in_at', v_sess.check_in_at, 'at', NOW(),
    'worked_seconds', v_secs, 'earned_amount', v_earned,
    'full_name', v_emp.full_name, 'branch', v_branch.name, 'distance_m', v_dist
  );
END;
$$;
REVOKE ALL ON FUNCTION public.branch_check_in_out(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.branch_check_in_out(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
