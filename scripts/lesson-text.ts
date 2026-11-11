// Shared helpers for the content scripts (audit-content.ts, check-words.ts, check-structures.ts).
// Splits a lesson body into teaching text and "text sections" (dialogues, longer texts and,
// from B2, the "En résumé" recap).

// A line of French text in a dialogue, chat, forum thread or model paragraph:
//   - *Bonjour !* (Hello!)        - **Inès:** *Salut !* (Hi!)        *Chère Sophie,*        (translation)
const TEXT_LINE = /^(- (\*\*[^*]+\*\* )?\*[^*]|\*[^*]|\(.*\)\s*$)/;
const CALLOUT = /<Callout\b[\s\S]*?<\/Callout>/g;

export const DIALOGUE_HEADING = "En français";
export const RESUME_HEADING = "En résumé";

export type SectionKind = "teaching" | "dialogue" | "text" | "resume";
export type Section = { heading: string; body: string; callouts: string[]; isText: boolean; kind: SectionKind };

// A section is a dialogue or longer text when most of its lines (outside callouts, tables and
// vocab tables) are French text lines. "## En français" is always the dialogue. "## En résumé"
// (B2 and later) is a French recap in plain prose: it's a text section too, so it's left out of
// the teaching text but still counted in the whole lesson.
export function splitSections(body: string): Section[] {
  return body.replace(/\r\n/g, "\n").split(/\n(?=## )/).map((raw) => {
    const heading = (raw.match(/^## (.*)/) ?? [])[1]?.trim() ?? "";
    const callouts = raw.match(CALLOUT) ?? [];
    const rest = raw.replace(CALLOUT, "");
    const lines = rest.split("\n").map((l) => l.trim())
      .filter((l) => l && !l.startsWith("## ") && !l.startsWith("<VocabTable") && !l.startsWith("|"));
    const textLines = lines.filter((l) => TEXT_LINE.test(l)).length;
    const kind: SectionKind =
      heading === DIALOGUE_HEADING ? "dialogue"
        : heading === RESUME_HEADING ? "resume"
          : lines.length > 0 && textLines >= 2 && textLines / lines.length >= 0.6 ? "text"
            : "teaching";
    return { heading, body: rest, callouts, isText: kind !== "teaching", kind };
  });
}

// Teaching text = every non-text section, plus the callouts inside text sections.
export function teachingText(body: string): string {
  return splitSections(body).map((s) => (s.isText ? s.callouts.join("\n") : s.body + "\n" + s.callouts.join("\n"))).join("\n");
}

// French text lines of dialogues and longer texts (italic spans only, so English translations are skipped).
export function textSectionFrench(body: string): string[] {
  const out: string[] = [];
  for (const s of splitSections(body)) {
    if (s.kind !== "dialogue" && s.kind !== "text") continue;
    out.push(...italicLines(s.body));
  }
  return out;
}

// Italic French spans of one section, one per line (bold speaker names removed).
export function italicLines(sectionBody: string): string[] {
  const out: string[] = [];
  for (const line of sectionBody.split("\n")) {
    const l = line.trim().replace(/\*\*[^*]+\*\*/g, " ");
    if (/^Note:/i.test(l)) continue; // English notes glossing a structure (B2 longer texts)
    for (const m of l.matchAll(/\*([^*]+)\*/g)) out.push(m[1]);
  }
  return out;
}

// Sentences of the "En résumé" recap: plain French prose, markup removed.
export function resumeFrench(body: string): string[] {
  const out: string[] = [];
  for (const s of splitSections(body)) {
    if (s.kind !== "resume") continue;
    const text = s.body.replace(/^## .*$/m, " ").replace(/<[^>]+>/g, " ").replace(/[*_#>|]/g, " ");
    out.push(...text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean));
  }
  return out;
}

// Word count of the "En résumé" section (0 when there is none).
export function resumeWords(body: string): number {
  return resumeFrench(body).join(" ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// "Note:" lines in longer-text sections, with the italic forms each one glosses.
export function textNotes(body: string): { heading: string; forms: string[] }[] {
  const out: { heading: string; forms: string[] }[] = [];
  for (const s of splitSections(body)) {
    if (s.kind !== "text") continue;
    for (const line of s.body.split("\n")) {
      const l = line.trim();
      if (!/^Note:/i.test(l)) continue;
      out.push({ heading: s.heading, forms: [...l.matchAll(/\*([^*]+)\*/g)].map((m) => m[1]) });
    }
  }
  return out;
}
