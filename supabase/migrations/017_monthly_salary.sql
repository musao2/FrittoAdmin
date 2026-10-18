-- ============================================================
-- 017 — BELGILANGAN OYLIK (SOATSIZ)
-- ------------------------------------------------------------
-- Har bir xodimning maosh turi:
--   'hourly'  — soatbay (avvalgidek: ishlagan soati × soatlik stavka)
--   'monthly' — belgilangan oylik: soat hisoblanmaydi, davomat faqat
--               ko'rish uchun yoziladi, oyiga monthly_salary to'lanadi
--
-- Oylikdagi xodimning hourly_rate = 0 bo'ladi, shuning uchun keldi-ketdi
-- yozuvlarida "topdi" 0 chiqadi. Ish haqi hisoblanganda oylik summasi olinadi.
--
-- Supabase → SQL Editor → nusxalab "Run". Qayta ishga tushirsa ham xato bermaydi.
-- ============================================================

ALTER TABLE public.salary_rates
  ADD COLUMN IF NOT EXISTS salary_type TEXT NOT NULL DEFAULT 'hourly',
  ADD COLUMN IF NOT EXISTS monthly_salary NUMERIC(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.salary_rates DROP CONSTRAINT IF EXISTS salary_rates_salary_type_check;
ALTER TABLE public.salary_rates
  ADD CONSTRAINT salary_rates_salary_type_check CHECK (salary_type IN ('hourly', 'monthly'));

ALTER TABLE public.salary_rates DROP CONSTRAINT IF EXISTS salary_rates_monthly_salary_check;
ALTER TABLE public.salary_rates
  ADD CONSTRAINT salary_rates_monthly_salary_check CHECK (monthly_salary >= 0);
