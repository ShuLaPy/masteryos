export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      aiml_concepts: {
        Row: {
          centrality: number | null
          concept_type: string | null
          created_at: string
          id: string
          mastery_score: number | null
          notes: string | null
          prerequisites: string[] | null
          source: string | null
          tags: string[] | null
          title: string
          user_id: string
          week_number: number | null
        }
        Insert: {
          centrality?: number | null
          concept_type?: string | null
          created_at?: string
          id?: string
          mastery_score?: number | null
          notes?: string | null
          prerequisites?: string[] | null
          source?: string | null
          tags?: string[] | null
          title: string
          user_id: string
          week_number?: number | null
        }
        Update: {
          centrality?: number | null
          concept_type?: string | null
          created_at?: string
          id?: string
          mastery_score?: number | null
          notes?: string | null
          prerequisites?: string[] | null
          source?: string | null
          tags?: string[] | null
          title?: string
          user_id?: string
          week_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "aiml_concepts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      concept_embeddings: {
        Row: {
          content_hash: string
          created_at: string
          embedding: string | null
          id: string
          source_id: string
          source_type: string
          user_id: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          embedding?: string | null
          id?: string
          source_id: string
          source_type: string
          user_id: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          embedding?: string | null
          id?: string
          source_id?: string
          source_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "concept_embeddings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_plans: {
        Row: {
          completion_pct: number | null
          created_at: string
          generated_plan: Json | null
          id: string
          mentor_message: string | null
          plan_date: string
          srs_due_count: number | null
          user_id: string
        }
        Insert: {
          completion_pct?: number | null
          created_at?: string
          generated_plan?: Json | null
          id?: string
          mentor_message?: string | null
          plan_date: string
          srs_due_count?: number | null
          user_id: string
        }
        Update: {
          completion_pct?: number | null
          created_at?: string
          generated_plan?: Json | null
          id?: string
          mentor_message?: string | null
          plan_date?: string
          srs_due_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_plans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dsa_problems: {
        Row: {
          approach_notes: string | null
          confidence: number | null
          difficulty: string | null
          id: string
          patterns: string[] | null
          solved_at: string
          source: string | null
          time_taken_minutes: number | null
          title: string
          url: string | null
          user_id: string
        }
        Insert: {
          approach_notes?: string | null
          confidence?: number | null
          difficulty?: string | null
          id?: string
          patterns?: string[] | null
          solved_at?: string
          source?: string | null
          time_taken_minutes?: number | null
          title: string
          url?: string | null
          user_id: string
        }
        Update: {
          approach_notes?: string | null
          confidence?: number | null
          difficulty?: string | null
          id?: string
          patterns?: string[] | null
          solved_at?: string
          source?: string | null
          time_taken_minutes?: number | null
          title?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dsa_problems_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_schedules: {
        Row: {
          bridge_cache: Json | null
          bridge_cache_key: string | null
          created_at: string
          extracted_concept_ids: string[] | null
          id: string
          is_attended: boolean | null
          notes: string | null
          prerequisite_concept_ids: string[] | null
          scheduled_date: string
          title: string
          updated_at: string
          user_id: string
          week_number: number
        }
        Insert: {
          bridge_cache?: Json | null
          bridge_cache_key?: string | null
          created_at?: string
          extracted_concept_ids?: string[] | null
          id?: string
          is_attended?: boolean | null
          notes?: string | null
          prerequisite_concept_ids?: string[] | null
          scheduled_date: string
          title: string
          updated_at?: string
          user_id: string
          week_number: number
        }
        Update: {
          bridge_cache?: Json | null
          bridge_cache_key?: string | null
          created_at?: string
          extracted_concept_ids?: string[] | null
          id?: string
          is_attended?: boolean | null
          notes?: string | null
          prerequisite_concept_ids?: string[] | null
          scheduled_date?: string
          title?: string
          updated_at?: string
          user_id?: string
          week_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "lecture_schedules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      pattern_mastery: {
        Row: {
          attempts: number
          id: string
          last_attempt_at: string | null
          pattern: string
          rating: number
          rd: number
          updated_at: string
          user_id: string
          volatility: number
        }
        Insert: {
          attempts?: number
          id?: string
          last_attempt_at?: string | null
          pattern: string
          rating?: number
          rd?: number
          updated_at?: string
          user_id: string
          volatility?: number
        }
        Update: {
          attempts?: number
          id?: string
          last_attempt_at?: string | null
          pattern?: string
          rating?: number
          rd?: number
          updated_at?: string
          user_id?: string
          volatility?: number
        }
        Relationships: [
          {
            foreignKeyName: "pattern_mastery_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_attempts: {
        Row: {
          created_at: string
          difficulty: string
          id: string
          outcome_score: number
          pattern_identified: string | null
          patterns: string[]
          problem_id: string | null
          time_seconds: number | null
          used_hints: boolean | null
          user_id: string
        }
        Insert: {
          created_at?: string
          difficulty: string
          id?: string
          outcome_score: number
          pattern_identified?: string | null
          patterns?: string[]
          problem_id?: string | null
          time_seconds?: number | null
          used_hints?: boolean | null
          user_id: string
        }
        Update: {
          created_at?: string
          difficulty?: string
          id?: string
          outcome_score?: number
          pattern_identified?: string | null
          patterns?: string[]
          problem_id?: string | null
          time_seconds?: number | null
          used_hints?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "problem_attempts_problem_id_fkey"
            columns: ["problem_id"]
            isOneToOne: false
            referencedRelation: "dsa_problems"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "problem_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      problem_bank: {
        Row: {
          acceptance_rate: number | null
          difficulty: string
          id: string
          leetcode_url: string
          patterns: string[]
          slug: string
          title: string
        }
        Insert: {
          acceptance_rate?: number | null
          difficulty: string
          id?: string
          leetcode_url: string
          patterns?: string[]
          slug: string
          title: string
        }
        Update: {
          acceptance_rate?: number | null
          difficulty?: string
          id?: string
          leetcode_url?: string
          patterns?: string[]
          slug?: string
          title?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          card_id: string
          confidence_predicted: number | null
          created_at: string
          duration_seconds: number
          id: string
          rating: number
          retrievability_at_review: number
          scheduled_days_after: number
          stability_after: number
          stability_before: number
          user_id: string
        }
        Insert: {
          card_id: string
          confidence_predicted?: number | null
          created_at?: string
          duration_seconds: number
          id?: string
          rating: number
          retrievability_at_review: number
          scheduled_days_after: number
          stability_after: number
          stability_before: number
          user_id: string
        }
        Update: {
          card_id?: string
          confidence_predicted?: number | null
          created_at?: string
          duration_seconds?: number
          id?: string
          rating?: number
          retrievability_at_review?: number
          scheduled_days_after?: number
          stability_after?: number
          stability_before?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "srs_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      srs_cards: {
        Row: {
          back: string
          card_type: string
          created_at: string
          difficulty: number
          due: string
          elapsed_days: number
          front: string
          id: string
          lapses: number
          last_review: string | null
          reps: number
          scheduled_days: number
          source_id: string
          source_type: string
          stability: number
          state: string
          user_id: string
        }
        Insert: {
          back: string
          card_type: string
          created_at?: string
          difficulty: number
          due: string
          elapsed_days: number
          front: string
          id?: string
          lapses: number
          last_review?: string | null
          reps: number
          scheduled_days: number
          source_id: string
          source_type: string
          stability: number
          state: string
          user_id: string
        }
        Update: {
          back?: string
          card_type?: string
          created_at?: string
          difficulty?: number
          due?: string
          elapsed_days?: number
          front?: string
          id?: string
          lapses?: number
          last_review?: string | null
          reps?: number
          scheduled_days?: number
          source_id?: string
          source_type?: string
          stability?: number
          state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "srs_cards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      study_sessions: {
        Row: {
          actual_minutes: number | null
          cards_reviewed: number | null
          created_at: string
          ended_at: string | null
          energy_level: number | null
          id: string
          mood_end: number | null
          notes: string | null
          planned_minutes: number | null
          problems_logged: number | null
          session_type: string
          started_at: string
          topics_covered: string[] | null
          user_id: string
        }
        Insert: {
          actual_minutes?: number | null
          cards_reviewed?: number | null
          created_at?: string
          ended_at?: string | null
          energy_level?: number | null
          id?: string
          mood_end?: number | null
          notes?: string | null
          planned_minutes?: number | null
          problems_logged?: number | null
          session_type: string
          started_at?: string
          topics_covered?: string[] | null
          user_id: string
        }
        Update: {
          actual_minutes?: number | null
          cards_reviewed?: number | null
          created_at?: string
          ended_at?: string | null
          energy_level?: number | null
          id?: string
          mood_end?: number | null
          notes?: string | null
          planned_minutes?: number | null
          problems_logged?: number | null
          session_type?: string
          started_at?: string
          topics_covered?: string[] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          daily_goal_minutes: number | null
          display_name: string | null
          email: string
          grace_days_remaining: number | null
          id: string
          settings: Json | null
          streak_count: number | null
          streak_last_date: string | null
        }
        Insert: {
          created_at?: string
          daily_goal_minutes?: number | null
          display_name?: string | null
          email: string
          grace_days_remaining?: number | null
          id: string
          settings?: Json | null
          streak_count?: number | null
          streak_last_date?: string | null
        }
        Update: {
          created_at?: string
          daily_goal_minutes?: number | null
          display_name?: string | null
          email?: string
          grace_days_remaining?: number | null
          id?: string
          settings?: Json | null
          streak_count?: number | null
          streak_last_date?: string | null
        }
        Relationships: []
      }
      weekly_syntheses: {
        Row: {
          ai_synthesis: string | null
          average_retention: number | null
          concepts_learned: string[] | null
          created_at: string
          cross_connections: Json | null
          id: string
          problems_logged_count: number | null
          user_id: string
          week_number: number | null
          week_start_date: string | null
        }
        Insert: {
          ai_synthesis?: string | null
          average_retention?: number | null
          concepts_learned?: string[] | null
          created_at?: string
          cross_connections?: Json | null
          id?: string
          problems_logged_count?: number | null
          user_id: string
          week_number?: number | null
          week_start_date?: string | null
        }
        Update: {
          ai_synthesis?: string | null
          average_retention?: number | null
          concepts_learned?: string[] | null
          created_at?: string
          cross_connections?: Json | null
          id?: string
          problems_logged_count?: number | null
          user_id?: string
          week_number?: number | null
          week_start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "weekly_syntheses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_mastery: {
        Args: { p_concept_id: string; p_user_id: string }
        Returns: number
      }
      find_cross_connections: {
        Args: {
          max_pairs?: number
          p_user_id: string
          similarity_threshold?: number
        }
        Returns: {
          aiml_embedding_id: string
          aiml_source_id: string
          dsa_embedding_id: string
          dsa_source_id: string
          similarity: number
        }[]
      }
      match_concepts: {
        Args: {
          match_count?: number
          match_user_id?: string
          query_embedding: string
        }
        Returns: {
          id: string
          similarity: number
          source_id: string
          source_type: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

