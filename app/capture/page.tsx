import { redirect } from "next/navigation";

import { AccountBoundary } from "@/components/AccountBoundary";
import { CaptureUploader } from "@/components/CaptureUploader";
import { hasCoreEnv } from "@/lib/env";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CapturePage() {
  if (!hasCoreEnv()) {
    redirect("/");
  }

  const user = await requireUser();

  return (
    <AccountBoundary key={user.id} userId={user.id}>
      <CaptureUploader key={user.id} userId={user.id} />
    </AccountBoundary>
  );
}
