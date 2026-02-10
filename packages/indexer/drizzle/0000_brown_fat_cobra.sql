CREATE TABLE IF NOT EXISTS "agent_comms" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_comms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"topic_id" text NOT NULL,
	"from_agent" text NOT NULL,
	"to_agent" text,
	"text" text NOT NULL,
	"timestamp" text NOT NULL,
	"consensus_timestamp" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "agent_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"agent_id" text NOT NULL,
	"event_type" text NOT NULL,
	"session_key" text,
	"transaction_id" text,
	"transaction_type" text,
	"action" jsonb,
	"reasoning" text,
	"details" text,
	"previous_hash" text,
	"timestamp" bigint NOT NULL,
	"consensus_timestamp" text NOT NULL,
	"raw_data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agents" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"agent_name" text NOT NULL,
	"platform" text NOT NULL,
	"version" text,
	"operating_account" text,
	"first_seen_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hcs_messages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hcs_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"topic_id" text NOT NULL,
	"consensus_timestamp" text NOT NULL,
	"sequence_number" bigint NOT NULL,
	"payer_account_id" text,
	"message_base64" text NOT NULL,
	"decoded_json" jsonb,
	"message_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rentals" (
	"rental_id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"renter" text,
	"escrow_account" text,
	"stake_usd" numeric(10, 2),
	"buffer_usd" numeric(10, 2),
	"total_cost_usd" numeric(10, 2),
	"settlement" jsonb,
	"status" text DEFAULT 'initiated' NOT NULL,
	"initiated_at" bigint,
	"completed_at" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sync_cursors" (
	"topic_id" text PRIMARY KEY NOT NULL,
	"last_timestamp" text NOT NULL,
	"last_sequence_number" bigint,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_comms_from_agent_idx" ON "agent_comms" USING btree ("from_agent");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_comms_to_agent_idx" ON "agent_comms" USING btree ("to_agent");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_comms_timestamp_idx" ON "agent_comms" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_comms_topic_idx" ON "agent_comms" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_agent_id_idx" ON "agent_events" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_event_type_idx" ON "agent_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_timestamp_idx" ON "agent_events" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_consensus_timestamp_idx" ON "agent_events" USING btree ("consensus_timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_events_hash_idx" ON "agent_events" USING btree ("previous_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_platform_idx" ON "agents" USING btree ("platform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_last_seen_idx" ON "agents" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hcs_messages_topic_timestamp_idx" ON "hcs_messages" USING btree ("topic_id","consensus_timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hcs_messages_type_idx" ON "hcs_messages" USING btree ("message_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hcs_messages_timestamp_idx" ON "hcs_messages" USING btree ("consensus_timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rentals_agent_id_idx" ON "rentals" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rentals_renter_idx" ON "rentals" USING btree ("renter");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rentals_status_idx" ON "rentals" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rentals_initiated_at_idx" ON "rentals" USING btree ("initiated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sync_cursors_updated_at_idx" ON "sync_cursors" USING btree ("updated_at");