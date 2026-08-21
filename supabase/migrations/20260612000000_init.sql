-- Pretext backend schema (PRD §4B), plus row-level security and the trigger
-- that "spins up/retrieves a profile row" when Supabase Auth validates a new
-- Google user (PRD §4A step 3).

-- Users Profile Table
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users NOT NULL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'premium', 'pro'))
);

-- Token/Request Analytics (for tracing usage metrics)
CREATE TABLE public.usage_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) NOT NULL,
    model_used TEXT NOT NULL,
    prompt_tokens INT NOT NULL,
    completion_tokens INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX usage_logs_user_created_idx ON public.usage_logs (user_id, created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security: users can read their own data; usage rows are written
-- exclusively by the `optimize` edge function via the service-role key.
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Users can view own usage"
    ON public.usage_logs FOR SELECT
    USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Auto-provision a profile row whenever Supabase Auth creates a user.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email)
    VALUES (NEW.id, COALESCE(NEW.email, NEW.id::text || '@unknown.local'))
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
