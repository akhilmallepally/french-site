// Drafts of C2 writing tasks. The learner's text lives only in this browser's localStorage,
// one key per exercise. It is never sent to a server or a server action, never stored in
// progress (lib/progress.ts) and never logged. Client-side only: call from effects or handlers.

const PREFIX = "parlons-writing-draft-v1:";

export function loadDraft(exerciseId: string): string {
  try {
    return localStorage.getItem(PREFIX + exerciseId) ?? "";
  } catch {
    return ""; // Storage blocked (private mode): start empty.
  }
}

export function saveDraft(exerciseId: string, text: string): void {
  try {
    if (text) localStorage.setItem(PREFIX + exerciseId, text);
    else localStorage.removeItem(PREFIX + exerciseId);
  } catch {
    // Storage blocked or full: the draft just isn't kept.
  }
}
