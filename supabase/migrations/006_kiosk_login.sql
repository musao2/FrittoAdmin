-- ============================================================
-- 006 — QR EKRANIGA (KIOSK) EMAIL VA PAROL BILAN KIRISH
-- ------------------------------------------------------------
-- QR ekran ochilganda avval email va parol so'raladi.
-- Email va parolni admin panel → Sozlamalar bo'limida o'zgartirish mumkin.
-- Parol bazada ochiq saqlanmaydi (tuz + sha256).
-- 5 marta noto'g'ri kiritilsa — 5 daqiqaga bloklanadi.
--
-- 002 va 003 dan KEYIN ishga tushiring.
-- Supabase → SQL Editor ga to'liq nusxalab, "Run" bosing.
-- ============================================================

-- ─── 1. Kiosk login ma'lumotlari ──────────────────────────────────────────
ALTER TABLE public.qr_kiosks
  ADD COLUMN IF NOT EXISTS login_email     TEXT,
  ADD COLUMN IF NOT EXISTS password_salt   TEXT,
  ADD COLUMN IF NOT EXISTS password_hash   TEXT,
  ADD COLUMN IF NOT EXISTS failed_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until    TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_kiosks_login_email
  ON public.qr_kiosks (lower(login_email)) WHERE login_email IS NOT NULL;

-- ─── 2. Kirgan QR ekranlar (sessiyalar) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qr_kiosk_sessions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  kiosk_id    UUID REFERENCES public.qr_kiosks(id) ON DELETE CASCADE NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.qr_kiosk_sessions ENABLE ROW LEVEL SECURITY;  -- faqat funksiyalar orqali

-- ─── 3. Boshlang'ich login: fritto@fritto.uz (parol admin bergan) ────────
UPDATE public.qr_kiosks
   SET login_email   = 'fritto@fritto.uz',
       password_salt = 'a83dc95820b37dfab46ef2a084adc33e',
       password_hash = '9a924dd2bcb23f071c7c44e2aa5332858f46d88147d0b34ed07c9f990bfb0c3f'
 WHERE id = 'eba49964-a8c9-4a2f-b3e5-fb93c5ee99ac'
   AND login_email IS NULL;


-- ============================================================
-- FUNKSIYALAR
-- ============================================================

-- Kiosk tekshiruvi: eski maxfiy kalit YOKI login orqali olingan sessiya
CREATE OR REPLACE FUNCTION public.kiosk_auth(p_kiosk_id UUID, p_secret TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.qr_kiosks k
     WHERE k.id = p_kiosk_id AND k.is_active
       AND (
         k.secret_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
         OR EXISTS (
           SELECT 1 FROM public.qr_kiosk_sessions s
            WHERE s.kiosk_id = k.id
              AND s.token_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
         )
       )
  );
$$;
REVOKE ALL ON FUNCTION public.kiosk_auth(UUID, TEXT) FROM PUBLIC, anon, authenticated;


-- QR ekran email va parol bilan kiradi → kiosk ID va sessiya kodi qaytadi
CREATE OR REPLACE FUNCTION public.kiosk_login(p_email TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_k     public.qr_kiosks%ROWTYPE;
  v_token TEXT;
BEGIN
  SELECT * INTO v_k FROM public.qr_kiosks k
   WHERE lower(k.login_email) = lower(trim(p_email)) AND k.is_active
   LIMIT 1;

  IF v_k.id IS NULL THEN
    RAISE EXCEPTION 'INVALID_LOGIN';
  END IF;

  IF v_k.locked_until IS NOT NULL AND v_k.locked_until > NOW() THEN
    RAISE EXCEPTION 'LOCKED';
  END IF;

  IF v_k.password_hash IS DISTINCT FROM encode(sha256(convert_to(v_k.password_salt || p_password, 'UTF8')), 'hex') THEN
    UPDATE public.qr_kiosks
       SET failed_attempts = COALESCE(failed_attempts, 0) + 1,
           locked_until = CASE WHEN COALESCE(failed_attempts, 0) + 1 >= 5
                               THEN NOW() + INTERVAL '5 minutes' ELSE NULL END
     WHERE id = v_k.id;
    -- Xatoni qaytarsak, yuqoridagi UPDATE ham bekor bo'ladi, shuning uchun natijani JSON da beramiz
    RETURN json_build_object('ok', false, 'error', 'INVALID_LOGIN');
  END IF;

  UPDATE public.qr_kiosks SET failed_attempts = 0, locked_until = NULL WHERE id = v_k.id;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.qr_kiosk_sessions (kiosk_id, token_hash)
  VALUES (v_k.id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'));

  RETURN json_build_object('ok', true, 'kiosk_id', v_k.id, 'kiosk_name', v_k.name, 'token', v_token);
END;
$$;
GRANT EXECUTE ON FUNCTION public.kiosk_login(TEXT, TEXT) TO anon, authenticated;


-- QR ekrandan chiqish
CREATE OR REPLACE FUNCTION public.kiosk_logout(p_kiosk_id UUID, p_token TEXT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.qr_kiosk_sessions s
   WHERE s.kiosk_id = p_kiosk_id
     AND s.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;
GRANT EXECUTE ON FUNCTION public.kiosk_logout(UUID, TEXT) TO anon, authenticated;


-- Admin QR ekran email/parolini o'zgartiradi (barcha kirgan ekranlar chiqarib yuboriladi)
CREATE OR REPLACE FUNCTION public.admin_set_kiosk_login(p_kiosk_id UUID, p_email TEXT, p_password TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_salt TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
    RAISE EXCEPTION 'ADMIN_ONLY';
  END IF;
  IF p_email IS NULL OR position('@' IN p_email) = 0 THEN
    RAISE EXCEPTION 'BAD_EMAIL';
  END IF;

  IF p_password IS NOT NULL AND length(p_password) > 0 THEN
    IF length(p_password) < 6 THEN
      RAISE EXCEPTION 'PASSWORD_TOO_SHORT';
    END IF;
    v_salt := replace(gen_random_uuid()::text, '-', '');
    UPDATE public.qr_kiosks
       SET login_email = lower(trim(p_email)),
           password_salt = v_salt,
           password_hash = encode(sha256(convert_to(v_salt || p_password, 'UTF8')), 'hex'),
           failed_attempts = 0, locked_until = NULL
     WHERE id = p_kiosk_id;
    DELETE FROM public.qr_kiosk_sessions s WHERE s.kiosk_id = p_kiosk_id;
  ELSE
    UPDATE public.qr_kiosks SET login_email = lower(trim(p_email)) WHERE id = p_kiosk_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_kiosk_login(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_kiosk_login(UUID, TEXT, TEXT) TO authenticated;
