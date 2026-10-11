import { createClient } from "@supabase/supabase-js";
import { createDemoClient } from "./demo/mockSupabase.js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// With no Supabase config (or VITE_DEMO=true) the app runs as a self-contained
// demo: an in-browser mock of the Supabase client serves fictional sample data.
// Set both env vars to run it against a real Supabase project instead.
export const DEMO = import.meta.env.VITE_DEMO === "true" || !url || !anonKey;

export const supabase = DEMO ? createDemoClient() : createClient(url, anonKey);
