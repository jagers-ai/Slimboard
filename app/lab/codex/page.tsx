import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { CodexLab } from "@/components/CodexLab";
import { isCodexLabEnabled } from "@/lib/codex-lab";

export const dynamic = "force-dynamic";

export default async function CodexLabPage() {
  if (!isCodexLabEnabled((await headers()).get("host"))) notFound();
  return <CodexLab />;
}
