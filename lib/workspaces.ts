import { type AppUser, isLocalDevUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function ensurePersonalWorkspace(user: AppUser) {
  const supabase = createAdminClient();
  const email = user.email ?? "";
  const fullName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    email.split("@")[0] ??
    "Slimboard User";
  const avatarUrl =
    (user.user_metadata?.avatar_url as string | undefined) ??
    (user.user_metadata?.picture as string | undefined) ??
    null;

  if (!isLocalDevUser(user)) {
    await supabase.from("profiles").upsert(
      {
        id: user.id,
        email,
        full_name: fullName,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  }

  const { data: existingWorkspaces, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_user_id", user.id)
    .eq("kind", "personal")
    .order("created_at", { ascending: true })
    .limit(1);

  if (workspaceError) {
    throw workspaceError;
  }

  const existingWorkspace = existingWorkspaces?.[0];

  if (existingWorkspace?.id) {
    await supabase.from("workspace_members").upsert(
      {
        workspace_id: existingWorkspace.id,
        user_id: user.id,
        role: "owner",
      },
      { onConflict: "workspace_id,user_id" },
    );

    return existingWorkspace.id as string;
  }

  const { data: workspace, error: createError } = await supabase
    .from("workspaces")
    .insert({
      name: "Personal",
      kind: "personal",
      owner_user_id: user.id,
    })
    .select("id")
    .single();

  if (createError || !workspace) {
    throw createError ?? new Error("Could not create personal workspace.");
  }

  const { error: memberError } = await supabase
    .from("workspace_members")
    .insert({
      workspace_id: workspace.id,
      user_id: user.id,
      role: "owner",
    });

  if (memberError) {
    throw memberError;
  }

  return workspace.id as string;
}
