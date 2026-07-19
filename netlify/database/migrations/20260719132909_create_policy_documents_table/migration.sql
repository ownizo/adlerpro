CREATE TABLE "policy_documents" (
	"id" text PRIMARY KEY,
	"policy_id" text NOT NULL,
	"company_id" text,
	"individual_client_id" text,
	"uploaded_by_user_id" text NOT NULL,
	"blob_key" text NOT NULL UNIQUE,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "policy_documents_policy_id_idx" ON "policy_documents" ("policy_id");