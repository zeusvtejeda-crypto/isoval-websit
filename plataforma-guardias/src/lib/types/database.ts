export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      app_settings: {
        Row: {
          description: string | null;
          is_public: boolean;
          key: string;
          updated_at: string;
          updated_by: string | null;
          value: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          description?: string | null;
          is_public?: boolean;
          key: string;
          updated_at?: string;
          updated_by?: string | null;
          value: NonNullable<Json>;
        };
        Update: {
          description?: string | null;
          is_public?: boolean;
          key?: string;
          updated_at?: string;
          updated_by?: string | null;
          value?: NonNullable<Json>;
        };
        Relationships: [];
      };
      attendance_sessions: {
        Row: {
          assignment_id: string;
          check_in_at: string;
          check_in_by: string;
          check_in_method: Database["public"]["Enums"]["attendance_method"];
          check_in_reason: string | null;
          check_in_request_id: string;
          check_out_at: string | null;
          check_out_by: string | null;
          check_out_method: Database["public"]["Enums"]["attendance_method"] | null;
          check_out_reason: string | null;
          check_out_request_id: string | null;
          created_at: string;
          facility_id: string;
          id: string;
          notes: string | null;
          record_status: Database["public"]["Enums"]["record_status"];
          shift_id: string;
          status_changed_at: string | null;
          status_changed_by: string | null;
          status_reason: string | null;
          supersedes_id: string | null;
          worker_id: string;
        };
        ComputedFields: never;
        Insert: {
          assignment_id: string;
          check_in_at: string;
          check_in_by: string;
          check_in_method: Database["public"]["Enums"]["attendance_method"];
          check_in_reason?: string | null;
          check_in_request_id: string;
          check_out_at?: string | null;
          check_out_by?: string | null;
          check_out_method?: Database["public"]["Enums"]["attendance_method"] | null;
          check_out_reason?: string | null;
          check_out_request_id?: string | null;
          created_at?: string;
          facility_id: string;
          id?: string;
          notes?: string | null;
          record_status?: Database["public"]["Enums"]["record_status"];
          shift_id: string;
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          status_reason?: string | null;
          supersedes_id?: string | null;
          worker_id: string;
        };
        Update: {
          assignment_id?: string;
          check_in_at?: string;
          check_in_by?: string;
          check_in_method?: Database["public"]["Enums"]["attendance_method"];
          check_in_reason?: string | null;
          check_in_request_id?: string;
          check_out_at?: string | null;
          check_out_by?: string | null;
          check_out_method?: Database["public"]["Enums"]["attendance_method"] | null;
          check_out_reason?: string | null;
          check_out_request_id?: string | null;
          created_at?: string;
          facility_id?: string;
          id?: string;
          notes?: string | null;
          record_status?: Database["public"]["Enums"]["record_status"];
          shift_id?: string;
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          status_reason?: string | null;
          supersedes_id?: string | null;
          worker_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_sessions_assignment_id_fkey";
            columns: ["assignment_id"];
            isOneToOne: false;
            referencedRelation: "shift_assignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_sessions_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_sessions_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "public_facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_sessions_shift_id_fkey";
            columns: ["shift_id"];
            isOneToOne: false;
            referencedRelation: "shifts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_sessions_supersedes_id_fkey";
            columns: ["supersedes_id"];
            isOneToOne: false;
            referencedRelation: "attendance_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_sessions_worker_id_fkey";
            columns: ["worker_id"];
            isOneToOne: false;
            referencedRelation: "workers";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_role: string | null;
          changed_fields: string[] | null;
          facility_id: string | null;
          id: number;
          new_data: Json | null;
          occurred_at: string;
          old_data: Json | null;
          reason: string | null;
          record_id: string | null;
          table_name: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_role?: string | null;
          changed_fields?: string[] | null;
          facility_id?: string | null;
          id?: never;
          new_data?: Json | null;
          occurred_at?: string;
          old_data?: Json | null;
          reason?: string | null;
          record_id?: string | null;
          table_name: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_role?: string | null;
          changed_fields?: string[] | null;
          facility_id?: string | null;
          id?: never;
          new_data?: Json | null;
          occurred_at?: string;
          old_data?: Json | null;
          reason?: string | null;
          record_id?: string | null;
          table_name?: string;
        };
        Relationships: [];
      };
      correction_requests: {
        Row: {
          assignment_id: string;
          created_at: string;
          facility_id: string;
          id: string;
          reason: string;
          requested_by: string;
          requested_check_in_at: string | null;
          requested_check_out_at: string | null;
          resulting_session_id: string | null;
          review_notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          session_id: string | null;
          status: Database["public"]["Enums"]["correction_status"];
          worker_id: string;
        };
        ComputedFields: never;
        Insert: {
          assignment_id: string;
          created_at?: string;
          facility_id: string;
          id?: string;
          reason: string;
          requested_by: string;
          requested_check_in_at?: string | null;
          requested_check_out_at?: string | null;
          resulting_session_id?: string | null;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          session_id?: string | null;
          status?: Database["public"]["Enums"]["correction_status"];
          worker_id: string;
        };
        Update: {
          assignment_id?: string;
          created_at?: string;
          facility_id?: string;
          id?: string;
          reason?: string;
          requested_by?: string;
          requested_check_in_at?: string | null;
          requested_check_out_at?: string | null;
          resulting_session_id?: string | null;
          review_notes?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          session_id?: string | null;
          status?: Database["public"]["Enums"]["correction_status"];
          worker_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "correction_requests_assignment_id_fkey";
            columns: ["assignment_id"];
            isOneToOne: false;
            referencedRelation: "shift_assignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "correction_requests_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "correction_requests_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "public_facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "correction_requests_resulting_session_id_fkey";
            columns: ["resulting_session_id"];
            isOneToOne: false;
            referencedRelation: "attendance_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "correction_requests_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "attendance_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "correction_requests_worker_id_fkey";
            columns: ["worker_id"];
            isOneToOne: false;
            referencedRelation: "workers";
            referencedColumns: ["id"];
          },
        ];
      };
      facilities: {
        Row: {
          active: boolean;
          address: string | null;
          arrival_tolerance_minutes: number;
          category_id: number;
          change_reason: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          internal_code: string;
          is_demo: boolean;
          is_public: boolean;
          last_verified_at: string | null;
          latitude: number | null;
          longitude: number | null;
          municipality_id: number | null;
          normalized_name: string | null;
          notes: string | null;
          official_name: string;
          phone: string | null;
          schedule: string | null;
          services: string[];
          services_verified: boolean;
          source: string;
          source_url: string | null;
          state_id: number;
          timezone: string;
          unit_key: string | null;
          updated_at: string;
          updated_by: string | null;
          verification_status: Database["public"]["Enums"]["verification_status"];
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          address?: string | null;
          arrival_tolerance_minutes?: number;
          category_id: number;
          change_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          internal_code?: string;
          is_demo?: boolean;
          is_public?: boolean;
          last_verified_at?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          municipality_id?: number | null;
          normalized_name?: never;
          notes?: string | null;
          official_name: string;
          phone?: string | null;
          schedule?: string | null;
          services?: string[];
          services_verified?: boolean;
          source?: string;
          source_url?: string | null;
          state_id: number;
          timezone?: string;
          unit_key?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          verification_status?: Database["public"]["Enums"]["verification_status"];
        };
        Update: {
          active?: boolean;
          address?: string | null;
          arrival_tolerance_minutes?: number;
          category_id?: number;
          change_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          internal_code?: string;
          is_demo?: boolean;
          is_public?: boolean;
          last_verified_at?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          municipality_id?: number | null;
          normalized_name?: never;
          notes?: string | null;
          official_name?: string;
          phone?: string | null;
          schedule?: string | null;
          services?: string[];
          services_verified?: boolean;
          source?: string;
          source_url?: string | null;
          state_id?: number;
          timezone?: string;
          unit_key?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          verification_status?: Database["public"]["Enums"]["verification_status"];
        };
        Relationships: [
          {
            foreignKeyName: "facilities_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "facility_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "facilities_municipality_state_fk";
            columns: ["municipality_id", "state_id"];
            isOneToOne: false;
            referencedRelation: "municipalities";
            referencedColumns: ["id", "state_id"];
          },
          {
            foreignKeyName: "facilities_state_id_fkey";
            columns: ["state_id"];
            isOneToOne: false;
            referencedRelation: "states";
            referencedColumns: ["id"];
          },
        ];
      };
      facility_categories: {
        Row: {
          active: boolean;
          color: string;
          created_at: string;
          description: string | null;
          icon: string;
          id: number;
          name: string;
          slug: string;
          sort_order: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          color?: string;
          created_at?: string;
          description?: string | null;
          icon?: string;
          id?: never;
          name: string;
          slug: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          color?: string;
          created_at?: string;
          description?: string | null;
          icon?: string;
          id?: never;
          name?: string;
          slug?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      incident_notes: {
        Row: {
          assignment_id: string;
          created_at: string;
          created_by: string | null;
          facility_id: string;
          id: string;
          incident_type: Database["public"]["Enums"]["incident_type"];
          justified: boolean;
          note: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          assignment_id: string;
          created_at?: string;
          created_by?: string | null;
          facility_id: string;
          id?: string;
          incident_type: Database["public"]["Enums"]["incident_type"];
          justified?: boolean;
          note: string;
          updated_at?: string;
        };
        Update: {
          assignment_id?: string;
          created_at?: string;
          created_by?: string | null;
          facility_id?: string;
          id?: string;
          incident_type?: Database["public"]["Enums"]["incident_type"];
          justified?: boolean;
          note?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "incident_notes_assignment_id_fkey";
            columns: ["assignment_id"];
            isOneToOne: false;
            referencedRelation: "shift_assignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incident_notes_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incident_notes_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "public_facilities";
            referencedColumns: ["id"];
          },
        ];
      };
      municipalities: {
        Row: {
          id: number;
          inegi_code: string;
          name: string;
          state_id: number;
          timezone: string | null;
        };
        ComputedFields: never;
        Insert: {
          id?: never;
          inegi_code: string;
          name: string;
          state_id: number;
          timezone?: string | null;
        };
        Update: {
          id?: never;
          inegi_code?: string;
          name?: string;
          state_id?: number;
          timezone?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "municipalities_state_id_fkey";
            columns: ["state_id"];
            isOneToOne: false;
            referencedRelation: "states";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          active: boolean;
          change_reason: string | null;
          created_at: string;
          display_name: string | null;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          updated_at: string;
          worker_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          change_reason?: string | null;
          created_at?: string;
          display_name?: string | null;
          id: string;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
          worker_id?: string | null;
        };
        Update: {
          active?: boolean;
          change_reason?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          updated_at?: string;
          worker_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_worker_id_fkey";
            columns: ["worker_id"];
            isOneToOne: true;
            referencedRelation: "workers";
            referencedColumns: ["id"];
          },
        ];
      };
      shift_assignments: {
        Row: {
          assigned_point: string | null;
          change_reason: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          notes: string | null;
          shift_id: string;
          status: Database["public"]["Enums"]["assignment_status"];
          status_changed_at: string | null;
          status_changed_by: string | null;
          status_reason: string | null;
          substitute_for_worker_id: string | null;
          updated_at: string;
          worker_id: string;
        };
        ComputedFields: never;
        Insert: {
          assigned_point?: string | null;
          change_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          shift_id: string;
          status?: Database["public"]["Enums"]["assignment_status"];
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          status_reason?: string | null;
          substitute_for_worker_id?: string | null;
          updated_at?: string;
          worker_id: string;
        };
        Update: {
          assigned_point?: string | null;
          change_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          shift_id?: string;
          status?: Database["public"]["Enums"]["assignment_status"];
          status_changed_at?: string | null;
          status_changed_by?: string | null;
          status_reason?: string | null;
          substitute_for_worker_id?: string | null;
          updated_at?: string;
          worker_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shift_assignments_shift_id_fkey";
            columns: ["shift_id"];
            isOneToOne: false;
            referencedRelation: "shifts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shift_assignments_substitute_for_worker_id_fkey";
            columns: ["substitute_for_worker_id"];
            isOneToOne: false;
            referencedRelation: "workers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shift_assignments_worker_id_fkey";
            columns: ["worker_id"];
            isOneToOne: false;
            referencedRelation: "workers";
            referencedColumns: ["id"];
          },
        ];
      };
      shifts: {
        Row: {
          cancel_reason: string | null;
          change_reason: string | null;
          created_at: string;
          created_by: string | null;
          ends_at: string;
          facility_id: string;
          id: string;
          instructions: string | null;
          is_demo: boolean;
          max_staff: number | null;
          meeting_point: string;
          min_staff: number;
          responsible_worker_id: string | null;
          starts_at: string;
          status: Database["public"]["Enums"]["shift_status"];
          title: string | null;
          updated_at: string;
          updated_by: string | null;
          effective_status: Database["public"]["Enums"]["shift_status"] | null;
        };
        ComputedFields: "effective_status";
        Insert: {
          cancel_reason?: string | null;
          change_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          ends_at: string;
          facility_id: string;
          id?: string;
          instructions?: string | null;
          is_demo?: boolean;
          max_staff?: number | null;
          meeting_point: string;
          min_staff?: number;
          responsible_worker_id?: string | null;
          starts_at: string;
          status?: Database["public"]["Enums"]["shift_status"];
          title?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          cancel_reason?: string | null;
          change_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          ends_at?: string;
          facility_id?: string;
          id?: string;
          instructions?: string | null;
          is_demo?: boolean;
          max_staff?: number | null;
          meeting_point?: string;
          min_staff?: number;
          responsible_worker_id?: string | null;
          starts_at?: string;
          status?: Database["public"]["Enums"]["shift_status"];
          title?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "shifts_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shifts_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "public_facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shifts_responsible_worker_id_fkey";
            columns: ["responsible_worker_id"];
            isOneToOne: false;
            referencedRelation: "workers";
            referencedColumns: ["id"];
          },
        ];
      };
      states: {
        Row: {
          abbreviation: string;
          default_timezone: string;
          enabled: boolean;
          id: number;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          abbreviation: string;
          default_timezone?: string;
          enabled?: boolean;
          id: number;
          name: string;
        };
        Update: {
          abbreviation?: string;
          default_timezone?: string;
          enabled?: boolean;
          id?: number;
          name?: string;
        };
        Relationships: [];
      };
      user_facility_scopes: {
        Row: {
          facility_id: string;
          granted_at: string;
          granted_by: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          facility_id: string;
          granted_at?: string;
          granted_by?: string | null;
          user_id: string;
        };
        Update: {
          facility_id?: string;
          granted_at?: string;
          granted_by?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_facility_scopes_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_facility_scopes_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "public_facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_facility_scopes_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      worker_private: {
        Row: {
          change_reason: string | null;
          employee_number: string | null;
          phone: string | null;
          updated_at: string;
          worker_id: string;
        };
        ComputedFields: never;
        Insert: {
          change_reason?: string | null;
          employee_number?: string | null;
          phone?: string | null;
          updated_at?: string;
          worker_id: string;
        };
        Update: {
          change_reason?: string | null;
          employee_number?: string | null;
          phone?: string | null;
          updated_at?: string;
          worker_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "worker_private_worker_id_fkey";
            columns: ["worker_id"];
            isOneToOne: true;
            referencedRelation: "workers";
            referencedColumns: ["id"];
          },
        ];
      };
      workers: {
        Row: {
          active: boolean;
          area: string | null;
          change_reason: string | null;
          created_at: string;
          created_by: string | null;
          facility_id: string | null;
          full_name: string;
          id: string;
          internal_code: string;
          is_demo: boolean;
          municipality_id: number | null;
          normalized_name: string | null;
          position: string | null;
          state_id: number;
          updated_at: string;
          updated_by: string | null;
          usual_shift: string | null;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          area?: string | null;
          change_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          facility_id?: string | null;
          full_name: string;
          id?: string;
          internal_code?: string;
          is_demo?: boolean;
          municipality_id?: number | null;
          normalized_name?: never;
          position?: string | null;
          state_id: number;
          updated_at?: string;
          updated_by?: string | null;
          usual_shift?: string | null;
        };
        Update: {
          active?: boolean;
          area?: string | null;
          change_reason?: string | null;
          created_at?: string;
          created_by?: string | null;
          facility_id?: string | null;
          full_name?: string;
          id?: string;
          internal_code?: string;
          is_demo?: boolean;
          municipality_id?: number | null;
          normalized_name?: never;
          position?: string | null;
          state_id?: number;
          updated_at?: string;
          updated_by?: string | null;
          usual_shift?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "workers_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workers_facility_id_fkey";
            columns: ["facility_id"];
            isOneToOne: false;
            referencedRelation: "public_facilities";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workers_municipality_state_fk";
            columns: ["municipality_id", "state_id"];
            isOneToOne: false;
            referencedRelation: "municipalities";
            referencedColumns: ["id", "state_id"];
          },
          {
            foreignKeyName: "workers_state_id_fkey";
            columns: ["state_id"];
            isOneToOne: false;
            referencedRelation: "states";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      public_facilities: {
        Row: {
          address: string | null;
          category_id: number | null;
          description: string | null;
          id: string | null;
          internal_code: string | null;
          is_demo: boolean | null;
          last_verified_at: string | null;
          latitude: number | null;
          longitude: number | null;
          municipality_id: number | null;
          notes: string | null;
          official_name: string | null;
          phone: string | null;
          schedule: string | null;
          services: string[] | null;
          services_verified: boolean | null;
          source: string | null;
          source_url: string | null;
          state_id: number | null;
          timezone: string | null;
          unit_key: string | null;
          updated_at: string | null;
          verification_status: Database["public"]["Enums"]["verification_status"] | null;
        };
        ComputedFields: never;
        Insert: {
          address?: string | null;
          category_id?: number | null;
          description?: string | null;
          id?: string | null;
          internal_code?: string | null;
          is_demo?: boolean | null;
          last_verified_at?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          municipality_id?: number | null;
          notes?: string | null;
          official_name?: string | null;
          phone?: string | null;
          schedule?: string | null;
          services?: never;
          services_verified?: boolean | null;
          source?: string | null;
          source_url?: string | null;
          state_id?: number | null;
          timezone?: string | null;
          unit_key?: string | null;
          updated_at?: string | null;
          verification_status?: Database["public"]["Enums"]["verification_status"] | null;
        };
        Update: {
          address?: string | null;
          category_id?: number | null;
          description?: string | null;
          id?: string | null;
          internal_code?: string | null;
          is_demo?: boolean | null;
          last_verified_at?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          municipality_id?: number | null;
          notes?: string | null;
          official_name?: string | null;
          phone?: string | null;
          schedule?: string | null;
          services?: never;
          services_verified?: boolean | null;
          source?: string | null;
          source_url?: string | null;
          state_id?: number | null;
          timezone?: string | null;
          unit_key?: string | null;
          updated_at?: string | null;
          verification_status?: Database["public"]["Enums"]["verification_status"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "facilities_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "facility_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "facilities_municipality_state_fk";
            columns: ["municipality_id", "state_id"];
            isOneToOne: false;
            referencedRelation: "municipalities";
            referencedColumns: ["id", "state_id"];
          },
          {
            foreignKeyName: "facilities_state_id_fkey";
            columns: ["state_id"];
            isOneToOne: false;
            referencedRelation: "states";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      add_manual_attendance: {
        Args: {
          p_assignment_id: string;
          p_check_in_at: string;
          p_check_out_at: string;
          p_notes?: string;
          p_reason: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      apply_retention_policy: { Args: { p_execute?: boolean }; Returns: Json };
      check_in: {
        Args: {
          p_assignment_id: string;
          p_notes?: string;
          p_reason?: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      check_out: {
        Args: {
          p_assignment_id: string;
          p_notes?: string;
          p_reason?: string;
          p_request_id: string;
        };
        Returns: Json;
      };
      correct_attendance: {
        Args: {
          p_check_in_at: string;
          p_check_out_at: string;
          p_notes?: string;
          p_reason: string;
          p_session_id: string;
        };
        Returns: Json;
      };
      effective_status: {
        Args: {
          s: Omit<
            Database["public"]["Tables"]["shifts"]["Row"],
            Database["public"]["Tables"]["shifts"]["ComputedFields"]
          >;
        };
        Returns: Database["public"]["Enums"]["shift_status"];
      };
      get_my_assignments: {
        Args: { p_from: string; p_to: string };
        Returns: {
          arrival_tolerance_minutes: number;
          assigned_point: string;
          assignment_id: string;
          assignment_status: Database["public"]["Enums"]["assignment_status"];
          ends_at: string;
          facility_id: string;
          facility_name: string;
          facility_timezone: string;
          instructions: string;
          meeting_point: string;
          responsible_name: string;
          shift_id: string;
          shift_status: Database["public"]["Enums"]["shift_status"];
          shift_title: string;
          starts_at: string;
          substitute_for_name: string;
        }[];
      };
      purge_demo_data: { Args: Record<PropertyKey, never>; Returns: Json };
      request_correction: {
        Args: {
          p_assignment_id: string;
          p_check_in_at: string;
          p_check_out_at: string;
          p_reason: string;
          p_session_id: string;
        };
        Returns: {
          assignment_id: string;
          created_at: string;
          facility_id: string;
          id: string;
          reason: string;
          requested_by: string;
          requested_check_in_at: string | null;
          requested_check_out_at: string | null;
          resulting_session_id: string | null;
          review_notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          session_id: string | null;
          status: Database["public"]["Enums"]["correction_status"];
          worker_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "correction_requests";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      review_correction: {
        Args: { p_approve: boolean; p_notes?: string; p_request_id: string };
        Returns: {
          assignment_id: string;
          created_at: string;
          facility_id: string;
          id: string;
          reason: string;
          requested_by: string;
          requested_check_in_at: string | null;
          requested_check_out_at: string | null;
          resulting_session_id: string | null;
          review_notes: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          session_id: string | null;
          status: Database["public"]["Enums"]["correction_status"];
          worker_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "correction_requests";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      server_time: { Args: Record<PropertyKey, never>; Returns: string };
      set_assignment_status: {
        Args: {
          p_assignment_id: string;
          p_reason: string;
          p_status: Database["public"]["Enums"]["assignment_status"];
        };
        Returns: {
          assigned_point: string | null;
          change_reason: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          notes: string | null;
          shift_id: string;
          status: Database["public"]["Enums"]["assignment_status"];
          status_changed_at: string | null;
          status_changed_by: string | null;
          status_reason: string | null;
          substitute_for_worker_id: string | null;
          updated_at: string;
          worker_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "shift_assignments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      void_attendance: { Args: { p_reason: string; p_session_id: string }; Returns: Json };
    };
    Enums: {
      app_role: "admin" | "coordinador" | "trabajador" | "auditor";
      assignment_status:
        | "asignado"
        | "ausencia_justificada"
        | "inasistencia_confirmada"
        | "cancelado";
      attendance_method: "propio" | "coordinador" | "qr" | "correccion";
      correction_status: "pendiente" | "aprobada" | "rechazada";
      incident_type:
        | "llegada_tardia"
        | "salida_anticipada"
        | "permanencia_adicional"
        | "sustitucion"
        | "correccion_administrativa"
        | "registro_incompleto";
      record_status: "vigente" | "corregido" | "anulado";
      shift_status: "programada" | "en_curso" | "finalizada" | "cancelada";
      verification_status: "verificado" | "pendiente";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

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
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "coordinador", "trabajador", "auditor"],
      assignment_status: [
        "asignado",
        "ausencia_justificada",
        "inasistencia_confirmada",
        "cancelado",
      ],
      attendance_method: ["propio", "coordinador", "qr", "correccion"],
      correction_status: ["pendiente", "aprobada", "rechazada"],
      incident_type: [
        "llegada_tardia",
        "salida_anticipada",
        "permanencia_adicional",
        "sustitucion",
        "correccion_administrativa",
        "registro_incompleto",
      ],
      record_status: ["vigente", "corregido", "anulado"],
      shift_status: ["programada", "en_curso", "finalizada", "cancelada"],
      verification_status: ["verificado", "pendiente"],
    },
  },
} as const;
