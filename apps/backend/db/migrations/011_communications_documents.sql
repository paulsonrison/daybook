DO $$ BEGIN IF current_setting('server_encoding')<>'UTF8' THEN RAISE EXCEPTION 'A UTF8 database is required for supported resident names and languages';END IF;END $$;
ALTER TABLE daybook.notification_intents DROP CONSTRAINT notification_intents_status_check;
ALTER TABLE daybook.notification_intents ADD CONSTRAINT notification_intents_status_check CHECK(status IN('NOT_CONFIGURED','PENDING','CLAIMED','SUBMITTING','ACCEPTED','DELIVERED','READ','FAILED','UNKNOWN','CANCELLED','NO_CONSENT','MISSING_TEMPLATE','STALE','WAITING_DOCUMENT','NOT_DUE','SENT','UNRESOLVED','COOLDOWN','INVALID_RECIPIENT','UNKNOWN_CLOSED','OWNER_NOT_SENT','OWNER_ACCEPTED'));
ALTER TABLE daybook.notification_intents ADD COLUMN attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),ADD COLUMN lease_until timestamptz,ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),ADD COLUMN submitted_at timestamptz,ADD COLUMN provider_message_id text,ADD COLUMN last_error text;
ALTER TABLE daybook.notification_intents ADD CONSTRAINT notification_lease CHECK((status IN('CLAIMED','SUBMITTING'))=(lease_until IS NOT NULL));
CREATE UNIQUE INDEX notification_provider_identity ON daybook.notification_intents(agency_id,channel,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX notification_pending ON daybook.notification_intents(agency_id,next_attempt_at,created_at) WHERE status IN('PENDING','CLAIMED','SUBMITTING');
ALTER TABLE daybook.notification_intents ADD COLUMN accepted_at timestamptz;
ALTER TABLE daybook.notification_intents ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE daybook.notification_intents ADD COLUMN actor_kind text NOT NULL DEFAULT 'AGENT' CHECK(actor_kind IN('AGENT','SYSTEM'));
ALTER TABLE daybook.notification_intents ADD CONSTRAINT notification_actor CHECK((actor_kind='AGENT')=(created_by IS NOT NULL));
CREATE TABLE daybook.communication_evaluations (
 agency_id uuid NOT NULL REFERENCES daybook.agencies(id),evaluation_date date NOT NULL,after_resident_id uuid,completed boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(agency_id,evaluation_date)
);
ALTER TABLE daybook.communication_evaluations ENABLE ROW LEVEL SECURITY;ALTER TABLE daybook.communication_evaluations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON daybook.communication_evaluations TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency());
GRANT SELECT,INSERT ON daybook.communication_evaluations TO daybook_app;
GRANT UPDATE(after_resident_id,completed) ON daybook.communication_evaluations TO daybook_app;
GRANT UPDATE(accepted_at) ON daybook.notification_intents TO daybook_app;
CREATE TABLE daybook.notification_resolutions (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,intent_id uuid NOT NULL,request_id uuid NOT NULL,decision text NOT NULL CHECK(decision IN('CLOSE_UNKNOWN','CONFIRMED_NOT_SENT','CONFIRMED_ACCEPTED')),recipient_snapshot text NOT NULL,evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 1 AND 1000),provider_reference text,confirmed_by uuid NOT NULL,agent_name text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(agency_id,id),UNIQUE(agency_id,request_id),FOREIGN KEY(agency_id,intent_id) REFERENCES daybook.notification_intents(agency_id,id),FOREIGN KEY(agency_id,confirmed_by) REFERENCES daybook.agents(agency_id,id),CHECK((decision='CONFIRMED_ACCEPTED')=(provider_reference IS NOT NULL))
);
ALTER TABLE daybook.notification_resolutions ENABLE ROW LEVEL SECURITY;ALTER TABLE daybook.notification_resolutions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON daybook.notification_resolutions TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency());
GRANT SELECT,INSERT ON daybook.notification_resolutions TO daybook_app;
GRANT UPDATE(status,attempts,lease_until,next_attempt_at,submitted_at,provider_message_id,last_error) ON daybook.notification_intents TO daybook_app;
CREATE TABLE daybook.notification_events (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,intent_id uuid NOT NULL,event_key text NOT NULL CHECK(length(event_key) BETWEEN 1 AND 128),provider_status text NOT NULL CHECK(provider_status IN('ACCEPTED','FAILED','DELIVERED','READ')),applied boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(agency_id,intent_id,event_key),FOREIGN KEY(agency_id,intent_id) REFERENCES daybook.notification_intents(agency_id,id)
);
ALTER TABLE daybook.notification_events ENABLE ROW LEVEL SECURITY;ALTER TABLE daybook.notification_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON daybook.notification_events TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency());
GRANT SELECT,INSERT ON daybook.notification_events TO daybook_app;
CREATE TABLE daybook.notification_inbox (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL REFERENCES daybook.agencies(id),channel text NOT NULL CHECK(channel IN('SMS','WHATSAPP')),message_id text NOT NULL CHECK(length(message_id) BETWEEN 1 AND 255),event_key text NOT NULL CHECK(length(event_key) BETWEEN 1 AND 128),provider_status text NOT NULL CHECK(provider_status IN('ACCEPTED','FAILED','DELIVERED','READ')),processed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(agency_id,channel,message_id,event_key)
);
ALTER TABLE daybook.notification_inbox ENABLE ROW LEVEL SECURITY;ALTER TABLE daybook.notification_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON daybook.notification_inbox TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency());
GRANT SELECT,INSERT ON daybook.notification_inbox TO daybook_app;GRANT UPDATE(processed_at) ON daybook.notification_inbox TO daybook_app;
CREATE TABLE daybook.communication_settings (
 agency_id uuid PRIMARY KEY REFERENCES daybook.agencies(id),reminders_enabled boolean NOT NULL DEFAULT false,frequency_days integer NOT NULL DEFAULT 7 CHECK(frequency_days BETWEEN 1 AND 365),cooldown_hours integer NOT NULL DEFAULT 24 CHECK(cooldown_hours BETWEEN 1 AND 720),reminder_channel text NOT NULL DEFAULT 'WHATSAPP' CHECK(reminder_channel IN('WHATSAPP','SMS')),templates jsonb NOT NULL DEFAULT '[]',version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE TABLE daybook.contact_preferences (
 agency_id uuid NOT NULL,resident_id uuid NOT NULL,locale text NOT NULL CHECK(locale IN('en','ml','hi')),whatsapp boolean NOT NULL DEFAULT false,sms boolean NOT NULL DEFAULT false,phone_snapshot text NOT NULL,consent_evidence text NOT NULL CHECK(length(btrim(consent_evidence))>0),confirmed_by uuid NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),version integer NOT NULL DEFAULT 1 CHECK(version>0),PRIMARY KEY(agency_id,resident_id),FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id),FOREIGN KEY(agency_id,confirmed_by) REFERENCES daybook.agents(agency_id,id)
);
CREATE TABLE daybook.contact_attempts (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,resident_id uuid NOT NULL,request_id uuid NOT NULL,channel text NOT NULL CHECK(channel IN('CALL','WHATSAPP')),phone_snapshot text NOT NULL,outcome text NOT NULL DEFAULT 'ATTEMPTED' CHECK(outcome='ATTEMPTED'),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(agency_id,id),UNIQUE(agency_id,request_id),FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id)
);
DO $$ DECLARE name text;BEGIN FOREACH name IN ARRAY ARRAY['communication_settings','contact_preferences','contact_attempts'] LOOP
 EXECUTE format('ALTER TABLE daybook.%I ENABLE ROW LEVEL SECURITY',name);EXECUTE format('ALTER TABLE daybook.%I FORCE ROW LEVEL SECURITY',name);EXECUTE format('CREATE POLICY tenant_scope ON daybook.%I TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency())',name);EXECUTE format('GRANT SELECT,INSERT ON daybook.%I TO daybook_app',name);END LOOP;END $$;
GRANT UPDATE ON daybook.communication_settings,daybook.contact_preferences TO daybook_app;
CREATE TABLE daybook.documents (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('INVOICE','PAYMENT_RECEIPT','PAYSLIP','CLEARANCE_REFUND')),source_id uuid NOT NULL,source_version integer NOT NULL CHECK(source_version>0),resident_id uuid,staff_id uuid,locale text NOT NULL CHECK(locale IN('en','ml','hi')),snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),snapshot_hash text NOT NULL CHECK(snapshot_hash ~ '^[a-f0-9]{64}$'),filename text NOT NULL CHECK(filename ~ '^[A-Za-z0-9._-]{1,150}\.pdf$'),status text NOT NULL DEFAULT 'PREPARED' CHECK(status IN('PREPARED','GENERATING','READY','FAILED')),attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),lease_until timestamptz,pdf bytea,sha256 text,byte_length integer GENERATED ALWAYS AS(octet_length(pdf)) STORED,last_error text,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agency_id,id),FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id),FOREIGN KEY(agency_id,staff_id) REFERENCES daybook.staff(agency_id,id),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id),CHECK((status='GENERATING')=(lease_until IS NOT NULL)),CHECK((status='READY')=(pdf IS NOT NULL AND sha256 IS NOT NULL)),CHECK(pdf IS NULL OR octet_length(pdf) BETWEEN 100 AND 10485760),CHECK(sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),CHECK((kind='PAYSLIP')=(staff_id IS NOT NULL)),CHECK((kind<>'PAYSLIP')=(resident_id IS NOT NULL))
);
ALTER TABLE daybook.documents ENABLE ROW LEVEL SECURITY;ALTER TABLE daybook.documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON daybook.documents TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency());
GRANT SELECT,INSERT,UPDATE ON daybook.documents TO daybook_app;
CREATE FUNCTION daybook.guard_document_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ BEGIN
 IF OLD.status='READY' OR (NEW.id,NEW.agency_id,NEW.kind,NEW.source_id,NEW.source_version,NEW.resident_id,NEW.staff_id,NEW.locale,NEW.snapshot,NEW.snapshot_hash,NEW.filename,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.agency_id,OLD.kind,OLD.source_id,OLD.source_version,OLD.resident_id,OLD.staff_id,OLD.locale,OLD.snapshot,OLD.snapshot_hash,OLD.filename,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Document identity and snapshots are immutable' USING ERRCODE='23514';END IF;
 IF NEW.status='GENERATING' THEN IF NOT(OLD.status IN('PREPARED','FAILED') OR (OLD.status='GENERATING' AND OLD.lease_until<=now())) OR NEW.attempts<>OLD.attempts+1 OR NEW.lease_until<=now() THEN RAISE EXCEPTION 'Invalid document generation claim' USING ERRCODE='23514';END IF;
 ELSIF NEW.status IN('READY','FAILED') THEN IF OLD.status<>'GENERATING' OR NEW.attempts<>OLD.attempts THEN RAISE EXCEPTION 'Invalid document generation result' USING ERRCODE='23514';END IF;
 ELSE RAISE EXCEPTION 'Invalid document transition' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER document_finality BEFORE UPDATE ON daybook.documents FOR EACH ROW EXECUTE FUNCTION daybook.guard_document_update();
CREATE TABLE daybook.document_links (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,document_id uuid NOT NULL,request_id uuid NOT NULL,token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),expires_at timestamptz NOT NULL,revoked_at timestamptz,revoked_by uuid,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agency_id,id),UNIQUE(agency_id,request_id),UNIQUE(agency_id,token_hash),FOREIGN KEY(agency_id,document_id) REFERENCES daybook.documents(agency_id,id),FOREIGN KEY(agency_id,created_by) REFERENCES daybook.agents(agency_id,id),FOREIGN KEY(agency_id,revoked_by) REFERENCES daybook.agents(agency_id,id),CHECK(expires_at>created_at AND expires_at<=created_at+interval '720 hours'),CHECK((revoked_at IS NULL)=(revoked_by IS NULL))
);
ALTER TABLE daybook.document_links ENABLE ROW LEVEL SECURITY;ALTER TABLE daybook.document_links FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON daybook.document_links TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency());
ALTER TABLE daybook.documents DROP CONSTRAINT documents_kind_check;
ALTER TABLE daybook.documents ADD CONSTRAINT documents_kind_check CHECK(kind IN('INVOICE','PAYMENT_RECEIPT','PAYSLIP','CLEARANCE_REFUND','ACCOUNT_NOTICE'));
ALTER TABLE daybook.documents ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE daybook.documents ADD COLUMN actor_kind text NOT NULL DEFAULT 'AGENT' CHECK(actor_kind IN('AGENT','SYSTEM'));
ALTER TABLE daybook.documents ADD CONSTRAINT documents_actor CHECK((actor_kind='AGENT')=(created_by IS NOT NULL));
ALTER TABLE daybook.document_links ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE daybook.document_links ADD COLUMN actor_kind text NOT NULL DEFAULT 'AGENT' CHECK(actor_kind IN('AGENT','SYSTEM'));
ALTER TABLE daybook.document_links ADD CONSTRAINT document_links_actor CHECK((actor_kind='AGENT')=(created_by IS NOT NULL));
GRANT SELECT,INSERT ON daybook.document_links TO daybook_app;GRANT UPDATE(revoked_at,revoked_by) ON daybook.document_links TO daybook_app;
CREATE FUNCTION daybook.guard_document_link_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,daybook AS $$ BEGIN IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revoked_by IS NULL OR (NEW.id,NEW.agency_id,NEW.document_id,NEW.request_id,NEW.token_hash,NEW.expires_at,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.agency_id,OLD.document_id,OLD.request_id,OLD.token_hash,OLD.expires_at,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'Document links can only be revoked once' USING ERRCODE='23514';END IF;RETURN NEW;END $$;
CREATE TRIGGER document_link_finality BEFORE UPDATE ON daybook.document_links FOR EACH ROW EXECUTE FUNCTION daybook.guard_document_link_update();
