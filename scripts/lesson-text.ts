// Shared helpers for the content scripts (audit-content.ts, check-words.ts).
// Splits a lesson body into teaching text and "text sections" (dialogues and longer texts).

// A line of French text in a dialogue, chat, forum thread or model paragraph:
//   - *Bonjour !* (Hello!)        - **Inès:** *Salut !* (Hi!)        *Chère Sophie,*        (translation)
const TEXT_LINE = /^(- (\*\*[^*]+\*\* )?\*[^*]|\*[^*]|\(.*\)\s*$)/;
const CALLOUT = /<Callout\b[\s\S]*?<\/Callout>/g;

export type Section = { heading: string; body: string; callouts: string[]; isText: boolean };

// A section is a dialogue or longer text when most of its lines (outside callouts, tables and
// vocab tables) are French text lines. "## En français" is always one.
export function splitSections(body: string): Section[] {
  return body.replace(/\r\n/g, "\n").split(/\n(?=## )/).map((raw) => {
    const heading = (raw.match(/^## (.*)/) ?? [])[1] ?? "";
    const callouts = raw.match(CALLOUT) ?? [];
    const rest = raw.replace(CALLOUT, "");
    const lines = rest.split("\n").map((l) => l.trim())
      .filter((l) => l && !l.startsWith("## ") && !l.startsWith("<VocabTable") && !l.startsWith("|"));
    const textLines = lines.filter((l) => TEXT_LINE.test(l)).length;
    const isText = heading === "En français" || (lines.length > 0 && textLines >= 2 && textLines / lines.length >= 0.6);
    return { heading, body: rest, callouts, isText };
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
    if (!s.isText) continue;
    for (const line of s.body.split("\n")) {
      const l = line.trim().replace(/\*\*[^*]+\*\*/g, " ");
      for (const m of l.matchAll(/\*([^*]+)\*/g)) out.push(m[1]);
    }
  }
  return out;
}
