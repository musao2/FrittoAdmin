-- ============================================================
-- 013 — XODIM PAROLLARINI ADMIN KO'RA OLISHI (SHIFRLANGAN NUSXA)
-- ------------------------------------------------------------
-- Supabase parollarni bir tomonlama xeshlaydi — ularni ochib bo'lmaydi.
-- Shuning uchun parol QO'YILGAN PAYTDA (yangi xodim yaratilganda yoki
-- admin parol qo'yganda) alohida nusxa saqlanadi:
--   • nusxa maxfiy kalit bilan shifrlanadi (pgp_sym_encrypt); kalit Supabase Vault'da
--     (Vault bo'lmasa — API orqali ko'rinmaydigan private sxemada)
--   • jadvalga to'g'ridan-to'g'ri hech kim kira olmaydi — faqat admin funksiyasi
--   • admin parolni har ko'rganida audit_logs jurnaliga yoziladi
--
-- Bu SQL dan OLDINGI parollarni ko'rib bo'lmaydi — ularga bir marta yangi
-- parol qo'yish kerak (Sozlamalar → "Parollari ko'rinmaydigan xodimlar").
--
-- 012_account_credentials.sql dan KEYIN ishga tushiring.
-- ============================================================

-- Shifrlash kengaytmasi (Supabase'da odatda allaqachon yoqilgan)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ─── 1. Shifrlash kaliti ──────────────────────────────────────────────────
-- Supabase Vault bo'lsa — kalit Vault'da; bo'lmasa — API orqali ko'rinmaydigan
-- "private" sxemasidagi jadvalda saqlanadi.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS private.app_secrets (
  name  TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
REVOKE ALL ON private.app_secrets FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_key TEXT := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
BEGIN
  IF to_regclass('vault.secrets') IS NOT NULL THEN
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'fritto_password_key') THEN
        PERFORM vault.create_secret(v_key, 'fritto_password_key', 'FRITTO: xodim parollari nusxasini shifrlash kaliti');
      END IF;
      RETURN;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Vault ishlatib bo''lmadi (%), kalit private.app_secrets ga yoziladi', SQLERRM;
    END;
  END IF;
  INSERT INTO private.app_secrets (name, value) VALUES ('fritto_password_key', v_key)
  ON CONFLICT (name) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public._password_key()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
  k TEXT;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
        INTO k USING 'fritto_password_key';
    EXCEPTION WHEN OTHERS THEN
      k := NULL;
    END;
  END IF;
  IF k IS NULL THEN
    SELECT s.value INTO k FROM private.app_secrets s WHERE s.name = 'fritto_password_key';
  END IF;
  IF k IS NULL THEN
    RAISE EXCEPTION 'PASSWORD_KEY_MISSING';
  END IF;
  RETURN k;
END;
$$;
REVOKE ALL ON FUNCTION public._password_key() FROM PUBLIC, anon, authenticated;

-- ─── 2. Parol nusxalari jadvali (faqat funksiyalar orqali) ───────────────
CREATE TABLE IF NOT EXISTS public.password_vault (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  password_enc  BYTEA NOT NULL,
  set_by        UUID REFERENCES auth.users(id),
  set_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.password_vault ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_vault FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._store_password(p_user_id UUID, p_password TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  INSERT INTO public.password_vault (user_id, password_enc, set_by, set_at)
  VALUES (p_user_id, pgp_sym_encrypt(p_password, public._password_key()), auth.uid(), NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET password_enc = EXCLUDED.password_enc, set_by = EXCLUDED.set_by, set_at = NOW();
END;
$$;
REVOKE ALL ON FUNCTION public._store_password(UUID, TEXT) FROM PUBLIC, anon, authenticated;


-- ─── 3. Yangi xodim yaratilganda: admin bergan parol nusxasini saqlash ────
-- Parol haqiqatan shu xodimniki ekanligi tekshiriladi (boshqa matn saqlanmasin)
CREATE OR REPLACE FUNCTION public.admin_store_password(p_user_id UUID, p_password TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NOT public.caller_is_admin() THEN
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


-- ─── 4. Admin parol qo'yganda — nusxasi ham saqlanadi (012 dagi funksiya yangilanadi) ──
CREATE OR REPLACE FUNCTION public.admin_set_user_credentials(p_user_id UUID, p_email TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res JSON;
BEGIN
  IF NOT public.caller_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  -- Faqat xodimlar (boshqa adminning parolini bu yerdan o'zgartirib bo'lmaydi)
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.role = 'employee') THEN
    RAISE EXCEPTION 'NOT_EMPLOYEE';
  END IF;

  v_res := public._set_credentials(p_user_id, p_email, p_password);

  -- Parol o'zgarsa — shifrlangan nusxa saqlanadi va xodim barcha qurilmalardan chiqariladi
  IF (v_res->>'password_changed')::BOOLEAN THEN
    PERFORM public._store_password(p_user_id, p_password);
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
  END IF;
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_user_credentials(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_credentials(UUID, TEXT, TEXT) TO authenticated;



-- ─── 5. Admin xodim parolini ko'radi (jurnalga yoziladi) ──────────────────
-- Nusxa bo'lmasa NULL qaytadi (eski parol — yangisini qo'yish kerak)
CREATE OR REPLACE FUNCTION public.admin_reveal_password(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_enc BYTEA;
BEGIN
  IF NOT public.caller_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.role = 'employee') THEN
    RAISE EXCEPTION 'NOT_EMPLOYEE';
  END IF;

  SELECT v.password_enc INTO v_enc FROM public.password_vault v WHERE v.user_id = p_user_id;
  IF v_enc IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.audit_logs (table_name, record_id, action, reason, performed_by)
  VALUES ('password_vault', p_user_id, 'reveal_password', 'Admin xodim parolini ko''rdi', auth.uid());

  RETURN pgp_sym_decrypt(v_enc, public._password_key());
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reveal_password(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reveal_password(UUID) TO authenticated;


-- ─── 6. Paroli ko'rinmaydigan (nusxasi yo'q) xodimlar ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_employees_without_password_copy()
RETURNS TABLE (user_id UUID, employee_id UUID, full_name TEXT, email TEXT)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.caller_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  RETURN QUERY
  SELECT e.user_id, e.id, e.full_name::TEXT, u.email::TEXT
    FROM public.employees e
    JOIN auth.users u ON u.id = e.user_id
    JOIN public.profiles p ON p.id = e.user_id AND p.role = 'employee'
   WHERE NOT EXISTS (SELECT 1 FROM public.password_vault v WHERE v.user_id = e.user_id)
     AND e.status IN ('active', 'trial')
   ORDER BY e.full_name;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_employees_without_password_copy() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_employees_without_password_copy() TO authenticated;
