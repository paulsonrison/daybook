CREATE TABLE daybook.territories (
  id uuid PRIMARY KEY, agency_id uuid NOT NULL REFERENCES daybook.agencies(id),
  name text NOT NULL, locality text NOT NULL, locality_key text NOT NULL,
  pin_codes text[] NOT NULL, sectors text[] NOT NULL, sector_keys text[] NOT NULL,
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(agency_id,id)
);
CREATE TABLE daybook.staff (
  id uuid PRIMARY KEY, agency_id uuid NOT NULL REFERENCES daybook.agencies(id),
  name text NOT NULL, staff_code text NOT NULL, phone text NOT NULL,
  status text NOT NULL CHECK(status IN ('ACTIVE','ON_LEAVE','INACTIVE')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(agency_id,id), UNIQUE(agency_id,staff_code)
);
CREATE TABLE daybook.routes (
  id uuid PRIMARY KEY, agency_id uuid NOT NULL REFERENCES daybook.agencies(id),
  code text NOT NULL, name text NOT NULL, territory_id uuid NOT NULL, staff_id uuid,
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK(version>0),
  FOREIGN KEY(agency_id,territory_id) REFERENCES daybook.territories(agency_id,id),
  FOREIGN KEY(agency_id,staff_id) REFERENCES daybook.staff(agency_id,id),
  UNIQUE(agency_id,id), UNIQUE(agency_id,code)
);
CREATE TABLE daybook.route_stops (
  id uuid PRIMARY KEY, agency_id uuid NOT NULL, route_id uuid NOT NULL,
  label text NOT NULL, door text NOT NULL, sequence integer NOT NULL CHECK(sequence>0),
  FOREIGN KEY(agency_id,route_id) REFERENCES daybook.routes(agency_id,id),
  UNIQUE(agency_id,id), UNIQUE(agency_id,route_id,id),
  UNIQUE(agency_id,route_id,sequence) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX routes_staff ON daybook.routes(agency_id,staff_id);
CREATE INDEX route_stops_sequence ON daybook.route_stops(agency_id,route_id,sequence);
CREATE TABLE daybook.audit_events (
  id uuid PRIMARY KEY, agency_id uuid NOT NULL, actor_id uuid NOT NULL,
  entity_type text NOT NULL, entity_id uuid NOT NULL, action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(agency_id,actor_id) REFERENCES daybook.agents(agency_id,id)
);
CREATE INDEX audit_events_agency_time ON daybook.audit_events(agency_id,created_at DESC);
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['territories','staff','routes','route_stops','audit_events'] LOOP
    EXECUTE format('ALTER TABLE daybook.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('ALTER TABLE daybook.%I FORCE ROW LEVEL SECURITY',name);
    EXECUTE format('CREATE POLICY tenant_scope ON daybook.%I TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency())',name);
    EXECUTE format('GRANT SELECT,INSERT ON daybook.%I TO daybook_app',name);
    IF name <> 'audit_events' THEN EXECUTE format('GRANT UPDATE,DELETE ON daybook.%I TO daybook_app',name); END IF;
  END LOOP;
END $$;
