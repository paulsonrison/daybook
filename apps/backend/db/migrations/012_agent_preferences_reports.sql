CREATE TABLE daybook.agent_preferences (
 agency_id uuid NOT NULL,agent_id uuid NOT NULL,locale text NOT NULL CHECK(locale IN('en','ml','hi')),mode text NOT NULL CHECK(mode IN('light','dark','system')),
 scheme text NOT NULL CHECK(scheme IN('default','dynamic','catppuccin','greenApple','lavender','midnightDusk','nord','strawberryDaiquiri','tako','teal','tidalWave','yinYang','yotsuba','tokyoNight','monochrome')),layout text NOT NULL CHECK(layout IN('TABLE','CARDS','ROUTE')),
 font_family text NOT NULL CHECK(font_family IN('inter','manrope','nunito','lora')),font_size integer NOT NULL CHECK(font_size BETWEEN 12 AND 24),font_weight integer NOT NULL CHECK(font_weight IN(400,500,600,700)),font_style text NOT NULL CHECK(font_style IN('normal','italic')),line_height numeric(3,2) NOT NULL CHECK(line_height IN(1.25,1.45,1.6)),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(agency_id,agent_id),FOREIGN KEY(agency_id,agent_id) REFERENCES daybook.agents(agency_id,id)
);
ALTER TABLE daybook.agent_preferences ENABLE ROW LEVEL SECURITY;ALTER TABLE daybook.agent_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_scope ON daybook.agent_preferences TO daybook_app USING(agency_id=daybook.current_agency() AND agent_id=nullif(current_setting('app.agent_id',true),'')::uuid) WITH CHECK(agency_id=daybook.current_agency() AND agent_id=nullif(current_setting('app.agent_id',true),'')::uuid);
GRANT SELECT,INSERT ON daybook.agent_preferences TO daybook_app;
GRANT UPDATE(locale,mode,scheme,layout,font_family,font_size,font_weight,font_style,line_height,version,updated_at) ON daybook.agent_preferences TO daybook_app;
