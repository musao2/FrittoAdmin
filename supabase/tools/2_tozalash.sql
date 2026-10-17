-- ============================================================
-- 2-QADAM: SINOV MA'LUMOTLARINI TOZALASH (ORTGA QAYTARIB BO'LMAYDI!)
-- ------------------------------------------------------------
-- O'CHIRILADI:
--   • barcha xodimlar va ularning tizimga kirish hisoblari (email/parol)
--   • davomat, tanaffuslar, ish haqi, avanslar, to'lovlar, bonus/jarimalar
--   • sinov muddatlari, ish jadvallari, soatlik stavkalar
--   • xodim qurilmalari, bildirishnomalar, jurnal (audit), parol nusxalari
--   • eski QR tokenlar
-- QOLADI:
--   • admin hisobi(lari)
--   • bazaning tuzilishi, barcha funksiyalar va himoya qoidalari
--   • filiallar va QR ekran (kiosk) sozlamalari  (filiallarni ham o'chirish — pastda)
--
-- DIQQAT — BU SKRIPTDAN OLDIN: davomat RASMLARI fayl sifatida Storage'da turadi
-- va SQL bilan to'g'ri o'chmaydi. Avval ularni o'chiring:
--   Supabase → Storage → attendance-photos → "..." → "Empty bucket"
-- (rasmlar qolsa, xodim hisoblarini o'chirish to'xtashi mumkin)
--
-- Hammasi bitta tranzaksiyada: biror joyda xato bo'lsa — HECH NARSA o'chmaydi.
-- ============================================================

BEGIN;

DO $$
DECLARE
  t TEXT;
  -- Mavjud bo'lsa tozalanadigan jadvallar (ba'zilari keyingi SQL fayllarda qo'shilgan)
  tables TEXT[] := ARRAY[
    'public.payments',
    'public.payroll_adjustments',
    'public.payroll_items',
    'public.payroll_periods',
    'public.advances',
    'public.breaks',
    'public.attendance_sessions',
    'public.employee_devices',
    'public.employment_trials',
    'public.work_schedules',
    'public.salary_rates',
    'public.notifications',
    'public.audit_logs',
    'public.password_vault',
    'public.qr_tokens'
  ];
  existing TEXT[] := '{}';
  v_users INTEGER;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(t) IS NOT NULL THEN
      existing := existing || t;
    END IF;
  END LOOP;

  -- 1) Ish ma'lumotlari
  EXECUTE 'TRUNCATE TABLE ' || array_to_string(existing, ', ') || ' RESTART IDENTITY CASCADE';

  -- 2) Xodimlarning tizimga kirish hisoblari (profil, sessiyalar avtomatik o'chadi)
  DELETE FROM auth.users u
   WHERE u.id IN (SELECT p.id FROM public.profiles p WHERE p.role = 'employee');
  GET DIAGNOSTICS v_users = ROW_COUNT;

  -- 3) Xodimlar
  DELETE FROM public.employees;

  RAISE NOTICE 'Tozalandi: % ta jadval, % ta xodim hisobi', array_length(existing, 1), v_users;
END $$;

-- ── Filiallarni ham o'chirmoqchi bo'lsangiz, keyingi qatordagi "--" ni olib tashlang:
-- DELETE FROM public.branches;

COMMIT;

-- Natijani tekshirish: hammasi 0 bo'lishi kerak (adminlar bundan mustasno)
SELECT
  (SELECT COUNT(*) FROM public.employees)           AS xodimlar,
  (SELECT COUNT(*) FROM public.attendance_sessions) AS davomat,
  (SELECT COUNT(*) FROM public.advances)            AS avanslar,
  (SELECT COUNT(*) FROM public.payments)            AS tolovlar,
  (SELECT COUNT(*) FROM public.profiles WHERE role = 'employee') AS xodim_hisoblari,
  (SELECT COUNT(*) FROM public.profiles WHERE role = 'admin')    AS adminlar_qoldi;
