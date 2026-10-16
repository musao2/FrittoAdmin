-- ============================================================
-- 010 — DAVOMATDA SELFI (YUZ RASMI) MAJBURIY
-- ------------------------------------------------------------
-- Xodim QR ni skanerlagach, telefonning old kamerasi ochiladi.
-- Ilova kadrda INSON YUZI borligini tekshiradi (buyum bo'lsa — olmaydi),
-- rasm "attendance-photos" yopiq omboriga yuklanadi va davomatga bog'lanadi.
-- Server rasmsiz (yoki eski / boshqaning rasmi bilan) davomatni QABUL QILMAYDI.
--
-- 005, 007 dan KEYIN ishga tushiring.
-- Supabase → SQL Editor ga to'liq nusxalab, "Run" bosing.
-- ============================================================

-- ─── 1. Rasm ombori (yopiq, faqat JPEG, 2 MB gacha) ──────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('attendance-photos', 'attendance-photos', FALSE, 2097152, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
  SET public = FALSE, file_size_limit = 2097152, allowed_mime_types = ARRAY['image/jpeg'];

-- Xodim faqat O'Z papkasiga (user_id/...) rasm yuklaydi
DROP POLICY IF EXISTS "attendance_photos_own_insert" ON storage.objects;
CREATE POLICY "attendance_photos_own_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attendance-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Xodim o'z rasmlarini, admin esa hammasini ko'radi
DROP POLICY IF EXISTS "attendance_photos_read" ON storage.objects;
CREATE POLICY "attendance_photos_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attendance-photos' AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
    )
  );

-- Faqat admin o'chira oladi
DROP POLICY IF EXISTS "attendance_photos_admin_delete" ON storage.objects;
CREATE POLICY "attendance_photos_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'attendance-photos'
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ─── 2. Davomatga kelish / ketish rasmlari ────────────────────────────────
ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS in_photo_path  TEXT,
  ADD COLUMN IF NOT EXISTS out_photo_path TEXT;

-- ─── 3. Eski (rasmsiz) funksiyalar o'rniga — rasm talab qiladiganlari ────
DROP FUNCTION IF EXISTS public.qr_check_in_out(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.branch_check_in_out(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION);

-- Xodim QR ni skanerlaydi: ochiq ish bo'lmasa — KELDI, bo'lsa — KETDI
CREATE OR REPLACE FUNCTION public.qr_check_in_out(p_token TEXT, p_device_id TEXT, p_photo_path TEXT)
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

  -- Rasm (selfi) majburiy: xodimning o'z papkasida, so'nggi 10 daqiqada yuklangan bo'lishi kerak
  IF p_photo_path IS NULL
     OR split_part(p_photo_path, '/', 1) <> auth.uid()::text
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'attendance-photos'
          AND o.name = p_photo_path
          AND o.created_at > NOW() - INTERVAL '10 minutes'
     ) THEN
    RAISE EXCEPTION 'PHOTO_REQUIRED';
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
      (employee_id, check_in_at, status, hourly_rate_snapshot, kiosk_in_id, in_photo_path)
    VALUES
      (v_emp.id, NOW(), 'open', COALESCE(v_rate, 0), v_kiosk, p_photo_path)
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
         out_photo_path = p_photo_path,
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
REVOKE ALL ON FUNCTION public.qr_check_in_out(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qr_check_in_out(TEXT, TEXT, TEXT) TO authenticated;


-- ─── 4. Xodim qog'ozdagi QR ni skanerlaydi ────────────────────────────────
-- Ochiq ish bo'lmasa — KELDI, bo'lsa — KETDI.
-- Xatolar: PHOTO_REQUIRED, QR_INVALID, NOT_EMPLOYEE, EMPLOYEE_INACTIVE, DEVICE_NOT_APPROVED,
--          LOCATION_REQUIRED, LOW_ACCURACY:<metr>, TOO_FAR:<metr>:<radius>, TOO_SOON
CREATE OR REPLACE FUNCTION public.branch_check_in_out(
  p_code TEXT, p_device_id TEXT,
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_accuracy DOUBLE PRECISION,
  p_photo_path TEXT
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

  -- Rasm (selfi) majburiy: xodimning o'z papkasida, so'nggi 10 daqiqada yuklangan bo'lishi kerak
  IF p_photo_path IS NULL
     OR split_part(p_photo_path, '/', 1) <> auth.uid()::text
     OR NOT EXISTS (
       SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = 'attendance-photos'
          AND o.name = p_photo_path
          AND o.created_at > NOW() - INTERVAL '10 minutes'
     ) THEN
    RAISE EXCEPTION 'PHOTO_REQUIRED';
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
      (employee_id, check_in_at, status, hourly_rate_snapshot, branch_in_id, in_distance_m, in_location, in_photo_path)
    VALUES
      (v_emp.id, NOW(), 'open', COALESCE(v_rate, 0), v_branch.id, v_dist, v_loc, p_photo_path)
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
         out_photo_path = p_photo_path,
         updated_at     = NOW()
   WHERE id = v_sess.id;

  RETURN json_build_object(
    'action', 'out', 'session_id', v_sess.id, 'check_in_at', v_sess.check_in_at, 'at', NOW(),
    'worked_seconds', v_secs, 'earned_amount', v_earned,
    'full_name', v_emp.full_name, 'branch', v_branch.name, 'distance_m', v_dist
  );
END;
$$;
REVOKE ALL ON FUNCTION public.branch_check_in_out(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.branch_check_in_out(TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) TO authenticated;


-- ─── 4. Ekrandagi (kiosk) QR: selfi uchun vaqt yetsin ─────────────────────
-- Kiosk yangi QR token oladi (har 15 soniyada). Selfi olishga vaqt yetishi uchun token 2 daqiqa amal qiladi.
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
  v_until := NOW() + INTERVAL '2 minutes';

  INSERT INTO public.qr_tokens (token, kiosk_id, expires_at)
  VALUES (v_token, p_kiosk_id, v_until);

  RETURN QUERY SELECT v_token::TEXT, v_until::TIMESTAMPTZ;
END;
$$;
GRANT EXECUTE ON FUNCTION public.kiosk_issue_token(UUID, TEXT) TO anon, authenticated;
