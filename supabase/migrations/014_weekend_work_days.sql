-- ============================================================
-- 014 — SHANBA VA YAKSHANBA HAM ISH KUNI
-- ------------------------------------------------------------
-- Mavjud xodimlarning ish jadvallariga shanba (Sat) va yakshanba (Sun)
-- qo'shiladi. Yangi jadvallar uchun standart ham 7 kun bo'ladi.
--
--  • Bitta jadvali bor xodim (har kuni bir xil vaqt) → Sat va Sun qo'shiladi
--  • Ikkita jadvali bor xodim (kunlarga qarab har xil vaqt):
--      Du/Chor/Ju guruhiga → Yakshanba,  Se/Pay guruhiga → Shanba
--
-- Qayta ishga tushirsa ham xato bermaydi (bor kun qayta qo'shilmaydi).
-- ============================================================

-- Kunlarni hafta tartibida saqlash uchun yordamchi
CREATE OR REPLACE FUNCTION public._sort_week_days(days TEXT[])
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT ARRAY(
    SELECT d FROM unnest(ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun']) WITH ORDINALITY AS w(d, i)
     WHERE d = ANY(days)
     ORDER BY i
  );
$$;

-- 1) Bitta jadvali bor xodimlar: shanba + yakshanba
UPDATE public.work_schedules s
   SET work_days  = public._sort_week_days(COALESCE(s.work_days, '{}') || ARRAY['Sat','Sun']),
       updated_at = NOW()
 WHERE (SELECT COUNT(*) FROM public.work_schedules x WHERE x.employee_id = s.employee_id) = 1
   AND NOT (COALESCE(s.work_days, '{}') @> ARRAY['Sat','Sun']);

-- 2) Ikki jadvalli xodimlar: dushanba bor guruhga yakshanba
UPDATE public.work_schedules s
   SET work_days  = public._sort_week_days(s.work_days || ARRAY['Sun']),
       updated_at = NOW()
 WHERE (SELECT COUNT(*) FROM public.work_schedules x WHERE x.employee_id = s.employee_id) > 1
   AND 'Mon' = ANY(s.work_days)
   AND NOT ('Sun' = ANY(s.work_days))
   AND NOT EXISTS (SELECT 1 FROM public.work_schedules x
                    WHERE x.employee_id = s.employee_id AND x.id <> s.id AND 'Sun' = ANY(x.work_days));

-- 3) Ikki jadvalli xodimlar: seshanba bor guruhga shanba
UPDATE public.work_schedules s
   SET work_days  = public._sort_week_days(s.work_days || ARRAY['Sat']),
       updated_at = NOW()
 WHERE (SELECT COUNT(*) FROM public.work_schedules x WHERE x.employee_id = s.employee_id) > 1
   AND 'Tue' = ANY(s.work_days)
   AND NOT ('Sat' = ANY(s.work_days))
   AND NOT EXISTS (SELECT 1 FROM public.work_schedules x
                    WHERE x.employee_id = s.employee_id AND x.id <> s.id AND 'Sat' = ANY(x.work_days));

-- 4) Yangi jadvallar uchun standart: haftaning 7 kuni
ALTER TABLE public.work_schedules
  ALTER COLUMN work_days SET DEFAULT ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

-- Natija: har bir xodimning ish kunlari
SELECT e.full_name AS xodim,
       string_agg(array_to_string(s.work_days, ', ') || ' (' || to_char(s.shift_start, 'HH24:MI') || '–' || to_char(s.shift_end, 'HH24:MI') || ')', ' | ') AS ish_kunlari
  FROM public.employees e
  JOIN public.work_schedules s ON s.employee_id = e.id
 GROUP BY e.full_name
 ORDER BY e.full_name;
