/** Ownership must be checked before storage mutations or billable analysis. */
export async function getOwnedNote<T extends { owner_user_id: string }>(
  noteId: string,
  userId: string,
  load: (noteId: string, userId: string) => Promise<T | null>,
): Promise<T | null> {
  const note = await load(noteId, userId);
  return note?.owner_user_id === userId ? note : null;
}

type DeletableNote = { owner_user_id: string; original_image_path: string | null; analysis_image_path: string };
type DeleteDependencies = {
  load: (noteId: string, userId: string) => Promise<DeletableNote | null>;
  deleteRow: (noteId: string, userId: string) => Promise<boolean>;
  removeImages: (paths: string[]) => Promise<void>;
  onCleanupFailure: () => void;
};

export async function deleteOwnedNote(noteId: string, userId: string, dependencies: DeleteDependencies): Promise<boolean> {
  const note = await getOwnedNote(noteId, userId, dependencies.load);
  if (!note) return false;
  // Confirm the owner-filtered row deletion first. A failed DB write must never
  // leave a still-visible record with permanently deleted photographs.
  if (!await dependencies.deleteRow(noteId, userId)) return false;
  try {
    await dependencies.removeImages([...new Set([note.original_image_path, note.analysis_image_path].filter((path): path is string => Boolean(path)))]);
  } catch {
    // The note is already deleted; do not report a retryable note deletion.
    // Storage cleanup needs separate operational follow-up, without logging paths.
    dependencies.onCleanupFailure();
  }
  return true;
}
