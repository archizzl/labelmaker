ALTER TABLE "plans" ADD COLUMN "band_id" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_band_id_bands_id_fk" FOREIGN KEY ("band_id") REFERENCES "public"."bands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plans_band" ON "plans" USING btree ("band_id");