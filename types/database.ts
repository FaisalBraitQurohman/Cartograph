export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      analyses: {
        Row: {
          commit_sha: string | null
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          organization_id: string
          project_id: string
          stage: string | null
          stage_at: string | null
          stage_message: string | null
          status: string
        }
        Insert: {
          commit_sha?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          organization_id: string
          project_id: string
          stage?: string | null
          stage_at?: string | null
          stage_message?: string | null
          status: string
        }
        Update: {
          commit_sha?: string | null
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          organization_id?: string
          project_id?: string
          stage?: string | null
          stage_at?: string | null
          stage_message?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "analyses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analyses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          }
        ]
      }
      coverage: {
        Row: {
          analysis_id: string
          created_at: string
          distinct_folders: number
          files_found: number
          files_parsed: number
          files_skipped: number
          imports_excluded: number
          imports_outside: number
          imports_resolved: number
          imports_total: number
          imports_unresolved: number
          organization_id: string
          resolved_fraction: number | null
        }
        Insert: {
          analysis_id: string
          created_at?: string
          distinct_folders?: number
          files_found?: number
          files_parsed?: number
          files_skipped?: number
          imports_excluded?: number
          imports_outside?: number
          imports_resolved?: number
          imports_total?: number
          imports_unresolved?: number
          organization_id: string
          resolved_fraction?: never
        }
        Update: {
          analysis_id?: string
          created_at?: string
          distinct_folders?: number
          files_found?: number
          files_parsed?: number
          files_skipped?: number
          imports_excluded?: number
          imports_outside?: number
          imports_resolved?: number
          imports_total?: number
          imports_unresolved?: number
          organization_id?: string
          resolved_fraction?: never
        }
        Relationships: [
          {
            foreignKeyName: "coverage_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: true
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coverage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      edges: {
        Row: {
          analysis_id: string
          created_at: string
          from_file_id: string
          id: string
          kind: string
          line: number | null
          organization_id: string
          specifier: string | null
          to_file_id: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          from_file_id: string
          id?: string
          kind: string
          line?: number | null
          organization_id: string
          specifier?: string | null
          to_file_id: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          from_file_id?: string
          id?: string
          kind?: string
          line?: number | null
          organization_id?: string
          specifier?: string | null
          to_file_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edges_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_from_file_id_fkey"
            columns: ["from_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edges_to_file_id_fkey"
            columns: ["to_file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          }
        ]
      }
      explanations: {
        Row: {
          analysis_id: string
          body: string
          created_at: string
          file_id: string
          id: string
          model: string
          organization_id: string
        }
        Insert: {
          analysis_id: string
          body: string
          created_at?: string
          file_id: string
          id?: string
          model: string
          organization_id: string
        }
        Update: {
          analysis_id?: string
          body?: string
          created_at?: string
          file_id?: string
          id?: string
          model?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "explanations_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "explanations_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: true
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "explanations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      file_roles: {
        Row: {
          analysis_id: string
          created_at: string
          file_id: string
          id: string
          organization_id: string
          role: string
          source: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          file_id: string
          id?: string
          organization_id: string
          role: string
          source: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          file_id?: string
          id?: string
          organization_id?: string
          role?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_roles_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_roles_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: true
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "file_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      files: {
        Row: {
          analysis_id: string
          created_at: string
          fan_in: number
          fan_out: number
          folder: string
          id: string
          is_entry_point: boolean
          is_external_module: boolean
          language: string | null
          lines: number | null
          module_id: string | null
          organization_id: string
          path: string
          sha256: string | null
        }
        Insert: {
          analysis_id: string
          created_at?: string
          fan_in?: number
          fan_out?: number
          folder: string
          id?: string
          is_entry_point?: boolean
          is_external_module?: boolean
          language?: string | null
          lines?: number | null
          module_id?: string | null
          organization_id: string
          path: string
          sha256?: string | null
        }
        Update: {
          analysis_id?: string
          created_at?: string
          fan_in?: number
          fan_out?: number
          folder?: string
          id?: string
          is_entry_point?: boolean
          is_external_module?: boolean
          language?: string | null
          lines?: number | null
          module_id?: string | null
          organization_id?: string
          path?: string
          sha256?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      insights: {
        Row: {
          analysis_id: string
          body: string
          created_at: string
          file_id: string | null
          id: string
          kind: string
          organization_id: string
          title: string
        }
        Insert: {
          analysis_id: string
          body: string
          created_at?: string
          file_id?: string | null
          id?: string
          kind: string
          organization_id: string
          title: string
        }
        Update: {
          analysis_id?: string
          body?: string
          created_at?: string
          file_id?: string | null
          id?: string
          kind?: string
          organization_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "insights_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insights_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insights_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          id: string
          name: string
          organization_id: string
          repo_url: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          organization_id: string
          repo_url: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          repo_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      routes: {
        Row: {
          analysis_id: string
          created_at: string
          file_id: string
          id: string
          method: string
          organization_id: string
          path: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          file_id: string
          id?: string
          method: string
          organization_id: string
          path: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          file_id?: string
          id?: string
          method?: string
          organization_id?: string
          path?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      skipped_files: {
        Row: {
          analysis_id: string
          created_at: string
          entry_kind: string
          id: number
          organization_id: string
          path: string
          reason: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          entry_kind: string
          id?: never
          organization_id: string
          path: string
          reason: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          entry_kind?: string
          id?: never
          organization_id?: string
          path?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "skipped_files_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skipped_files_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      unresolved_imports: {
        Row: {
          analysis_id: string
          created_at: string
          file_path: string
          id: number
          import_kind: string
          kind: string
          line: number
          organization_id: string
          reason: string
          specifier: string
        }
        Insert: {
          analysis_id: string
          created_at?: string
          file_path: string
          id?: never
          import_kind: string
          kind: string
          line: number
          organization_id: string
          reason: string
          specifier: string
        }
        Update: {
          analysis_id?: string
          created_at?: string
          file_path?: string
          id?: never
          import_kind?: string
          kind?: string
          line?: number
          organization_id?: string
          reason?: string
          specifier?: string
        }
        Relationships: [
          {
            foreignKeyName: "unresolved_imports_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "unresolved_imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_organization_id: { Args: never; Returns: string }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
