CREATE TABLE daybook.publishers (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL REFERENCES daybook.agencies(id),name text NOT NULL,phone text NOT NULL,return_cutoff time NOT NULL,return_window_days integer NOT NULL CHECK(return_window_days BETWEEN 0 AND 31),active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,UNIQUE(agency_id,id)
);
CREATE TABLE daybook.supply_lots (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,publisher_id uuid NOT NULL,publication_id uuid NOT NULL,supply_date date NOT NULL,quantity integer NOT NULL CHECK(quantity>0),
 publication_name text NOT NULL,dispatch text NOT NULL,net_paise bigint NOT NULL CHECK(net_paise>=0),list_paise bigint,margin_bps integer,total_paise bigint NOT NULL CHECK(total_paise>=0),return_deadline timestamptz NOT NULL,
 UNIQUE(agency_id,id),FOREIGN KEY(agency_id,publisher_id) REFERENCES daybook.publishers(agency_id,id),FOREIGN KEY(agency_id,publication_id) REFERENCES daybook.publications(agency_id,id)
);
CREATE INDEX supply_lots_statement ON daybook.supply_lots(agency_id,publisher_id,supply_date);
CREATE TABLE daybook.supply_returns (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,supply_id uuid NOT NULL,quantity integer NOT NULL CHECK(quantity>0),reason text NOT NULL,credit_paise bigint NOT NULL CHECK(credit_paise>=0),recorded_date date NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agency_id,id),FOREIGN KEY(agency_id,supply_id) REFERENCES daybook.supply_lots(agency_id,id)
);
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['publishers','supply_lots','supply_returns'] LOOP
  EXECUTE format('ALTER TABLE daybook.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE daybook.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY tenant_scope ON daybook.%I TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency())',name);
  EXECUTE format('GRANT SELECT,INSERT ON daybook.%I TO daybook_app',name);
 END LOOP;
END $$;
GRANT UPDATE ON daybook.publishers TO daybook_app;
CREATE TABLE daybook.merchandise_items (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL REFERENCES daybook.agencies(id),name text NOT NULL,sku text NOT NULL,kind text NOT NULL CHECK(kind IN('CALENDAR','DIARY','FESTIVAL','OTHER')),price_paise bigint NOT NULL CHECK(price_paise>=0),on_hand integer NOT NULL DEFAULT 0,reserved integer NOT NULL DEFAULT 0,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,
 CHECK(on_hand>=0 AND reserved>=0 AND reserved<=on_hand),UNIQUE(agency_id,id),UNIQUE(agency_id,sku)
);
CREATE TABLE daybook.merchandise_receipts (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,item_id uuid NOT NULL,quantity integer NOT NULL CHECK(quantity>0),note text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(agency_id,id),FOREIGN KEY(agency_id,item_id) REFERENCES daybook.merchandise_items(agency_id,id)
);
CREATE TABLE daybook.merchandise_orders (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,resident_id uuid NOT NULL,item_id uuid NOT NULL,quantity integer NOT NULL CHECK(quantity>0),drop_date date NOT NULL,dispatch text NOT NULL CHECK(dispatch IN('MORNING','EVENING')),item_name text NOT NULL,unit_paise bigint NOT NULL CHECK(unit_paise>=0),total_paise bigint NOT NULL CHECK(total_paise>=0),settlement text NOT NULL CHECK(settlement IN('INVOICE','CASH')),status text NOT NULL CHECK(status IN('PREORDER','RESERVED','FULFILLED','CANCELLED')),version integer NOT NULL DEFAULT 1,fulfilled_at timestamptz,packing_snapshot jsonb,
 UNIQUE(agency_id,id),FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id),FOREIGN KEY(agency_id,item_id) REFERENCES daybook.merchandise_items(agency_id,id)
);
CREATE INDEX merchandise_orders_manifest ON daybook.merchandise_orders(agency_id,drop_date,status);
CREATE TABLE daybook.merchandise_charges (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,order_id uuid NOT NULL,resident_id uuid NOT NULL,amount_paise bigint NOT NULL CHECK(amount_paise>=0),settlement text NOT NULL CHECK(settlement IN('INVOICE','CASH')),receipt_code text,charge_date date NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agency_id,id),UNIQUE(agency_id,order_id),UNIQUE(agency_id,receipt_code),FOREIGN KEY(agency_id,order_id) REFERENCES daybook.merchandise_orders(agency_id,id),FOREIGN KEY(agency_id,resident_id) REFERENCES daybook.residents(agency_id,id)
);
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['merchandise_items','merchandise_receipts','merchandise_orders','merchandise_charges'] LOOP
  EXECUTE format('ALTER TABLE daybook.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE daybook.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY tenant_scope ON daybook.%I TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency())',name);
  EXECUTE format('GRANT SELECT,INSERT ON daybook.%I TO daybook_app',name);
 END LOOP;
END $$;
GRANT UPDATE ON daybook.merchandise_items,daybook.merchandise_orders TO daybook_app;
CREATE TABLE daybook.advertisers (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL REFERENCES daybook.agencies(id),name text NOT NULL,phone text NOT NULL,email text,billing_address text NOT NULL,active boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1,UNIQUE(agency_id,id)
);
CREATE TABLE daybook.insert_orders (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,advertiser_id uuid NOT NULL,title text NOT NULL,quantity integer NOT NULL CHECK(quantity>0),drop_date date NOT NULL,dispatch text NOT NULL CHECK(dispatch IN('MORNING','EVENING')),unit_paise bigint NOT NULL CHECK(unit_paise>=0),total_paise bigint NOT NULL CHECK(total_paise>=0),status text NOT NULL CHECK(status IN('SCHEDULED','COMPLETED','CANCELLED')),version integer NOT NULL DEFAULT 1,
 UNIQUE(agency_id,id),FOREIGN KEY(agency_id,advertiser_id) REFERENCES daybook.advertisers(agency_id,id)
);
CREATE TABLE daybook.insert_allocations (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,order_id uuid NOT NULL,route_id uuid NOT NULL,quantity integer NOT NULL CHECK(quantity>0),UNIQUE(agency_id,id),UNIQUE(agency_id,order_id,route_id),FOREIGN KEY(agency_id,order_id) REFERENCES daybook.insert_orders(agency_id,id),FOREIGN KEY(agency_id,route_id) REFERENCES daybook.routes(agency_id,id)
);
CREATE TABLE daybook.advertiser_invoices (
 id uuid PRIMARY KEY,agency_id uuid NOT NULL,order_id uuid NOT NULL,advertiser_id uuid NOT NULL,code text NOT NULL,advertiser_name text NOT NULL,billing_address text NOT NULL,subtotal_paise bigint NOT NULL CHECK(subtotal_paise>=0),tax_paise bigint NOT NULL CHECK(tax_paise>=0),total_paise bigint NOT NULL CHECK(total_paise=subtotal_paise+tax_paise),no_tax_confirmed boolean NOT NULL CHECK(no_tax_confirmed),packed_items jsonb NOT NULL,proof_reference text NOT NULL,issued_date date NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(agency_id,id),UNIQUE(agency_id,order_id),UNIQUE(agency_id,code),FOREIGN KEY(agency_id,order_id) REFERENCES daybook.insert_orders(agency_id,id),FOREIGN KEY(agency_id,advertiser_id) REFERENCES daybook.advertisers(agency_id,id)
);
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['advertisers','insert_orders','insert_allocations','advertiser_invoices'] LOOP
  EXECUTE format('ALTER TABLE daybook.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE daybook.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY tenant_scope ON daybook.%I TO daybook_app USING(agency_id=daybook.current_agency()) WITH CHECK(agency_id=daybook.current_agency())',name);
  EXECUTE format('GRANT SELECT,INSERT ON daybook.%I TO daybook_app',name);
 END LOOP;
END $$;
GRANT UPDATE ON daybook.advertisers,daybook.insert_orders TO daybook_app;
GRANT DELETE ON daybook.insert_allocations TO daybook_app;
