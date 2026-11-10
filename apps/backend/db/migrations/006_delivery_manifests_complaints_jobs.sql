CREATE TABLE daybook.press_holidays (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,publication_id uuid NOT NULL,issue_date date NOT NULL,reason text NOT NULL,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,
 UNIQUE(agency_id,id),UNIQUE(agency_id,publication_id,issue_date),FOREIGN KEY(agency_id,publication_id) REFERENCES daybook.publications(agency_id,id)
);
CREATE TABLE daybook.substitute_assignments (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,route_id uuid NOT NULL,start_date date NOT NULL,end_date date NOT NULL,reason text NOT NULL,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,
 CHECK(end_date>=start_date),UNIQUE(agency_id,id),FOREIGN KEY(agency_id,route_id) REFERENCES daybook.routes(agency_id,id)
);
CREATE TABLE daybook.substitute_allocations (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,assignment_id uuid NOT NULL,staff_id uuid NOT NULL,from_drop integer NOT NULL CHECK(from_drop>0),to_drop integer NOT NULL CHECK(to_drop>=from_drop AND to_drop<=99999),
 UNIQUE(agency_id,id),FOREIGN KEY(agency_id,assignment_id) REFERENCES daybook.substitute_assignments(agency_id,id),FOREIGN KEY(agency_id,staff_id) REFERENCES daybook.staff(agency_id,id)
);
CREATE TABLE daybook.delivery_logs (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,subscription_id uuid NOT NULL,resident_id uuid NOT NULL,publication_id uuid NOT NULL,route_id uuid NOT NULL,staff_id uuid,
 permanent_staff_id uuid,permanent_staff_name text,
 delivery_date date NOT NULL,dispatch text NOT NULL CHECK(dispatch IN('MORNING','EVENING')),drop_order integer NOT NULL,
 resident_name text NOT NULL,address text NOT NULL,publication_name text NOT NULL,route_name text NOT NULL,staff_name text,
 quantity integer NOT NULL CHECK(quantity>0),price_paise bigint NOT NULL CHECK(price_paise>=0),price_rule_id uuid,
 status text NOT NULL CHECK(status IN('DELIVERED','MISSED','DAMAGED','REPLACED','CREDITED','SKIPPED')),
 source text NOT NULL CHECK(source IN('AUTO','AGENT','COMPLAINT')),reason text,chargeable_quantity integer NOT NULL CHECK(chargeable_quantity>=0 AND chargeable_quantity<=quantity),version integer NOT NULL DEFAULT 1,
 UNIQUE(agency_id,id),UNIQUE(agency_id,subscription_id,delivery_date),
 FOREIGN KEY(agency_id,subscription_id) REFERENCES daybook.subscriptions(agency_id,id),FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id),
 FOREIGN KEY(agency_id,publication_id) REFERENCES daybook.publications(agency_id,id),FOREIGN KEY(agency_id,route_id) REFERENCES daybook.routes(agency_id,id),FOREIGN KEY(agency_id,staff_id) REFERENCES daybook.staff(agency_id,id),FOREIGN KEY(agency_id,permanent_staff_id) REFERENCES daybook.staff(agency_id,id),FOREIGN KEY(agency_id,price_rule_id) REFERENCES daybook.price_rules(agency_id,id)
);
CREATE INDEX delivery_logs_date ON daybook.delivery_logs(agency_id,delivery_date,route_id,drop_order);
CREATE TABLE daybook.delivery_days(agency_id uuid NOT NULL REFERENCES daybook.agencies(id),delivery_date date NOT NULL,marked_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(agency_id,delivery_date));
CREATE TABLE daybook.manifests (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,manifest_date date NOT NULL,dispatch text NOT NULL,payload jsonb NOT NULL,version integer NOT NULL DEFAULT 1,generated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agency_id,id),UNIQUE(agency_id,manifest_date,dispatch)
);
CREATE TABLE daybook.complaints (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,delivery_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('MISSED','DAMAGED','LATE')),note text NOT NULL,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','REPLACEMENT','CREDIT','UNSUBSTANTIATED')),resolution_note text,
 replacement_copies integer NOT NULL DEFAULT 0,credit_paise bigint NOT NULL DEFAULT 0 CHECK(credit_paise>=0),satisfaction_rating smallint CHECK(satisfaction_rating BETWEEN 1 AND 5),version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz,
 UNIQUE(agency_id,id),FOREIGN KEY(agency_id,delivery_id) REFERENCES daybook.delivery_logs(agency_id,id)
);
CREATE UNIQUE INDEX complaint_benefit_once ON daybook.complaints(agency_id,delivery_id,status) WHERE status IN('REPLACEMENT','CREDIT');
CREATE TABLE daybook.mutation_requests (
 agency_id uuid NOT NULL REFERENCES daybook.agencies(id),request_id uuid NOT NULL,operation text NOT NULL,fingerprint text NOT NULL,result jsonb NOT NULL,
 PRIMARY KEY(agency_id,request_id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE daybook.job_runs (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL REFERENCES daybook.agencies(id),job_key text NOT NULL,kind text NOT NULL,run_date date NOT NULL,
 status text NOT NULL CHECK(status IN('PENDING','RUNNING','SUCCEEDED','FAILED')),attempts integer NOT NULL DEFAULT 0,lease_until timestamptz,available_at timestamptz NOT NULL DEFAULT now(),last_error text,completed_at timestamptz,
 UNIQUE(agency_id,id),UNIQUE(agency_id,job_key)
);
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['press_holidays','substitute_assignments','substitute_allocations','delivery_logs','delivery_days','manifests','complaints','mutation_requests','job_runs'] LOOP
  EXECUTE format('ALTER TABLE daybook.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE daybook.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY tenant_scope ON daybook.%I TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency())',name);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON daybook.%I TO daybook_app',name);
 END LOOP;
END $$;
GRANT DELETE ON daybook.substitute_allocations TO daybook_app;
REVOKE UPDATE ON daybook.mutation_requests FROM daybook_app;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='daybook_scheduler') THEN CREATE ROLE daybook_scheduler NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION; END IF; END $$;
GRANT USAGE ON SCHEMA daybook TO daybook_scheduler;
GRANT SELECT(id,timezone,created_at) ON daybook.agencies TO daybook_scheduler;
CREATE POLICY scheduler_metadata ON daybook.agencies FOR SELECT TO daybook_scheduler USING(true);
CREATE FUNCTION daybook.worker_tenants() RETURNS TABLE(id uuid,timezone text,created_at timestamptz) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,daybook AS $$ SELECT id,timezone,created_at FROM daybook.agencies ORDER BY id $$;
ALTER FUNCTION daybook.worker_tenants() OWNER TO daybook_scheduler;
REVOKE ALL ON FUNCTION daybook.worker_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION daybook.worker_tenants() TO daybook_app;
