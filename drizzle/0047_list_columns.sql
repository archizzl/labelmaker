CREATE TABLE "list_columns" (
	"user_id" text NOT NULL,
	"org_id" text NOT NULL,
	"list_id" text NOT NULL,
	"hidden" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" text DEFAULT to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "list_columns" ADD CONSTRAINT "list_columns_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_columns" ADD CONSTRAINT "list_columns_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "list_columns_pk" ON "list_columns" USING btree ("user_id","org_id","list_id");