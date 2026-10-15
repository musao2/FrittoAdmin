-- ============================================================
-- 003 — Birinchi QR kiosk (Asosiy filial)
-- 002_qr_attendance.sql dan KEYIN ishga tushiring.
-- Bu yerda faqat kalitning sha256 xeshi saqlanadi; kalitning o'zi
-- FrittoQR/.env faylida (VITE_KIOSK_SECRET).
-- ============================================================
INSERT INTO public.qr_kiosks (id, name, branch, secret_hash)
VALUES ('eba49964-a8c9-4a2f-b3e5-fb93c5ee99ac', 'Asosiy filial — kirish eshigi', 'Asosiy', 'f87eacee912499fb5dd8ba83b4d7cfebbc83e342ad712a7bdfb7b45e02535d24')
ON CONFLICT (id) DO NOTHING;
