# B2 writing log

## B2 setup (conventions and checks)

- **B1 longer texts are too short for the planned B2 range, so I didn't apply it.**
  - The longer texts in the 13 B1 communication lessons average 89 French words, ranging from 45 to 141.
  - That's outside 250 to 400, so CLAUDE.md requires one longer text per communication and culture lesson but leaves its length to decide.
- **CLAUDE.md:**
  - New "B2 conventions" section: En résumé, the 14 French instruction verbs plus instruction nouns, lengths and the exercise mix, the 4 new exercise types, glossary and `Note:` formats, cognate and new-meaning allowlists, passé simple, register and facts.
  - The Workflow section now has the B2 steps.
- **lib/types.ts, lib/lessons.ts and components/exercise-player.tsx:**
  - New exercise types: `reformulation`, `register-shift` and `error-correction` are typed answers; `connector-choice` picks from options to fill a ___ gap.
  - The validator rejects these four types below B2. The player renders them.
- **scripts/lesson-text.ts:** "En résumé" is a text section, out of the teaching-text count but counted in the whole lesson. There are new helpers for its text and for `Note:` lines.
- **scripts/b2-lists.ts (new):** the instruction words, the cognate allowlist, NEW_MEANINGS (empty), a passé simple finder and a dropped-*ne* test.
- **audit:content:** 7 new B2 rows:
  - lengths
  - En résumé (presence, words per unit, position)
  - the vocab, exercise and dialogue mix, and a longer text in communication and culture lessons
  - repeated A1 to B1 vocab (an error)
  - French sentences and tips copied from an earlier level
  - passé simple before lesson 46 or in typed answers
  - dropped *ne* in answers before lesson 53
- **check:words:** from B2, it also checks En résumé text and whole French prompts, treats cognates and instruction words as known, and flags glossary entries that no longer text uses.
- **check:structures:**
  - 21 B2 rules, mapped to outline lessons through the syllabus.
  - It counts distinct Note-glossed forms in longer texts against the cap of 2.
  - Its summary line now reads "in B1 and later".
- **test:content:** 3 new fixtures cover the new types below B2, a connector-choice with no gap or options, and a valid B2 lesson using all four types.
- **Checks:**
  - All pass: check:words, check:structures, audit:content, validate:content, test:content, test:checker (29/29), lint and build.
  - The A1 to B1 output is identical to a baseline from the committed scripts. The only differences are the 7 new B2 audit rows (all 0) and the reworded check:structures summary.
  - I checked the B2 rules on a temporary probe lesson, then deleted it.
- **Not done:**
  - These can't be detected: *on* for *nous*, *ça* for *cela*, italics plus English on a term's first use, the 2-to-3-sentence recap limit, nominalisation, adjective position and *tout*.
  - The new exercise types haven't been tried in a browser.

## B2 plan

- **Files:**
  - docs/plans/b2/unit-1.md to unit-8.md: all 59 lessons. Each has its goal, prior coverage, structures, vocab, dialogue, text, En résumé, exercise list, prerequisites, LessonLinks, review items and size.
  - docs/plans/b2/overview.md: the cross-unit checks.
  - docs/b2-plan-review.md: 19 decisions.
- **Checks:**
  - A script checked the planned vocab against all A1 to B1 entries.
    - 32 planned "new" words were already taught. They're now recaps.
    - 7 are kept as new meanings for NEW_MEANINGS.
    - *un compromis* is replaced by *un juste milieu*.
  - The same script found no prerequisite cycles and no lesson over 6 prerequisites.
  - Every vocab count is within the limits.
  - Every early use of a structure is tied to a decision or a labelled fixed phrase.
- **Biggest risks:**
  - Nominal style and logical connectors are needed before their lessons (decisions 2 and 3). Accepting both renumbers lessons 5 to 45.
  - Unit 2's order (decision 4).
  - The longer-text length is still open (decision 1). It drives the 1,800-word cap for 21, 37, 44 and 57.
  - Five lessons sit at the 1,200-word grammar limit (decision 8).
  - Sensitive topics (decision 16).
  - About 60 cognates and 7 new meanings still need adding to scripts/b2-lists.ts.
- **Not done:**
  - Every "check before writing" item was resolved against the A1 to B1 vocab. One B1 gap turned up: b1-making-a-complaint uses *c'est-à-dire* with no vocab entry, so b2-logical-connectors now defines it.
  - The 250 to 400-word longer-text range wasn't applied (decision 1).
  - docs/syllabus.md isn't changed yet; that waits for decisions 2 to 4 and 18.

## B2 plan, second pass (decisions applied)

- **Order:** the syllabus and the B2 outline use the new order. Unit 1 has 8 lessons, Unit 3 has 10 and Unit 6 has 5, with no unit renamed.
  - b2-logical-connectors follows b2-concession-opposition.
  - b2-nominalisation precedes b2-summarizing-an-article and is re-planned for news and politics vocabulary. It doesn't overlap b2-politics-and-society or b2-reporting-verbs.
  - Unit 2 is reordered, ending with b2-regret-and-reproach.
  - Every prerequisite change is applied, plus b1-ce-qui-ce-que for b2-relative-prepositions. The two review lessons' prerequisites are fixed.
- **Plans:**
  - Every plan block is renumbered and in its new unit file, with the conditional "if decision…" text resolved.
  - The trims from decision 8 and the additions from decision 14 are in, all within their limits.
  - The subjonctif-passé fixed-phrase note is gone from b2-regret-and-reproach. docs/review-needed.md has no B2 entries yet, so nothing there changed.
- **CLAUDE.md:**
  - longer texts are 150 to 250 words
  - grammar lessons need 12 or more vocab entries
  - En résumé follows the lesson's current unit
  - there's a sensitive-topics rule
  - the Workflow points to docs/plans/b2
  - lessons are named by id
- **Scripts:**
  - **scripts/b2-lists.ts:** the plans' cognates and the 7 new meanings.
  - **audit:content:** the grammar vocab minimum and the longer-text check.
  - **check:structures:**
    - pour que, the concessive relatives, the extended connectors and *le fait que* are mapped to their lessons
    - *il semble que* is no longer mapped to b2-certainty-and-probability (b2-nuancing-opinions teaches it)
    - accent-initial patterns now match (they never did before)
  - **test:content:** a B2 syllabus-order check, with a fixture.
- **Checks:**
  - Re-run on the new order, every check is clean: no structure or word used early, no cycles, nothing over 6 prerequisites, all 59 plans match the syllabus, and all sizes are within the limits.
  - validate:content, test:content, test:checker (29/29), audit:content, check:words, check:structures, lint and build all pass.
  - The A1 to B1 output is identical to the baseline, apart from the new B2 audit rows.
- **New problems:** 3, in docs/b2-plan-review-2.md:
  - four grammar lessons in a row in Unit 1
  - Unit 3 has 10 lessons
  - B1's *c'est-à-dire* gap
- **Not done:** check:structures can't detect *à* + infinitive with a passive sense.

## Unit 1

- **Step 0:** b2-idioms-everyday moved to order 5 in the syllabus, outline, unit-1 plan and overview. No prerequisite broke, and the checks stayed clean.
- **Teaching-text words:** nuancing-opinions 853, social-issues 833, subjunctive-conjunctions 821, concession-opposition 819, idioms-everyday 823, logical-connectors 875, purpose-expressions 909, review-nuance 820 (all b2-).
- **Content deviations:**
  - Added *la lutte contre* (social-issues), and *une affiche* and *un atelier* (purpose-expressions). The forum glossary has 1 word. Concession uses *bien qu'il pleuve* (the past subjunctive comes later).
  - The *soit… soit* table counts as teaching text. Purpose ex014 is a translated paragraph. *On* variants are removed from typed answers. Extra English paragraphs reach 800 words, and words that weren't defined were reworded.
- **List and script changes:** *le sens* is an instruction noun (CLAUDE.md and b2-lists.ts). New cognates: excellent(e), présentation, action(s), ambiance. check-words.ts has B2-only English words and 4 subjunctive forms. *Certes* is now *sehrt*.
- **Checks:** check:words, check:structures, audit (0 B2 findings), validate, test:content, test:checker (29/29) and build all pass. The A1 to B1 output is identical to the baseline.
- **review-needed.md:** 22 items under the 8 ids. They cover moods (*il semble que*, *bien que*, *de sorte que*, *ne explétif*), registers (*SDF*, *quand même*, *vu que*, the idioms), *malgré que*, *or*, *mitigé* and the immigration sentences.
- **Not done:** no fluent-speaker check yet. The review's link to b2-conditionnel-passe shows "Coming soon" until that lesson exists.

## Unit 1, batch-review fixes

- **b2-subjunctive-conjunctions:** a note callout on *après que* + indicative (no B1 lesson teaches it). The warning now links *même si* to the next lesson. Answer variants: ex009 and ex010 word order; ex013 *attendre que*, with the *on* forms removed.
- **b2-concession-opposition:** *même si* + indicative added (no lesson taught it). It has a vocab entry, a section, two examples and a résumé line, and syllabus, unit-1 and unit-2 now treat it as a recap in b2-mixed-conditionals. The mood claim for *alors que* is now just "the rule". The dialogue uses *avoir beau trouver* and a single *quand même*, and the résumé's *avoir beau* and *quand même* lines are rewritten. Variants added to ex007, ex008, ex009 (also *même si*) and ex012 (*on* removed). ex013's cue is reworded, and ex014 is pinned to *néanmoins* ("Nevertheless, formal").
- **b2-purpose-expressions:** *en faveur de* removed (it wasn't in the review). The *pour* + infinitive, *sensibiliser* and *convaincre* links were already right. ex010 cue + « nous ». *De sorte que* accepted in ex012; *manquer* in ex013; ex014 says "problem" and has 6 answers. The dialogue uses *pour*, not formal *afin de*.
- **b2-logical-connectors:** ex011 accepts *néanmoins*. ex013's cue is pinned, with word-order variants. ex014 accepts *de plus* and *d'ailleurs*, and its cue reads "Consequently, formal". *D'abord* was credited to the wrong lesson; it's now *premièrement* and *deuxièmement*. *De plus* links its lesson, and the punctuation paragraph is fixed.
- **Scan found and fixed:**
  - b2-nuancing-opinions: Inès said *partagé*, now *partagée*; ex010 accepts *il me semble que*; the warning had circular reasoning.
  - b2-social-issues: ex014 accepts *problème*.
  - b2-idioms-everyday: ex009 accepts *Il n'est pas venu*; ex012 is pinned to the idiom; ex013 accepts *coûter un rein*.
  - b2-review-nuance: ex011 word order; ex014 pinned (4 answers); ex015 accepts 3 connectors.
  - No wrong links or filler sections found.
- **CLAUDE.md:** a new B2 accepted-answers rule, and the self-check question added to workflow step 5. 2 new items in review-needed.md (*même si*, *après que*), plus 1 for the new dialogue line.
- **Checks:** check:words, check:structures, validate, test:content, test:checker (29/29) and build pass. The audit's only B2 row is purpose ex014 with 6 answers, allowed under the "6 or fewer" instruction. A1 to B1 output is unchanged.

## Unit 2

- **Teaching-text words:** conditionnel-passe 870, si-plus-que-parfait 832, mixed-conditionals 808, futur-anterieur 860, subjonctif-passe 831, regret-and-reproach 806 (whole lesson 1,475), review-what-might-have-been 828 (all b2-).
- **Vocab deviations:**
  - Recaps instead of entries: *éviter*, *après que*, *ravi*, *fier*, *déçu*, *s'inquiéter*, *il aura oublié*. *D'ici* is merged into one entry.
  - Added: grammar-term entries for the résumés, *un rapport*, *ému*, *se réjouir que*, *trinquer*.
- **Exercise deviations:**
  - si ex7 distractors are *bien que* and *pour que* (*même si* + plus-que-parfait is grammatical).
  - mixed ex12 is about medicine, and regret ex6 avoids *mec* (law and slang aren't taught).
  - Several cues are pinned so every valid answer is listed. No dialogue relies on agreement with a preceding object pronoun.
- **Lists and scripts:** NEW_MEANINGS has *un carrefour*. check-words.ts has *pleuvrait* and some B2-only English words.
- **Checks:** check:words, check:structures, audit, validate, test:content, test:checker (29/29) and build all pass. The only B2 audit row is the earlier purpose ex014 (6 answers). Duplicate vocab is 66 (*un bilan*, a NEW_MEANINGS entry). A1 to B1 output is unchanged.
- **review-needed.md:** 20 items under 6 ids. They cover the news conditionnel, *si j'aurais su*, *se douter que*, *faillir*, *au cas où*, *sauf si*, *après que*, supposition, the subjunctive tenses, the 3 fixed phrases and *tu aurais pu*.
- **Not done:** no fluent-speaker check.

## Unit 2, batch-review fixes

- **b2-conditionnel-passe:** the "always describes" sentence now covers this lesson's two uses only, and there's a 2-sentence agreement recap (*je l'aurais vue*, linking a2-pronouns-in-passe-compose). Also: *apparemment* confirmed, a *bilan* example, a *la médecine* entry, *cela* in the *ça aurait été* entry, ex014 with 4 combinations, *changement* in ex011 and COGNATES.
- **b2-si-plus-que-parfait:** the *j'avais* / *j'aurais* paragraph is rewritten. The tip uses *je me suis couché tard* (*mouillé* isn't taught). Also: *se douter (de / que)*, ex008 feedback and *manqué*, the ex009 cue and a *presque* entry, *rater* and *prévoir* confirmed.
- **b2-mixed-conditionals:** *si je parlais allemand* is now a hypothesis about the present (text and résumé). *Même si* and *carrière* confirmed. ex007 *rich* is now *polite*, and *réussir sa vie* and *le destin* have examples.
- **Scan:**
  - "never the conditionnel after *si*" is false for indirect questions later in B2, so it now reads "*si* meaning 'if'".
  - *bien que* keeps the subjunctive with one subject (b2-subjonctif-passe).
  - *ce n'est pas grave* meant "it's not serious" at A2 (b2-regret-and-reproach).
  - Unused entries now have examples in futur, subjonctif and regret. The review's warning covers preceding-object agreement. regret ex006 and ex008 have new variants.
- **Docs:** 2 CLAUDE.md rules and the A2 agreement note. The unit-4.md agreement checklist with ex4 (about 1,000 teaching words, within limits), and the overview updated. 2 review-needed items.
- **Checks:** all 7 pass; the only B2 audit row is the earlier purpose ex014. A1 to B1 output is unchanged.

## Unit 3, run 1

- **Teaching-text words:** politics-and-society 800, reported-speech-past 889, reported-questions-orders 815, reporting-verbs 808, passive-voice 828 (all b2-). Run 2 (b2-alternatives-to-passive to b2-review-news) isn't written yet.
- **Vocab deviations:** recaps instead of entries for *candidat*, *démissionner*, *interdire*, *exiger*, *ajouter*, *confirmer*, *éviter de* and *ce jour-là*. Merged entries: *le pouvoir* / *au pouvoir*, *tenir sa promesse* / *tenir parole*, *la veille* / *la veille au soir*. Added entries: *le Parlement*, *le discours indirect*, *l'imparfait*, *un château*, *un mur*.
- **Exercise deviations:**
  - politics ex13 uses *monter* (*augmenter* isn't taught).
  - reported-speech ex10 sets the context so that *viendra* is wrong.
  - reporting-verbs ex13 is "nothing had changed" (the passive is the next lesson).
  - passive ex10 corrects agreement (*aimé par* isn't wrong).
  - Several cues are pinned. The "still true" exception adds variants in ex008, ex012 and ex009.
- **Lists and scripts:** new COGNATES (*opposition*, *coalition*, *scandale*, *politique*, *électoral(e)*, *monument(s)*, *historique*), new irregular forms and B2-only English words in check-words.ts. *Imparfait* is a vocab entry because it's flagged at A2.
- **Checks:** check:words, check:structures, audit (only the earlier purpose ex014), validate, test:content, test:checker (29/29) and build all pass. A1 to B1 output is unchanged.
- **review-needed.md:** 21 items under 5 ids. They cover the institutions and law-making, two-round elections, the tense-shift exceptions, *insister pour que*, *audition*, *nier que*, *prétendre*, headlines, and *par* / *de* in the passive.
- **Not done:** no fluent-speaker check.

## Unit 3, run 2

- **Teaching-text words:** alternatives-to-passive 909, nominalisation 814, summarizing-an-article 802, culture-french-press 800, review-news 803 (all b2-).
- **À + infinitive (hand check):** taught in b2-alternatives-to-passive. Earlier uses are glossed fixed phrases only (b1 *à voir absolument*, *à éviter*, *un appartement à louer*) plus a2-review-travel *choses à voir*; logged in review-needed.md.
- **Vocab deviations:**
  - New entries: *l'arrivée* (the plan's "A2 recap" isn't in any vocab), *les habitants*, the grammar terms (*adjectif / adverbe*, *masculin / féminin*, *groupe nominal*) and *l'auteur / l'autrice d'un article*. Unknown source verbs are shown in brackets in the noun entries.
  - Recaps instead of entries: *un lecteur* (b1-review-opinions), *éditorial* and *abonnement* (B1). *Le chapeau* goes in NEW_MEANINGS.
- **Exercise deviations:** the review's model text uses *sera ouverte* (*rouvrir* and *de nouveau* aren't taught), and several cues are pinned. Nominalisation doesn't overlap b2-politics-and-society or b2-reporting-verbs.
- **Lists and scripts:** new COGNATES (*développement*, *création*, *importance*, *sécurité*, *taxe*, *maximum*, *satirique*), and in check-words.ts the press names and a few irregular forms.
- **Checks:** check:words, check:structures, audit (only the earlier purpose ex014), validate, test:content, test:checker (29/29) and build all pass. A1 to B1 output is unchanged.
- **review-needed.md:** 18 items under 5 ids: *se voir* agreement, *on m'a dit*, the earlier *à* + infinitive uses, suffix genders, nominal style, *chapeau*, *il ressort que*, the press leanings and titles, the AFP, public broadcasting, and the satire framing.
- **Not done:** no fluent-speaker check.

## Unit 3 fixes

- **passive-voice:** infinitive after *devoir* / *pouvoir*, subjunctive after *il faut que* (text, list, résumé). The résumé says *c'est être qui change de temps*; *de nouveau* and *à l'époque* are replaced; *de* / *par* "differ in emphasis". ex012 accepts *avant juin*; ex014's cue says passé composé and it also accepts *va être rénové*. *Reporter* and *annuler* confirmed.
- **reported-speech-past:** the *était malade* example says "he was ill", with a "had been" note, and the résumé is reworded. ex012 pinned with *a dit*; ex014 accepts *allait ouvrir* (*terminer* isn't taught). *Déclaration*, *porte-parole* and *entretien* confirmed.
- **reported-questions-orders:** ex014 accepts *allait être*. The *enquête* / *témoin* sentence credits each lesson separately, and the résumé is reworded.
- **culture-french-press:** papers are described by type and format only; leanings are removed and review-needed.md is updated. The paragraph that repeated the tip is gone; local editions and agency texts are added.
- **CLAUDE.md:** new fixed-phrase rule.
- **Scan:**
  - Fixed phrases defined at first use: *avoir lieu* (nuancing), *avoir du mal à* (social-issues), *faire semblant de* and *prendre du retard* (reporting-verbs), *de leur côté* (summary), *d'ici là* (a futur-anterieur note). Replaced: *de près*, *en plus*, *il s'agit de*, *au bord de*, *en même temps*.
  - Claims softened: "most verbs with *à*" and "normally no *par*". *Aller* variants added in politics and review ex013 / ex014; summary ex014 pinned. The reporting-verbs résumé is reworded. All "you know X from Y" claims hold.
- **Checks:** all 7 pass; the only B2 audit row is the earlier purpose ex014. A1 to B1 output is unchanged.

## Unit 4

- **Step 0:** the agreement checklist was already in unit-4.md (about 1,000 teaching words, within the review limits). It's written into b2-review-pronouns.
- **Teaching-text words:** relative-lequel 802, relative-prepositions 805, subjunctive-relative-clauses 823, idiomatic-y-en 802, mise-en-relief 802, review-pronouns 806 (all b2-).
- **Vocab deviations:**
  - Recaps instead of entries: *le jour où* (a2-relative-qui-que-ou teaches *où* for time), *parler couramment*, *un logement*, *idéal*, *ce qui compte, c'est*, and *s'en vouloir* (*je m'en veux* is from b2-regret-and-reproach).
  - Added: *quoique*, *une réponse*, the grammar terms (*préposition*, *phrase relative*), the plural forms *auxquels* / *desquels*, *il n'y a personne qui* and *la mise en relief*. NEW_MEANINGS has *un serveur*.
- **Exercise deviations:** prepositions ex4 tests *ce sur quoi* instead of *où*. The *qui* / *lequel* MC uses clearly wrong distractors (*que*, *dont*), because *lequel* is correct too. Several cues are pinned, and *lequel* variants are listed for people.
- **Hand checks:** no untaught fixed phrases left (*gagner du temps*, *parmi*, *le jour même* and *compliqué* were replaced). One sentence copied from A2 (*Tu lui as parlé ?*) is reworded. Dialogues avoid dislocation before b2-mise-en-relief.
- **Checks:** check:words, check:structures, audit (only the earlier purpose ex014), validate, test:content, test:checker (29/29) and build all pass. A1 to B1 output is unchanged.
- **review-needed.md:** 17 items under 6 ids: *dont* after compound prepositions, *qui* / *lequel* for people, *parmi* / *entre*, *quoique*, moods after superlatives and negatives, the *y* / *en* registers, *comme je te l'ai dit*, *c'est moi qui ai*, *ce sont*, dislocation, and the agreement checklist.
- **Not done:** no fluent-speaker check.

## Unit 5, part 1

- **Teaching-text words:** economy-and-business 800, faire-causatif 815, participles-and-gerund 815, infinitif-passe 812, meetings-and-calls 809 (all b2-).
- **Register deviations:** the economy and participles dialogues use *vous* (the plan had *tu*), and the meetings call is *vous* throughout (the plan mixed them), per the workplace rule. *Tu* and *on* in meetings are described as spoken habits.
- **Vocab deviations:**
  - Added entries: *racheter / le rachat*, *un bienfait*, *un salarié*, *un contrat de maintenance*, *différent* (the plan's "A2 recap" isn't in any vocab), *remercier*, three grammar terms, and a 3-word glossary for the minutes.
  - Recaps instead of entries: *convaincant*, *précédent*, *suivant*, *ayant / étant*, *en conclusion*. NEW_MEANINGS has *une société* and *une action*.
- **Exercise deviations:** five spelling pairs, not six (a sixth would need untaught words). Plan examples with untaught words were changed (*mentir*, *date*, *tais-toi*, *évier*). Several cues are pinned, and alternatives are listed (*on lui a volé*, *après avoir fini*, *sans dire*).
- **Lists and scripts:** new COGNATES (economy terms, *intervention*, *maintenance*, *priorité*, *profil*, *système*), and in check-words.ts a few irregular forms and B2-only English words.
- **Checks:** check:words, check:structures, audit (only the earlier purpose ex014), validate, test:content, test:checker (29/29) and build all pass. A1 to B1 output is unchanged.
- **review-needed.md:** 16 items under 5 ids: the false friends and *PME*, *fait* / *laissé* agreement, the spelling pairs, past-infinitive negatives, *remercier de / pour*, *nier* + infinitive, and the spoken meeting habits.
- **Not done:** no fluent-speaker check. Part 2 (negotiating to review-work) is still to write.

## Unit 5, part 2

- **Teaching-text words:** negotiating 809, presenting-data 806, formal-report 806, review-work 831 (all b2-).
- **Register deviation:** the presenting-data dialogue uses *vous* (the plan had *tu*), per the workplace rule. All four dialogues are *vous*.
- **Vocab deviations:**
  - Recaps instead of entries: *une proposition* (b2-meetings glossary), *un compromis*, *un rapport* (b2-futur-anterieur), *une piste*, *à long terme*, *le télétravail*.
  - Added: *fournisseur*, *acheteur*, *commande*, *baisser*, *élevé*, *les ventes*, *l'évolution*, *la part*, *un plan d'action*, and glossaries (*fictif*, *remarquable*, *isolement*, *satisfait*). *Près de* and *état des lieux* were already in NEW_MEANINGS.
- **Exercise and text deviations:** *la plupart*, *en tête* and *pour cent* were kept out of negotiating (not yet taught there). The *quoi* filler is avoided, and figures are invented and labelled. *Laisser* + infinitive is practised in review-work (a section, ex002, ex015, ex016).
- **Fixes after the audit:** strictAccents added; three longer texts brought to 150 or more words; new sections (opening and closing a negotiation, structuring a presentation, one fact at three report levels); bullets that read as dialogue reworded.
- **Checks:** check:words, check:structures, audit (only the earlier purpose ex014), validate, test:content, test:checker (29/29) and build all pass. A1 to B1 output is unchanged.
- **review-needed.md:** 11 items under 4 ids: *quitte à*, polite *si* + imparfait, *remise*, the % spacing, *augmenter de / passer de… à*, *données*, *il importe / il apparaît que*, the report plan, *nous* in reports, *collaborateur* and *qualité de vie au travail*.
- **Not done:** no fluent-speaker check.

## Unit 6

- Written: b2-science-and-research (41), b2-health-system (42), b2-certainty-and-probability (43), b2-argumentative-essay (44), b2-review-science (45).
- Teaching words (whole lesson): science 877 (1,247), health 821 (1,206), certainty 804 (1,170, well within the grammar cap, so nothing had to be cut), essay 890 (1,654), review 896 (1,336). Model essay 249 French words, after trimming from 254.
- Deviations from the plan:
  - health-system: added entries for *la santé*, *une maladie* and *un adulte*, which weren't in the earlier vocab.
  - science-and-research: recaps *une preuve* (b1-expressing-doubt-certainty) instead of a new entry.
  - argumentative-essay: added *le sujet* and *une amorce* (19 entries plus 7 glossary); *ouverture* is a B2 new meaning, so it's in the note, not in NEW_MEANINGS (which covers A1 to B1 only).
  - review-science: *obligatoire* replaces *un progrès* (A2 has *faire des progrès*).
- Fixed while checking: strictAccents on 3 exercises; teaching text below 800 in lessons 41 to 43, fixed with real sections (describing a study, questions to ask about a study, one visit step by step, where the adverb goes); untaught phrases replaced (*poser un problème*, *y voir*, *au lieu de*, *faire partie de*); an *adultes* that came before its lesson; mixed connector variants added to two plan-announcement answers.
- Lists: COGNATES gained *transition(s)*, *paragraphe(s)*, *introduction(s)* and *concentration*, and B2_ENGLISH gained 5 prompt words.
- Checks: check:words 110 (baseline), check:structures 0, audit 0 B2 rows for Unit 6, validate OK, test:content and test:checker passed (29/29), build OK. A1 to B1 words, structures and all-data unchanged; the audit differs only in B2 row labels and the lesson count.
- review-needed.md: 5 new sections (mood claims, the *sans doute* false friend, *le fait que*, health-system facts with no rates, the dissertation plan and *nous*/*je*, the precautionary principle).
- Not done: nothing.

## Units 4 and 5 fixes

- subjunctive-relative-clauses: both mood-table rows are now minimal pairs with different forms (*est / soit*, *peut / puisse*); ex014 is one coherent flatshare ad (two subjunctives for the flatmate, one after *le seul*); ex008 accepts *qui sache travailler en équipe*; *exigeant* is now used (*un poste exigeant*). ex012 unchanged: *tranquille* isn't taught. The "so far, relative clauses have been in the indicative" claim is verified: no A1 to B1 or earlier B2 lesson has a subjunctive relative, so it's unchanged.
- relative-prepositions: dialogue uses *qu'elle me dise* and *c'est de quelqu'un qui m'écoute*; the repeated-preposition rule is limited to "a noun follows", since *c'est que* + clause takes none. ex001 accepts *laquelle*; ex012 accepts *sur qui / sur laquelle je peux compter*. *La confiance* is in b1-relationships (verified).
- relative-lequel: *fonctionner* is "the standard word; *marcher* is more informal"; the dialogue translation says "during which"; *paramétrer* is used in an example; vocab ids are in order; ex008 accepts the appositive.
- mise-en-relief: *sur le fond* is in b2-nuancing-opinions (verified). Scan fix: *l'essentiel, c'est que vous avez travaillé* (indicative where the subjunctive is standard) became *l'essentiel, c'est votre travail en équipe*.
- faire-causatif: ex008 accepts *au plombier* and *je le fais réparer par le plombier*. *S'y prendre* is in b2-idiomatic-y-en (order 29, before 33), and b1-food-and-cooking has *faire cuire / bouillir / fondre* (both verified).
- participles-and-gerund: ex008 and ex011 accept the requested variants (ex011 now has strictAccents); "can miss"; the dialogue says *n'avions pas reçu de réponse*.
- Scan:
  - Two dialogue lines broke their lesson's own rules: the infinitif-passe line *Après avoir atteint ces objectifs, c'est normal* (two subjects) became *…, vous avez raison d'en parler*; the mise-en-relief line is above.
  - Unused vocab: three entries are now used (*en rester là* in idiomatic-y-en, *un document de travail* in participles-and-gerund, *un pourcentage* in presenting-data). The other script hits were inflected uses.
  - review-pronouns ex003 accepts *laquelle*.
  - presenting-data ex013 was incoherent: "sales" going from 20 % to 30 % and then "rising by 50 %". It now covers the share of online sales, which rises by ten points.
  - Untaught fixed phrases replaced: *à temps* (infinitif-passe ex011) and *par écrit* (negotiating).
  - The infinitif-passe credit to b2-regret-and-reproach is now a LessonLink. All other "you know X" claims are verified.
- CLAUDE.md gained a "Self-audit" bullet in the B2 conventions with the four rules. Checks: check:words 110 (baseline), check:structures 0, audit B2 rows only the accepted purpose-expressions ex014, validate OK, test:content and test:checker passed (29/29), build OK. A1 to B1 words, structures, audit and all-data are unchanged.
