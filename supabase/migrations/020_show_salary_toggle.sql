-- ============================================================
-- 020 — XODIMGA OYLIGINI KO'RSATISH / YASHIRISH
-- ------------------------------------------------------------
-- employees.show_salary:
--   TRUE  — xodim ilovada oyligini, chekini ko'radi (standart)
--   FALSE — xodim faqat ishlagan vaqtini ko'radi, "admin hisoblab aytadi"
--
-- Faqat admin o'zgartiradi (menejer xodimni tahrirlay olmaydi).
-- Yashirilganda xodim stavka va oylik hisobini bazadan ham o'qiy olmaydi.
--
-- Supabase → SQL Editor → nusxalab "Run".
-- ============================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS show_salary BOOLEAN NOT NULL DEFAULT TRUE;

-- Xodimga oyligi ko'rsatiladimi?
CREATE OR REPLACE FUNCTION public.my_salary_visible()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE((SELECT e.show_salary FROM public.employees e WHERE e.id = public.get_employee_id()), TRUE);
$$;

-- Yashirilgan bo'lsa — stavka, oylik hisobi, bonus/jarima xodimga berilmaydi
DROP POLICY IF EXISTS "salary_own_select" ON public.salary_rates;
CREATE POLICY "salary_own_select" ON public.salary_rates
  FOR SELECT USING (employee_id = public.get_employee_id() AND public.my_salary_visible());

DROP POLICY IF EXISTS "items_own_select" ON public.payroll_items;
CREATE POLICY "items_own_select" ON public.payroll_items
  FOR SELECT USING (employee_id = public.get_employee_id() AND public.my_salary_visible());

DROP POLICY IF EXISTS "adjustments_own_select" ON public.payroll_adjustments;
CREATE POLICY "adjustments_own_select" ON public.payroll_adjustments
  FOR SELECT USING (employee_id = public.get_employee_id() AND public.my_salary_visible());

-- Menejer yangi xodimni yashirin qilib qo'sha olmasin (bu faqat admin ishi)
DROP POLICY IF EXISTS employees_manager_insert ON public.employees;
CREATE POLICY employees_manager_insert ON public.employees
  FOR INSERT WITH CHECK (public.manager_can('add_employees') AND show_salary = TRUE);

-- Supabase yangi ustunni darhol ko'rsin
NOTIFY pgrst, 'reload schema';
