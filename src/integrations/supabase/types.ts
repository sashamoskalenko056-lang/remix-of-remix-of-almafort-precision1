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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      admin_logs: {
        Row: {
          action: string
          admin_email: string | null
          admin_id: string | null
          created_at: string
          id: string
          new_value: Json | null
          old_value: Json | null
          target: string | null
        }
        Insert: {
          action: string
          admin_email?: string | null
          admin_id?: string | null
          created_at?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          target?: string | null
        }
        Update: {
          action?: string
          admin_email?: string | null
          admin_id?: string | null
          created_at?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          target?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          is_public: boolean
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          is_public?: boolean
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          is_public?: boolean
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      asset_groups: {
        Row: {
          created_at: string
          description: string
          id: string
          images: Json
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          images?: Json
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          images?: Json
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      bulk_requests: {
        Row: {
          base_price: number
          comment: string | null
          contact_name: string
          created_at: string
          email: string | null
          id: string
          inn: string | null
          phone: string
          product_name: string
          qty: number
          sku: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          base_price?: number
          comment?: string | null
          contact_name: string
          created_at?: string
          email?: string | null
          id?: string
          inn?: string | null
          phone: string
          product_name: string
          qty?: number
          sku: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          base_price?: number
          comment?: string | null
          contact_name?: string
          created_at?: string
          email?: string | null
          id?: string
          inn?: string | null
          phone?: string
          product_name?: string
          qty?: number
          sku?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      companies: {
        Row: {
          assigned_tier: number
          created_at: string
          credit_allowed: boolean
          director: string | null
          id: string
          inn: string
          is_default: boolean
          kpp: string | null
          last_activity_at: string
          legal_address: string | null
          lifetime_value: number
          manual_tier_override: boolean
          name: string
          ogrn: string | null
          registry_status: string
          requisites_source: string
          user_id: string
        }
        Insert: {
          assigned_tier?: number
          created_at?: string
          credit_allowed?: boolean
          director?: string | null
          id?: string
          inn: string
          is_default?: boolean
          kpp?: string | null
          last_activity_at?: string
          legal_address?: string | null
          lifetime_value?: number
          manual_tier_override?: boolean
          name: string
          ogrn?: string | null
          registry_status?: string
          requisites_source?: string
          user_id: string
        }
        Update: {
          assigned_tier?: number
          created_at?: string
          credit_allowed?: boolean
          director?: string | null
          id?: string
          inn?: string
          is_default?: boolean
          kpp?: string | null
          last_activity_at?: string
          legal_address?: string | null
          lifetime_value?: number
          manual_tier_override?: boolean
          name?: string
          ogrn?: string | null
          registry_status?: string
          requisites_source?: string
          user_id?: string
        }
        Relationships: []
      }
      erp_sync_jobs: {
        Row: {
          attempts: number
          created_at: string
          direction: string
          id: string
          last_error: string | null
          next_attempt_at: string
          order_id: string | null
          order_number: string
          payload: Json
          status: string
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          direction?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          order_id?: string | null
          order_number: string
          payload?: Json
          status?: string
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          direction?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          order_id?: string | null
          order_number?: string
          payload?: Json
          status?: string
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      llm_logs: {
        Row: {
          completion_tokens: number
          cost_usd: number
          created_at: string
          id: string
          kind: string
          model: string | null
          parse_status: string
          prompt: string | null
          prompt_tokens: number
          response: string | null
        }
        Insert: {
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          kind?: string
          model?: string | null
          parse_status?: string
          prompt?: string | null
          prompt_tokens?: number
          response?: string | null
        }
        Update: {
          completion_tokens?: number
          cost_usd?: number
          created_at?: string
          id?: string
          kind?: string
          model?: string | null
          parse_status?: string
          prompt?: string | null
          prompt_tokens?: number
          response?: string | null
        }
        Relationships: []
      }
      llm_prompts: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          slot: string
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          slot: string
          version: number
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          slot?: string
          version?: number
        }
        Relationships: []
      }
      order_documents: {
        Row: {
          created_at: string
          id: string
          kind: string
          order_id: string
          title: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          order_id: string
          title: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          order_id?: string
          title?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_documents_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          created_at: string
          id: string
          note: string | null
          order_id: string
          source: string
          stage: string
          title: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          order_id: string
          source?: string
          stage: string
          title: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          order_id?: string
          source?: string
          stage?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          carrier: string | null
          city: string | null
          closed_at: string | null
          comment: string | null
          company_id: string | null
          created_at: string
          deferred_payment: boolean
          delivery_price: number
          goods_price: number
          id: string
          idempotency_key: string | null
          items: Json
          number: string
          offer_version: string
          pvz_address: string | null
          status: string
          storage_until: string | null
          total: number
          tracking_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          carrier?: string | null
          city?: string | null
          closed_at?: string | null
          comment?: string | null
          company_id?: string | null
          created_at?: string
          deferred_payment?: boolean
          delivery_price?: number
          goods_price?: number
          id?: string
          idempotency_key?: string | null
          items?: Json
          number: string
          offer_version?: string
          pvz_address?: string | null
          status?: string
          storage_until?: string | null
          total?: number
          tracking_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          carrier?: string | null
          city?: string | null
          closed_at?: string | null
          comment?: string | null
          company_id?: string | null
          created_at?: string
          deferred_payment?: boolean
          delivery_price?: number
          goods_price?: number
          id?: string
          idempotency_key?: string | null
          items?: Json
          number?: string
          offer_version?: string
          pvz_address?: string | null
          status?: string
          storage_until?: string | null
          total?: number
          tracking_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      product_asset_links: {
        Row: {
          created_at: string
          group_id: string
          sku: string
        }
        Insert: {
          created_at?: string
          group_id: string
          sku: string
        }
        Update: {
          created_at?: string
          group_id?: string
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_asset_links_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "asset_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      product_overrides: {
        Row: {
          base_price: number | null
          created_at: string
          description: string | null
          hidden: boolean
          image_url: string | null
          model_url: string | null
          opt1_price: number | null
          opt2_price: number | null
          sku: string
          stock: number | null
          synonyms: string[]
          updated_at: string
        }
        Insert: {
          base_price?: number | null
          created_at?: string
          description?: string | null
          hidden?: boolean
          image_url?: string | null
          model_url?: string | null
          opt1_price?: number | null
          opt2_price?: number | null
          sku: string
          stock?: number | null
          synonyms?: string[]
          updated_at?: string
        }
        Update: {
          base_price?: number | null
          created_at?: string
          description?: string | null
          hidden?: boolean
          image_url?: string | null
          model_url?: string | null
          opt1_price?: number | null
          opt2_price?: number | null
          sku?: string
          stock?: number | null
          synonyms?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          manager_name: string
          manager_phone: string
          manager_telegram: string
          manager_whatsapp: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          manager_name?: string
          manager_phone?: string
          manager_telegram?: string
          manager_whatsapp?: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          manager_name?: string
          manager_phone?: string
          manager_telegram?: string
          manager_whatsapp?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      saved_carts: {
        Row: {
          lines: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          lines?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          lines?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      link_asset_group: {
        Args: {
          _description: string
          _images: Json
          _skus: string[]
          _slug: string
          _title: string
        }
        Returns: string
      }
      my_loyalty: { Args: never; Returns: Json }
      recalc_company_tiers: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "owner" | "manager" | "content"
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
      app_role: ["owner", "manager", "content"],
    },
  },
} as const
