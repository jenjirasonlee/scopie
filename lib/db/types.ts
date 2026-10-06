// Database types for the Supabase client.
// Regenerate from a running local database with `pnpm db:types`; keep in sync with supabase/migrations.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '12';
  };
  public: {
    Tables: {
      account_group_members: {
        Row: { group_id: string; organization_id: string; social_account_id: string };
        Insert: { group_id: string; organization_id: string; social_account_id: string };
        Update: { group_id?: string; organization_id?: string; social_account_id?: string };
        Relationships: [];
      };
      account_groups: {
        Row: { created_at: string; id: string; kind: string; name: string; organization_id: string };
        Insert: { created_at?: string; id?: string; kind?: string; name: string; organization_id: string };
        Update: { created_at?: string; id?: string; kind?: string; name?: string; organization_id?: string };
        Relationships: [];
      };
      activity_log: {
        Row: {
          action: string;
          actor_id: string | null;
          changes: Json | null;
          created_at: string;
          entity_id: string;
          entity_type: string;
          id: number;
          organization_id: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      countries: {
        Row: { code: string; name: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      organization_members: {
        Row: {
          created_at: string;
          organization_id: string;
          role: Database['public']['Enums']['org_role'];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          organization_id: string;
          role: Database['public']['Enums']['org_role'];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          organization_id?: string;
          role?: Database['public']['Enums']['org_role'];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'organization_members_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'organization_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          created_by: string | null;
          default_timezone: string;
          id: string;
          is_demo: boolean;
          name: string;
          slug: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          default_timezone?: string;
          id?: string;
          is_demo?: boolean;
          name: string;
          slug: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          default_timezone?: string;
          id?: string;
          is_demo?: boolean;
          name?: string;
          slug?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      permissions: {
        Row: { description: string; key: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      platforms: {
        Row: {
          connector_status: Database['public']['Enums']['platform_connector_status'];
          key: string;
          name: string;
          sort_order: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          timezone: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          timezone?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          timezone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      role_permissions: {
        Row: { permission_key: string; role: Database['public']['Enums']['org_role'] };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      social_accounts: {
        Row: {
          account_type: string | null;
          connection_status: Database['public']['Enums']['account_connection_status'];
          country_code: string | null;
          created_at: string;
          created_by: string | null;
          display_name: string;
          external_id: string | null;
          handle: string | null;
          id: string;
          is_active: boolean;
          is_competitor: boolean;
          language: string | null;
          last_successful_sync_at: string | null;
          notes: string | null;
          organization_id: string;
          owner_user_id: string | null;
          platform_key: string;
          primary_data_source: Database['public']['Enums']['data_source'];
          timezone: string | null;
          updated_at: string;
        };
        Insert: {
          account_type?: string | null;
          connection_status?: Database['public']['Enums']['account_connection_status'];
          country_code?: string | null;
          created_at?: string;
          created_by?: string | null;
          display_name: string;
          external_id?: string | null;
          handle?: string | null;
          id?: string;
          is_active?: boolean;
          is_competitor?: boolean;
          language?: string | null;
          last_successful_sync_at?: string | null;
          notes?: string | null;
          organization_id: string;
          owner_user_id?: string | null;
          platform_key: string;
          primary_data_source?: Database['public']['Enums']['data_source'];
          timezone?: string | null;
          updated_at?: string;
        };
        Update: {
          account_type?: string | null;
          connection_status?: Database['public']['Enums']['account_connection_status'];
          country_code?: string | null;
          created_at?: string;
          created_by?: string | null;
          display_name?: string;
          external_id?: string | null;
          handle?: string | null;
          id?: string;
          is_active?: boolean;
          is_competitor?: boolean;
          language?: string | null;
          last_successful_sync_at?: string | null;
          notes?: string | null;
          organization_id?: string;
          owner_user_id?: string | null;
          platform_key?: string;
          primary_data_source?: Database['public']['Enums']['data_source'];
          timezone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'social_accounts_country_code_fkey';
            columns: ['country_code'];
            isOneToOne: false;
            referencedRelation: 'countries';
            referencedColumns: ['code'];
          },
          {
            foreignKeyName: 'social_accounts_organization_id_fkey';
            columns: ['organization_id'];
            isOneToOne: false;
            referencedRelation: 'organizations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'social_accounts_owner_user_id_fkey';
            columns: ['owner_user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'social_accounts_platform_key_fkey';
            columns: ['platform_key'];
            isOneToOne: false;
            referencedRelation: 'platforms';
            referencedColumns: ['key'];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      create_organization: {
        Args: { org_name: string; org_slug: string; org_timezone?: string };
        Returns: Database['public']['Tables']['organizations']['Row'];
      };
      has_org_permission: { Args: { org: string; permission: string }; Returns: boolean };
      is_org_member: { Args: { org: string }; Returns: boolean };
      org_role_of: { Args: { org: string }; Returns: Database['public']['Enums']['org_role'] };
    };
    Enums: {
      account_connection_status: 'not_connected' | 'connected' | 'needs_reauth' | 'error' | 'demo';
      data_source: 'live_api' | 'public_api' | 'manual' | 'import' | 'demo';
      org_role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'EDITOR' | 'VIEWER';
      platform_connector_status: 'available' | 'planned' | 'demo_only';
    };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicSchema = Database['public'];
export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row'];
export type TablesInsert<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update'];
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];
