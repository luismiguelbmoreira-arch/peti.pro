-- ─── Peti.PRO — Billing Schema ───────────────────────────────────────────────
-- Rodar no SQL Editor do Supabase (projeto gru1 / sa-east-1)

-- Subscriptions (1 por usuário, upsert via webhook)
CREATE TABLE public.subscriptions (
  user_id                uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id     text        UNIQUE,
  stripe_subscription_id text        UNIQUE,
  stripe_price_id        text,
  plan                   text,        -- 'basico' | 'pro' | 'escritorio' | null (trial)
  status                 text        NOT NULL DEFAULT 'trialing',
  -- trialing | active | past_due | canceled
  current_period_end     timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  trial_end              timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  cancel_at_period_end   boolean     NOT NULL DEFAULT false,
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscriptions_customer ON public.subscriptions(stripe_customer_id);

-- Usage (contador mensal)
CREATE TABLE public.usage (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month    text NOT NULL,  -- 'YYYY-MM' em America/Sao_Paulo
  count    int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

-- Stripe event idempotência
CREATE TABLE public.stripe_events (
  id          text        PRIMARY KEY,
  type        text        NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own sub"   ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own usage" ON public.usage         FOR SELECT USING (auth.uid() = user_id);

-- RPC: incremento atômico de uso
CREATE OR REPLACE FUNCTION public.increment_usage(p_user_id uuid, p_month text)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO public.usage(user_id, month, count) VALUES (p_user_id, p_month, 1)
  ON CONFLICT (user_id, month) DO UPDATE SET count = public.usage.count + 1;
$$;

-- Trigger: cria trial automaticamente ao criar usuário
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, status, current_period_end, trial_end)
  VALUES (NEW.id, 'trialing', now() + interval '7 days', now() + interval '7 days')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
