-- ============================================================
-- 011 — DAVOMAT RASMLARINI 40 KUNDAN KEYIN O'CHIRISH
-- ------------------------------------------------------------
-- Har bir selfi olingan kunidan boshlab 40 kun (1 oy 10 kun) saqlanadi,
-- keyin o'chiriladi. Har rasm o'z muddati bo'yicha — bittadan.
--
-- Fayllar Storage orqali o'chirilishi shart (SQL bilan o'chirilsa,
-- fayl omborda "yetim" bo'lib qoladi). Shuning uchun:
--   1) admin_expired_photos() — muddati o'tgan rasmlar ro'yxati
--   2) admin panel ularni Storage API orqali o'chiradi
--   3) admin_mark_photos_deleted() — davomatdagi havolani tozalaydi
-- Admin panel buni kuniga bir marta avtomatik bajaradi.
--
-- 010_attendance_selfie.sql dan KEYIN ishga tushiring.
-- ============================================================

-- Muddati o'tgan (40 kundan eski) rasmlar — eng eskisidan boshlab
CREATE OR REPLACE FUNCTION public.admin_expired_photos(p_limit INTEGER DEFAULT 200)
RETURNS TABLE (photo_path TEXT)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;

  RETURN QUERY
  SELECT o.name::TEXT
    FROM storage.objects o
   WHERE o.bucket_id = 'attendance-photos'
     AND o.created_at < NOW() - INTERVAL '40 days'
   ORDER BY o.created_at
   LIMIT LEAST(GREATEST(p_limit, 1), 1000);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_expired_photos(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_expired_photos(INTEGER) TO authenticated;


-- O'chirilgan rasmlar havolasini davomatdan olib tashlash
CREATE OR REPLACE FUNCTION public.admin_mark_photos_deleted(p_paths TEXT[])
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_n     INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;

  UPDATE public.attendance_sessions SET in_photo_path = NULL WHERE in_photo_path = ANY(p_paths);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;
  UPDATE public.attendance_sessions SET out_photo_path = NULL WHERE out_photo_path = ANY(p_paths);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_mark_photos_deleted(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_photos_deleted(TEXT[]) TO authenticated;
