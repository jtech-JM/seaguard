export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bmus: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          id: string
          name: string
          region: string | null
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          name: string
          region?: string | null
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          id?: string
          name?: string
          region?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      boats: {
        Row: {
          bmu_id: string | null
          boat_type: string | null
          created_at: string
          id: string
          name: string
          owner_fisherman_id: string | null
          registration_number: string | null
          updated_at: string
        }
        Insert: {
          bmu_id?: string | null
          boat_type?: string | null
          created_at?: string
          id?: string
          name: string
          owner_fisherman_id?: string | null
          registration_number?: string | null
          updated_at?: string
        }
        Update: {
          bmu_id?: string | null
          boat_type?: string | null
          created_at?: string
          id?: string
          name?: string
          owner_fisherman_id?: string | null
          registration_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boats_bmu_id_fkey"
            columns: ["bmu_id"]
            isOneToOne: false
            referencedRelation: "bmus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boats_owner_fisherman_id_fkey"
            columns: ["owner_fisherman_id"]
            isOneToOne: false
            referencedRelation: "fishermen"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          active: boolean
          assigned_at: string | null
          boat_id: string | null
          created_at: string
          device_id: string
          device_secret: string
          hardware_type: string | null
          id: string
          last_seen_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          assigned_at?: string | null
          boat_id?: string | null
          created_at?: string
          device_id: string
          device_secret?: string
          hardware_type?: string | null
          id?: string
          last_seen_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          assigned_at?: string | null
          boat_id?: string | null
          created_at?: string
          device_id?: string
          device_secret?: string
          hardware_type?: string | null
          id?: string
          last_seen_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
        ]
      }
      fishermen: {
        Row: {
          active: boolean
          bmu_id: string | null
          created_at: string
          created_by: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          full_name: string
          id: string
          national_id: string | null
          phone: string | null
          photo_url: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          bmu_id?: string | null
          created_at?: string
          created_by?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name: string
          id?: string
          national_id?: string | null
          phone?: string | null
          photo_url?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          bmu_id?: string | null
          created_at?: string
          created_by?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string
          id?: string
          national_id?: string | null
          phone?: string | null
          photo_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fishermen_bmu_id_fkey"
            columns: ["bmu_id"]
            isOneToOne: false
            referencedRelation: "bmus"
            referencedColumns: ["id"]
          },
        ]
      }
      gps_logs: {
        Row: {
          accuracy: number | null
          alert_id: string | null
          battery: number | null
          device_id: string
          heading: number | null
          id: string
          lat: number
          lng: number
          recorded_at: string
          speed: number | null
        }
        Insert: {
          accuracy?: number | null
          alert_id?: string | null
          battery?: number | null
          device_id: string
          heading?: number | null
          id?: string
          lat: number
          lng: number
          recorded_at?: string
          speed?: number | null
        }
        Update: {
          accuracy?: number | null
          alert_id?: string | null
          battery?: number | null
          device_id?: string
          heading?: number | null
          id?: string
          lat?: number
          lng?: number
          recorded_at?: string
          speed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "gps_logs_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "sos_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gps_logs_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          alert_id: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          error: string | null
          id: string
          payload: Json | null
          recipient: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
        }
        Insert: {
          alert_id?: string | null
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json | null
          recipient?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
        }
        Update: {
          alert_id?: string | null
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json | null
          recipient?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
        }
        Relationships: [
          {
            foreignKeyName: "notifications_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "sos_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          bmu_id: string | null
          created_at: string
          email: string | null
          fisherman_id: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          bmu_id?: string | null
          created_at?: string
          email?: string | null
          fisherman_id?: string | null
          full_name?: string | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          bmu_id?: string | null
          created_at?: string
          email?: string | null
          fisherman_id?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_bmu_id_fkey"
            columns: ["bmu_id"]
            isOneToOne: false
            referencedRelation: "bmus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_fisherman_id_fkey"
            columns: ["fisherman_id"]
            isOneToOne: false
            referencedRelation: "fishermen"
            referencedColumns: ["id"]
          },
        ]
      }
      rescue_operations: {
        Row: {
          alert_id: string
          assigned_by: string | null
          created_at: string
          ended_at: string | null
          id: string
          notes: string | null
          started_at: string
          status: Database["public"]["Enums"]["alert_status"]
          team_name: string | null
          updated_at: string
        }
        Insert: {
          alert_id: string
          assigned_by?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          notes?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["alert_status"]
          team_name?: string | null
          updated_at?: string
        }
        Update: {
          alert_id?: string
          assigned_by?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          notes?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["alert_status"]
          team_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rescue_operations_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "sos_alerts"
            referencedColumns: ["id"]
          },
        ]
      }
      sea_trips: {
        Row: {
          actual_departure: string | null
          actual_return: string | null
          bmu_id: string | null
          boat_id: string | null
          captain_id: string | null
          created_at: string
          created_by: string | null
          destination: string | null
          device_id: string | null
          expected_return: string | null
          fishing_area: string | null
          id: string
          notes: string | null
          planned_departure: string | null
          status: Database["public"]["Enums"]["trip_status"]
          updated_at: string
        }
        Insert: {
          actual_departure?: string | null
          actual_return?: string | null
          bmu_id?: string | null
          boat_id?: string | null
          captain_id?: string | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          device_id?: string | null
          expected_return?: string | null
          fishing_area?: string | null
          id?: string
          notes?: string | null
          planned_departure?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          updated_at?: string
        }
        Update: {
          actual_departure?: string | null
          actual_return?: string | null
          bmu_id?: string | null
          boat_id?: string | null
          captain_id?: string | null
          created_at?: string
          created_by?: string | null
          destination?: string | null
          device_id?: string | null
          expected_return?: string | null
          fishing_area?: string | null
          id?: string
          notes?: string | null
          planned_departure?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sea_trips_bmu_id_fkey"
            columns: ["bmu_id"]
            isOneToOne: false
            referencedRelation: "bmus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sea_trips_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sea_trips_captain_id_fkey"
            columns: ["captain_id"]
            isOneToOne: false
            referencedRelation: "fishermen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sea_trips_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      sos_alerts: {
        Row: {
          acknowledged_at: string | null
          battery: number | null
          bmu_id: string | null
          boat_id: string | null
          created_at: string
          device_id: string
          emergency_level: string | null
          fisherman_id: string | null
          id: string
          last_accuracy: number | null
          last_lat: number | null
          last_lng: number | null
          last_ping_at: string | null
          notes: string | null
          resolved_at: string | null
          started_at: string
          status: Database["public"]["Enums"]["alert_status"]
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          battery?: number | null
          bmu_id?: string | null
          boat_id?: string | null
          created_at?: string
          device_id: string
          emergency_level?: string | null
          fisherman_id?: string | null
          id?: string
          last_accuracy?: number | null
          last_lat?: number | null
          last_lng?: number | null
          last_ping_at?: string | null
          notes?: string | null
          resolved_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["alert_status"]
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          battery?: number | null
          bmu_id?: string | null
          boat_id?: string | null
          created_at?: string
          device_id?: string
          emergency_level?: string | null
          fisherman_id?: string | null
          id?: string
          last_accuracy?: number | null
          last_lat?: number | null
          last_lng?: number | null
          last_ping_at?: string | null
          notes?: string | null
          resolved_at?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["alert_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sos_alerts_bmu_id_fkey"
            columns: ["bmu_id"]
            isOneToOne: false
            referencedRelation: "bmus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_alerts_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_alerts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sos_alerts_fisherman_id_fkey"
            columns: ["fisherman_id"]
            isOneToOne: false
            referencedRelation: "fishermen"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_crew: {
        Row: {
          created_at: string
          fisherman_id: string
          id: string
          role: string | null
          trip_id: string
        }
        Insert: {
          created_at?: string
          fisherman_id: string
          id?: string
          role?: string | null
          trip_id: string
        }
        Update: {
          created_at?: string
          fisherman_id?: string
          id?: string
          role?: string | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_crew_fisherman_id_fkey"
            columns: ["fisherman_id"]
            isOneToOne: false
            referencedRelation: "fishermen"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_crew_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "sea_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_status_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          notes: string | null
          status: Database["public"]["Enums"]["trip_status"]
          trip_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          notes?: string | null
          status: Database["public"]["Enums"]["trip_status"]
          trip_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["trip_status"]
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_status_history_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "sea_trips"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      alert_status:
        | "new"
        | "acknowledged"
        | "assigned"
        | "in_progress"
        | "resolved"
        | "closed"
      app_role:
        | "admin"
        | "bmu_officer"
        | "rescue_officer"
        | "fisherman"
      notification_channel: "dashboard" | "sms" | "email" | "whatsapp"
      notification_status: "pending" | "sent" | "failed"
      trip_status:
        | "planned"
        | "pending_approval"
        | "checked_out"
        | "at_sea"
        | "sos"
        | "rescue_in_progress"
        | "rescued"
        | "returned"
        | "overdue"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_status: [
        "new",
        "acknowledged",
        "assigned",
        "in_progress",
        "resolved",
        "closed",
      ],
      app_role: [
        "admin",
        "bmu_officer",
        "rescue_officer",
        "fisherman",
      ],
      notification_channel: ["dashboard", "sms", "email", "whatsapp"],
      notification_status: ["pending", "sent", "failed"],
      trip_status: [
        "planned",
        "pending_approval",
        "checked_out",
        "at_sea",
        "sos",
        "rescue_in_progress",
        "rescued",
        "returned",
        "overdue",
        "cancelled",
      ],
    },
  },
} as const
