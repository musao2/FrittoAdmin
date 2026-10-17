-- ============================================================
-- 1-QADAM: NIMA O'CHIRILISHINI KO'RISH (hech narsa o'chirmaydi)
-- Supabase → SQL Editor → shu faylni ishga tushiring va sonlarni ko'ring.
-- ============================================================
SELECT 'Xodimlar'                 AS nima, COUNT(*) AS soni FROM public.employees
UNION ALL SELECT 'Xodim kirish hisoblari', COUNT(*) FROM public.profiles WHERE role = 'employee'
UNION ALL SELECT 'Admin hisoblari (QOLADI)', COUNT(*) FROM public.profiles WHERE role = 'admin'
UNION ALL SELECT 'Davomat yozuvlari',      COUNT(*) FROM public.attendance_sessions
UNION ALL SELECT 'Avanslar',               COUNT(*) FROM public.advances
UNION ALL SELECT 'Ish haqi hisoblari',     COUNT(*) FROM public.payroll_items
UNION ALL SELECT 'To''lovlar',             COUNT(*) FROM public.payments
UNION ALL SELECT 'Bonus va jarimalar',     COUNT(*) FROM public.payroll_adjustments
UNION ALL SELECT 'Bildirishnomalar',       COUNT(*) FROM public.notifications
UNION ALL SELECT 'Davomat rasmlari (fayl)', COUNT(*) FROM storage.objects WHERE bucket_id = 'attendance-photos';

-- Qoladigan admin(lar) — topshirishdan oldin email/parolini Sozlamalar → "Mening hisobim"da almashtiring
SELECT email AS qoladigan_admin FROM public.profiles WHERE role = 'admin';
