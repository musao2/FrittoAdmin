-- ============================================================
-- 004 — XODIMGA OYLIGIDAN KO'P PUL BERISHNI TAQIQLASH
-- ------------------------------------------------------------
-- Har bir yangi to'lov yozilishidan oldin tekshiriladi:
--   shu oy uchun berilgan pul + yangi to'lov  ≤  oylik (net_payable)
-- Oshib ketsa — to'lov saqlanmaydi.
--
-- Supabase → SQL Editor ga to'liq nusxalab, "Run" bosing.
-- Qayta ishga tushirsa ham xato bermaydi.
-- ============================================================

CREATE OR REPLACE FUNCTION public.payments_prevent_overpay()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_net        NUMERIC;
  v_paid       NUMERIC;
  v_remaining  NUMERIC;
BEGIN
  IF NEW.payroll_item_id IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_NO_PAYROLL_ITEM'
      USING HINT = 'To''lov oylik hisob-kitobiga bog''langan bo''lishi kerak';
  END IF;

  -- Bir vaqtda ikki to'lov kiritilsa ham to'g'ri hisoblash uchun qatorni qulflaymiz
  SELECT COALESCE(pi.net_payable, 0) INTO v_net
    FROM public.payroll_items pi
   WHERE pi.id = NEW.payroll_item_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NO_PAYROLL_ITEM';
  END IF;

  SELECT COALESCE(SUM(p.amount), 0) INTO v_paid
    FROM public.payments p
   WHERE p.payroll_item_id = NEW.payroll_item_id
     AND (TG_OP = 'INSERT' OR p.id <> NEW.id);

  v_remaining := GREATEST(0, v_net - v_paid);

  IF NEW.amount > v_remaining THEN
    RAISE EXCEPTION 'OVERPAY:%', ROUND(v_remaining)
      USING HINT = 'Oylikdan ko''p pul berib bo''lmaydi';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payments_prevent_overpay ON public.payments;
CREATE TRIGGER trg_payments_prevent_overpay
  BEFORE INSERT OR UPDATE OF amount, payroll_item_id ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_prevent_overpay();
