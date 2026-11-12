// Lists and helpers for the B2 conventions in CLAUDE.md, shared by audit-content.ts,
// check-words.ts and check-structures.ts. They apply to B2 and later only.
// Keep INSTRUCTION_WORDS in step with the list in CLAUDE.md ("B2 conventions").

// French exercise instructions (vous form), known in every B2 lesson once b2-nuancing-opinions
// introduces them. Plus the few nouns and adjectives the instructions need.
export const INSTRUCTION_VERBS = [
  "Complétez", "Choisissez", "Indiquez", "Reformulez", "Transformez", "Corrigez", "Remettez dans l'ordre",
  "Conjuguez", "Accordez", "Mettez au…", "Répondez", "Rédigez", "Traduisez", "Trouvez",
];
export const INSTRUCTION_NOUNS = [
  "la phrase", "le mot", "le verbe", "la forme", "le sens", "la bonne réponse", "le connecteur", "l'erreur",
  "le registre", "soutenu", "familier", "courant", "le temps", "le texte",
];
export const INSTRUCTION_WORDS = new Set(
  [...INSTRUCTION_VERBS, ...INSTRUCTION_NOUNS]
    .join(" ").toLowerCase().replace(/…/g, " ").split(/[\s']+/).filter((w) => w.length > 1),
);

// Transparent cognates (same spelling and meaning as in English, or nearly) that need no vocab
// entry from B2 on. False friends never go here: they always get a vocab entry or a gloss.
// Add words only when an English speaker would understand them on sight.
// The first block is general; the second is every cognate named in the B2 unit plans
// (docs/plans/b2, "Cognates for the allowlist"), with singular and plural forms where they differ.
export const COGNATES = new Set(`
démocratie démocratique société nation population crise système systèmes organisation institution institutions
parlement constitution majorité minorité communication technologie technologique science sciences scientifique
biologie philosophie psychologie économique politique politiques social sociale sociaux sociales culturel culturelle
international internationale internationaux global globale solution situation condition conditions différence
diversité identité tradition traditionnel traditionnelle moderne modernité réforme analyse statistique statistiques
tolérance violence violent violente absence présence influence urgence référence structure nature littérature
architecture sculpture musique photographie tragédie comédie poème poèmes poésie talent ironie

administratif administrative africain africaine alternative alternatives analyser argument arguments article articles
coalition colonial coloniale colonie colonies composition conclusion connexion consultation contexte contraste création
discrimination décision décisions décolonisation développement document documents empire exclusion exporter importer
financier financière formel formelle francophonie historique idéal idéale immigration importance impression
impressionnisme incertain incertaine indépendance inflation informel informelle interprétation interrogatoire
intervention introduction intégration journaliste journalistes laboratoire maintenance modéré modérée monument monuments
médical médicale méthode méthodes négociation objection opposition paradoxal paradoxale paragraphe partenaire
participant participante position positions priorité probabilité procédure profil prévention racisme registre
restauration rhétorique rime risque risques romantisme récession satirique scandale scène solidarité spécialiste
stratégie surprise surréalisme suspect symboliser thème thèmes transition électoral électorale émotion émotions absentéisme
excellent excellente présentation action actions ambiance changement opposition coalition scandale politique électoral électorale monument monuments historique développement création importance sécurité taxe maximum satirique système systèmes profil profils priorité priorités récession inflation exporter importer économique économiques financier financière intervention interventions maintenance
`.trim().split(/\s+/));

// A B2 vocab entry may repeat an A1–B1 entry only when it teaches a new meaning, listed here
// with the reason (the audit flags any other repeat as an error). Key: the `fr` text, lowercase.
// These are the new meanings marked in docs/plans/b2.
export const NEW_MEANINGS: Record<string, string> = {
  "un bilan": "B2 (b2-conditionnel-passe): a toll, in the news. b1-review-final taught a stock-take.",
  "un entretien": "B2 (b2-reported-speech-past): a media interview. b1-cover-letter taught a job interview.",
  "le marché": "B2 (b2-economy-and-business): the market, in economics. a1-places-in-town taught a street market.",
  "près de": "B2 (b2-presenting-data): nearly, with figures. a1-prepositions-of-place taught near.",
  "un état des lieux": "B2 (b2-formal-report): an overview of a situation. b1-housing-and-renting taught an inventory check.",
  "quoi": "B2 (b2-colloquial-french): the filler at the end of a sentence. a1-question-words taught what.",
  "trop": "B2 (b2-colloquial-french): very, in familiar speech. a2-adverbs-ment taught too (much).",
  "une société": "B2 (b2-economy-and-business): a company. Society is on the cognate list and in b2-review-nuance (un débat de société).",
  "une action": "B2 (b2-economy-and-business): a share in a company. Action (an act) is on the cognate list.",
  "un serveur": "B2 (b2-relative-lequel): a computer server. a2-jobs-and-workplace taught a waiter (un serveur / une serveuse).",
  "un chapeau": "B2 (b2-summarizing-an-article): the standfirst of an article. a1-shopping-for-clothes taught a hat (le chapeau).",
  "un carrefour": "B2 (b2-review-what-might-have-been): a crossroads in life, figuratively. a1-asking-directions taught a road junction (le carrefour).",
};

// The passé simple (recognition only, from b2-arts-and-literature on). Unambiguous endings and
// common irregular forms; present-tense forms that share an ending are excluded.
const PS_FORMS = new Set(`fut furent eut eurent fit firent vint vinrent tint tinrent prit prirent mit mirent naquit
naquirent mourut moururent vécut vécurent dut durent put purent sut surent voulut voulurent connut connurent
parut parurent crut crurent lut lurent vit virent dit dirent écrivit écrivirent répondit répondirent`.trim().split(/\s+/));
const PS_ENDING = /^[a-zàâçéèêëîïôûùüÿœ]{2,}(?:èrent|âmes|âtes|îmes|îtes|ûmes|ûtes|ât|ît|ût|irent|urent|inrent)$/;
// Present or noun forms with the same endings.
const NOT_PS = new Set(`espèrent préfèrent gèrent considèrent opèrent exagèrent tolèrent récupèrent libèrent accélèrent
digèrent suggèrent modèrent génèrent coopèrent répèrent désirent tirent admirent respirent inspirent aspirent expirent
soupirent attirent retirent durent assurent mesurent jurent figurent murent pleurent fleurent plaît connaît paraît naît
disparaît reconnaît apparaît goût coût août dégoût ragoût`.trim().split(/\s+/));
// "durent", "dit", "vit", "lut" and similar are also present forms or nouns: they only count in a sentence
// that has another passé simple form, or when the tense is otherwise clear. Keep them as single-word hits.
const AMBIGUOUS_PS = new Set(["dit", "vit", "lut", "put", "sut", "dut", "durent", "virent", "dirent", "mit", "prit", "lurent"]);

/** Passé simple forms in a French sentence (lowercase words). */
export function passeSimpleForms(s: string): string[] {
  const words = s.toLowerCase().normalize("NFC").replace(/[’]/g, "'").split(/[^a-zàâçéèêëîïôûùüÿœ']+/).map((w) => w.replace(/^.*'/, ""));
  const hits = words.filter((w) => !NOT_PS.has(w) && (PS_FORMS.has(w) || PS_ENDING.test(w)));
  // An ambiguous form on its own isn't enough: "il dit" is also the present.
  return hits.some((w) => !AMBIGUOUS_PS.has(w)) ? hits : [];
}

// Spoken features that stay out of exercise answers before b2-registers and b2-colloquial-french.
/** True when a French sentence drops the ne of a negation (pas, jamais, rien, plus... with no ne). */
export function dropsNe(s: string): boolean {
  const t = " " + s.toLowerCase().replace(/[’]/g, "'") + " ";
  return /\s(?:pas|jamais|rien|personne)\s/.test(t) && !/\sn(?:e\s|')/.test(t) && !/\b(?:pas mal|pas du tout|pourquoi pas|pas encore|pas vraiment)\b/.test(t) && !/^\s*(?:pas|non)\b/.test(t);
}
