-- ============================================================
-- 008 — XODIMNI FILIALGA BOG'LASH (admin paneldagi filial filtri uchun)
-- ------------------------------------------------------------
-- Har bir xodimga filial (branches jadvalidan) biriktiriladi.
-- Admin panel tepasidagi "Filial" tanlovi shu bog'lanish orqali
-- xodimlar, davomat, ish haqi, avans va to'lovlarni filtrlaydi.
--
-- Avvalgi xodimlarda filial nomi matn ko'rinishida edi ("Asosiy" ...).
-- Nomi mos keladigan filial bo'lsa — avtomatik bog'lanadi.
--
-- 007_branches_location.sql dan KEYIN ishga tushiring.
-- ============================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_branch_id ON public.employees(branch_id);

-- Eski matnli filial nomlarini yangi filiallarga bog'lash (katta-kichik harf farqi yo'q)
UPDATE public.employees e
   SET branch_id = b.id
  FROM public.branches b
 WHERE e.branch_id IS NULL
   AND lower(trim(e.branch)) = lower(trim(b.name));
