export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      admin_events: {
        Row: {
          action: string;
          admin_id: string;
          created_at: string;
          id: string;
          metadata: Json;
          reason: string | null;
          subject_id: string | null;
          subject_type: string;
        };
        Insert: {
          action: string;
          admin_id: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          reason?: string | null;
          subject_id?: string | null;
          subject_type: string;
        };
        Update: {
          action?: string;
          admin_id?: string;
          created_at?: string;
          id?: string;
          metadata?: Json;
          reason?: string | null;
          subject_id?: string | null;
          subject_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "admin_events_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_actions: {
        Row: {
          action_type: string;
          actor_id: string | null;
          created_at: string;
          id: string;
          input_redacted: Json;
          output_redacted: Json;
          status: string;
        };
        Insert: {
          action_type: string;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          input_redacted?: Json;
          output_redacted?: Json;
          status: string;
        };
        Update: {
          action_type?: string;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          input_redacted?: Json;
          output_redacted?: Json;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_actions_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_usage: {
        Row: {
          ai_action_id: string | null;
          created_at: string;
          id: string;
          input_tokens: number;
          model: string;
          output_tokens: number;
          provider: string;
        };
        Insert: {
          ai_action_id?: string | null;
          created_at?: string;
          id?: string;
          input_tokens?: number;
          model: string;
          output_tokens?: number;
          provider: string;
        };
        Update: {
          ai_action_id?: string | null;
          created_at?: string;
          id?: string;
          input_tokens?: number;
          model?: string;
          output_tokens?: number;
          provider?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_usage_ai_action_id_fkey";
            columns: ["ai_action_id"];
            isOneToOne: false;
            referencedRelation: "ai_actions";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_events: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          id: string;
          metadata: Json;
          subject_id: string | null;
          subject_type: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          subject_id?: string | null;
          subject_type: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          metadata?: Json;
          subject_id?: string | null;
          subject_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      auth_rate_limits: {
        Row: {
          identifier_hash: string;
          request_count: number;
          scope: string;
          updated_at: string;
          window_started_at: string;
        };
        Insert: {
          identifier_hash: string;
          request_count?: number;
          scope: string;
          updated_at?: string;
          window_started_at?: string;
        };
        Update: {
          identifier_hash?: string;
          request_count?: number;
          scope?: string;
          updated_at?: string;
          window_started_at?: string;
        };
        Relationships: [];
      };
      business_memberships: {
        Row: {
          accepted_at: string | null;
          business_id: string;
          created_at: string;
          invited_by: string | null;
          profile_id: string;
          role: Database["public"]["Enums"]["business_member_role"];
        };
        Insert: {
          accepted_at?: string | null;
          business_id: string;
          created_at?: string;
          invited_by?: string | null;
          profile_id: string;
          role: Database["public"]["Enums"]["business_member_role"];
        };
        Update: {
          accepted_at?: string | null;
          business_id?: string;
          created_at?: string;
          invited_by?: string | null;
          profile_id?: string;
          role?: Database["public"]["Enums"]["business_member_role"];
        };
        Relationships: [
          {
            foreignKeyName: "business_memberships_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_memberships_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_memberships_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      business_onboarding_drafts: {
        Row: {
          business_id: string;
          created_at: string;
          data: Json;
          owner_id: string;
          step: string;
          submitted_at: string | null;
          updated_at: string;
        };
        Insert: {
          business_id: string;
          created_at?: string;
          data?: Json;
          owner_id: string;
          step?: string;
          submitted_at?: string | null;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          data?: Json;
          owner_id?: string;
          step?: string;
          submitted_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_onboarding_drafts_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: true;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "business_onboarding_drafts_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      businesses: {
        Row: {
          address_text: string | null;
          created_at: string;
          id: string;
          legal_name: string | null;
          location_id: string | null;
          market_id: string;
          metadata: Json;
          name: string;
          phone_e164: string | null;
          slug: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          address_text?: string | null;
          created_at?: string;
          id?: string;
          legal_name?: string | null;
          location_id?: string | null;
          market_id: string;
          metadata?: Json;
          name: string;
          phone_e164?: string | null;
          slug: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          address_text?: string | null;
          created_at?: string;
          id?: string;
          legal_name?: string | null;
          location_id?: string | null;
          market_id?: string;
          metadata?: Json;
          name?: string;
          phone_e164?: string | null;
          slug?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "businesses_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "market_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "businesses_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
        ];
      };
      categories: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          kind: string;
          market_id: string | null;
          name: string;
          parent_id: string | null;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          kind?: string;
          market_id?: string | null;
          name: string;
          parent_id?: string | null;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          kind?: string;
          market_id?: string | null;
          name?: string;
          parent_id?: string | null;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "categories_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "categories_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
        ];
      };
      category_aliases: {
        Row: {
          alias: string;
          category_id: string;
          created_at: string;
          id: string;
          market_id: string | null;
          normalized_alias: string;
        };
        Insert: {
          alias: string;
          category_id: string;
          created_at?: string;
          id?: string;
          market_id?: string | null;
          normalized_alias: string;
        };
        Update: {
          alias?: string;
          category_id?: string;
          created_at?: string;
          id?: string;
          market_id?: string | null;
          normalized_alias?: string;
        };
        Relationships: [
          {
            foreignKeyName: "category_aliases_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "category_aliases_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
        ];
      };
      category_listing_type_mappings: {
        Row: {
          category_id: string;
          created_at: string;
          is_default: boolean;
          listing_schema_id: string;
          listing_type_id: string;
        };
        Insert: {
          category_id: string;
          created_at?: string;
          is_default?: boolean;
          listing_schema_id: string;
          listing_type_id: string;
        };
        Update: {
          category_id?: string;
          created_at?: string;
          is_default?: boolean;
          listing_schema_id?: string;
          listing_type_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "category_listing_type_mappings_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "category_listing_type_mappings_listing_schema_id_fkey";
            columns: ["listing_schema_id"];
            isOneToOne: false;
            referencedRelation: "listing_schemas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "category_listing_type_mappings_listing_type_id_fkey";
            columns: ["listing_type_id"];
            isOneToOne: false;
            referencedRelation: "listing_types";
            referencedColumns: ["id"];
          },
        ];
      };
      demand_signals: {
        Row: {
          category_id: string | null;
          id: string;
          market_id: string;
          observed_at: string;
          signal_type: string;
          source_search_id: string | null;
          weight: number;
        };
        Insert: {
          category_id?: string | null;
          id?: string;
          market_id: string;
          observed_at?: string;
          signal_type: string;
          source_search_id?: string | null;
          weight?: number;
        };
        Update: {
          category_id?: string | null;
          id?: string;
          market_id?: string;
          observed_at?: string;
          signal_type?: string;
          source_search_id?: string | null;
          weight?: number;
        };
        Relationships: [
          {
            foreignKeyName: "demand_signals_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "demand_signals_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "demand_signals_source_search_id_fkey";
            columns: ["source_search_id"];
            isOneToOne: true;
            referencedRelation: "searches";
            referencedColumns: ["id"];
          },
        ];
      };
      fulfilment_events: {
        Row: {
          actor_id: string | null;
          event_type: string;
          fulfilment_id: string;
          id: string;
          occurred_at: string;
          order_id: string;
          payload: Json;
          status: string;
        };
        Insert: {
          actor_id?: string | null;
          event_type: string;
          fulfilment_id: string;
          id?: string;
          occurred_at?: string;
          order_id: string;
          payload?: Json;
          status: string;
        };
        Update: {
          actor_id?: string | null;
          event_type?: string;
          fulfilment_id?: string;
          id?: string;
          occurred_at?: string;
          order_id?: string;
          payload?: Json;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fulfilment_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fulfilment_events_fulfilment_order_fkey";
            columns: ["fulfilment_id", "order_id"];
            isOneToOne: false;
            referencedRelation: "order_fulfilments";
            referencedColumns: ["id", "order_id"];
          },
          {
            foreignKeyName: "fulfilment_events_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      order_fulfilments: {
        Row: {
          created_at: string;
          id: string;
          order_id: string;
          started_at: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at: string;
          id?: string;
          order_id: string;
          started_at: string;
          status: string;
          updated_at: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          order_id?: string;
          started_at?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_fulfilments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      guest_intents: {
        Row: {
          claimed_at: string | null;
          claimed_by: string | null;
          consumed_at: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          kind: string;
          market_id: string | null;
          payload: Json;
          return_to: string;
          secret_hash: string | null;
          updated_at: string;
        };
        Insert: {
          claimed_at?: string | null;
          claimed_by?: string | null;
          consumed_at?: string | null;
          created_at?: string;
          expires_at: string;
          id?: string;
          kind: string;
          market_id?: string | null;
          payload?: Json;
          return_to: string;
          secret_hash?: string | null;
          updated_at?: string;
        };
        Update: {
          claimed_at?: string | null;
          claimed_by?: string | null;
          consumed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          kind?: string;
          market_id?: string | null;
          payload?: Json;
          return_to?: string;
          secret_hash?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guest_intents_claimed_by_fkey";
            columns: ["claimed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "guest_intents_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_levels: {
        Row: {
          quantity_on_hand: number;
          quantity_reserved: number;
          updated_at: string;
          variant_id: string;
        };
        Insert: {
          quantity_on_hand?: number;
          quantity_reserved?: number;
          updated_at?: string;
          variant_id: string;
        };
        Update: {
          quantity_on_hand?: number;
          quantity_reserved?: number;
          updated_at?: string;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_levels_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: true;
            referencedRelation: "listing_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_accounts: {
        Row: {
          account_type: string;
          code: string;
          created_at: string;
          currency_code: string | null;
          id: string;
          is_active: boolean;
          name: string;
        };
        Insert: {
          account_type: string;
          code: string;
          created_at?: string;
          currency_code?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
        };
        Update: {
          account_type?: string;
          code?: string;
          created_at?: string;
          currency_code?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
        };
        Relationships: [];
      };
      ledger_entries: {
        Row: {
          account_id: string;
          amount_minor: number;
          created_at: string;
          currency_code: string;
          direction: Database["public"]["Enums"]["ledger_direction"];
          id: string;
          journal_id: string;
        };
        Insert: {
          account_id: string;
          amount_minor: number;
          created_at?: string;
          currency_code?: string;
          direction: Database["public"]["Enums"]["ledger_direction"];
          id?: string;
          journal_id: string;
        };
        Update: {
          account_id?: string;
          amount_minor?: number;
          created_at?: string;
          currency_code?: string;
          direction?: Database["public"]["Enums"]["ledger_direction"];
          id?: string;
          journal_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_entries_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "ledger_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_entries_journal_id_fkey";
            columns: ["journal_id"];
            isOneToOne: false;
            referencedRelation: "ledger_journals";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_journals: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          posted_at: string | null;
          posting_key: string;
          reference_id: string | null;
          reference_type: string;
          reversal_of: string | null;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          posted_at?: string | null;
          posting_key: string;
          reference_id?: string | null;
          reference_type: string;
          reversal_of?: string | null;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          posted_at?: string | null;
          posting_key?: string;
          reference_id?: string | null;
          reference_type?: string;
          reversal_of?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_journals_reversal_of_fkey";
            columns: ["reversal_of"];
            isOneToOne: true;
            referencedRelation: "ledger_journals";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_availability: {
        Row: {
          created_at: string;
          ends_at: string | null;
          id: string;
          is_available: boolean;
          listing_id: string;
          starts_at: string | null;
          weekday: number | null;
        };
        Insert: {
          created_at?: string;
          ends_at?: string | null;
          id?: string;
          is_available?: boolean;
          listing_id: string;
          starts_at?: string | null;
          weekday?: number | null;
        };
        Update: {
          created_at?: string;
          ends_at?: string | null;
          id?: string;
          is_available?: boolean;
          listing_id?: string;
          starts_at?: string | null;
          weekday?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "listing_availability_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_media: {
        Row: {
          alt_text: string | null;
          created_at: string;
          id: string;
          listing_id: string;
          media_type: string;
          sort_order: number;
          storage_path: string;
        };
        Insert: {
          alt_text?: string | null;
          created_at?: string;
          id?: string;
          listing_id: string;
          media_type: string;
          sort_order?: number;
          storage_path: string;
        };
        Update: {
          alt_text?: string | null;
          created_at?: string;
          id?: string;
          listing_id?: string;
          media_type?: string;
          sort_order?: number;
          storage_path?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_media_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_media_upload_reservations: {
        Row: {
          cleanup_attempt_count: number;
          cleanup_claim_token: string | null;
          cleanup_claimed_at: string | null;
          cleanup_completed_at: string | null;
          cleanup_error: string | null;
          cleanup_failed_at: string | null;
          cleanup_state: string;
          confirmed_at: string | null;
          created_at: string;
          expires_at: string;
          listing_id: string | null;
          profile_id: string | null;
          registered_at: string | null;
          removed_at: string | null;
          status: string;
          storage_path: string;
          updated_at: string;
        };
        Insert: {
          cleanup_attempt_count?: number;
          cleanup_claim_token?: string | null;
          cleanup_claimed_at?: string | null;
          cleanup_completed_at?: string | null;
          cleanup_error?: string | null;
          cleanup_failed_at?: string | null;
          cleanup_state?: string;
          confirmed_at?: string | null;
          created_at?: string;
          expires_at: string;
          listing_id?: string | null;
          profile_id?: string | null;
          registered_at?: string | null;
          removed_at?: string | null;
          status?: string;
          storage_path: string;
          updated_at?: string;
        };
        Update: {
          cleanup_attempt_count?: number;
          cleanup_claim_token?: string | null;
          cleanup_claimed_at?: string | null;
          cleanup_completed_at?: string | null;
          cleanup_error?: string | null;
          cleanup_failed_at?: string | null;
          cleanup_state?: string;
          confirmed_at?: string | null;
          created_at?: string;
          expires_at?: string;
          listing_id?: string | null;
          profile_id?: string | null;
          registered_at?: string | null;
          removed_at?: string | null;
          status?: string;
          storage_path?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_media_upload_reservations_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listing_media_upload_reservations_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_schemas: {
        Row: {
          created_at: string;
          id: string;
          listing_type_id: string;
          published_at: string | null;
          schema: Json;
          status: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          listing_type_id: string;
          published_at?: string | null;
          schema?: Json;
          status?: string;
          updated_at?: string;
          version: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          listing_type_id?: string;
          published_at?: string | null;
          schema?: Json;
          status?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "listing_schemas_listing_type_id_fkey";
            columns: ["listing_type_id"];
            isOneToOne: false;
            referencedRelation: "listing_types";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_types: {
        Row: {
          code: string;
          created_at: string;
          description: string | null;
          id: string;
          is_active: boolean;
          name: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          description?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      listing_variants: {
        Row: {
          attributes: Json;
          created_at: string;
          currency_code: string;
          id: string;
          is_active: boolean;
          listing_id: string;
          name: string;
          price_minor: number | null;
          sku: string | null;
          updated_at: string;
        };
        Insert: {
          attributes?: Json;
          created_at?: string;
          currency_code?: string;
          id?: string;
          is_active?: boolean;
          listing_id: string;
          name: string;
          price_minor?: number | null;
          sku?: string | null;
          updated_at?: string;
        };
        Update: {
          attributes?: Json;
          created_at?: string;
          currency_code?: string;
          id?: string;
          is_active?: boolean;
          listing_id?: string;
          name?: string;
          price_minor?: number | null;
          sku?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_variants_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listings: {
        Row: {
          attributes: Json;
          business_id: string;
          category_id: string | null;
          created_at: string;
          created_by: string | null;
          currency_code: string;
          description: string | null;
          draft_revision: number;
          fulfilment_methods: Json;
          id: string;
          is_orderable: boolean;
          listing_schema_id: string;
          listing_type_id: string;
          location_id: string | null;
          market_id: string;
          price_minor: number | null;
          published_at: string | null;
          slug: string;
          status: Database["public"]["Enums"]["listing_status"];
          title: string;
          updated_at: string;
        };
        Insert: {
          attributes?: Json;
          business_id: string;
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency_code?: string;
          description?: string | null;
          draft_revision?: number;
          fulfilment_methods?: Json;
          id?: string;
          is_orderable?: boolean;
          listing_schema_id: string;
          listing_type_id: string;
          location_id?: string | null;
          market_id: string;
          price_minor?: number | null;
          published_at?: string | null;
          slug: string;
          status?: Database["public"]["Enums"]["listing_status"];
          title: string;
          updated_at?: string;
        };
        Update: {
          attributes?: Json;
          business_id?: string;
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency_code?: string;
          description?: string | null;
          draft_revision?: number;
          fulfilment_methods?: Json;
          id?: string;
          is_orderable?: boolean;
          listing_schema_id?: string;
          listing_type_id?: string;
          location_id?: string | null;
          market_id?: string;
          price_minor?: number | null;
          published_at?: string | null;
          slug?: string;
          status?: Database["public"]["Enums"]["listing_status"];
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listings_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listings_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listings_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listings_listing_schema_id_fkey";
            columns: ["listing_schema_id"];
            isOneToOne: false;
            referencedRelation: "listing_schemas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listings_listing_type_id_fkey";
            columns: ["listing_type_id"];
            isOneToOne: false;
            referencedRelation: "listing_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listings_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "market_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listings_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
        ];
      };
      market_locations: {
        Row: {
          boundary: Json;
          created_at: string;
          id: string;
          is_active: boolean;
          kind: string;
          latitude: number | null;
          longitude: number | null;
          market_id: string;
          name: string;
          parent_id: string | null;
          slug: string;
          updated_at: string;
        };
        Insert: {
          boundary?: Json;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          kind: string;
          latitude?: number | null;
          longitude?: number | null;
          market_id: string;
          name: string;
          parent_id?: string | null;
          slug: string;
          updated_at?: string;
        };
        Update: {
          boundary?: Json;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          kind?: string;
          latitude?: number | null;
          longitude?: number | null;
          market_id?: string;
          name?: string;
          parent_id?: string | null;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "market_locations_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "market_locations_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "market_locations";
            referencedColumns: ["id"];
          },
        ];
      };
      markets: {
        Row: {
          country_code: string;
          created_at: string;
          currency_code: string;
          id: string;
          is_active: boolean;
          name: string;
          slug: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          country_code?: string;
          created_at?: string;
          currency_code?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          slug: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          country_code?: string;
          created_at?: string;
          currency_code?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          slug?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      media_upload_rate_limits: {
        Row: {
          profile_id: string;
          request_count: number;
          updated_at: string;
          window_started_at: string;
        };
        Insert: {
          profile_id: string;
          request_count?: number;
          updated_at?: string;
          window_started_at?: string;
        };
        Update: {
          profile_id?: string;
          request_count?: number;
          updated_at?: string;
          window_started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "media_upload_rate_limits_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      mission_progress: {
        Row: {
          completed_at: string | null;
          mission_id: string;
          profile_id: string;
          progress: Json;
          updated_at: string;
        };
        Insert: {
          completed_at?: string | null;
          mission_id: string;
          profile_id: string;
          progress?: Json;
          updated_at?: string;
        };
        Update: {
          completed_at?: string | null;
          mission_id?: string;
          profile_id?: string;
          progress?: Json;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mission_progress_mission_id_fkey";
            columns: ["mission_id"];
            isOneToOne: false;
            referencedRelation: "missions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mission_progress_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      missions: {
        Row: {
          created_at: string;
          definition: Json;
          id: string;
          market_id: string | null;
          name: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          definition?: Json;
          id?: string;
          market_id?: string | null;
          name: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          definition?: Json;
          id?: string;
          market_id?: string | null;
          name?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "missions_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          action_path: string | null;
          body: string;
          created_at: string;
          id: string;
          market_id: string | null;
          profile_id: string | null;
          read_at: string | null;
          source_id: string;
          source_kind: string;
          template_key: string;
          template_version: number;
          title: string;
        };
        Insert: {
          action_path?: string | null;
          body: string;
          created_at?: string;
          id?: string;
          market_id?: string | null;
          profile_id?: string | null;
          read_at?: string | null;
          source_id: string;
          source_kind: string;
          template_key: string;
          template_version?: number;
          title: string;
        };
        Update: {
          action_path?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          market_id?: string | null;
          profile_id?: string | null;
          read_at?: string | null;
          source_id?: string;
          source_kind?: string;
          template_key?: string;
          template_version?: number;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          created_at: string;
          id: string;
          listing_id: string;
          order_id: string;
          quantity: number;
          title_snapshot: string;
          total_minor: number;
          unit_price_minor: number;
          variant_id: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          listing_id: string;
          order_id: string;
          quantity: number;
          title_snapshot: string;
          total_minor: number;
          unit_price_minor: number;
          variant_id?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          listing_id?: string;
          order_id?: string;
          quantity?: number;
          title_snapshot?: string;
          total_minor?: number;
          unit_price_minor?: number;
          variant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "listing_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      order_status_events: {
        Row: {
          actor_id: string | null;
          id: string;
          note: string | null;
          occurred_at: string;
          order_id: string;
          status: Database["public"]["Enums"]["order_status"];
        };
        Insert: {
          actor_id?: string | null;
          id?: string;
          note?: string | null;
          occurred_at?: string;
          order_id: string;
          status: Database["public"]["Enums"]["order_status"];
        };
        Update: {
          actor_id?: string | null;
          id?: string;
          note?: string | null;
          occurred_at?: string;
          order_id?: string;
          status?: Database["public"]["Enums"]["order_status"];
        };
        Relationships: [
          {
            foreignKeyName: "order_status_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_status_events_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          business_id: string;
          buyer_id: string;
          created_at: string;
          currency_code: string;
          guest_intent_id: string | null;
          id: string;
          listing_route_snapshot: string | null;
          market_id: string;
          order_number: string;
          placed_at: string | null;
          snapshot_source: string | null;
          status: Database["public"]["Enums"]["order_status"];
          subtotal_minor: number;
          total_minor: number;
          updated_at: string;
          vendor_decided_at: string | null;
          vendor_name_snapshot: string | null;
        };
        Insert: {
          business_id: string;
          buyer_id: string;
          created_at?: string;
          currency_code?: string;
          guest_intent_id?: string | null;
          id?: string;
          listing_route_snapshot?: string | null;
          market_id: string;
          order_number: string;
          placed_at?: string | null;
          snapshot_source?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal_minor?: number;
          total_minor?: number;
          updated_at?: string;
          vendor_decided_at?: string | null;
          vendor_name_snapshot?: string | null;
        };
        Update: {
          business_id?: string;
          buyer_id?: string;
          created_at?: string;
          currency_code?: string;
          guest_intent_id?: string | null;
          id?: string;
          listing_route_snapshot?: string | null;
          market_id?: string;
          order_number?: string;
          placed_at?: string | null;
          snapshot_source?: string | null;
          status?: Database["public"]["Enums"]["order_status"];
          subtotal_minor?: number;
          total_minor?: number;
          updated_at?: string;
          vendor_decided_at?: string | null;
          vendor_name_snapshot?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "orders_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_buyer_id_fkey";
            columns: ["buyer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_guest_intent_id_fkey";
            columns: ["guest_intent_id"];
            isOneToOne: false;
            referencedRelation: "guest_intents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_events: {
        Row: {
          event_type: string;
          id: string;
          occurred_at: string;
          payload: Json;
          payment_id: string;
          provider_event_id: string;
        };
        Insert: {
          event_type: string;
          id?: string;
          occurred_at?: string;
          payload?: Json;
          payment_id: string;
          provider_event_id: string;
        };
        Update: {
          event_type?: string;
          id?: string;
          occurred_at?: string;
          payload?: Json;
          payment_id?: string;
          provider_event_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payment_events_payment_id_fkey";
            columns: ["payment_id"];
            isOneToOne: false;
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          amount_minor: number;
          created_at: string;
          currency_code: string;
          id: string;
          order_id: string | null;
          payer_id: string | null;
          provider: string;
          provider_reference: string | null;
          status: Database["public"]["Enums"]["payment_status"];
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          created_at?: string;
          currency_code?: string;
          id?: string;
          order_id?: string | null;
          payer_id?: string | null;
          provider: string;
          provider_reference?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          created_at?: string;
          currency_code?: string;
          id?: string;
          order_id?: string | null;
          payer_id?: string | null;
          provider?: string;
          provider_reference?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_capabilities: {
        Row: {
          capability: Database["public"]["Enums"]["profile_capability"];
          granted_at: string;
          granted_by: string | null;
          profile_id: string;
        };
        Insert: {
          capability: Database["public"]["Enums"]["profile_capability"];
          granted_at?: string;
          granted_by?: string | null;
          profile_id: string;
        };
        Update: {
          capability?: Database["public"]["Enums"]["profile_capability"];
          granted_at?: string;
          granted_by?: string | null;
          profile_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profile_capabilities_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_capabilities_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_path: string | null;
          created_at: string;
          default_market_id: string | null;
          display_name: string | null;
          id: string;
          is_suspended: boolean;
          phone_e164: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_path?: string | null;
          created_at?: string;
          default_market_id?: string | null;
          display_name?: string | null;
          id: string;
          is_suspended?: boolean;
          phone_e164?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_path?: string | null;
          created_at?: string;
          default_market_id?: string | null;
          display_name?: string | null;
          id?: string;
          is_suspended?: boolean;
          phone_e164?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_default_market_id_fkey";
            columns: ["default_market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
        ];
      };
      referral_attributions: {
        Row: {
          attributed_at: string;
          guest_intent_id: string | null;
          id: string;
          referral_code_id: string;
          referred_profile_id: string | null;
        };
        Insert: {
          attributed_at?: string;
          guest_intent_id?: string | null;
          id?: string;
          referral_code_id: string;
          referred_profile_id?: string | null;
        };
        Update: {
          attributed_at?: string;
          guest_intent_id?: string | null;
          id?: string;
          referral_code_id?: string;
          referred_profile_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "referral_attributions_guest_intent_id_fkey";
            columns: ["guest_intent_id"];
            isOneToOne: false;
            referencedRelation: "guest_intents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referral_attributions_referral_code_id_fkey";
            columns: ["referral_code_id"];
            isOneToOne: false;
            referencedRelation: "referral_codes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referral_attributions_referred_profile_id_fkey";
            columns: ["referred_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      referral_codes: {
        Row: {
          code: string;
          created_at: string;
          id: string;
          is_active: boolean;
          profile_id: string;
          rule_id: string | null;
        };
        Insert: {
          code: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          profile_id: string;
          rule_id?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          profile_id?: string;
          rule_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "referral_codes_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referral_codes_rule_id_fkey";
            columns: ["rule_id"];
            isOneToOne: false;
            referencedRelation: "referral_rules";
            referencedColumns: ["id"];
          },
        ];
      };
      referral_commissions: {
        Row: {
          amount_minor: number | null;
          attribution_id: string;
          calculated_at: string;
          currency_code: string;
          id: string;
          order_id: string | null;
          rule_id: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount_minor?: number | null;
          attribution_id: string;
          calculated_at?: string;
          currency_code?: string;
          id?: string;
          order_id?: string | null;
          rule_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount_minor?: number | null;
          attribution_id?: string;
          calculated_at?: string;
          currency_code?: string;
          id?: string;
          order_id?: string | null;
          rule_id?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "referral_commissions_attribution_id_fkey";
            columns: ["attribution_id"];
            isOneToOne: false;
            referencedRelation: "referral_attributions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referral_commissions_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "referral_commissions_rule_id_fkey";
            columns: ["rule_id"];
            isOneToOne: false;
            referencedRelation: "referral_rules";
            referencedColumns: ["id"];
          },
        ];
      };
      referral_rules: {
        Row: {
          conditions: Json;
          created_at: string;
          ends_at: string | null;
          id: string;
          market_id: string | null;
          name: string;
          reward_definition: Json;
          starts_at: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          conditions?: Json;
          created_at?: string;
          ends_at?: string | null;
          id?: string;
          market_id?: string | null;
          name: string;
          reward_definition?: Json;
          starts_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          conditions?: Json;
          created_at?: string;
          ends_at?: string | null;
          id?: string;
          market_id?: string | null;
          name?: string;
          reward_definition?: Json;
          starts_at?: string | null;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "referral_rules_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
        ];
      };
      request_matches: {
        Row: {
          created_at: string;
          id: string;
          listing_id: string;
          rationale: Json;
          request_id: string;
          score: number;
          status: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          listing_id: string;
          rationale?: Json;
          request_id: string;
          score: number;
          status?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          listing_id?: string;
          rationale?: Json;
          request_id?: string;
          score?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "request_matches_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "request_matches_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "requests";
            referencedColumns: ["id"];
          },
        ];
      };
      requests: {
        Row: {
          business_id: string | null;
          category_id: string | null;
          created_at: string;
          details: string | null;
          guest_intent_id: string | null;
          id: string;
          listing_id: string | null;
          market_id: string;
          request_number: string | null;
          requested_action: string | null;
          requester_id: string | null;
          search_context: string | null;
          status: string;
          title: string;
          updated_at: string;
          vendor_responded_at: string | null;
        };
        Insert: {
          business_id?: string | null;
          category_id?: string | null;
          created_at?: string;
          details?: string | null;
          guest_intent_id?: string | null;
          id?: string;
          listing_id?: string | null;
          market_id: string;
          request_number?: string | null;
          requested_action?: string | null;
          requester_id?: string | null;
          search_context?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
          vendor_responded_at?: string | null;
        };
        Update: {
          business_id?: string | null;
          category_id?: string | null;
          created_at?: string;
          details?: string | null;
          guest_intent_id?: string | null;
          id?: string;
          listing_id?: string | null;
          market_id?: string;
          request_number?: string | null;
          requested_action?: string | null;
          requester_id?: string | null;
          search_context?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
          vendor_responded_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "requests_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "requests_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "requests_guest_intent_id_fkey";
            columns: ["guest_intent_id"];
            isOneToOne: false;
            referencedRelation: "guest_intents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "requests_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "requests_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "requests_requester_id_fkey";
            columns: ["requester_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      schema_fields: {
        Row: {
          created_at: string;
          data_type: string;
          display_order: number;
          id: string;
          is_filterable: boolean;
          is_required: boolean;
          key: string;
          label: string;
          listing_schema_id: string;
          updated_at: string;
          validation: Json;
        };
        Insert: {
          created_at?: string;
          data_type: string;
          display_order?: number;
          id?: string;
          is_filterable?: boolean;
          is_required?: boolean;
          key: string;
          label: string;
          listing_schema_id: string;
          updated_at?: string;
          validation?: Json;
        };
        Update: {
          created_at?: string;
          data_type?: string;
          display_order?: number;
          id?: string;
          is_filterable?: boolean;
          is_required?: boolean;
          key?: string;
          label?: string;
          listing_schema_id?: string;
          updated_at?: string;
          validation?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "schema_fields_listing_schema_id_fkey";
            columns: ["listing_schema_id"];
            isOneToOne: false;
            referencedRelation: "listing_schemas";
            referencedColumns: ["id"];
          },
        ];
      };
      search_intents: {
        Row: {
          category_id: string | null;
          confidence: number | null;
          created_at: string;
          extracted: Json;
          id: string;
          intent_kind: string;
          search_id: string;
        };
        Insert: {
          category_id?: string | null;
          confidence?: number | null;
          created_at?: string;
          extracted?: Json;
          id?: string;
          intent_kind: string;
          search_id: string;
        };
        Update: {
          category_id?: string | null;
          confidence?: number | null;
          created_at?: string;
          extracted?: Json;
          id?: string;
          intent_kind?: string;
          search_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "search_intents_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "search_intents_search_id_fkey";
            columns: ["search_id"];
            isOneToOne: true;
            referencedRelation: "searches";
            referencedColumns: ["id"];
          },
        ];
      };
      searches: {
        Row: {
          actor_id: string | null;
          created_at: string;
          deterministic_key: string;
          filters: Json;
          guest_intent_id: string | null;
          id: string;
          market_id: string | null;
          normalized_query: string;
          query_text: string;
          result_count: number;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          deterministic_key: string;
          filters?: Json;
          guest_intent_id?: string | null;
          id?: string;
          market_id?: string | null;
          normalized_query: string;
          query_text: string;
          result_count?: number;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          deterministic_key?: string;
          filters?: Json;
          guest_intent_id?: string | null;
          id?: string;
          market_id?: string | null;
          normalized_query?: string;
          query_text?: string;
          result_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "searches_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "searches_guest_intent_id_fkey";
            columns: ["guest_intent_id"];
            isOneToOne: false;
            referencedRelation: "guest_intents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "searches_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
        ];
      };
      system_events: {
        Row: {
          event_type: string;
          id: string;
          occurred_at: string;
          payload: Json;
          source: string;
        };
        Insert: {
          event_type: string;
          id?: string;
          occurred_at?: string;
          payload?: Json;
          source: string;
        };
        Update: {
          event_type?: string;
          id?: string;
          occurred_at?: string;
          payload?: Json;
          source?: string;
        };
        Relationships: [];
      };
      unmet_demand: {
        Row: {
          category_id: string | null;
          created_at: string;
          deterministic_key: string;
          evidence_count: number;
          id: string;
          market_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          category_id?: string | null;
          created_at?: string;
          deterministic_key: string;
          evidence_count?: number;
          id?: string;
          market_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          category_id?: string | null;
          created_at?: string;
          deterministic_key?: string;
          evidence_count?: number;
          id?: string;
          market_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "unmet_demand_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "unmet_demand_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_inbox: {
        Row: {
          id: string;
          payload: Json;
          processed_at: string | null;
          processing_error: string | null;
          provider: string;
          provider_event_id: string;
          received_at: string;
        };
        Insert: {
          id?: string;
          payload?: Json;
          processed_at?: string | null;
          processing_error?: string | null;
          provider: string;
          provider_event_id: string;
          received_at?: string;
        };
        Update: {
          id?: string;
          payload?: Json;
          processed_at?: string | null;
          processing_error?: string | null;
          provider?: string;
          provider_event_id?: string;
          received_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      cancel_listing_media_upload: {
        Args: { p_listing_id: string; p_storage_path: string };
        Returns: boolean;
      };
      claim_guest_intent: {
        Args: { p_intent_id: string; p_secret: string };
        Returns: Json;
      };
      claim_orphan_listing_media_cleanup: {
        Args: { p_batch_size?: number };
        Returns: {
          cleanup_claim_token: string;
          storage_path: string;
        }[];
      };
      complete_orphan_listing_media_cleanup: {
        Args: { p_cleanup_claim_token: string; p_storage_path: string };
        Returns: boolean;
      };
      confirm_listing_media_upload: {
        Args: { p_listing_id: string; p_storage_path: string };
        Returns: boolean;
      };
      consume_auth_rate_limit: {
        Args: { p_identifier: string; p_scope: string };
        Returns: boolean;
      };
      consume_media_upload_rate_limit: { Args: never; Returns: boolean };
      create_guest_intent: {
        Args: {
          p_kind: string;
          p_payload: Json;
          p_rate_limit_key: string;
          p_return_to: string;
        };
        Returns: {
          expires_at: string;
          id: string;
          secret: string;
        }[];
      };
      create_or_get_my_referral_link: {
        Args: { p_market_id: string };
        Returns: {
          code: string;
          expires_at: string;
          link_id: string;
          market_id: string;
          status: string;
          target: string;
        }[];
      };
      create_listing_order_from_intent: {
        Args: { p_intent_id: string };
        Returns: {
          business_id: string | null;
          created_at: string | null;
          currency_code: string | null;
          listing_id: string | null;
          listing_route: string | null;
          listing_title: string | null;
          market_slug: string | null;
          order_id: string | null;
          order_number: string | null;
          outcome: string;
          placed_at: string | null;
          quantity: number | null;
          retryable: boolean;
          status: string | null;
          total_minor: number | null;
          fulfilment_id: string | null;
          fulfilment_status: string | null;
          fulfilment_started_at: string | null;
          fulfilment_updated_at: string | null;
          unit_price_minor: number | null;
          vendor_decided_at: string | null;
          vendor_name: string | null;
        }[];
      };
      create_listing_order_intent: {
        Args: {
          p_listing_id: string;
          p_quantity: number;
          p_rate_limit_key: string;
        };
        Returns: {
          expires_at: string;
          id: string;
          secret: string;
        }[];
      };
      create_listing_request_from_intent: {
        Args: { p_details: string | null; p_intent_id: string };
        Returns: {
          created_at: string | null;
          details: string | null;
          listing_id: string | null;
          listing_route: string | null;
          listing_title: string | null;
          market_slug: string | null;
          outcome: string;
          request_id: string | null;
          request_number: string | null;
          requested_action: string | null;
          retryable: boolean;
          status: string | null;
          vendor_name: string | null;
        }[];
      };
      create_listing_request_intent: {
        Args: {
          p_listing_id: string;
          p_rate_limit_key: string;
          p_requested_action: string;
          p_search_context: string | null;
        };
        Returns: {
          expires_at: string;
          id: string;
          secret: string;
        }[];
      };
      ensure_my_referrer_identity: {
        Args: never;
        Returns: {
          created_at: string;
          profile_id: string;
          status: string;
        }[];
      };
      expire_listing_media_upload_reservations: {
        Args: never;
        Returns: number;
      };
      fail_orphan_listing_media_cleanup: {
        Args: {
          p_cleanup_claim_token: string;
          p_error: string;
          p_storage_path: string;
        };
        Returns: boolean;
      };
      get_customer_listing_request: {
        Args: { p_request_id: string };
        Returns: {
          business_id: string;
          created_at: string;
          details: string | null;
          listing_id: string;
          listing_route: string;
          listing_title: string;
          market_id: string;
          market_slug: string;
          request_id: string;
          request_number: string;
          requested_action: string;
          search_context: string | null;
          status: string;
          vendor_name: string;
          vendor_responded_at: string | null;
        }[];
      };
      get_customer_order: {
        Args: { p_market_slug: string; p_order_number: string };
        Returns: {
          business_id: string;
          created_at: string;
          currency_code: string;
          listing_id: string;
          listing_route: string;
          listing_title: string;
          market_slug: string;
          order_id: string;
          order_number: string;
          placed_at: string;
          quantity: number;
          status: string;
          total_minor: number;
          fulfilment_id: string | null;
          fulfilment_status: string | null;
          fulfilment_started_at: string | null;
          fulfilment_updated_at: string | null;
          unit_price_minor: number;
          vendor_decided_at: string | null;
          vendor_name: string;
        }[];
      };
      get_listing_draft_context: {
        Args: { p_business_id?: string; p_listing_id?: string };
        Returns: {
          business_id: string;
          category_id: string;
          category_slug: string;
          draft_revision: number;
          listing_id: string;
          listing_schema_id: string;
          listing_type_code: string;
          listing_type_id: string;
          mode: string;
          schema_document: Json;
          schema_key: string;
          schema_version: number;
          slug: string;
          updated_at: string;
          values: Json;
        }[];
      };
      get_listing_order_intent: {
        Args: { p_intent_id: string };
        Returns: {
          business_id: string;
          claimed_at: string;
          consumed_at: string;
          currency_code: string;
          expires_at: string;
          intent_id: string;
          listing_id: string;
          listing_route: string;
          listing_title: string;
          market_id: string;
          market_slug: string;
          order_created_at: string;
          order_id: string;
          order_number: string;
          order_status: string;
          quantity: number;
          return_to: string;
          total_minor: number;
          unit_price_minor: number;
          vendor_name: string;
        }[];
      };
      list_super_admin_pending_businesses: {
        Args: {
          p_after_business_id?: string;
          p_after_submitted_at?: string;
          p_limit?: number;
          p_market_id: string;
        };
        Returns: {
          business_id: string;
          business_name: string;
          category_slug: string;
          has_more: boolean;
          market_id: string;
          market_name: string;
          market_slug: string;
          submitted_at: string;
        }[];
      };
      get_listing_request_intent: {
        Args: { p_intent_id: string };
        Returns: {
          business_id: string;
          category_id: string;
          claimed_at: string | null;
          consumed_at: string | null;
          expires_at: string;
          intent_id: string;
          listing_id: string;
          listing_route: string;
          listing_title: string;
          market_id: string;
          market_slug: string;
          request_created_at: string | null;
          request_id: string | null;
          request_number: string | null;
          request_status: string | null;
          requested_action: string | null;
          return_to: string;
          search_context: string | null;
          vendor_name: string;
        }[];
      };
      get_tool_gateway_platform_summary: {
        Args: { p_invocation_id: string; p_market_slug: string };
        Returns: {
          active_category_count: number | null;
          active_vendor_count: number | null;
          audit_event_id: string | null;
          country_code: string | null;
          currency_code: string | null;
          invocation_id: string;
          market_id: string | null;
          market_name: string | null;
          market_slug: string | null;
          observed_at: string;
          orderable_listing_count: number | null;
          outcome: string;
          published_listing_count: number | null;
          timezone: string | null;
        }[];
      };
      get_vendor_order: {
        Args: { p_order_number: string };
        Returns: {
          business_id: string;
          created_at: string;
          currency_code: string;
          listing_id: string;
          listing_route: string;
          listing_title: string;
          market_slug: string;
          order_id: string;
          order_number: string;
          placed_at: string;
          quantity: number;
          status: string;
          total_minor: number;
          fulfilment_id: string | null;
          fulfilment_status: string | null;
          fulfilment_started_at: string | null;
          fulfilment_updated_at: string | null;
          unit_price_minor: number;
          vendor_decided_at: string | null;
          vendor_name: string;
        }[];
      };
      has_capability: {
        Args: { required: Database["public"]["Enums"]["profile_capability"] };
        Returns: boolean;
      };
      has_confirmed_listing_media_upload: {
        Args: { p_listing_id: string; p_storage_path: string };
        Returns: boolean;
      };
      has_reserved_listing_media_upload: {
        Args: { p_storage_path: string };
        Returns: boolean;
      };
      is_active_profile: { Args: { target_profile: string }; Returns: boolean };
      is_business_manager: {
        Args: { target_business: string };
        Returns: boolean;
      };
      is_business_member: {
        Args: { target_business: string };
        Returns: boolean;
      };
      is_current_profile_active: { Args: never; Returns: boolean };
      is_valid_completed_onboarding_draft: {
        Args: { draft_data: Json; target_business: string };
        Returns: boolean;
      };
      journal_matches_lines: {
        Args: { p_journal_id: string; p_lines: Json };
        Returns: boolean;
      };
      list_customer_listing_requests: {
        Args: { p_market_slug: string };
        Returns: {
          business_id: string;
          created_at: string;
          details: string | null;
          listing_id: string;
          listing_route: string;
          listing_title: string;
          market_id: string;
          market_slug: string;
          request_id: string;
          request_number: string;
          requested_action: string;
          search_context: string | null;
          status: string;
          vendor_name: string;
          vendor_responded_at: string | null;
        }[];
      };
      list_my_referral_links: {
        Args: never;
        Returns: {
          code: string;
          expires_at: string;
          link_id: string;
          market_id: string;
          status: string;
          target: string;
        }[];
      };
      list_my_notifications: {
        Args: {
          p_before_created_at?: string | null;
          p_before_id?: string | null;
          p_limit?: number;
          p_unread_only?: boolean;
        };
        Returns: {
          action_path: string | null;
          body: string;
          created_at: string;
          market_id: string | null;
          notification_id: string;
          read_at: string | null;
          template_key: string;
          template_version: number;
          title: string;
        }[];
      };
      list_customer_orders: {
        Args: { p_market_slug: string };
        Returns: {
          business_id: string;
          created_at: string;
          currency_code: string;
          listing_id: string;
          listing_route: string;
          listing_title: string;
          market_slug: string;
          order_id: string;
          order_number: string;
          placed_at: string;
          quantity: number;
          status: string;
          total_minor: number;
          fulfilment_id: string | null;
          fulfilment_status: string | null;
          fulfilment_started_at: string | null;
          fulfilment_updated_at: string | null;
          unit_price_minor: number;
          vendor_decided_at: string | null;
          vendor_name: string;
        }[];
      };
      list_vendor_listing_requests: {
        Args: never;
        Returns: {
          business_id: string;
          created_at: string;
          details: string | null;
          listing_id: string;
          listing_route: string;
          listing_title: string;
          market_id: string;
          market_slug: string;
          request_id: string;
          request_number: string;
          requested_action: string;
          search_context: string | null;
          status: string;
          vendor_name: string;
          vendor_responded_at: string | null;
        }[];
      };
      list_vendor_orders: {
        Args: never;
        Returns: {
          business_id: string;
          created_at: string;
          currency_code: string;
          listing_id: string;
          listing_route: string;
          listing_title: string;
          market_slug: string;
          order_id: string;
          order_number: string;
          placed_at: string;
          quantity: number;
          status: string;
          total_minor: number;
          fulfilment_id: string | null;
          fulfilment_status: string | null;
          fulfilment_started_at: string | null;
          fulfilment_updated_at: string | null;
          unit_price_minor: number;
          vendor_decided_at: string | null;
          vendor_name: string;
        }[];
      };
      mark_listing_media_upload_removed: {
        Args: { p_listing_id: string; p_storage_path: string };
        Returns: boolean;
      };
      mark_my_notification_read: {
        Args: { p_notification_id: string };
        Returns: {
          notification_id: string | null;
          outcome: string;
          read_at: string | null;
        }[];
      };
      record_my_unmet_demand_zero_result: {
        Args: { p_category_id: string; p_market_slug: string };
        Returns: boolean;
      };
      post_journal: {
        Args: {
          p_description: string;
          p_lines: Json;
          p_posting_key: string;
          p_reference_id: string;
          p_reference_type: string;
        };
        Returns: string;
      };
      prune_listing_draft_internal_state: {
        Args: { p_batch_size?: number };
        Returns: {
          idempotency_rows_pruned: number;
          rate_limit_rows_pruned: number;
        }[];
      };
      prune_listing_order_intents: {
        Args: { p_batch_size?: number };
        Returns: {
          auth_rate_limits_pruned: number;
          listing_order_intents_pruned: number;
        }[];
      };
      prune_listing_order_fulfilment_processing: {
        Args: { p_batch_size?: number };
        Returns: {
          processing_rows_pruned: number;
          rate_limits_pruned: number;
        }[];
      };
      prune_listing_order_vendor_transitions: {
        Args: { p_batch_size?: number };
        Returns: {
          rate_limits_pruned: number;
          transitions_pruned: number;
        }[];
      };
      prune_listing_request_intents: {
        Args: { p_batch_size?: number };
        Returns: {
          actor_rate_limits_pruned: number;
          auth_rate_limits_pruned: number;
          listing_request_intents_pruned: number;
        }[];
      };
      prune_listing_request_vendor_response_rate_limits: {
        Args: { p_batch_size?: number };
        Returns: number;
      };
      prune_listing_request_vendor_responses: {
        Args: { p_batch_size?: number };
        Returns: number;
      };
      reserve_listing_media_upload: {
        Args: { p_listing_id: string; p_storage_path: string };
        Returns: string;
      };
      resolve_referral_acquisition_link: {
        Args: { p_code: string };
        Returns: {
          canonical_target_path: string;
          expires_at: string;
          market_slug: string;
          outcome: string;
          target: string;
        }[];
      };
      start_listing_order_fulfilment: {
        Args: { p_idempotency_key: string; p_order_id: string };
        Returns: {
          fulfilment_id: string | null;
          fulfilment_started_at: string | null;
          fulfilment_status: string | null;
          fulfilment_updated_at: string | null;
          order_id: string | null;
          order_status: string | null;
          outcome: string;
          retryable: boolean;
        }[];
      };
      respond_to_listing_order: {
        Args: {
          p_decision: string;
          p_idempotency_key: string;
          p_order_id: string;
        };
        Returns: {
          order_id: string | null;
          outcome: string;
          retryable: boolean;
          status: string | null;
          updated_at: string | null;
          vendor_decided_at: string | null;
        }[];
      };
      respond_to_listing_request: {
        Args: {
          p_decision: string;
          p_idempotency_key: string;
          p_request_id: string;
        };
        Returns: {
          outcome: string;
          request_id: string | null;
          retryable: boolean;
          status: string | null;
          updated_at: string | null;
          vendor_responded_at: string | null;
        }[];
      };
      reversal_matches_original: {
        Args: { p_original_id: string; p_reversal_id: string };
        Returns: boolean;
      };
      reverse_posted_journal: {
        Args: {
          p_description: string;
          p_original_journal: string;
          p_posting_key: string;
        };
        Returns: string;
      };
      save_business_onboarding_draft: {
        Args: { draft_data: Json; next_step: string; target_business: string };
        Returns: undefined;
      };
      save_listing_draft: {
        Args: {
          p_business_id?: string;
          p_expected_revision?: number;
          p_expected_schema_id: string;
          p_expected_schema_version: number;
          p_idempotency_key?: string;
          p_listing_id?: string;
          p_payload: Json;
        };
        Returns: {
          business_id: string;
          created_at: string;
          draft_revision: number;
          listing_id: string;
          listing_schema_id: string;
          schema_key: string;
          schema_version: number;
          updated_at: string;
        }[];
      };
      set_my_referral_link_enabled: {
        Args: { p_enabled: boolean; p_link_id: string };
        Returns: {
          code: string;
          expires_at: string;
          link_id: string;
          market_id: string;
          status: string;
          target: string;
        }[];
      };
      set_profile_suspension: {
        Args: {
          reason: string;
          should_suspend: boolean;
          target_profile: string;
        };
        Returns: undefined;
      };
      start_business_onboarding: {
        Args: {
          business_name: string;
          business_slug: string;
          target_market: string;
        };
        Returns: string;
      };
      transition_business_status: {
        Args: { next_status: string; reason: string; target_business: string };
        Returns: undefined;
      };
    };
    Enums: {
      business_member_role: "owner" | "manager" | "staff";
      ledger_direction: "debit" | "credit";
      listing_status: "draft" | "active" | "paused" | "archived";
      order_status:
        | "draft"
        | "placed"
        | "confirmed"
        | "fulfilled"
        | "cancelled"
        | "refunded";
      payment_status:
        | "pending"
        | "authorized"
        | "succeeded"
        | "failed"
        | "refunded"
        | "cancelled";
      profile_capability:
        | "customer"
        | "merchant"
        | "referrer"
        | "support"
        | "admin"
        | "super_admin";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      business_member_role: ["owner", "manager", "staff"],
      ledger_direction: ["debit", "credit"],
      listing_status: ["draft", "active", "paused", "archived"],
      order_status: [
        "draft",
        "placed",
        "confirmed",
        "fulfilled",
        "cancelled",
        "refunded",
      ],
      payment_status: [
        "pending",
        "authorized",
        "succeeded",
        "failed",
        "refunded",
        "cancelled",
      ],
      profile_capability: [
        "customer",
        "merchant",
        "referrer",
        "support",
        "admin",
        "super_admin",
      ],
    },
  },
} as const;
