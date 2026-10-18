-- ============================================================
-- 019 — MENEJER AVANS BERISHI
-- ------------------------------------------------------------
-- Yangi ruxsat: give_advance — "Avans berish".
-- Menejer avans bersa: kim bergani yoziladi (given_by) va adminga
-- bildirishnoma boradi. Avans oylik hisobida avvalgidek ayiriladi.
--
-- 018 dan KEYIN ishga tushiring. Supabase → SQL Editor → "Run".
-- ============================================================

ALTER TABLE public.manager_permissions
  ADD COLUMN IF NOT EXISTS give_advance BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.manager_can(p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT public.is_manager() AND COALESCE((
    SELECT CASE p_perm
             WHEN 'add_employees'   THEN mp.add_employees
             WHEN 'pay_salary'      THEN mp.pay_salary
             WHEN 'give_advance'    THEN mp.give_advance
             WHEN 'view_salary'     THEN mp.view_salary
             WHEN 'view_attendance' THEN mp.view_attendance
             ELSE FALSE
           END
      FROM public.manager_permissions mp WHERE mp.user_id = auth.uid()
  ), FALSE);
$$;

-- Avans berish ruxsati bo'lsa ham pul ma'lumotlarini ko'ra olsin
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['advances', 'payroll_periods', 'payroll_items', 'payroll_adjustments', 'payments'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_manager_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.manager_can(''view_salary'') OR public.manager_can(''pay_salary'') OR public.manager_can(''give_advance''))', t || '_manager_select', t);
  END LOOP;
END $$;

-- Ruxsatlar ro'yxati va saqlash — give_advance bilan
DROP FUNCTION IF EXISTS public.admin_list_managers();
CREATE OR REPLACE FUNCTION public.admin_list_managers()
RETURNS TABLE (id UUID, email TEXT, full_name TEXT, created_at TIMESTAMPTZ, last_sign_in_at TIMESTAMPTZ, permissions JSONB)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.caller_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  RETURN QUERY
    SELECT p.id, u.email::TEXT, p.full_name, u.created_at, u.last_sign_in_at,
           jsonb_build_object(
             'add_employees',   COALESCE(mp.add_employees, TRUE),
             'pay_salary',      COALESCE(mp.pay_salary, FALSE),
             'give_advance',    COALESCE(mp.give_advance, FALSE),
             'view_salary',     COALESCE(mp.view_salary, TRUE),
             'view_attendance', COALESCE(mp.view_attendance, TRUE)
           )
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.id
      LEFT JOIN public.manager_permissions mp ON mp.user_id = p.id
     WHERE p.role = 'manager'
       AND (u.banned_until IS NULL OR u.banned_until < NOW())
     ORDER BY u.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_managers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_managers() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_manager_permissions(p_user_id UUID, p_permissions JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.caller_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.role = 'manager') THEN
    RAISE EXCEPTION 'NOT_MANAGER';
  END IF;
  INSERT INTO public.manager_permissions (user_id, add_employees, pay_salary, give_advance, view_salary, view_attendance, updated_at)
  VALUES (
    p_user_id,
    COALESCE((p_permissions->>'add_employees')::BOOLEAN, TRUE),
    COALESCE((p_permissions->>'pay_salary')::BOOLEAN, FALSE),
    COALESCE((p_permissions->>'give_advance')::BOOLEAN, FALSE),
    COALESCE((p_permissions->>'view_salary')::BOOLEAN, TRUE),
    COALESCE((p_permissions->>'view_attendance')::BOOLEAN, TRUE),
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    add_employees   = EXCLUDED.add_employees,
    pay_salary      = EXCLUDED.pay_salary,
    give_advance    = EXCLUDED.give_advance,
    view_salary     = EXCLUDED.view_salary,
    view_attendance = EXCLUDED.view_attendance,
    updated_at      = NOW();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_manager_permissions(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_manager_permissions(UUID, JSONB) TO authenticated;

-- Menejer yaratish (give_advance bilan): avval yaratadi, keyin barcha ruxsatlarni saqlaydi
CREATE OR REPLACE FUNCTION public.admin_create_manager_v2(p_email TEXT, p_password TEXT, p_full_name TEXT, p_permissions JSONB DEFAULT '{}'::jsonb)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  v_id := public.admin_create_manager(p_email, p_password, p_full_name, p_permissions);
  PERFORM public.admin_set_manager_permissions(v_id, p_permissions);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_create_manager_v2(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_manager_v2(TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- ─── Menejer avans beradi ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.manager_give_advance(
  p_employee_id UUID, p_amount NUMERIC, p_method TEXT DEFAULT 'cash', p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id  UUID;
  v_emp TEXT;
  v_by  TEXT;
BEGIN
  IF NOT (public.caller_is_admin() OR public.manager_can('give_advance')) THEN
    RAISE EXCEPTION 'NO_PERMISSION';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'BAD_AMOUNT';
  END IF;
  IF p_method NOT IN ('cash', 'card', 'transfer') THEN
    p_method := 'cash';
  END IF;
  SELECT e.full_name INTO v_emp FROM public.employees e
   WHERE e.id = p_employee_id AND e.status IN ('active', 'trial');
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
  END IF;

  INSERT INTO public.advances (employee_id, amount, payment_type, notes, status, given_by, created_at)
  VALUES (p_employee_id, ROUND(p_amount), p_method, NULLIF(trim(p_notes), ''), 'active', auth.uid(), NOW())
  RETURNING id INTO v_id;

  SELECT COALESCE(NULLIF(pr.full_name, ''), pr.email) INTO v_by FROM public.profiles pr WHERE pr.id = auth.uid();
  INSERT INTO public.notifications (employee_id, target_role, type, title, message, data)
  VALUES (
    p_employee_id, 'admin', 'manager_advance',
    'Menejer avans berdi',
    format('%s → %s: %s so''m avans', COALESCE(v_by, 'Menejer'), v_emp, to_char(ROUND(p_amount), 'FM999G999G999')),
    jsonb_build_object('amount', ROUND(p_amount), 'by', auth.uid(), 'by_name', v_by, 'method', p_method, 'advance_id', v_id)
  );
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.manager_give_advance(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_give_advance(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

-- "Kim berdi" ismlari — avans beruvchi menejer ham ko'ra olsin
CREATE OR REPLACE FUNCTION public.payment_recorders(p_ids UUID[])
RETURNS TABLE (id UUID, full_name TEXT, role TEXT)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT p.id, COALESCE(NULLIF(p.full_name, ''), p.email), p.role
    FROM public.profiles p
   WHERE p.id = ANY(p_ids)
     AND (public.caller_is_admin() OR public.manager_can('view_salary')
          OR public.manager_can('pay_salary') OR public.manager_can('give_advance'));
$$;
