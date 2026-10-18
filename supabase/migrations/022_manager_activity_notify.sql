-- ============================================================
-- 022 — MENEJER HARAKATLARI HAQIDA ADMINGA XABAR
-- ------------------------------------------------------------
-- Menejer yangi xodim qo'shsa → adminga bildirishnoma:
--   "Aziz yangi xodim qo'shdi: Ali Valiyev (Oshpaz, FRITTO BAZA) · 15 000 so'm/soat"
-- (Oylik va avans berganda xabar 018/019 da allaqachon bor.)
--
-- 018 dan KEYIN ishga tushiring. Supabase → SQL Editor → "Run".
-- ============================================================

CREATE OR REPLACE FUNCTION public._manager_name()
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(p.full_name, ''), p.email, 'Menejer') FROM public.profiles p WHERE p.id = auth.uid();
$$;

-- ─── 1. Menejer xodim qo'shdi ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_manager_employee_added()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_by     TEXT;
  v_branch TEXT;
BEGIN
  IF NOT public.is_manager() THEN
    RETURN NEW;
  END IF;
  v_by := public._manager_name();
  SELECT b.name INTO v_branch FROM public.branches b WHERE b.id = NEW.branch_id;

  INSERT INTO public.notifications (employee_id, target_role, type, title, message, data)
  VALUES (
    NEW.id, 'admin', 'manager_employee_added',
    'Menejer yangi xodim qo''shdi',
    format('%s → %s (%s)', v_by, NEW.full_name,
           concat_ws(', ', NULLIF(NEW.position, ''), COALESCE(v_branch, NULLIF(NEW.branch, '')))),
    jsonb_build_object('by', auth.uid(), 'by_name', v_by, 'employee', NEW.full_name)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_manager_employee_added ON public.employees;
CREATE TRIGGER trg_notify_manager_employee_added
  AFTER INSERT ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.notify_manager_employee_added();

-- ─── 2. Menejer maosh belgiladi — xabarga maoshni qo'shamiz ──────────────
CREATE OR REPLACE FUNCTION public.notify_manager_rate_set()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate TEXT;
  v_id   UUID;
BEGIN
  IF NOT public.is_manager() THEN
    RETURN NEW;
  END IF;
  v_rate := CASE
    WHEN NEW.salary_type = 'monthly' THEN to_char(NEW.monthly_salary, 'FM999G999G999') || ' so''m/oy'
    ELSE to_char(NEW.hourly_rate, 'FM999G999G999') || ' so''m/soat'
  END;

  -- Shu xodim uchun hozirgina yuborilgan "xodim qo'shdi" xabariga qo'shamiz
  SELECT n.id INTO v_id
    FROM public.notifications n
   WHERE n.employee_id = NEW.employee_id
     AND n.type = 'manager_employee_added'
     AND n.created_at > NOW() - INTERVAL '10 minutes'
   ORDER BY n.created_at DESC
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.notifications
       SET message = message || ' · maosh: ' || v_rate,
           data = data || jsonb_build_object('rate', v_rate)
     WHERE id = v_id;
  ELSE
    INSERT INTO public.notifications (employee_id, target_role, type, title, message, data)
    SELECT NEW.employee_id, 'admin', 'manager_rate_set', 'Menejer maosh belgiladi',
           format('%s → %s: %s', public._manager_name(), e.full_name, v_rate),
           jsonb_build_object('by', auth.uid(), 'rate', v_rate)
      FROM public.employees e WHERE e.id = NEW.employee_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_manager_rate_set ON public.salary_rates;
CREATE TRIGGER trg_notify_manager_rate_set
  AFTER INSERT ON public.salary_rates
  FOR EACH ROW EXECUTE FUNCTION public.notify_manager_rate_set();
