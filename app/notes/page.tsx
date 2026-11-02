import { redirect } from "next/navigation";

// Saved notes now live on Home; keep old links working.
export default function NotesPage() {
  redirect("/");
}
