-- ============================================================
-- 015 — MENEJER ROLI (Menejer paneli uchun)
-- ------------------------------------------------------------
-- Menejer:
--   ✓ xodimlar, davomat, oylik ma'lumotlarini KO'RADI
--   ✓ yangi xodim QO'SHADI (xodim, stavka, ish jadvali, sinov muddati)
--   ✗ pul bera olmaydi, davomatni tuzata olmaydi, xodimni o'chira/o'zgartira olmaydi
--
-- Menejer hisobini yaratish (pastda, 3-bo'limda) — Supabase → Authentication → Users → "Add user",
-- keyin shu fayl oxiridagi UPDATE bilan rolini 'manager' qiling.
--
-- 013 dan KEYIN ishga tushiring.
-- ============================================================

-- ─── 1. 'manager' rolini ruxsat etish ─────────────────────────────────────
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.profiles'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'employee', 'manager'));

CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'manager');
$$;

-- ─── 2. Menejer ruxsatlari ────────────────────────────────────────────────
-- Ko'rish (SELECT)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employees', 'attendance_sessions', 'salary_rates', 'work_schedules', 'employment_trials',
    'advances', 'payroll_periods', 'payroll_items', 'payroll_adjustments', 'payments', 'branches'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_manager_select', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.is_manager())', t || '_manager_select', t);
    END IF;
  END LOOP;
END $$;

-- Qo'shish (INSERT) — faqat yangi xodim yaratish uchun kerakli jadvallar
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees', 'salary_rates', 'work_schedules', 'employment_trials'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_manager_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.is_manager())', t || '_manager_insert', t);
  END LOOP;
END $$;

-- Menejer qo'shgan xodim parolining shifrlangan nusxasi ham saqlansin (admin keyin ko'ra oladi)
CREATE OR REPLACE FUNCTION public.admin_store_password(p_user_id UUID, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NOT (public.caller_is_admin() OR public.is_manager()) THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.role = 'employee') THEN
    RAISE EXCEPTION 'NOT_EMPLOYEE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = p_user_id AND u.encrypted_password = crypt(p_password, u.encrypted_password)
  ) THEN
    RAISE EXCEPTION 'PASSWORD_MISMATCH';
  END IF;
  PERFORM public._store_password(p_user_id, p_password);
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_store_password(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_store_password(UUID, TEXT) TO authenticated;

-- ─── 3. Menejer hisobini yaratish ─────────────────────────────────────────
-- 1) Supabase → Authentication → Users → "Add user" → email va parol kiriting
--    ("Auto Confirm User" belgilangan bo'lsin)
-- 2) Quyidagi qatordagi emailni o'zgartirib, "--" ni olib tashlang va ishga tushiring:
-- UPDATE public.profiles SET role = 'manager', full_name = 'Menejer' WHERE email = 'menejer@fritto.uz';
