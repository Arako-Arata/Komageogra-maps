import { createClient } from '@supabase/supabase-js';

// .env.local に保存した環境変数（URLとキー）を読み込む
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// プロジェクト全体で使い回せる接続用クライアントを作成してエクスポート
export const supabase = createClient(supabaseUrl, supabaseAnonKey);