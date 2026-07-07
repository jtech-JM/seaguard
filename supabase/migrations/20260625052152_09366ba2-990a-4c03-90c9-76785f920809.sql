
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin', 'bmu_officer', 'rescue_team');
CREATE TYPE public.alert_status AS ENUM ('new', 'acknowledged', 'assigned', 'in_progress', 'resolved', 'closed');
CREATE TYPE public.notification_channel AS ENUM ('dashboard', 'sms', 'email', 'whatsapp');
CREATE TYPE public.notification_status AS ENUM ('pending', 'sent', 'failed');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles read own" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles update own" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles insert own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles read own" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ============ AUTO PROFILE + ROLE ON SIGNUP ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'bmu_officer')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ UPDATED_AT HELPER ============
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ BMUs ============
CREATE TABLE public.bmus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  region TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bmus TO authenticated;
GRANT ALL ON public.bmus TO service_role;
ALTER TABLE public.bmus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bmus all auth" ON public.bmus FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_bmus_updated BEFORE UPDATE ON public.bmus FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ FISHERMEN ============
CREATE TABLE public.fishermen (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bmu_id UUID REFERENCES public.bmus(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  national_id TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  photo_url TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fishermen_bmu ON public.fishermen(bmu_id);
CREATE INDEX idx_fishermen_active ON public.fishermen(active);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fishermen TO authenticated;
GRANT ALL ON public.fishermen TO service_role;
ALTER TABLE public.fishermen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fishermen all auth" ON public.fishermen FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_fishermen_updated BEFORE UPDATE ON public.fishermen FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ BOATS ============
CREATE TABLE public.boats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  registration_number TEXT UNIQUE,
  boat_type TEXT,
  owner_fisherman_id UUID REFERENCES public.fishermen(id) ON DELETE SET NULL,
  bmu_id UUID REFERENCES public.bmus(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_boats_owner ON public.boats(owner_fisherman_id);
CREATE INDEX idx_boats_bmu ON public.boats(bmu_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.boats TO authenticated;
GRANT ALL ON public.boats TO service_role;
ALTER TABLE public.boats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "boats all auth" ON public.boats FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_boats_updated BEFORE UPDATE ON public.boats FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ DEVICES ============
CREATE TABLE public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT NOT NULL UNIQUE,
  boat_id UUID REFERENCES public.boats(id) ON DELETE SET NULL,
  hardware_type TEXT DEFAULT 'simulator',
  active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_devices_boat ON public.devices(boat_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices TO authenticated;
GRANT ALL ON public.devices TO service_role;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "devices all auth" ON public.devices FOR ALL TO authenticated USING (true) WITH CHECK (true);
-- Public read of a device by device_id is needed for the SOS simulator (unauthenticated device)
CREATE POLICY "devices public read" ON public.devices FOR SELECT TO anon USING (true);
GRANT SELECT ON public.devices TO anon;
CREATE TRIGGER trg_devices_updated BEFORE UPDATE ON public.devices FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ SOS ALERTS ============
CREATE TABLE public.sos_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  boat_id UUID REFERENCES public.boats(id) ON DELETE SET NULL,
  fisherman_id UUID REFERENCES public.fishermen(id) ON DELETE SET NULL,
  bmu_id UUID REFERENCES public.bmus(id) ON DELETE SET NULL,
  status public.alert_status NOT NULL DEFAULT 'new',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  last_lat DOUBLE PRECISION,
  last_lng DOUBLE PRECISION,
  last_accuracy DOUBLE PRECISION,
  last_ping_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alerts_status ON public.sos_alerts(status);
CREATE INDEX idx_alerts_device ON public.sos_alerts(device_id);
CREATE INDEX idx_alerts_started ON public.sos_alerts(started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sos_alerts TO authenticated;
GRANT ALL ON public.sos_alerts TO service_role;
ALTER TABLE public.sos_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alerts all auth" ON public.sos_alerts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_alerts_updated BEFORE UPDATE ON public.sos_alerts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ GPS LOGS ============
CREATE TABLE public.gps_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID REFERENCES public.sos_alerts(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  speed DOUBLE PRECISION,
  heading DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gps_alert ON public.gps_logs(alert_id);
CREATE INDEX idx_gps_recorded ON public.gps_logs(recorded_at DESC);
GRANT SELECT, INSERT ON public.gps_logs TO authenticated;
GRANT ALL ON public.gps_logs TO service_role;
ALTER TABLE public.gps_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gps read auth" ON public.gps_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "gps insert auth" ON public.gps_logs FOR INSERT TO authenticated WITH CHECK (true);

-- ============ RESCUE OPERATIONS ============
CREATE TABLE public.rescue_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES public.sos_alerts(id) ON DELETE CASCADE,
  team_name TEXT,
  status public.alert_status NOT NULL DEFAULT 'assigned',
  notes TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ops_alert ON public.rescue_operations(alert_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rescue_operations TO authenticated;
GRANT ALL ON public.rescue_operations TO service_role;
ALTER TABLE public.rescue_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops all auth" ON public.rescue_operations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_ops_updated BEFORE UPDATE ON public.rescue_operations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ NOTIFICATIONS ============
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID REFERENCES public.sos_alerts(id) ON DELETE CASCADE,
  channel public.notification_channel NOT NULL,
  recipient TEXT,
  payload JSONB,
  status public.notification_status NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);
CREATE INDEX idx_notif_alert ON public.notifications(alert_id);
CREATE INDEX idx_notif_status ON public.notifications(status);
GRANT SELECT, INSERT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif all auth" ON public.notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============ AUTO-NOTIFICATION ON NEW ALERT ============
CREATE OR REPLACE FUNCTION public.create_initial_notifications()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fisherman public.fishermen%ROWTYPE;
  v_boat public.boats%ROWTYPE;
  v_payload JSONB;
BEGIN
  SELECT * INTO v_fisherman FROM public.fishermen WHERE id = NEW.fisherman_id;
  SELECT * INTO v_boat FROM public.boats WHERE id = NEW.boat_id;
  v_payload := jsonb_build_object(
    'alert_id', NEW.id,
    'fisherman_name', COALESCE(v_fisherman.full_name, 'Unknown'),
    'boat_name', COALESCE(v_boat.name, 'Unknown'),
    'started_at', NEW.started_at,
    'lat', NEW.last_lat,
    'lng', NEW.last_lng
  );
  INSERT INTO public.notifications (alert_id, channel, recipient, payload, status)
  VALUES
    (NEW.id, 'dashboard', NULL, v_payload, 'sent'),
    (NEW.id, 'sms', v_fisherman.emergency_contact_phone, v_payload, 'pending'),
    (NEW.id, 'email', v_fisherman.emergency_contact_name, v_payload, 'pending'),
    (NEW.id, 'whatsapp', v_fisherman.emergency_contact_phone, v_payload, 'pending');
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_alert_notifications
AFTER INSERT ON public.sos_alerts
FOR EACH ROW EXECUTE FUNCTION public.create_initial_notifications();

-- ============ REALTIME ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.sos_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.gps_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rescue_operations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
