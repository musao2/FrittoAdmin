-- ============================================================
-- 009 — RAD ETILGAN QURILMA UCHUN QAYTA SO'ROV YUBORISH
-- ------------------------------------------------------------
-- Admin xodimning qurilmasini rad etsa, xodim ekranida
-- "Qayta so'rov yuborish" tugmasi chiqadi. Bosilsa so'rov yana
-- "kutilmoqda" holatiga o'tadi va adminga yangi bildirishnoma boradi.
-- Spamdan himoya: 2 daqiqada bir martadan ko'p emas.
--
-- 005_device_approval.sql dan KEYIN ishga tushiring.
-- ============================================================

ALTER TABLE public.employee_devices
  ADD COLUMN IF NOT EXISTS request_count INTEGER NOT NULL DEFAULT 1;

-- Qaytaradi: 'pending' (so'rov yuborildi) yoki 'approved' (allaqachon ruxsat bor)
-- Xatolar: NOT_AUTHENTICATED, DEVICE_NOT_FOUND, TOO_SOON:<soniya>
CREATE OR REPLACE FUNCTION public.device_request_again(p_device_id TEXT, p_label TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid  UUID := auth.uid();
  v_dev  public.employee_devices%ROWTYPE;
  v_emp  public.employees%ROWTYPE;
  v_wait INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED';
  END IF;

  SELECT * INTO v_dev FROM public.employee_devices d
   WHERE d.user_id = v_uid AND d.device_id = p_device_id
   FOR UPDATE;
  IF v_dev.id IS NULL THEN
    RAISE EXCEPTION 'DEVICE_NOT_FOUND';
  END IF;

  IF v_dev.status = 'approved' THEN
    RETURN 'approved';
  END IF;

  -- Oxirgi so'rovdan beri 2 daqiqa o'tmagan bo'lsa — kutish kerak
  v_wait := CEIL(EXTRACT(EPOCH FROM (v_dev.requested_at + INTERVAL '2 minutes' - NOW())));
  IF v_dev.status = 'pending' OR v_wait > 0 THEN
    IF v_dev.status = 'pending' THEN
      RETURN 'pending';
    END IF;
    RAISE EXCEPTION 'TOO_SOON:%', v_wait;
  END IF;

  UPDATE public.employee_devices
     SET status = 'pending',
         requested_at = NOW(),
         decided_at = NULL,
         decided_by = NULL,
         request_count = COALESCE(request_count, 1) + 1,
         device_label = COALESCE(left(p_label, 120), device_label),
         last_seen_at = NOW()
   WHERE id = v_dev.id;

  SELECT * INTO v_emp FROM public.employees e WHERE e.user_id = v_uid LIMIT 1;
  INSERT INTO public.notifications (employee_id, target_role, type, title, message, data)
  VALUES (
    v_emp.id, 'admin', 'device_request',
    'Qayta kirish so''rovi',
    COALESCE(v_emp.full_name, 'Xodim') || ' — ' || COALESCE(left(p_label, 120), v_dev.device_label, 'noma''lum qurilma')
      || ' (' || (COALESCE(v_dev.request_count, 1) + 1) || '-marta)',
    jsonb_build_object('device_row_id', v_dev.id)
  );

  RETURN 'pending';
END;
$$;
REVOKE ALL ON FUNCTION public.device_request_again(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.device_request_again(TEXT, TEXT) TO authenticated;
