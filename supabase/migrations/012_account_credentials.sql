-- ============================================================
-- 012 — EMAIL VA PAROLNI ADMIN PANELDAN O'ZGARTIRISH
-- ------------------------------------------------------------
-- 1) Admin o'z email/parolini o'zgartiradi (joriy parol bilan tasdiqlab)
-- 2) Admin xodimning emailini va oxirgi kirgan vaqtini ko'radi,
--    email va parolini o'zgartiradi.
--
-- Parollar shifrlangan (bcrypt) — ularni hech kim ko'ra olmaydi,
-- faqat yangisini qo'yish mumkin. Parol o'zgarsa, o'sha foydalanuvchi
-- boshqa barcha qurilmalardan chiqarib yuboriladi.
--
-- Supabase → SQL Editor ga to'liq nusxalab, "Run" bosing.
-- ============================================================

-- Yordamchi: chaqirayotgan foydalanuvchi adminmi?
CREATE OR REPLACE FUNCTION public.caller_is_admin()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin');
$$;

-- Ichki: email/parolni yangilash (tekshiruvlar chaqiruvchi funksiyalarda)
CREATE OR REPLACE FUNCTION public._set_credentials(p_user_id UUID, p_email TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_email   TEXT := NULLIF(lower(trim(p_email)), '');
  v_changed_email BOOLEAN := FALSE;
  v_changed_pass  BOOLEAN := FALSE;
BEGIN
  IF v_email IS NOT NULL THEN
    IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'BAD_EMAIL';
    END IF;
    IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email AND u.id <> p_user_id) THEN
      RAISE EXCEPTION 'EMAIL_TAKEN';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id AND lower(u.email) = v_email) THEN
      UPDATE auth.users
         SET email = v_email,
             email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
             email_change = '', email_change_token_new = '', email_change_token_current = '',
             updated_at = NOW()
       WHERE id = p_user_id;
      UPDATE auth.identities
         SET identity_data = jsonb_set(COALESCE(identity_data, '{}'::jsonb), '{email}', to_jsonb(v_email)),
             updated_at = NOW()
       WHERE user_id = p_user_id AND provider = 'email';
      UPDATE public.profiles SET email = v_email, updated_at = NOW() WHERE id = p_user_id;
      v_changed_email := TRUE;
    END IF;
  END IF;

  IF p_password IS NOT NULL AND length(p_password) > 0 THEN
    IF length(p_password) < 6 THEN
      RAISE EXCEPTION 'PASSWORD_TOO_SHORT';
    END IF;
    UPDATE auth.users
       SET encrypted_password = crypt(p_password, gen_salt('bf')),
           updated_at = NOW()
     WHERE id = p_user_id;
    v_changed_pass := TRUE;
  END IF;

  RETURN json_build_object('email_changed', v_changed_email, 'password_changed', v_changed_pass);
END;
$$;
REVOKE ALL ON FUNCTION public._set_credentials(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;


-- ─── 1. Admin: xodimning kirish ma'lumotlari ──────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_user_auth_info(p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
  v JSON;
BEGIN
  IF NOT public.caller_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  SELECT json_build_object(
           'email', u.email,
           'last_sign_in_at', u.last_sign_in_at,
           'created_at', u.created_at,
           'confirmed', u.email_confirmed_at IS NOT NULL
         )
    INTO v
    FROM auth.users u
   WHERE u.id = p_user_id;
  IF v IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_user_auth_info(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_auth_info(UUID) TO authenticated;


-- ─── 2. Admin: xodimning email/parolini o'zgartirish ──────────────────────
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

  -- Parol o'zgarsa — xodim barcha qurilmalardan chiqariladi
  IF (v_res->>'password_changed')::BOOLEAN THEN
    DELETE FROM auth.sessions WHERE user_id = p_user_id;
  END IF;
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_user_credentials(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_credentials(UUID, TEXT, TEXT) TO authenticated;


-- ─── 3. Admin: o'z email/parolini o'zgartirish (joriy parol bilan) ────────
CREATE OR REPLACE FUNCTION public.admin_update_own_credentials(p_current_password TEXT, p_email TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_res JSON;
  v_session UUID;
BEGIN
  IF NOT public.caller_is_admin() THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
     WHERE u.id = v_uid AND u.encrypted_password = crypt(p_current_password, u.encrypted_password)
  ) THEN
    RAISE EXCEPTION 'WRONG_PASSWORD';
  END IF;

  v_res := public._set_credentials(v_uid, p_email, p_password);

  -- Parol o'zgarsa — boshqa qurilmalardagi sessiyalar yopiladi (hozirgisi qoladi)
  IF (v_res->>'password_changed')::BOOLEAN THEN
    v_session := NULLIF(auth.jwt() ->> 'session_id', '')::UUID;
    DELETE FROM auth.sessions WHERE user_id = v_uid AND (v_session IS NULL OR id <> v_session);
  END IF;
  RETURN v_res;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_own_credentials(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_own_credentials(TEXT, TEXT, TEXT) TO authenticated;
