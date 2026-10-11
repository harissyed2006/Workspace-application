// Workspace — owner-only account management
// Deploy with Verify JWT ON (the default). The client calls it via
// supabase.functions.invoke, which passes the signed-in user's JWT; we then
// check the caller is an OWNER in the roles table before doing anything.
// Uses the service-role key (auto-available in Edge Functions) for auth-admin
// operations that the browser can never do directly.

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Identify the caller from their JWT and require the owner role.
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: caller } = await admin.auth.getUser(jwt);
    const callerEmail = (caller?.user?.email || "").toLowerCase();
    if (!callerEmail) return json(401, { error: "Not signed in" });
    const { data: callerRole } = await admin
      .from("roles").select("role").eq("email", callerEmail).maybeSingle();
    if (callerRole?.role !== "owner") return json(403, { error: "Owners only" });

    const { action, payload = {} } = await req.json();
    const email = (payload.email || "").toLowerCase();

    // Peer rules: owners MAY reset each other's passwords (recovery), but may
    // not change another owner's email or delete their login.
    if (email && email !== callerEmail && ["update_email", "delete_user"].includes(action)) {
      const { data: targetRole } = await admin
        .from("roles").select("role").eq("email", email).maybeSingle();
      if (targetRole?.role === "owner")
        return json(403, { error: "Owners can't change another owner's email or remove their login" });
    }

    const findUser = async (em: string) => {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw error;
      return data.users.find((u) => (u.email || "").toLowerCase() === em);
    };

    switch (action) {
      case "list_users": {
        const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (error) throw error;
        return json(200, {
          users: data.users.map((u) => ({
            email: (u.email || "").toLowerCase(),
            created_at: u.created_at,
            last_sign_in_at: u.last_sign_in_at,
            mfa: (u.factors || []).some((f) => f.status === "verified"),
          })),
        });
      }
      case "remove_mfa": {
        // Recovery for lost authenticators — allowed on any user, incl. owners
        if (!email) return json(400, { error: "email required" });
        const u = await findUser(email);
        if (!u) return json(404, { error: "No login with that email" });
        const { data: fl, error: lerr } = await admin.auth.admin.mfa.listFactors({ userId: u.id });
        if (lerr) return json(400, { error: lerr.message });
        for (const f of fl?.factors || []) {
          const { error } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: u.id });
          if (error) return json(400, { error: error.message });
        }
        return json(200, { ok: true });
      }
      case "create_user": {
        if (!email || !payload.password || payload.password.length < 8)
          return json(400, { error: "Email and a password of 8+ characters required" });
        const { error } = await admin.auth.admin.createUser({
          email,
          password: payload.password,
          email_confirm: true,
        });
        if (error) return json(400, { error: error.message });
        return json(200, { ok: true });
      }
      case "reset_password": {
        if (!email || !payload.password || payload.password.length < 8)
          return json(400, { error: "Email and a password of 8+ characters required" });
        const u = await findUser(email);
        if (!u) return json(404, { error: "No login with that email" });
        const { error } = await admin.auth.admin.updateUserById(u.id, {
          password: payload.password,
        });
        if (error) return json(400, { error: error.message });
        return json(200, { ok: true });
      }
      case "update_email": {
        const newEmail = (payload.new_email || "").toLowerCase();
        if (!email || !newEmail) return json(400, { error: "email and new_email required" });
        const u = await findUser(email);
        if (!u) return json(404, { error: "No login with that email" });
        const { error } = await admin.auth.admin.updateUserById(u.id, {
          email: newEmail,
          email_confirm: true,
        });
        if (error) return json(400, { error: error.message });
        return json(200, { ok: true });
      }
      case "delete_user": {
        if (!email) return json(400, { error: "email required" });
        if (email === callerEmail)
          return json(400, { error: "You can't delete your own login" });
        const u = await findUser(email);
        if (!u) return json(404, { error: "No login with that email" });
        const { error } = await admin.auth.admin.deleteUser(u.id);
        if (error) return json(400, { error: error.message });
        return json(200, { ok: true });
      }
      default:
        return json(400, { error: "Unknown action" });
    }
  } catch (e) {
    return json(500, { error: String((e as Error)?.message || e) });
  }
});
