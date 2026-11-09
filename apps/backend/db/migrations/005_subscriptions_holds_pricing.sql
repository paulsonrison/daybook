CREATE TABLE daybook.subscriptions (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,resident_id uuid NOT NULL,publication_id uuid NOT NULL,
 cadence text NOT NULL CHECK(cadence IN('DAILY','WEEKDAYS','SUNDAY','ONCE','WEEKLY','FORTNIGHTLY','MONTHLY','YEARLY')),
 start_date date NOT NULL,end_date date,weekdays smallint[] NOT NULL DEFAULT '{}',
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
 status text NOT NULL CHECK(status IN('ACTIVE','PAUSED','CANCELLED')),version integer NOT NULL DEFAULT 1,
 creation_request_id uuid NOT NULL,creation_fingerprint text NOT NULL,UNIQUE(agency_id,creation_request_id),
 CHECK(end_date IS NULL OR end_date>=start_date),UNIQUE(agency_id,id),UNIQUE(agency_id,resident_id,id),
 FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id),
 FOREIGN KEY(agency_id,publication_id) REFERENCES daybook.publications(agency_id,id)
);
CREATE INDEX subscriptions_resident ON daybook.subscriptions(agency_id,resident_id,status);
CREATE TABLE daybook.holds (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,resident_id uuid NOT NULL,subscription_id uuid,
 start_date date NOT NULL,resume_date date,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,
 CHECK(resume_date IS NULL OR resume_date>start_date),UNIQUE(agency_id,id),
 FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id),
 FOREIGN KEY(agency_id,resident_id,subscription_id) REFERENCES daybook.subscriptions(agency_id,resident_id,id)
);
CREATE INDEX holds_resident ON daybook.holds(agency_id,resident_id,start_date);
CREATE TABLE daybook.price_rules (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,publication_id uuid NOT NULL,
 start_date date NOT NULL,end_date date,weekdays smallint[] NOT NULL DEFAULT '{}',
 price_paise bigint NOT NULL CHECK(price_paise>=0),active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,
 CHECK(end_date IS NULL OR end_date>=start_date),UNIQUE(agency_id,id),
 FOREIGN KEY(agency_id,publication_id) REFERENCES daybook.publications(agency_id,id)
);
CREATE INDEX price_rules_publication ON daybook.price_rules(agency_id,publication_id,start_date);
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['subscriptions','holds','price_rules'] LOOP
  EXECUTE format('ALTER TABLE daybook.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE daybook.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY tenant_scope ON daybook.%I TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency())',name);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON daybook.%I TO daybook_app',name);
 END LOOP;
END $$;
