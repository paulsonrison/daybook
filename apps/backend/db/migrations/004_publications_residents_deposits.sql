CREATE TABLE daybook.agency_counters (
 agency_id uuid NOT NULL REFERENCES daybook.agencies(id), name text NOT NULL,
 value bigint NOT NULL CHECK(value>0), PRIMARY KEY(agency_id,name)
);
CREATE TABLE daybook.publications (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL REFERENCES daybook.agencies(id),
 name text NOT NULL,edition text NOT NULL,name_key text NOT NULL,edition_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('NEWSPAPER','MAGAZINE','PERIODICAL','SUPPLEMENT')),
 language text NOT NULL,dispatch text NOT NULL CHECK(dispatch IN ('MORNING','EVENING')),
 frequency text NOT NULL CHECK(frequency IN ('DAILY','WEEKLY','FORTNIGHTLY','MONTHLY','YEARLY')),
 publishing_days smallint[] NOT NULL CHECK(cardinality(publishing_days)>0 AND publishing_days<@ARRAY[0,1,2,3,4,5,6]::smallint[]),
 anchor_date date, weekday_paise bigint NOT NULL CHECK(weekday_paise>=0),weekend_paise bigint NOT NULL CHECK(weekend_paise>=0),
 procurement_net_paise bigint CHECK(procurement_net_paise>=0),
 active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 UNIQUE(agency_id,id),UNIQUE(agency_id,name_key,edition_key,language,dispatch)
);
CREATE TABLE daybook.residents (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL REFERENCES daybook.agencies(id),code text NOT NULL,
 name text NOT NULL,address text NOT NULL,phone text NOT NULL,sector text NOT NULL,route_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','SUSPENDED','CLOSED')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),creation_request_id uuid NOT NULL,creation_fingerprint text NOT NULL,
 FOREIGN KEY(agency_id,route_id) REFERENCES daybook.routes(agency_id,id),
 UNIQUE(agency_id,id),UNIQUE(agency_id,route_id,id),UNIQUE(agency_id,code),UNIQUE(agency_id,creation_request_id)
);
CREATE INDEX residents_route_status ON daybook.residents(agency_id,route_id,status);
ALTER TABLE daybook.route_stops ADD COLUMN resident_id uuid;
ALTER TABLE daybook.route_stops ADD CONSTRAINT route_stop_resident_link FOREIGN KEY(agency_id,route_id,resident_id)
 REFERENCES daybook.residents(agency_id,route_id,id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE daybook.route_stops ADD CONSTRAINT one_stop_per_resident UNIQUE(agency_id,resident_id);
CREATE TABLE daybook.deposit_entries (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,resident_id uuid NOT NULL,
 request_id uuid NOT NULL,fingerprint text NOT NULL,receipt_code text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('RECEIVED','REFUNDED','OFFSET')),
 amount_paise bigint NOT NULL CHECK(amount_paise>0),balance_after_paise bigint NOT NULL CHECK(balance_after_paise>=0),
 actor_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id),
 FOREIGN KEY(agency_id,actor_id) REFERENCES daybook.agents(agency_id,id),
 UNIQUE(agency_id,id),UNIQUE(agency_id,request_id),UNIQUE(agency_id,receipt_code)
);
CREATE INDEX deposit_entries_resident ON daybook.deposit_entries(agency_id,resident_id,created_at);
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['agency_counters','publications','residents','deposit_entries'] LOOP
  EXECUTE format('ALTER TABLE daybook.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE daybook.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY tenant_scope ON daybook.%I TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency())',name);
  EXECUTE format('GRANT SELECT,INSERT ON daybook.%I TO daybook_app',name);
  IF name<>'deposit_entries' THEN EXECUTE format('GRANT UPDATE ON daybook.%I TO daybook_app',name);END IF;
 END LOOP;
END $$;
