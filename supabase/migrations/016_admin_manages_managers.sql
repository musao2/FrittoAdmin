-- ============================================================
-- 016 — ADMIN MENEJER YARATADI
-- ------------------------------------------------------------
-- Admin panel → "Menejerlar" sahifasidan:
--   • yangi menejer yaratish (email + parol + ism)
--   • menejerlar ro'yxati, oxirgi kirgan vaqti
--   • parolini ko'rish / email va parolni o'zgartirish
--   • menejerni o'chirish
--
-- Xavfsizlik tuzatishi: yangi ro'yxatdan o'tgan har qanday foydalanuvchi
-- endi doim 'employee' bo'ladi (avval o'zi "admin" deb yozib yuborishi mumkin edi).
-- Admin va menejer rolini faqat admin beradi.
--
-- 015 dan KEYIN ishga tushiring. Supabase → SQL Editor → nusxalab "Run".
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ─── 1. Ro'yxatdan o'tganda rol doim 'employee' ──────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role, full_name)
  VALUES (NEW.id, NEW.email, 'employee', COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ─── 2. Menejer yaratish ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_create_manager(p_email TEXT, p_password TEXT, p_full_name TEXT)
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

  -- handle_new_user profil yaratadi — rolini menejer qilamiz
  INSERT INTO public.profiles (id, email, role, full_name)
  VALUES (v_id, v_email, 'manager', COALESCE(v_name, 'Menejer'))
  ON CONFLICT (id) DO UPDATE SET role = 'manager', full_name = EXCLUDED.full_name;

  PERFORM public._store_password(v_id, p_password);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_create_manager(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_manager(TEXT, TEXT, TEXT) TO authenticated;

-- ─── 3. Menejerlar ro'yxati ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_list_managers()
RETURNS TABLE (id UUID, email TEXT, full_name TEXT, created_at TIMESTAMPTZ, last_sign_in_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.caller_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  RETURN QUERY
    SELECT p.id, u.email::TEXT, p.full_name, u.created_at, u.last_sign_in_at
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.id
     WHERE p.role = 'manager'
       AND (u.banned_until IS NULL OR u.banned_until < NOW())
     ORDER BY u.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_managers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_managers() TO authenticated;

-- ─── 4. Menejer email/parolini o'zgartirish ───────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_manager_credentials(p_user_id UUID, p_email TEXT, p_password TEXT)
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
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.role = 'manager') THEN
    RAISE EXCEPTION 'NOT_MANAGER';
  END IF;
  v_res := public._set_credentials(p_user_id, p_email, p_password);
  IF (v_res->>'password_changed')::BOOLEAN THEN
    PERFORM public._store_password(p_user_id, p_password);
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
  END IF;
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_manager_credentials(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_manager_credentials(UUID, TEXT, TEXT) TO authenticated;

-- ─── 5. Menejer parolini ko'rish (jurnalga yoziladi) ──────────────────────
CREATE OR REPLACE FUNCTION public.admin_reveal_manager_password(p_user_id UUID)
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
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.role = 'manager') THEN
    RAISE EXCEPTION 'NOT_MANAGER';
  END IF;
  SELECT v.password_enc INTO v_enc FROM public.password_vault v WHERE v.user_id = p_user_id;
  IF v_enc IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.audit_logs (table_name, record_id, action, reason, performed_by)
  VALUES ('password_vault', p_user_id, 'reveal_password', 'Admin menejer parolini ko''rdi', auth.uid());
  RETURN pgp_sym_decrypt(v_enc, public._password_key());
END;
$$;
REVOKE ALL ON FUNCTION public.admin_reveal_manager_password(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reveal_manager_password(UUID) TO authenticated;

-- ─── 6. Menejerni o'chirish ───────────────────────────────────────────────
-- Menejer qo'shgan yozuvlar unga bog'langan bo'lsa, hisob o'chirilmaydi,
-- balki butunlay bloklanadi (kira olmaydi, ro'yxatda ko'rinmaydi).
CREATE OR REPLACE FUNCTION public.admin_delete_manager(p_user_id UUID)
RETURNS TEXT
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

  DELETE FROM auth.sessions WHERE user_id = p_user_id;
  BEGIN
    DELETE FROM auth.users WHERE id = p_user_id;
    RETURN 'deleted';
  EXCEPTION WHEN foreign_key_violation THEN
    UPDATE auth.users SET banned_until = 'infinity', updated_at = NOW() WHERE id = p_user_id;
    DELETE FROM public.password_vault WHERE user_id = p_user_id;
    RETURN 'blocked';
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_delete_manager(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_manager(UUID) TO authenticated;

-- ─── 7. Bloklangan menejer menejer huquqlaridan ham foydalana olmasin ─────
CREATE OR REPLACE FUNCTION public.is_manager()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id = p.id
     WHERE p.id = auth.uid() AND p.role = 'manager'
       AND (u.banned_until IS NULL OR u.banned_until < NOW())
  );
$$;
