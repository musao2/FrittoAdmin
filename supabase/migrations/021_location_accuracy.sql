-- ============================================================
-- 021 — "FILIALDAN UZOQDASIZ" XATOSINI KAMAYTIRISH
-- ------------------------------------------------------------
-- Bino ichida telefon GPS'i 20–50 metr adashadi. Endi masofa tekshirilganda
-- telefon bergan aniqlik (±metr) ham hisobga olinadi (ko'pi bilan 50 m).
--
-- Masalan: radius 50 m, telefon 85 m dedi, aniqlik ±40 m → 85 − 40 = 45 ≤ 50 → qabul.
--
-- MUHIM: filial joylashuvi noto'g'ri saqlangan bo'lsa (kompyuterdan olingan),
-- admin panel → Filiallar → filialni oching → filial ICHIDA turib TELEFONDAN
-- «Hozirgi joylashuvimni olish»ni bosing va saqlang.
--
-- Supabase → SQL Editor → nusxalab "Run".
-- ============================================================

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
  -- GPS xatoligini hisobga olamiz: telefon "±30 m aniqlik" desa, haqiqiy joy
  -- 30 metrgacha yaqinroq bo'lishi mumkin. Ko'pi bilan 50 m kechiriladi.
  IF v_dist - LEAST(COALESCE(p_accuracy, 0), 50) > v_branch.radius_m THEN
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
