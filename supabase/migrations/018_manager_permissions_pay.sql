-- ============================================================
-- 018 — MENEJER RUXSATLARI VA MENEJER OYLIK BERISHI
-- ------------------------------------------------------------
-- Admin har bir menejer uchun nima qila olishini tanlaydi:
--   add_employees   — yangi xodim qo'shish
--   pay_salary      — oylik berish (pul berish)
--   view_salary     — oylik sahifasini ko'rish
--   view_attendance — davomatni ko'rish
--
-- Menejer oylik bersa:
--   • summa serverda hisoblanadi (oylikdan ko'p berib bo'lmaydi)
--   • to'lovda kim bergani yoziladi (recorded_by)
--   • adminga bildirishnoma boradi
--
-- 015, 016, 017 dan KEYIN ishga tushiring. Supabase → SQL Editor → "Run".
-- ============================================================

-- ─── 1. Ruxsatlar jadvali ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.manager_permissions (
  user_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  add_employees    BOOLEAN NOT NULL DEFAULT TRUE,
  pay_salary       BOOLEAN NOT NULL DEFAULT FALSE,
  view_salary      BOOLEAN NOT NULL DEFAULT TRUE,
  view_attendance  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.manager_permissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.manager_permissions FROM anon;

DROP POLICY IF EXISTS manager_permissions_select ON public.manager_permissions;
CREATE POLICY manager_permissions_select ON public.manager_permissions
  FOR SELECT USING (user_id = auth.uid() OR public.caller_is_admin());

-- Mavjud menejerlarga standart ruxsatlar
INSERT INTO public.manager_permissions (user_id)
SELECT p.id FROM public.profiles p WHERE p.role = 'manager'
ON CONFLICT (user_id) DO NOTHING;

-- Menejerda shu ruxsat bormi?
CREATE OR REPLACE FUNCTION public.manager_can(p_perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT public.is_manager() AND COALESCE((
    SELECT CASE p_perm
             WHEN 'add_employees'   THEN mp.add_employees
             WHEN 'pay_salary'      THEN mp.pay_salary
             WHEN 'view_salary'     THEN mp.view_salary
             WHEN 'view_attendance' THEN mp.view_attendance
             ELSE FALSE
           END
      FROM public.manager_permissions mp WHERE mp.user_id = auth.uid()
  ), FALSE);
$$;

-- ─── 2. Xodim qo'shish faqat ruxsat bo'lsa ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees', 'salary_rates', 'work_schedules', 'employment_trials'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_manager_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.manager_can(''add_employees''))', t || '_manager_insert', t);
  END LOOP;
END $$;

-- Pul ma'lumotlari faqat oylikni ko'rish yoki berish ruxsati bo'lsa
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['advances', 'payroll_periods', 'payroll_items', 'payroll_adjustments', 'payments'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_manager_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (public.manager_can(''view_salary'') OR public.manager_can(''pay_salary''))', t || '_manager_select', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.admin_store_password(p_user_id UUID, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NOT (public.caller_is_admin() OR public.manager_can('add_employees')) THEN
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

-- ─── 3. Admin: menejer yaratish (ruxsatlar bilan) ─────────────────────────
DROP FUNCTION IF EXISTS public.admin_create_manager(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.admin_create_manager(p_email TEXT, p_password TEXT, p_full_name TEXT, p_permissions JSONB DEFAULT '{}'::jsonb)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_email TEXT := lower(trim(p_email));
  v_name  TEXT := NULLIF(trim(p_full_name), '');
  v_id    UUID := gen_random_uuid();
BEGIN
  IF NOT public.caller_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'BAD_EMAIL';
  END IF;
  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'PASSWORD_TOO_SHORT';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'EMAIL_TAKEN';
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change_token_current, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    v_email, crypt(p_password, gen_salt('bf')), NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', COALESCE(v_name, 'Menejer')),
    NOW(), NOW(), '', '', '', '', ''
  );

  INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (
    gen_random_uuid(), v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', NOW(), NOW(), NOW()
  );

  INSERT INTO public.profiles (id, email, role, full_name)
  VALUES (v_id, v_email, 'manager', COALESCE(v_name, 'Menejer'))
  ON CONFLICT (id) DO UPDATE SET role = 'manager', full_name = EXCLUDED.full_name;

  INSERT INTO public.manager_permissions (user_id, add_employees, pay_salary, view_salary, view_attendance)
  VALUES (
    v_id,
    COALESCE((p_permissions->>'add_employees')::BOOLEAN, TRUE),
    COALESCE((p_permissions->>'pay_salary')::BOOLEAN, FALSE),
    COALESCE((p_permissions->>'view_salary')::BOOLEAN, TRUE),
    COALESCE((p_permissions->>'view_attendance')::BOOLEAN, TRUE)
  );

  PERFORM public._store_password(v_id, p_password);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_create_manager(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_manager(TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- ─── 4. Admin: ro'yxat ruxsatlar bilan ────────────────────────────────────
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

-- ─── 5. Admin: ruxsatlarni o'zgartirish ───────────────────────────────────
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
  INSERT INTO public.manager_permissions (user_id, add_employees, pay_salary, view_salary, view_attendance, updated_at)
  VALUES (
    p_user_id,
    COALESCE((p_permissions->>'add_employees')::BOOLEAN, TRUE),
    COALESCE((p_permissions->>'pay_salary')::BOOLEAN, FALSE),
    COALESCE((p_permissions->>'view_salary')::BOOLEAN, TRUE),
    COALESCE((p_permissions->>'view_attendance')::BOOLEAN, TRUE),
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    add_employees   = EXCLUDED.add_employees,
    pay_salary      = EXCLUDED.pay_salary,
    view_salary     = EXCLUDED.view_salary,
    view_attendance = EXCLUDED.view_attendance,
    updated_at      = NOW();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_manager_permissions(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_manager_permissions(UUID, JSONB) TO authenticated;

-- ─── 6. Menejer oylik beradi ──────────────────────────────────────────────
-- Hisob admin paneldagi bilan bir xil: ishlab topgani (yoki belgilangan oylik)
-- + bonus − jarima − avans. Oylikdan ko'p berib bo'lmaydi.
CREATE OR REPLACE FUNCTION public.manager_pay_salary(
  p_employee_id UUID, p_year INT, p_month INT, p_amount NUMERIC, p_method TEXT DEFAULT 'cash', p_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start   TIMESTAMPTZ;
  v_end     TIMESTAMPTZ;
  v_period  UUID;
  v_item    UUID;
  v_secs    BIGINT;
  v_days    INT;
  v_earned  NUMERIC;
  v_rate    RECORD;
  v_adv     NUMERIC;
  v_bonus   NUMERIC;
  v_ded     NUMERIC;
  v_net     NUMERIC;
  v_paid    NUMERIC;
  v_left    NUMERIC;
  v_emp     TEXT;
  v_by      TEXT;
BEGIN
  IF NOT (public.caller_is_admin() OR public.manager_can('pay_salary')) THEN
    RAISE EXCEPTION 'NO_PERMISSION';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'BAD_AMOUNT';
  END IF;
  IF p_method NOT IN ('cash', 'card', 'transfer') THEN
    p_method := 'cash';
  END IF;
  SELECT e.full_name INTO v_emp FROM public.employees e WHERE e.id = p_employee_id;
  IF v_emp IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND';
  END IF;

  -- Admin paneldagi kabi oy chegarasi
  v_start := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC');
  v_end   := make_timestamptz(p_year, p_month, EXTRACT(DAY FROM (make_date(p_year, p_month, 1) + INTERVAL '1 month - 1 day'))::INT, 23, 59, 59, 'UTC');

  INSERT INTO public.payroll_periods (year, month, period_start, period_end, status)
  VALUES (p_year, p_month, v_start::DATE, v_end::DATE, 'pending')
  ON CONFLICT (year, month) DO NOTHING;
  SELECT pp.id INTO v_period FROM public.payroll_periods pp WHERE pp.year = p_year AND pp.month = p_month;

  -- Ishlagani
  SELECT COALESCE(SUM(s.worked_seconds), 0), COALESCE(SUM(s.earned_amount), 0),
         COUNT(DISTINCT (s.check_in_at AT TIME ZONE 'Asia/Tashkent')::DATE)
    INTO v_secs, v_earned, v_days
    FROM public.attendance_sessions s
   WHERE s.employee_id = p_employee_id
     AND s.status IN ('closed', 'corrected')
     AND s.check_in_at BETWEEN v_start AND v_end;

  -- Belgilangan oylik bo'lsa — soat emas, oylik summasi
  SELECT r.salary_type, r.monthly_salary INTO v_rate
    FROM public.salary_rates r
   WHERE r.employee_id = p_employee_id
     AND r.effective_from <= v_end::DATE
     AND (r.effective_to IS NULL OR r.effective_to > v_start::DATE)
   ORDER BY r.effective_from DESC
   LIMIT 1;
  IF FOUND AND v_rate.salary_type = 'monthly' THEN
    v_earned := COALESCE(v_rate.monthly_salary, 0);
  END IF;

  SELECT COALESCE(SUM(a.amount), 0) INTO v_adv
    FROM public.advances a
   WHERE a.employee_id = p_employee_id AND a.status = 'active'
     AND a.created_at BETWEEN v_start AND v_end;

  SELECT COALESCE(SUM(CASE WHEN j.type = 'bonus' THEN j.amount ELSE 0 END), 0),
         COALESCE(SUM(CASE WHEN j.type = 'deduction' THEN j.amount ELSE 0 END), 0)
    INTO v_bonus, v_ded
    FROM public.payroll_adjustments j
   WHERE j.employee_id = p_employee_id AND j.period_id = v_period AND j.status = 'approved';

  v_net := GREATEST(0, ROUND(v_earned + v_bonus - v_ded - v_adv));

  INSERT INTO public.payroll_items (
    employee_id, period_id, total_worked_seconds, worked_days, total_earned,
    total_advances, total_bonuses, total_deductions, net_payable, calculated_at, updated_at
  ) VALUES (
    p_employee_id, v_period, v_secs, v_days, ROUND(v_earned),
    ROUND(v_adv), ROUND(v_bonus), ROUND(v_ded), v_net, NOW(), NOW()
  )
  ON CONFLICT (employee_id, period_id) DO UPDATE SET
    total_worked_seconds = EXCLUDED.total_worked_seconds,
    worked_days          = EXCLUDED.worked_days,
    total_earned         = EXCLUDED.total_earned,
    total_advances       = EXCLUDED.total_advances,
    total_bonuses        = EXCLUDED.total_bonuses,
    total_deductions     = EXCLUDED.total_deductions,
    net_payable          = EXCLUDED.net_payable,
    calculated_at        = NOW(),
    updated_at           = NOW()
  RETURNING id INTO v_item;

  PERFORM 1 FROM public.payroll_items WHERE id = v_item FOR UPDATE;
  SELECT COALESCE(SUM(p.amount), 0) INTO v_paid FROM public.payments p WHERE p.payroll_item_id = v_item;
  v_left := GREATEST(0, v_net - v_paid);
  IF p_amount > v_left THEN
    RAISE EXCEPTION 'OVERPAY:%', ROUND(v_left);
  END IF;

  INSERT INTO public.payments (employee_id, payroll_item_id, amount, payment_method, payment_date, notes, recorded_by)
  VALUES (p_employee_id, v_item, p_amount, p_method, NOW(), NULLIF(trim(p_notes), ''), auth.uid());

  v_paid := v_paid + p_amount;
  UPDATE public.payroll_items
     SET status  = CASE WHEN v_paid >= v_net AND v_net > 0 THEN 'paid' ELSE 'partial' END,
         paid_at = NOW(), paid_by = auth.uid(), updated_at = NOW()
   WHERE id = v_item;

  -- Adminga xabar
  SELECT COALESCE(NULLIF(pr.full_name, ''), pr.email) INTO v_by FROM public.profiles pr WHERE pr.id = auth.uid();
  INSERT INTO public.notifications (employee_id, target_role, type, title, message, data)
  VALUES (
    p_employee_id, 'admin', 'manager_payment',
    'Menejer oylik berdi',
    format('%s → %s: %s so''m (%s/%s)', COALESCE(v_by, 'Menejer'), v_emp, to_char(p_amount, 'FM999G999G999'), p_month, p_year),
    jsonb_build_object('amount', p_amount, 'by', auth.uid(), 'by_name', v_by, 'year', p_year, 'month', p_month, 'method', p_method)
  );

  RETURN json_build_object('paid', p_amount, 'remaining', GREATEST(0, v_net - v_paid), 'net', v_net);
END;
$$;
REVOKE ALL ON FUNCTION public.manager_pay_salary(UUID, INT, INT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manager_pay_salary(UUID, INT, INT, NUMERIC, TEXT, TEXT) TO authenticated;

-- ─── 7. Admin: to'lovni kim berganini ko'rish uchun ismlar ───────────────
-- (admin profiles jadvalini allaqachon ko'ra oladi; menejer ham to'lovlar ro'yxatida ismni ko'rsin)
CREATE OR REPLACE FUNCTION public.payment_recorders(p_ids UUID[])
RETURNS TABLE (id UUID, full_name TEXT, role TEXT)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT p.id, COALESCE(NULLIF(p.full_name, ''), p.email), p.role
    FROM public.profiles p
   WHERE p.id = ANY(p_ids)
     AND (public.caller_is_admin() OR public.manager_can('view_salary') OR public.manager_can('pay_salary'));
$$;
REVOKE ALL ON FUNCTION public.payment_recorders(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_recorders(UUID[]) TO authenticated;
