
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "account_group_members": {
                  Row: {
                    "group_id": string,"organization_id": string,"social_account_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "group_id": string,"organization_id": string,"social_account_id": string
                  }
                  Update: {
                    "group_id"?: string,"organization_id"?: string,"social_account_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "account_group_members_group_id_fkey"
      columns: ["group_id"]
isOneToOne: false
      referencedRelation: "account_groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "account_group_members_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "account_group_members_social_account_id_fkey"
      columns: ["social_account_id"]
isOneToOne: false
      referencedRelation: "social_accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"account_groups": {
                  Row: {
                    "created_at": string,"id": string,"kind": string,"name": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"kind"?: string,"name": string,"organization_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"kind"?: string,"name"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "account_groups_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"account_metric_snapshots": {
                  Row: {
                    "availability": Database["public"]['Enums']["metric_availability"],"captured_at": string,"created_at": string,"data_source": Database["public"]['Enums']["data_source"],"id": number,"import_batch_id": string | null,"metric_date": string,"metric_key": string,"organization_id": string,"period": Database["public"]['Enums']["metric_period"],"social_account_id": string,"source_metric": string,"sync_run_id": string | null,"value": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "availability": Database["public"]['Enums']["metric_availability"],"captured_at": string,"created_at"?: string,"data_source": Database["public"]['Enums']["data_source"],"id"?: never,"import_batch_id"?: string | null,"metric_date": string,"metric_key": string,"organization_id": string,"period": Database["public"]['Enums']["metric_period"],"social_account_id": string,"source_metric": string,"sync_run_id"?: string | null,"value"?: number | null
                  }
                  Update: {
                    "availability"?: Database["public"]['Enums']["metric_availability"],"captured_at"?: string,"created_at"?: string,"data_source"?: Database["public"]['Enums']["data_source"],"id"?: never,"import_batch_id"?: string | null,"metric_date"?: string,"metric_key"?: string,"organization_id"?: string,"period"?: Database["public"]['Enums']["metric_period"],"social_account_id"?: string,"source_metric"?: string,"sync_run_id"?: string | null,"value"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "account_metric_snapshots_import_batch_id_organization_id_fkey"
      columns: ["import_batch_id","organization_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "account_metric_snapshots_metric_key_fkey"
      columns: ["metric_key"]
isOneToOne: false
      referencedRelation: "metric_definitions"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "account_metric_snapshots_social_account_id_organization_id_fkey"
      columns: ["social_account_id","organization_id"]
isOneToOne: false
      referencedRelation: "social_accounts"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "account_metric_snapshots_sync_run_id_fkey"
      columns: ["sync_run_id"]
isOneToOne: false
      referencedRelation: "sync_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"activity_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"changes": Json | null,"created_at": string,"entity_id": string,"entity_type": string,"id": number,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"changes"?: Json | null,"created_at"?: string,"entity_id": string,"entity_type": string,"id"?: never,"organization_id": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"changes"?: Json | null,"created_at"?: string,"entity_id"?: string,"entity_type"?: string,"id"?: never,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_log_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "activity_log_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_generations": {
                  Row: {
                    "created_at": string,"duration_ms": number | null,"error": string | null,"id": string,"input": NonNullable<Json>,"input_tokens": number | null,"model": string,"organization_id": string,"output": Json | null,"output_tokens": number | null,"prompt_version": string,"provider": string,"purpose": string,"run_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"duration_ms"?: number | null,"error"?: string | null,"id"?: string,"input": NonNullable<Json>,"input_tokens"?: number | null,"model": string,"organization_id": string,"output"?: Json | null,"output_tokens"?: number | null,"prompt_version": string,"provider": string,"purpose": string,"run_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"duration_ms"?: number | null,"error"?: string | null,"id"?: string,"input"?: NonNullable<Json>,"input_tokens"?: number | null,"model"?: string,"organization_id"?: string,"output"?: Json | null,"output_tokens"?: number | null,"prompt_version"?: string,"provider"?: string,"purpose"?: string,"run_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_generations_run_id_organization_id_fkey"
      columns: ["run_id","organization_id"]
isOneToOne: false
      referencedRelation: "analysis_runs"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"ai_insights": {
                  Row: {
                    "account_ids": (string)[],"body": string,"created_at": string,"evidence": NonNullable<Json>,"id": string,"kind": string,"organization_id": string,"position": number,"run_id": string,"severity": Database["public"]['Enums']["insight_severity"],"signal_ids": (string)[],"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_ids"?: (string)[],"body": string,"created_at"?: string,"evidence": NonNullable<Json>,"id"?: string,"kind": string,"organization_id": string,"position"?: number,"run_id": string,"severity"?: Database["public"]['Enums']["insight_severity"],"signal_ids": (string)[],"title": string
                  }
                  Update: {
                    "account_ids"?: (string)[],"body"?: string,"created_at"?: string,"evidence"?: NonNullable<Json>,"id"?: string,"kind"?: string,"organization_id"?: string,"position"?: number,"run_id"?: string,"severity"?: Database["public"]['Enums']["insight_severity"],"signal_ids"?: (string)[],"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_insights_run_id_organization_id_fkey"
      columns: ["run_id","organization_id"]
isOneToOne: false
      referencedRelation: "analysis_runs"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"ai_recommendations": {
                  Row: {
                    "account_ids": (string)[],"confidence": Database["public"]['Enums']["recommendation_confidence"],"confidence_basis": string,"created_at": string,"evidence": NonNullable<Json>,"expected_impact": string,"experiment": Json | null,"id": string,"insight_id": string | null,"observation": string,"organization_id": string,"position": number,"recommendation": string,"run_id": string,"signal_ids": (string)[],"status": Database["public"]['Enums']["recommendation_status"],"status_changed_at": string | null,"status_changed_by": string | null,"status_note": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_ids"?: (string)[],"confidence": Database["public"]['Enums']["recommendation_confidence"],"confidence_basis": string,"created_at"?: string,"evidence": NonNullable<Json>,"expected_impact": string,"experiment"?: Json | null,"id"?: string,"insight_id"?: string | null,"observation": string,"organization_id": string,"position"?: number,"recommendation": string,"run_id": string,"signal_ids": (string)[],"status"?: Database["public"]['Enums']["recommendation_status"],"status_changed_at"?: string | null,"status_changed_by"?: string | null,"status_note"?: string | null,"title": string
                  }
                  Update: {
                    "account_ids"?: (string)[],"confidence"?: Database["public"]['Enums']["recommendation_confidence"],"confidence_basis"?: string,"created_at"?: string,"evidence"?: NonNullable<Json>,"expected_impact"?: string,"experiment"?: Json | null,"id"?: string,"insight_id"?: string | null,"observation"?: string,"organization_id"?: string,"position"?: number,"recommendation"?: string,"run_id"?: string,"signal_ids"?: (string)[],"status"?: Database["public"]['Enums']["recommendation_status"],"status_changed_at"?: string | null,"status_changed_by"?: string | null,"status_note"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_recommendations_insight_id_organization_id_fkey"
      columns: ["insight_id","organization_id"]
isOneToOne: false
      referencedRelation: "ai_insights"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "ai_recommendations_run_id_organization_id_fkey"
      columns: ["run_id","organization_id"]
isOneToOne: false
      referencedRelation: "analysis_runs"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "ai_recommendations_status_changed_by_fkey"
      columns: ["status_changed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"analysis_runs": {
                  Row: {
                    "created_at": string,"created_by": string | null,"data_source": Database["public"]['Enums']["data_source"],"error": string | null,"id": string,"model": string | null,"organization_id": string,"period_end": string,"period_start": string,"prompt_version": string | null,"provider": string | null,"rejected": NonNullable<Json>,"signals": NonNullable<Json>,"status": Database["public"]['Enums']["analysis_run_status"],"writer": Database["public"]['Enums']["analysis_writer"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"data_source": Database["public"]['Enums']["data_source"],"error"?: string | null,"id"?: string,"model"?: string | null,"organization_id": string,"period_end": string,"period_start": string,"prompt_version"?: string | null,"provider"?: string | null,"rejected"?: NonNullable<Json>,"signals"?: NonNullable<Json>,"status": Database["public"]['Enums']["analysis_run_status"],"writer": Database["public"]['Enums']["analysis_writer"]
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"data_source"?: Database["public"]['Enums']["data_source"],"error"?: string | null,"id"?: string,"model"?: string | null,"organization_id"?: string,"period_end"?: string,"period_start"?: string,"prompt_version"?: string | null,"provider"?: string | null,"rejected"?: NonNullable<Json>,"signals"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["analysis_run_status"],"writer"?: Database["public"]['Enums']["analysis_writer"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "analysis_runs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "analysis_runs_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"audiences": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"is_active": boolean,"name": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audiences_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"campaigns": {
                  Row: {
                    "created_at": string,"description": string | null,"ends_on": string | null,"id": string,"is_active": boolean,"name": string,"organization_id": string,"starts_on": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"ends_on"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string,"starts_on"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"ends_on"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string,"starts_on"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaigns_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"connection_assets": {
                  Row: {
                    "account_type": string | null,"connection_id": string,"discovered_at": string,"external_id": string,"handle": string | null,"id": string,"linked_account_id": string | null,"name": string | null,"organization_id": string,"parent_external_id": string | null,"platform_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_type"?: string | null,"connection_id": string,"discovered_at"?: string,"external_id": string,"handle"?: string | null,"id"?: string,"linked_account_id"?: string | null,"name"?: string | null,"organization_id": string,"parent_external_id"?: string | null,"platform_key": string
                  }
                  Update: {
                    "account_type"?: string | null,"connection_id"?: string,"discovered_at"?: string,"external_id"?: string,"handle"?: string | null,"id"?: string,"linked_account_id"?: string | null,"name"?: string | null,"organization_id"?: string,"parent_external_id"?: string | null,"platform_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "connection_assets_connection_id_organization_id_fkey"
      columns: ["connection_id","organization_id"]
isOneToOne: false
      referencedRelation: "platform_connections"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "connection_assets_linked_account_id_fkey"
      columns: ["linked_account_id"]
isOneToOne: false
      referencedRelation: "social_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "connection_assets_platform_key_fkey"
      columns: ["platform_key"]
isOneToOne: false
      referencedRelation: "platforms"
      referencedColumns: ["key"]
    }
                  ]
                },"connection_credentials": {
                  Row: {
                    "asset_external_id": string | null,"ciphertext": string,"connection_id": string,"expires_at": string | null,"id": string,"key_version": number,"organization_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "asset_external_id"?: string | null,"ciphertext": string,"connection_id": string,"expires_at"?: string | null,"id"?: string,"key_version": number,"organization_id": string,"updated_at"?: string
                  }
                  Update: {
                    "asset_external_id"?: string | null,"ciphertext"?: string,"connection_id"?: string,"expires_at"?: string | null,"id"?: string,"key_version"?: number,"organization_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "connection_credentials_connection_id_organization_id_fkey"
      columns: ["connection_id","organization_id"]
isOneToOne: false
      referencedRelation: "platform_connections"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"content_assets": {
                  Row: {
                    "bytes": number,"content_item_id": string,"content_version_id": string,"created_at": string,"created_by": string | null,"file_name": string,"height": number | null,"id": string,"mime_type": string,"organization_id": string,"position": number,"storage_path": string,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "bytes": number,"content_item_id": string,"content_version_id": string,"created_at"?: string,"created_by"?: string | null,"file_name": string,"height"?: number | null,"id"?: string,"mime_type": string,"organization_id": string,"position"?: number,"storage_path": string,"width"?: number | null
                  }
                  Update: {
                    "bytes"?: number,"content_item_id"?: string,"content_version_id"?: string,"created_at"?: string,"created_by"?: string | null,"file_name"?: string,"height"?: number | null,"id"?: string,"mime_type"?: string,"organization_id"?: string,"position"?: number,"storage_path"?: string,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_assets_content_item_id_organization_id_fkey"
      columns: ["content_item_id","organization_id"]
isOneToOne: false
      referencedRelation: "content_items"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "content_assets_content_version_id_organization_id_fkey"
      columns: ["content_version_id","organization_id"]
isOneToOne: false
      referencedRelation: "content_versions"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "content_assets_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"content_comments": {
                  Row: {
                    "author_id": string | null,"body": string,"content_item_id": string,"content_version_id": string | null,"created_at": string,"edited_at": string | null,"id": string,"mentions": (string)[],"organization_id": string,"parent_id": string | null,"resolved_at": string | null,"resolved_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"body": string,"content_item_id": string,"content_version_id"?: string | null,"created_at"?: string,"edited_at"?: string | null,"id"?: string,"mentions"?: (string)[],"organization_id": string,"parent_id"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"content_item_id"?: string,"content_version_id"?: string | null,"created_at"?: string,"edited_at"?: string | null,"id"?: string,"mentions"?: (string)[],"organization_id"?: string,"parent_id"?: string | null,"resolved_at"?: string | null,"resolved_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_comments_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_comments_content_item_id_organization_id_fkey"
      columns: ["content_item_id","organization_id"]
isOneToOne: false
      referencedRelation: "content_items"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "content_comments_content_version_id_fkey"
      columns: ["content_version_id"]
isOneToOne: false
      referencedRelation: "content_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_comments_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_comments_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "content_comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_comments_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"content_events": {
                  Row: {
                    "actor_id": string | null,"content_item_id": string,"content_version_id": string | null,"created_at": string,"from_status": Database["public"]['Enums']["content_status"] | null,"id": string,"note": string | null,"organization_id": string,"to_status": Database["public"]['Enums']["content_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"content_item_id": string,"content_version_id"?: string | null,"created_at"?: string,"from_status"?: Database["public"]['Enums']["content_status"] | null,"id"?: string,"note"?: string | null,"organization_id": string,"to_status": Database["public"]['Enums']["content_status"]
                  }
                  Update: {
                    "actor_id"?: string | null,"content_item_id"?: string,"content_version_id"?: string | null,"created_at"?: string,"from_status"?: Database["public"]['Enums']["content_status"] | null,"id"?: string,"note"?: string | null,"organization_id"?: string,"to_status"?: Database["public"]['Enums']["content_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_events_content_item_id_organization_id_fkey"
      columns: ["content_item_id","organization_id"]
isOneToOne: false
      referencedRelation: "content_items"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "content_events_content_version_id_fkey"
      columns: ["content_version_id"]
isOneToOne: false
      referencedRelation: "content_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_events_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"content_formats": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"is_active": boolean,"name": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_formats_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"content_items": {
                  Row: {
                    "audience_id": string | null,"campaign_id": string | null,"content_format_id": string | null,"country_code": string | null,"created_at": string,"created_by": string | null,"cta_type_id": string | null,"current_version_id": string | null,"id": string,"organization_id": string,"owner_user_id": string | null,"pillar_id": string | null,"planned_publish_at": string | null,"platform_keys": (string)[],"published_at": string | null,"published_post_id": string | null,"source_recommendation_id": string | null,"status": Database["public"]['Enums']["content_status"],"strategy_objective_id": string | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience_id"?: string | null,"campaign_id"?: string | null,"content_format_id"?: string | null,"country_code"?: string | null,"created_at"?: string,"created_by"?: string | null,"cta_type_id"?: string | null,"current_version_id"?: string | null,"id"?: string,"organization_id": string,"owner_user_id"?: string | null,"pillar_id"?: string | null,"planned_publish_at"?: string | null,"platform_keys"?: (string)[],"published_at"?: string | null,"published_post_id"?: string | null,"source_recommendation_id"?: string | null,"status"?: Database["public"]['Enums']["content_status"],"strategy_objective_id"?: string | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "audience_id"?: string | null,"campaign_id"?: string | null,"content_format_id"?: string | null,"country_code"?: string | null,"created_at"?: string,"created_by"?: string | null,"cta_type_id"?: string | null,"current_version_id"?: string | null,"id"?: string,"organization_id"?: string,"owner_user_id"?: string | null,"pillar_id"?: string | null,"planned_publish_at"?: string | null,"platform_keys"?: (string)[],"published_at"?: string | null,"published_post_id"?: string | null,"source_recommendation_id"?: string | null,"status"?: Database["public"]['Enums']["content_status"],"strategy_objective_id"?: string | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_items_audience_id_organization_id_fkey"
      columns: ["audience_id","organization_id"]
isOneToOne: false
      referencedRelation: "audiences"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "content_items_campaign_id_organization_id_fkey"
      columns: ["campaign_id","organization_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "content_items_content_format_id_organization_id_fkey"
      columns: ["content_format_id","organization_id"]
isOneToOne: false
      referencedRelation: "content_formats"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "content_items_country_code_fkey"
      columns: ["country_code"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "content_items_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_items_cta_type_id_organization_id_fkey"
      columns: ["cta_type_id","organization_id"]
isOneToOne: false
      referencedRelation: "cta_types"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "content_items_current_version_fk"
      columns: ["current_version_id"]
isOneToOne: false
      referencedRelation: "content_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_items_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_items_owner_user_id_fkey"
      columns: ["owner_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_items_pillar_id_organization_id_fkey"
      columns: ["pillar_id","organization_id"]
isOneToOne: false
      referencedRelation: "content_pillars"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "content_items_published_post_id_organization_id_fkey"
      columns: ["published_post_id","organization_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "content_items_source_recommendation_id_organization_id_fkey"
      columns: ["source_recommendation_id","organization_id"]
isOneToOne: false
      referencedRelation: "ai_recommendations"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "content_items_strategy_objective_id_organization_id_fkey"
      columns: ["strategy_objective_id","organization_id"]
isOneToOne: false
      referencedRelation: "strategy_objectives"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"content_pillars": {
                  Row: {
                    "color": string | null,"created_at": string,"description": string | null,"id": string,"is_active": boolean,"name": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string
                  }
                  Update: {
                    "color"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_pillars_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"content_reviews": {
                  Row: {
                    "comment": string | null,"content_item_id": string,"content_version_id": string,"created_at": string,"decision": Database["public"]['Enums']["review_decision"],"id": string,"organization_id": string,"reviewer_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "comment"?: string | null,"content_item_id": string,"content_version_id": string,"created_at"?: string,"decision": Database["public"]['Enums']["review_decision"],"id"?: string,"organization_id": string,"reviewer_id"?: string | null
                  }
                  Update: {
                    "comment"?: string | null,"content_item_id"?: string,"content_version_id"?: string,"created_at"?: string,"decision"?: Database["public"]['Enums']["review_decision"],"id"?: string,"organization_id"?: string,"reviewer_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_reviews_content_item_id_organization_id_fkey"
      columns: ["content_item_id","organization_id"]
isOneToOne: false
      referencedRelation: "content_items"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "content_reviews_content_version_id_fkey"
      columns: ["content_version_id"]
isOneToOne: false
      referencedRelation: "content_versions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_reviews_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_reviews_reviewer_id_fkey"
      columns: ["reviewer_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"content_versions": {
                  Row: {
                    "caption": string | null,"content_item_id": string,"created_at": string,"created_by": string | null,"cta": string | null,"description": string | null,"hashtags": (string)[],"id": string,"notes": string | null,"organization_id": string,"submitted_at": string | null,"submitted_by": string | null,"updated_at": string,"version_number": number
                  }
                  ComputedFields: never
                  Insert: {
                    "caption"?: string | null,"content_item_id": string,"created_at"?: string,"created_by"?: string | null,"cta"?: string | null,"description"?: string | null,"hashtags"?: (string)[],"id"?: string,"notes"?: string | null,"organization_id": string,"submitted_at"?: string | null,"submitted_by"?: string | null,"updated_at"?: string,"version_number": number
                  }
                  Update: {
                    "caption"?: string | null,"content_item_id"?: string,"created_at"?: string,"created_by"?: string | null,"cta"?: string | null,"description"?: string | null,"hashtags"?: (string)[],"id"?: string,"notes"?: string | null,"organization_id"?: string,"submitted_at"?: string | null,"submitted_by"?: string | null,"updated_at"?: string,"version_number"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "content_versions_content_item_id_organization_id_fkey"
      columns: ["content_item_id","organization_id"]
isOneToOne: false
      referencedRelation: "content_items"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "content_versions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "content_versions_submitted_by_fkey"
      columns: ["submitted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"countries": {
                  Row: {
                    "code": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"name": string
                  }
                  Update: {
                    "code"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"cta_types": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"is_active": boolean,"name": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"organization_id": string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cta_types_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"import_batches": {
                  Row: {
                    "completed_at": string | null,"created_at": string,"created_by": string | null,"errors": NonNullable<Json>,"file_name": string,"id": string,"kind": Database["public"]['Enums']["import_kind"],"organization_id": string,"platform_key": string,"rows_imported": number,"rows_skipped": number,"rows_total": number,"social_account_id": string,"status": Database["public"]['Enums']["import_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"errors"?: NonNullable<Json>,"file_name": string,"id"?: string,"kind": Database["public"]['Enums']["import_kind"],"organization_id": string,"platform_key": string,"rows_imported"?: number,"rows_skipped"?: number,"rows_total"?: number,"social_account_id": string,"status"?: Database["public"]['Enums']["import_status"]
                  }
                  Update: {
                    "completed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"errors"?: NonNullable<Json>,"file_name"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["import_kind"],"organization_id"?: string,"platform_key"?: string,"rows_imported"?: number,"rows_skipped"?: number,"rows_total"?: number,"social_account_id"?: string,"status"?: Database["public"]['Enums']["import_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_batches_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_batches_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_batches_social_account_id_organization_id_platform__fkey"
      columns: ["social_account_id","organization_id","platform_key"]
isOneToOne: false
      referencedRelation: "social_accounts"
      referencedColumns: ["id","organization_id","platform_key"]
    }
                  ]
                },"metric_definitions": {
                  Row: {
                    "aggregation": Database["public"]['Enums']["metric_aggregation"],"applies_to_accounts": boolean,"applies_to_posts": boolean,"definition": string,"formula": string | null,"higher_is_better": boolean,"inputs": (string)[],"is_derived": boolean,"key": string,"label": string,"sort_order": number,"unit": Database["public"]['Enums']["metric_unit"]
                  }
                  ComputedFields: never
                  Insert: {
                    "aggregation": Database["public"]['Enums']["metric_aggregation"],"applies_to_accounts": boolean,"applies_to_posts": boolean,"definition": string,"formula"?: string | null,"higher_is_better": boolean,"inputs"?: (string)[],"is_derived"?: boolean,"key": string,"label": string,"sort_order": number,"unit": Database["public"]['Enums']["metric_unit"]
                  }
                  Update: {
                    "aggregation"?: Database["public"]['Enums']["metric_aggregation"],"applies_to_accounts"?: boolean,"applies_to_posts"?: boolean,"definition"?: string,"formula"?: string | null,"higher_is_better"?: boolean,"inputs"?: (string)[],"is_derived"?: boolean,"key"?: string,"label"?: string,"sort_order"?: number,"unit"?: Database["public"]['Enums']["metric_unit"]
                  }
                  Relationships: [
                    
                  ]
                },"notifications": {
                  Row: {
                    "actor_id": string | null,"content_item_id": string | null,"created_at": string,"excerpt": string | null,"id": string,"kind": string,"organization_id": string,"read_at": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"content_item_id"?: string | null,"created_at"?: string,"excerpt"?: string | null,"id"?: string,"kind": string,"organization_id": string,"read_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "actor_id"?: string | null,"content_item_id"?: string | null,"created_at"?: string,"excerpt"?: string | null,"id"?: string,"kind"?: string,"organization_id"?: string,"read_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_content_item_id_organization_id_fkey"
      columns: ["content_item_id","organization_id"]
isOneToOne: false
      referencedRelation: "content_items"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "notifications_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"organization_members": {
                  Row: {
                    "created_at": string,"organization_id": string,"role": Database["public"]['Enums']["org_role"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"organization_id": string,"role": Database["public"]['Enums']["org_role"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"organization_id"?: string,"role"?: Database["public"]['Enums']["org_role"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_members_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "created_at": string,"created_by": string | null,"default_timezone": string,"id": string,"is_demo": boolean,"name": string,"slug": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"default_timezone"?: string,"id"?: string,"is_demo"?: boolean,"name": string,"slug": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"default_timezone"?: string,"id"?: string,"is_demo"?: boolean,"name"?: string,"slug"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organizations_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"permissions": {
                  Row: {
                    "description": string,"key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "description": string,"key": string
                  }
                  Update: {
                    "description"?: string,"key"?: string
                  }
                  Relationships: [
                    
                  ]
                },"platform_account_types": {
                  Row: {
                    "key": string,"label": string,"platform_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"label": string,"platform_key": string
                  }
                  Update: {
                    "key"?: string,"label"?: string,"platform_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "platform_account_types_platform_key_fkey"
      columns: ["platform_key"]
isOneToOne: false
      referencedRelation: "platforms"
      referencedColumns: ["key"]
    }
                  ]
                },"platform_connections": {
                  Row: {
                    "connected_by": string | null,"created_at": string,"display_name": string | null,"external_user_id": string,"id": string,"last_error": string | null,"last_refreshed_at": string | null,"organization_id": string,"provider": string,"scopes": (string)[],"status": Database["public"]['Enums']["connection_status"],"token_expires_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "connected_by"?: string | null,"created_at"?: string,"display_name"?: string | null,"external_user_id": string,"id"?: string,"last_error"?: string | null,"last_refreshed_at"?: string | null,"organization_id": string,"provider": string,"scopes"?: (string)[],"status"?: Database["public"]['Enums']["connection_status"],"token_expires_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "connected_by"?: string | null,"created_at"?: string,"display_name"?: string | null,"external_user_id"?: string,"id"?: string,"last_error"?: string | null,"last_refreshed_at"?: string | null,"organization_id"?: string,"provider"?: string,"scopes"?: (string)[],"status"?: Database["public"]['Enums']["connection_status"],"token_expires_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "platform_connections_connected_by_fkey"
      columns: ["connected_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "platform_connections_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"platform_metric_map": {
                  Row: {
                    "api_version": string | null,"comparability_class": string,"metric_key": string,"notes": string | null,"platform_key": string,"scope": Database["public"]['Enums']["metric_scope"],"source_metric": string,"value_transform": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "api_version"?: string | null,"comparability_class": string,"metric_key": string,"notes"?: string | null,"platform_key": string,"scope": Database["public"]['Enums']["metric_scope"],"source_metric": string,"value_transform"?: string | null
                  }
                  Update: {
                    "api_version"?: string | null,"comparability_class"?: string,"metric_key"?: string,"notes"?: string | null,"platform_key"?: string,"scope"?: Database["public"]['Enums']["metric_scope"],"source_metric"?: string,"value_transform"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "platform_metric_map_metric_key_fkey"
      columns: ["metric_key"]
isOneToOne: false
      referencedRelation: "metric_definitions"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "platform_metric_map_platform_key_fkey"
      columns: ["platform_key"]
isOneToOne: false
      referencedRelation: "platforms"
      referencedColumns: ["key"]
    }
                  ]
                },"platforms": {
                  Row: {
                    "key": string,"name": string,"private_data_status": Database["public"]['Enums']["platform_data_status"],"public_data_status": Database["public"]['Enums']["platform_data_status"],"reporting_timezone": string | null,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"name": string,"private_data_status"?: Database["public"]['Enums']["platform_data_status"],"public_data_status"?: Database["public"]['Enums']["platform_data_status"],"reporting_timezone"?: string | null,"sort_order"?: number
                  }
                  Update: {
                    "key"?: string,"name"?: string,"private_data_status"?: Database["public"]['Enums']["platform_data_status"],"public_data_status"?: Database["public"]['Enums']["platform_data_status"],"reporting_timezone"?: string | null,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"post_audiences": {
                  Row: {
                    "audience_id": string,"organization_id": string,"post_id": string,"source": Database["public"]['Enums']["tag_source"]
                  }
                  ComputedFields: never
                  Insert: {
                    "audience_id": string,"organization_id": string,"post_id": string,"source"?: Database["public"]['Enums']["tag_source"]
                  }
                  Update: {
                    "audience_id"?: string,"organization_id"?: string,"post_id"?: string,"source"?: Database["public"]['Enums']["tag_source"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "post_audiences_audience_id_organization_id_fkey"
      columns: ["audience_id","organization_id"]
isOneToOne: false
      referencedRelation: "audiences"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "post_audiences_post_id_organization_id_fkey"
      columns: ["post_id","organization_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"post_media": {
                  Row: {
                    "duration_seconds": number | null,"external_id": string | null,"height": number | null,"id": string,"media_type": string,"organization_id": string,"position": number,"post_id": string,"width": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "duration_seconds"?: number | null,"external_id"?: string | null,"height"?: number | null,"id"?: string,"media_type": string,"organization_id": string,"position": number,"post_id": string,"width"?: number | null
                  }
                  Update: {
                    "duration_seconds"?: number | null,"external_id"?: string | null,"height"?: number | null,"id"?: string,"media_type"?: string,"organization_id"?: string,"position"?: number,"post_id"?: string,"width"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "post_media_post_id_organization_id_fkey"
      columns: ["post_id","organization_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"post_metric_snapshots": {
                  Row: {
                    "availability": Database["public"]['Enums']["metric_availability"],"captured_at": string,"created_at": string,"data_source": Database["public"]['Enums']["data_source"],"id": number,"import_batch_id": string | null,"metric_date": string | null,"metric_key": string,"organization_id": string,"period": Database["public"]['Enums']["metric_period"],"post_age_hours": number,"post_id": string,"source_metric": string,"sync_run_id": string | null,"value": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "availability": Database["public"]['Enums']["metric_availability"],"captured_at": string,"created_at"?: string,"data_source": Database["public"]['Enums']["data_source"],"id"?: never,"import_batch_id"?: string | null,"metric_date"?: string | null,"metric_key": string,"organization_id": string,"period"?: Database["public"]['Enums']["metric_period"],"post_age_hours": number,"post_id": string,"source_metric": string,"sync_run_id"?: string | null,"value"?: number | null
                  }
                  Update: {
                    "availability"?: Database["public"]['Enums']["metric_availability"],"captured_at"?: string,"created_at"?: string,"data_source"?: Database["public"]['Enums']["data_source"],"id"?: never,"import_batch_id"?: string | null,"metric_date"?: string | null,"metric_key"?: string,"organization_id"?: string,"period"?: Database["public"]['Enums']["metric_period"],"post_age_hours"?: number,"post_id"?: string,"source_metric"?: string,"sync_run_id"?: string | null,"value"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "post_metric_snapshots_import_batch_id_organization_id_fkey"
      columns: ["import_batch_id","organization_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "post_metric_snapshots_metric_key_fkey"
      columns: ["metric_key"]
isOneToOne: false
      referencedRelation: "metric_definitions"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "post_metric_snapshots_post_id_organization_id_fkey"
      columns: ["post_id","organization_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "post_metric_snapshots_sync_run_id_fkey"
      columns: ["sync_run_id"]
isOneToOne: false
      referencedRelation: "sync_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"posts": {
                  Row: {
                    "campaign_id": string | null,"campaign_source": Database["public"]['Enums']["tag_source"] | null,"caption": string | null,"caption_updated_at": string | null,"content_format_id": string | null,"content_format_source": Database["public"]['Enums']["tag_source"] | null,"country_code": string | null,"created_at": string,"cta_source": Database["public"]['Enums']["tag_source"] | null,"cta_text": string | null,"cta_type_id": string | null,"data_source": Database["public"]['Enums']["data_source"],"external_id": string,"first_fetched_at": string,"hashtags": (string)[],"id": string,"import_batch_id": string | null,"is_paid": boolean | null,"is_shared_post": boolean,"language": string | null,"language_source": Database["public"]['Enums']["language_source"] | null,"last_fetched_at": string,"last_metrics_at": string | null,"media_format": Database["public"]['Enums']["media_format"],"native_type": string | null,"organization_id": string,"permalink": string | null,"pillar_id": string | null,"pillar_source": Database["public"]['Enums']["tag_source"] | null,"platform_key": string,"published_at": string,"published_local_date": string,"removed_at": string | null,"social_account_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "campaign_id"?: string | null,"campaign_source"?: Database["public"]['Enums']["tag_source"] | null,"caption"?: string | null,"caption_updated_at"?: string | null,"content_format_id"?: string | null,"content_format_source"?: Database["public"]['Enums']["tag_source"] | null,"country_code"?: string | null,"created_at"?: string,"cta_source"?: Database["public"]['Enums']["tag_source"] | null,"cta_text"?: string | null,"cta_type_id"?: string | null,"data_source": Database["public"]['Enums']["data_source"],"external_id": string,"first_fetched_at"?: string,"hashtags"?: (string)[],"id"?: string,"import_batch_id"?: string | null,"is_paid"?: boolean | null,"is_shared_post"?: boolean,"language"?: string | null,"language_source"?: Database["public"]['Enums']["language_source"] | null,"last_fetched_at"?: string,"last_metrics_at"?: string | null,"media_format"?: Database["public"]['Enums']["media_format"],"native_type"?: string | null,"organization_id": string,"permalink"?: string | null,"pillar_id"?: string | null,"pillar_source"?: Database["public"]['Enums']["tag_source"] | null,"platform_key": string,"published_at": string,"published_local_date": string,"removed_at"?: string | null,"social_account_id": string,"updated_at"?: string
                  }
                  Update: {
                    "campaign_id"?: string | null,"campaign_source"?: Database["public"]['Enums']["tag_source"] | null,"caption"?: string | null,"caption_updated_at"?: string | null,"content_format_id"?: string | null,"content_format_source"?: Database["public"]['Enums']["tag_source"] | null,"country_code"?: string | null,"created_at"?: string,"cta_source"?: Database["public"]['Enums']["tag_source"] | null,"cta_text"?: string | null,"cta_type_id"?: string | null,"data_source"?: Database["public"]['Enums']["data_source"],"external_id"?: string,"first_fetched_at"?: string,"hashtags"?: (string)[],"id"?: string,"import_batch_id"?: string | null,"is_paid"?: boolean | null,"is_shared_post"?: boolean,"language"?: string | null,"language_source"?: Database["public"]['Enums']["language_source"] | null,"last_fetched_at"?: string,"last_metrics_at"?: string | null,"media_format"?: Database["public"]['Enums']["media_format"],"native_type"?: string | null,"organization_id"?: string,"permalink"?: string | null,"pillar_id"?: string | null,"pillar_source"?: Database["public"]['Enums']["tag_source"] | null,"platform_key"?: string,"published_at"?: string,"published_local_date"?: string,"removed_at"?: string | null,"social_account_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "posts_campaign_id_organization_id_fkey"
      columns: ["campaign_id","organization_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "posts_content_format_id_organization_id_fkey"
      columns: ["content_format_id","organization_id"]
isOneToOne: false
      referencedRelation: "content_formats"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "posts_country_code_fkey"
      columns: ["country_code"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "posts_cta_type_id_organization_id_fkey"
      columns: ["cta_type_id","organization_id"]
isOneToOne: false
      referencedRelation: "cta_types"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "posts_import_batch_id_organization_id_fkey"
      columns: ["import_batch_id","organization_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "posts_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "posts_pillar_id_organization_id_fkey"
      columns: ["pillar_id","organization_id"]
isOneToOne: false
      referencedRelation: "content_pillars"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "posts_social_account_id_organization_id_platform_key_fkey"
      columns: ["social_account_id","organization_id","platform_key"]
isOneToOne: false
      referencedRelation: "social_accounts"
      referencedColumns: ["id","organization_id","platform_key"]
    }
                  ]
                },"profile_snapshots": {
                  Row: {
                    "account_type": string | null,"biography": string | null,"data_source": Database["public"]['Enums']["data_source"],"display_name": string | null,"id": number,"observed_at": string,"organization_id": string,"profile_picture_url": string | null,"social_account_id": string,"sync_run_id": string | null,"username": string | null,"website": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "account_type"?: string | null,"biography"?: string | null,"data_source": Database["public"]['Enums']["data_source"],"display_name"?: string | null,"id"?: never,"observed_at": string,"organization_id": string,"profile_picture_url"?: string | null,"social_account_id": string,"sync_run_id"?: string | null,"username"?: string | null,"website"?: string | null
                  }
                  Update: {
                    "account_type"?: string | null,"biography"?: string | null,"data_source"?: Database["public"]['Enums']["data_source"],"display_name"?: string | null,"id"?: never,"observed_at"?: string,"organization_id"?: string,"profile_picture_url"?: string | null,"social_account_id"?: string,"sync_run_id"?: string | null,"username"?: string | null,"website"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "profile_snapshots_social_account_id_organization_id_fkey"
      columns: ["social_account_id","organization_id"]
isOneToOne: false
      referencedRelation: "social_accounts"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "profile_snapshots_sync_run_id_fkey"
      columns: ["sync_run_id"]
isOneToOne: false
      referencedRelation: "sync_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"email": string,"full_name": string | null,"id": string,"timezone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"email": string,"full_name"?: string | null,"id": string,"timezone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"full_name"?: string | null,"id"?: string,"timezone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"public_data_viewers": {
                  Row: {
                    "connection_asset_id": string,"created_at": string,"created_by": string | null,"id": string,"organization_id": string,"platform_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "connection_asset_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"organization_id": string,"platform_key": string
                  }
                  Update: {
                    "connection_asset_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"organization_id"?: string,"platform_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "public_data_viewers_connection_asset_id_fkey"
      columns: ["connection_asset_id"]
isOneToOne: false
      referencedRelation: "connection_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "public_data_viewers_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "public_data_viewers_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "public_data_viewers_platform_key_fkey"
      columns: ["platform_key"]
isOneToOne: false
      referencedRelation: "platforms"
      referencedColumns: ["key"]
    }
                  ]
                },"public_profile_lookups": {
                  Row: {
                    "id": number,"looked_up_at": string,"organization_id": string,"platform_key": string,"requested_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: never,"looked_up_at"?: string,"organization_id": string,"platform_key": string,"requested_by"?: string | null
                  }
                  Update: {
                    "id"?: never,"looked_up_at"?: string,"organization_id"?: string,"platform_key"?: string,"requested_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "public_profile_lookups_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "public_profile_lookups_platform_key_fkey"
      columns: ["platform_key"]
isOneToOne: false
      referencedRelation: "platforms"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "public_profile_lookups_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"raw_payloads": {
                  Row: {
                    "captured_at": string,"endpoint": string,"id": number,"organization_id": string,"payload": NonNullable<Json>,"sync_run_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "captured_at"?: string,"endpoint": string,"id"?: never,"organization_id": string,"payload": NonNullable<Json>,"sync_run_id"?: string | null
                  }
                  Update: {
                    "captured_at"?: string,"endpoint"?: string,"id"?: never,"organization_id"?: string,"payload"?: NonNullable<Json>,"sync_run_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "raw_payloads_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "raw_payloads_sync_run_id_fkey"
      columns: ["sync_run_id"]
isOneToOne: false
      referencedRelation: "sync_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"role_permissions": {
                  Row: {
                    "permission_key": string,"role": Database["public"]['Enums']["org_role"]
                  }
                  ComputedFields: never
                  Insert: {
                    "permission_key": string,"role": Database["public"]['Enums']["org_role"]
                  }
                  Update: {
                    "permission_key"?: string,"role"?: Database["public"]['Enums']["org_role"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "role_permissions_permission_key_fkey"
      columns: ["permission_key"]
isOneToOne: false
      referencedRelation: "permissions"
      referencedColumns: ["key"]
    }
                  ]
                },"social_accounts": {
                  Row: {
                    "access_type": Database["public"]['Enums']["profile_access_type"],"account_type": string | null,"business_role": Database["public"]['Enums']["business_role"],"connection_id": string | null,"connection_status": Database["public"]['Enums']["account_connection_status"],"country_code": string | null,"created_at": string,"created_by": string | null,"display_name": string,"earliest_post_at": string | null,"external_id": string | null,"first_observed_at": string | null,"handle": string | null,"history_available_from": string | null,"id": string,"is_active": boolean,"language": string | null,"last_observed_at": string | null,"last_successful_sync_at": string | null,"last_sync_attempt_at": string | null,"notes": string | null,"organization_id": string,"owner_user_id": string | null,"platform_key": string,"timezone": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_type"?: Database["public"]['Enums']["profile_access_type"],"account_type"?: string | null,"business_role"?: Database["public"]['Enums']["business_role"],"connection_id"?: string | null,"connection_status"?: Database["public"]['Enums']["account_connection_status"],"country_code"?: string | null,"created_at"?: string,"created_by"?: string | null,"display_name": string,"earliest_post_at"?: string | null,"external_id"?: string | null,"first_observed_at"?: string | null,"handle"?: string | null,"history_available_from"?: string | null,"id"?: string,"is_active"?: boolean,"language"?: string | null,"last_observed_at"?: string | null,"last_successful_sync_at"?: string | null,"last_sync_attempt_at"?: string | null,"notes"?: string | null,"organization_id": string,"owner_user_id"?: string | null,"platform_key": string,"timezone"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "access_type"?: Database["public"]['Enums']["profile_access_type"],"account_type"?: string | null,"business_role"?: Database["public"]['Enums']["business_role"],"connection_id"?: string | null,"connection_status"?: Database["public"]['Enums']["account_connection_status"],"country_code"?: string | null,"created_at"?: string,"created_by"?: string | null,"display_name"?: string,"earliest_post_at"?: string | null,"external_id"?: string | null,"first_observed_at"?: string | null,"handle"?: string | null,"history_available_from"?: string | null,"id"?: string,"is_active"?: boolean,"language"?: string | null,"last_observed_at"?: string | null,"last_successful_sync_at"?: string | null,"last_sync_attempt_at"?: string | null,"notes"?: string | null,"organization_id"?: string,"owner_user_id"?: string | null,"platform_key"?: string,"timezone"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "social_accounts_account_type_fk"
      columns: ["platform_key","account_type"]
isOneToOne: false
      referencedRelation: "platform_account_types"
      referencedColumns: ["platform_key","key"]
    },{
      foreignKeyName: "social_accounts_connection_id_fkey"
      columns: ["connection_id"]
isOneToOne: false
      referencedRelation: "platform_connections"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "social_accounts_country_code_fkey"
      columns: ["country_code"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "social_accounts_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "social_accounts_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "social_accounts_owner_user_id_fkey"
      columns: ["owner_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "social_accounts_platform_key_fkey"
      columns: ["platform_key"]
isOneToOne: false
      referencedRelation: "platforms"
      referencedColumns: ["key"]
    }
                  ]
                },"strategies": {
                  Row: {
                    "country_codes": (string)[],"created_at": string,"created_by": string | null,"id": string,"name": string,"organization_id": string,"period_end": string,"period_start": string,"platform_keys": (string)[],"priorities": (string)[],"status": Database["public"]['Enums']["strategy_status"],"summary": string | null,"tone_of_voice": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "country_codes"?: (string)[],"created_at"?: string,"created_by"?: string | null,"id"?: string,"name": string,"organization_id": string,"period_end": string,"period_start": string,"platform_keys"?: (string)[],"priorities"?: (string)[],"status"?: Database["public"]['Enums']["strategy_status"],"summary"?: string | null,"tone_of_voice"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "country_codes"?: (string)[],"created_at"?: string,"created_by"?: string | null,"id"?: string,"name"?: string,"organization_id"?: string,"period_end"?: string,"period_start"?: string,"platform_keys"?: (string)[],"priorities"?: (string)[],"status"?: Database["public"]['Enums']["strategy_status"],"summary"?: string | null,"tone_of_voice"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "strategies_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "strategies_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"strategy_audiences": {
                  Row: {
                    "audience_id": string,"organization_id": string,"strategy_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience_id": string,"organization_id": string,"strategy_id": string
                  }
                  Update: {
                    "audience_id"?: string,"organization_id"?: string,"strategy_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "strategy_audiences_audience_id_organization_id_fkey"
      columns: ["audience_id","organization_id"]
isOneToOne: false
      referencedRelation: "audiences"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "strategy_audiences_strategy_id_organization_id_fkey"
      columns: ["strategy_id","organization_id"]
isOneToOne: false
      referencedRelation: "strategies"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"strategy_competitors": {
                  Row: {
                    "organization_id": string,"social_account_id": string,"strategy_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "organization_id": string,"social_account_id": string,"strategy_id": string
                  }
                  Update: {
                    "organization_id"?: string,"social_account_id"?: string,"strategy_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "strategy_competitors_social_account_id_organization_id_fkey"
      columns: ["social_account_id","organization_id"]
isOneToOne: false
      referencedRelation: "social_accounts"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "strategy_competitors_strategy_id_organization_id_fkey"
      columns: ["strategy_id","organization_id"]
isOneToOne: false
      referencedRelation: "strategies"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"strategy_objectives": {
                  Row: {
                    "created_at": string,"description": string | null,"id": string,"kpi": Database["public"]['Enums']["strategy_kpi"],"name": string,"organization_id": string,"position": number,"strategy_id": string,"target_value": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"kpi"?: Database["public"]['Enums']["strategy_kpi"],"name": string,"organization_id": string,"position"?: number,"strategy_id": string,"target_value"?: number | null
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"id"?: string,"kpi"?: Database["public"]['Enums']["strategy_kpi"],"name"?: string,"organization_id"?: string,"position"?: number,"strategy_id"?: string,"target_value"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "strategy_objectives_strategy_id_organization_id_fkey"
      columns: ["strategy_id","organization_id"]
isOneToOne: false
      referencedRelation: "strategies"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"strategy_pillars": {
                  Row: {
                    "organization_id": string,"pillar_id": string,"strategy_id": string,"target_share": number
                  }
                  ComputedFields: never
                  Insert: {
                    "organization_id": string,"pillar_id": string,"strategy_id": string,"target_share": number
                  }
                  Update: {
                    "organization_id"?: string,"pillar_id"?: string,"strategy_id"?: string,"target_share"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "strategy_pillars_pillar_id_organization_id_fkey"
      columns: ["pillar_id","organization_id"]
isOneToOne: false
      referencedRelation: "content_pillars"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "strategy_pillars_strategy_id_organization_id_fkey"
      columns: ["strategy_id","organization_id"]
isOneToOne: false
      referencedRelation: "strategies"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"sync_run_events": {
                  Row: {
                    "code": string,"context": Json | null,"created_at": string,"id": number,"level": string,"message": string,"organization_id": string,"sync_run_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "code": string,"context"?: Json | null,"created_at"?: string,"id"?: never,"level": string,"message": string,"organization_id": string,"sync_run_id": string
                  }
                  Update: {
                    "code"?: string,"context"?: Json | null,"created_at"?: string,"id"?: never,"level"?: string,"message"?: string,"organization_id"?: string,"sync_run_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sync_run_events_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sync_run_events_sync_run_id_fkey"
      columns: ["sync_run_id"]
isOneToOne: false
      referencedRelation: "sync_runs"
      referencedColumns: ["id"]
    }
                  ]
                },"sync_runs": {
                  Row: {
                    "attempt": number,"completed_at": string | null,"error_code": string | null,"error_message": string | null,"id": string,"job_type": Database["public"]['Enums']["sync_job_type"],"organization_id": string,"platform_key": string,"queued_at": string,"records_failed": number,"records_processed": number,"requested_by": string | null,"social_account_id": string,"started_at": string | null,"status": Database["public"]['Enums']["sync_status"],"trigger": Database["public"]['Enums']["sync_trigger"]
                  }
                  ComputedFields: never
                  Insert: {
                    "attempt"?: number,"completed_at"?: string | null,"error_code"?: string | null,"error_message"?: string | null,"id"?: string,"job_type": Database["public"]['Enums']["sync_job_type"],"organization_id": string,"platform_key": string,"queued_at"?: string,"records_failed"?: number,"records_processed"?: number,"requested_by"?: string | null,"social_account_id": string,"started_at"?: string | null,"status"?: Database["public"]['Enums']["sync_status"],"trigger": Database["public"]['Enums']["sync_trigger"]
                  }
                  Update: {
                    "attempt"?: number,"completed_at"?: string | null,"error_code"?: string | null,"error_message"?: string | null,"id"?: string,"job_type"?: Database["public"]['Enums']["sync_job_type"],"organization_id"?: string,"platform_key"?: string,"queued_at"?: string,"records_failed"?: number,"records_processed"?: number,"requested_by"?: string | null,"social_account_id"?: string,"started_at"?: string | null,"status"?: Database["public"]['Enums']["sync_status"],"trigger"?: Database["public"]['Enums']["sync_trigger"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "sync_runs_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sync_runs_requested_by_fkey"
      columns: ["requested_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sync_runs_social_account_id_fkey"
      columns: ["social_account_id"]
isOneToOne: false
      referencedRelation: "social_accounts"
      referencedColumns: ["id"]
    }
                  ]
                },"sync_state": {
                  Row: {
                    "completed": boolean,"consecutive_failures": number,"cursor": Json | null,"job_type": Database["public"]['Enums']["sync_job_type"],"last_attempt_at": string | null,"last_success_at": string | null,"next_run_after": string | null,"organization_id": string,"social_account_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed"?: boolean,"consecutive_failures"?: number,"cursor"?: Json | null,"job_type": Database["public"]['Enums']["sync_job_type"],"last_attempt_at"?: string | null,"last_success_at"?: string | null,"next_run_after"?: string | null,"organization_id": string,"social_account_id": string
                  }
                  Update: {
                    "completed"?: boolean,"consecutive_failures"?: number,"cursor"?: Json | null,"job_type"?: Database["public"]['Enums']["sync_job_type"],"last_attempt_at"?: string | null,"last_success_at"?: string | null,"next_run_after"?: string | null,"organization_id"?: string,"social_account_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sync_state_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sync_state_social_account_id_fkey"
      columns: ["social_account_id"]
isOneToOne: false
      referencedRelation: "social_accounts"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "account_metrics_daily": {
                  Row: {
                    "availability": Database["public"]['Enums']["metric_availability"] | null,"captured_at": string | null,"data_source": Database["public"]['Enums']["data_source"] | null,"metric_date": string | null,"metric_key": string | null,"organization_id": string | null,"period": Database["public"]['Enums']["metric_period"] | null,"social_account_id": string | null,"value": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "account_metric_snapshots_metric_key_fkey"
      columns: ["metric_key"]
isOneToOne: false
      referencedRelation: "metric_definitions"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "account_metric_snapshots_social_account_id_organization_id_fkey"
      columns: ["social_account_id","organization_id"]
isOneToOne: false
      referencedRelation: "social_accounts"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"post_metrics_at_age": {
                  Row: {
                    "age_days": number | null,"availability": Database["public"]['Enums']["metric_availability"] | null,"captured_at": string | null,"data_source": Database["public"]['Enums']["data_source"] | null,"metric_key": string | null,"organization_id": string | null,"post_age_hours": number | null,"post_id": string | null,"value": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "post_metric_snapshots_metric_key_fkey"
      columns: ["metric_key"]
isOneToOne: false
      referencedRelation: "metric_definitions"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "post_metric_snapshots_post_id_organization_id_fkey"
      columns: ["post_id","organization_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                },"post_metrics_latest": {
                  Row: {
                    "availability": Database["public"]['Enums']["metric_availability"] | null,"captured_at": string | null,"data_source": Database["public"]['Enums']["data_source"] | null,"metric_key": string | null,"organization_id": string | null,"post_age_hours": number | null,"post_id": string | null,"value": number | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "post_metric_snapshots_metric_key_fkey"
      columns: ["metric_key"]
isOneToOne: false
      referencedRelation: "metric_definitions"
      referencedColumns: ["key"]
    },{
      foreignKeyName: "post_metric_snapshots_post_id_organization_id_fkey"
      columns: ["post_id","organization_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id","organization_id"]
    }
                  ]
                }
          }
          Functions: {
            "check_fact_source":
{ Args: { "account": string,"batch": string,"org": string,"source": Database["public"]['Enums']["data_source"] }; Returns: undefined
                           },
"clear_public_data_viewer":
{ Args: { "org": string,"platform": string }; Returns: undefined
                           },
"content_item_for_move":
{ Args: { "item_id": string,"permission": string }; Returns: {
              "audience_id": string | null,
"campaign_id": string | null,
"content_format_id": string | null,
"country_code": string | null,
"created_at": string,
"created_by": string | null,
"cta_type_id": string | null,
"current_version_id": string | null,
"id": string,
"organization_id": string,
"owner_user_id": string | null,
"pillar_id": string | null,
"planned_publish_at": string | null,
"platform_keys": (string)[],
"published_at": string | null,
"published_post_id": string | null,
"source_recommendation_id": string | null,
"status": Database["public"]['Enums']["content_status"],
"strategy_objective_id": string | null,
"title": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "content_items"
        isOneToOne: true
        isSetofReturn: false
      } },
"content_reviewers":
{ Args: { "org": string }; Returns: (string)[]
                           },
"create_content_version":
{ Args: { "item_id": string }; Returns: string
                           },
"create_organization":
{ Args: { "org_name": string,"org_slug": string,"org_timezone"?: string }; Returns: {
              "created_at": string,
"created_by": string | null,
"default_timezone": string,
"id": string,
"is_demo": boolean,
"name": string,
"slug": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "organizations"
        isOneToOne: true
        isSetofReturn: false
      } },
"disconnect_platform_connection":
{ Args: { "target": string }; Returns: undefined
                           },
"extract_hashtags":
{ Args: { "caption": string }; Returns: (string)[]
                           },
"has_org_permission":
{ Args: { "org": string,"permission": string }; Returns: boolean
                           },
"is_end_user":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_org_member":
{ Args: { "org": string }; Returns: boolean
                           },
"link_connection_asset":
{ Args: { "account_id": string,"asset_id": string }; Returns: undefined
                           },
"mark_content_published":
{ Args: { "item_id": string,"post_id"?: string,"published"?: string }; Returns: undefined
                           },
"notify_members":
{ Args: { "excerpt"?: string,"item_id": string,"kind": string,"org": string,"recipients": (string)[] }; Returns: undefined
                           },
"org_role_of":
{ Args: { "org": string }; Returns: Database["public"]['Enums']["org_role"]
                           },
"remove_profile_and_data":
{ Args: { "account_id": string }; Returns: undefined
                           },
"request_sync":
{ Args: { "account_id": string,"job"?: Database["public"]['Enums']["sync_job_type"] }; Returns: string
                           },
"review_content":
{ Args: { "comment"?: string,"decision": Database["public"]['Enums']["review_decision"],"item_id": string }; Returns: undefined
                           },
"set_content_scheduled":
{ Args: { "item_id": string,"scheduled": boolean }; Returns: undefined
                           },
"set_public_data_viewer":
{ Args: { "asset_id": string }; Returns: undefined
                           },
"set_recommendation_status":
{ Args: { "new_status": Database["public"]['Enums']["recommendation_status"],"note"?: string,"recommendation_id": string }; Returns: undefined
                           },
"shares_org_with":
{ Args: { "other_user": string }; Returns: boolean
                           },
"submit_content_for_review":
{ Args: { "item_id": string,"note"?: string }; Returns: undefined
                           },
"unlink_social_account":
{ Args: { "account_id": string }; Returns: undefined
                           },
"withdraw_content_from_review":
{ Args: { "item_id": string }; Returns: undefined
                           }
          }
          Enums: {
            "account_connection_status": "not_connected"|"connected"|"needs_reauth"|"error"|"demo","analysis_run_status": "succeeded"|"failed","analysis_writer": "rules"|"model","business_role": "owned"|"competitor"|"industry"|"influencer"|"other","connection_status": "active"|"needs_reauth"|"revoked"|"error","content_status": "IDEA"|"DRAFT"|"IN_REVIEW"|"CHANGES_REQUESTED"|"APPROVED"|"SCHEDULED"|"PUBLISHED"|"ANALYSED"|"REJECTED"|"ARCHIVED","data_source": "live_public"|"live_connected"|"imported"|"estimated"|"demo","import_kind": "account_metrics"|"posts","import_status": "processing"|"completed"|"completed_with_errors"|"failed","insight_severity": "info"|"notable"|"important","language_source": "declared"|"account_default"|"detected","media_format": "image"|"carousel"|"short_video"|"long_video"|"video"|"text"|"link"|"story"|"live"|"other","metric_aggregation": "sum"|"last"|"recompute"|"not_additive","metric_availability": "available"|"not_permitted"|"not_applicable"|"pending"|"error"|"hidden_by_owner"|"not_public","metric_period": "lifetime"|"day","metric_scope": "account"|"post","metric_unit": "count"|"percent"|"seconds","org_role": "OWNER"|"ADMIN"|"MANAGER"|"EDITOR"|"VIEWER","platform_data_status": "available"|"planned"|"not_available","profile_access_type": "public"|"connected"|"imported"|"demo","recommendation_confidence": "low"|"medium"|"high","recommendation_status": "open"|"accepted"|"dismissed"|"done","review_decision": "APPROVED"|"CHANGES_REQUESTED"|"REJECTED","strategy_kpi": "published_content"|"posts_per_week"|"follower_growth"|"manual","strategy_status": "draft"|"active"|"archived","sync_job_type": "account_daily"|"posts_incremental"|"post_metrics_refresh"|"backfill"|"public_profile_daily"|"public_posts_refresh"|"public_backfill","sync_status": "queued"|"running"|"succeeded"|"partial"|"failed"|"cancelled","sync_trigger": "schedule"|"manual"|"retry","tag_source": "content_item"|"manual"|"imported"|"ai_suggested"|"ai_confirmed"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "account_connection_status": ["not_connected", "connected", "needs_reauth", "error", "demo"],"analysis_run_status": ["succeeded", "failed"],"analysis_writer": ["rules", "model"],"business_role": ["owned", "competitor", "industry", "influencer", "other"],"connection_status": ["active", "needs_reauth", "revoked", "error"],"content_status": ["IDEA", "DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED", "ANALYSED", "REJECTED", "ARCHIVED"],"data_source": ["live_public", "live_connected", "imported", "estimated", "demo"],"import_kind": ["account_metrics", "posts"],"import_status": ["processing", "completed", "completed_with_errors", "failed"],"insight_severity": ["info", "notable", "important"],"language_source": ["declared", "account_default", "detected"],"media_format": ["image", "carousel", "short_video", "long_video", "video", "text", "link", "story", "live", "other"],"metric_aggregation": ["sum", "last", "recompute", "not_additive"],"metric_availability": ["available", "not_permitted", "not_applicable", "pending", "error", "hidden_by_owner", "not_public"],"metric_period": ["lifetime", "day"],"metric_scope": ["account", "post"],"metric_unit": ["count", "percent", "seconds"],"org_role": ["OWNER", "ADMIN", "MANAGER", "EDITOR", "VIEWER"],"platform_data_status": ["available", "planned", "not_available"],"profile_access_type": ["public", "connected", "imported", "demo"],"recommendation_confidence": ["low", "medium", "high"],"recommendation_status": ["open", "accepted", "dismissed", "done"],"review_decision": ["APPROVED", "CHANGES_REQUESTED", "REJECTED"],"strategy_kpi": ["published_content", "posts_per_week", "follower_growth", "manual"],"strategy_status": ["draft", "active", "archived"],"sync_job_type": ["account_daily", "posts_incremental", "post_metrics_refresh", "backfill", "public_profile_daily", "public_posts_refresh", "public_backfill"],"sync_status": ["queued", "running", "succeeded", "partial", "failed", "cancelled"],"sync_trigger": ["schedule", "manual", "retry"],"tag_source": ["content_item", "manual", "imported", "ai_suggested", "ai_confirmed"]
          }
        }
} as const
