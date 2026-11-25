import { AccountBoundary } from "@/components/AccountBoundary";
import { notFound } from "next/navigation";
import { GoodnotesExport } from "@/components/GoodnotesExport";
import { hasCoreEnv } from "@/lib/env";
import { requireUser } from "@/lib/auth";
import { getNoteWithImageUrl } from "@/lib/notes";

export const dynamic = "force-dynamic";

type GoodnotesPageProps = {
  params: Promise<{ id: string }>;
};

export default async function GoodnotesPage({ params }: GoodnotesPageProps) {
  if (!hasCoreEnv()) {
    notFound();
  }

  const user = await requireUser();
  const { id } = await params;
  const note = await getNoteWithImageUrl(id, user.id);

  if (!note) {
    notFound();
  }

  return (
    <AccountBoundary key={user.id} userId={user.id}>
      <GoodnotesExport key={note.id} noteId={note.id} title={note.title}
        photoUrl={note.image_ready ? note.image_url : null} completed={note.status === "completed"} />
    </AccountBoundary>
  );
}
