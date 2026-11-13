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

## Unit 6 fixes

- science-and-research: ex003 also accepts *faire* (une étude), and ex004 also accepts *avancée*; both explanations updated.
- health-system: new entry v021 *passer par*, an untaught fixed phrase, now glossed at first use (*passer par le médecin traitant*). ex011 also accepts *je vais voir mon généraliste*.
- certainty-and-probability: same-form subjunctives replaced (the example's *change* became *soit différente*, ex014's *change* became *puissent embaucher*, the dialogue's *donnent* became *aient donné*). The warning "only *certain* and *probable* keep the indicative" is now limited to this lesson's scale. The untaught *plus ou moins* is gone from the résumé.
- review-science: same-form subjunctives removed (ex008 *doutent* became *n'aient pas confiance*; ex009 and ex015 *donne* became *soit acceptée*). In the model essay, *donne* became *soit bien acceptée* and *ait donné son avis*; the grammar bullet and translation follow.
- argumentative-essay: no changes needed.
- The audit also found: every vocab entry used (the script hits were plural or imperative forms), every "you know X" claim correct, no dialogue line breaking its lesson's rule, coherent paragraph exercises, no figures, quotes or named politicians in the health lessons, and no A1 to B1 vocab repeats.
- review-needed.md: 3 lines added (*mener* vs *faire une étude*, *passer par*, the limited indicative claim).
- Checks: check:words 110 (baseline), check:structures 0, audit B2 rows only the accepted purpose-expressions ex014, validate OK, test:content and test:checker passed (29/29), build OK. A1 to B1 words, structures, audit and all-data unchanged.

## Unit 6 fixes, round 2

- certainty-and-probability: ex014 accepts the 4 combinations (*certain / clair*, *possible / se peut*). *Une incertitude* and *prévisible* each have a translated Example, and *prévisible* moved to a new "adjectives" group with its own table. *Il doit être parti* has an Example. *Il oublie le fait que…* became a full translated sentence (*on oublie souvent le fait que la recherche prend du temps*). "In science and the news" gained 2 translated examples. Verified as taught: *imprévisible* and *un hasard* (b2-si-plus-que-parfait), *ne pas en revenir* (b2-idiomatic-y-en).
- argumentative-essay: new v027 *dans un troisième temps*, with a note and a teaching sentence; the model essay announces a third part (still within 250 French words, per the audit). ex013 has pinned cues and one answer. Nominal style now uses *on interdit les écrans* and links b2-nominalisation. Verified as taught: *mettre en œuvre*, *réduire*, *gêner*, *tablette*, *examen*, *indispensable*. *Suffire* is taught only as *il suffit que*, so *elle ne suffit pas* was replaced (no Note needed). b2-debating is in the syllabus (order 57); "What's next" now says a science or health essay, to match the review's task.
- review-science: personal *suffire* replaced (*ne peut pas réussir*; the warning and bullet use *réussisse*).
- New rule: CLAUDE.md "Self-audit" now counts an entry as used only in a complete French sentence. audit:content has a new B2 row, "vocab entry not used in a complete sentence". It ignores quoted « » terms and bare glosses, and matches inflected and irregular forms.
- Scan of all 45 B2 lessons: 62 entries in 26 lessons failed. Each now has one translated Example after the paragraph that introduces it (5 sentences reworded for check:words). The neutral sensitive-topic sentences (immigrés, manifestation, caricature) are in review-needed.md.
- Checks: check:words 110 (baseline), check:structures 0, audit B2 rows only the accepted purpose-expressions ex014 (the new row is 0), validate OK, test:content and test:checker passed (29/29), build OK. A1 to B1 words, structures, audit and all-data unchanged.

## Unit 7

- Written: arts-and-literature (46), culture-french-history (47), adjective-position-meaning (48), tout (49), describing-a-work-of-art (50), culture-francophone-africa (51), review-arts (52).
- Teaching words (whole lesson): 46: 1,094 (1,432); 47: 839 (1,408); 48: 1,131 (1,480); 49: 1,086 (1,465); 50: 846 (1,407); 51: 922 (1,506); 52: 876 (1,232). The longer texts of 47, 50 and 51 are within 150 to 250 French words (per the audit).
- Vocab deviations:
  - 46 adds *peindre*, *un humoriste* (for the *comédien* false friend), *il était une fois* and *un roi / une reine* (for the glossed tale).
  - 47 adds *un soldat*, *la paix*, *un monument aux morts*, *prendre le pouvoir*, *occuper*, *libérer*, *se rapprocher* and *un pays voisin*.
  - 48 adds *un vernissage*; 49 adds *un guide* and *une salle* (*partout* is a recap of lesson 44).
  - 50 adds *la lumière* and 4 glossary words; 51 adds *s'amuser*, *un mélange* and *le wolof*. None repeats an A1 to B1 entry, so NEW_MEANINGS is unchanged.
- Exercise deviations: 48 ex013 says "the only woman who came" (*personne* trips the audit's dropped-*ne* check). 51 ex009 uses *je vais m'enjailler* (no spoken *on* in a typed answer). Answers were added for *tous sont venus*, *de la peintre* and *a marqué son époque*.
- Register: spoken *on* appears only in a labelled example (51); typed answers have no spoken features; the passé simple is never in a typed answer.
- Lists and scripts: COGNATES gained arts, history and language terms (*impressionniste*, *existe*, *indépendant(e)(s)*, *européen(ne)(s)*, *communauté*, *rôle*, *pluriel*, *singulier*, *consonne*, *auxiliaire*, *solitude*, *galerie*, *simplicité*, *visiteur(s)*, *ivoirien(ne)(s)*, *africain(e)(s)*, *littéraire*, *standard*, *oral(e)*, *poète*, *génération*, *visible*, *impossible*). check-words IGNORE gained passé simple forms (*fit*, *vint*, *fut*, *eut*, *prit*, *devint*, ...), *deviennent*, *reviendra* and the names *dioula*, *léopold*, *sédar*, *senghor*, *abidjan*, *tamazight*, *varenne*, *enjoy*. *Wolof* became a vocab entry instead, because IGNORE changed an A2 result. B2_ENGLISH gained 4 words.
- Checks: check:words 110 (baseline), check:structures 0, audit B2 rows only the accepted purpose-expressions ex014 (Unit 7 has 0 in every row, including the complete-sentence row), validate OK (after adding lesson 49's missing museum vocab table), test:content and test:checker passed (29/29), build OK. A1 to B1 words, structures, audit and all-data are unchanged, and Units 1 to 6 still show only the accepted row.
- review-needed.md: 7 new sections (passé simple claims, movement dates, history dates and the neutral decolonization paragraph, every adjective pair, *tout* agreement and *quiconque*, *sobre*, the Africa facts and local words, Senghor, *engagée* vs *engageante*). Invented works and painters are labelled.
- Not done: nothing.

## Unit 7 fixes

- arts-and-literature: the tip says *-a* marks the passé simple only when added to the stem (*parl-a*), not on its own (*il a*, *il va*, *il parlera*). ex011's cue matches *au café*. The tale says *leurs enfants*, and *revint* is explained as *revenir* (built on *venir*). *Tableau* "usually" means a picture (A1 to B1 has no blackboard meaning, so NEW_MEANINGS is unchanged). The résumé drops *réunit* and *reconnaît*. ex013 accepts *être en train de*. Claims verified; 5 short sentences were cut to get back under 1,100 words. lib/check-answer.ts already treats œ as oe, and test:checker gained two *chef-d'oeuvre* cases.
- culture-french-history: the Empire paragraph is all passé simple (*prit*, *devint*, *fut publié*), and the other paragraphs are all historical present; the Note and the translation are updated. *Fait beaucoup de victimes*, *l'occupant*, *se termine* and *il y a du monde* were replaced with taught French. The warning was reworded. *La Nouvelle-France* moved to the colonies section, and the Fifth Republic was cut (*un tournant* verified). The ids are in order. The Vichy gap is in review-needed.md.
- adjective-position-meaning: the principle is a "rule of thumb" with its exceptions named and the time words noted (the résumé uses *souvent*). New examples: *un seul enfant… souvent seul*, and *il a fait froid* (*il a plu* isn't taught). ex008 has a new frame, ex013 accepts *Elle est la seule femme…*, ex007 no longer says "à la bonne place". The dialogue says *très grande*. The *grand* and *seul* résumé sentences are explicit. *Vernissage* has its own group. *Courageux* is glossed. Claims verified.
- The scan fixed: tense mixing in two model texts (review-arts is now all historical present, with the Note removed; in africa the literature paragraph is all passé simple, *lancèrent* and *fut*); out-of-order ids in describing-a-work-of-art and africa; the untaught *on peut y voir* and *fait la force de*; the aspirate *h* in tout's rule; an overclaiming tip in africa; 4 missing answers (*C'est un tableau saisissant*, *en train de lire*, *Ils sont tous venus*, *C'est un tableau intemporel*). The audit matcher now knows *prit* and *fit*.
- CLAUDE.md "Self-audit" gained the rule-of-thumb rule and the one-tense-per-paragraph rule.
- Checks: check:words 110 (baseline), check:structures 0, audit B2 rows only the accepted purpose-expressions ex014, validate OK, test:content and test:checker passed (29/29), build OK. A1 to B1 and Units 1 to 6 unchanged.

## Unit 8

- Done: all 7 lessons: registers (53), colloquial-french (54), culture-verlan-and-slang (55), false-friends (56), debating (57), persuasion-and-hedging (58), review-final (59).
- Teaching words (whole lesson): 53: 890 (1,459); 54: 844 (1,261); 55: 828 (1,401); 56: 974 (1,382); 57: 847 (1,532); 58: 924 (1,531); 59: 975 (1,430). The longer texts in 53, 55, 57 and 58 are within 150 to 250 French words (per the audit).
- 54 rewrite: its "Spoken grammar" section repeated b2-registers, so it's now a one-sentence recap plus three new spoken features: *faut* without *il*, *c'est* for *ce sont*, and the repeated subject (*mon frère, il…*).
- Vocab deviations:
  - 53 has no glossary. 55 adds *lourd*, *louche* and *vieillir*. 56 drops *sympathique* and *une lecture* (repeats of A1 *sympa* and *la lecture*, now in the recap table) and adds *raisonnable*, *avoir hâte de*, *dur* and *impoli*.
  - 57 adds *partager l'avis de quelqu'un*, *un commerçant*, *un piéton* and *un auditeur*; 58 adds *ne pensez-vous pas que* as its own entry and drops *réviser* and *un examen* (A1 and A2 repeats).
  - Recap claims cut: *en fait* and *je pense pas* aren't taught where the plan says.
- Exercise deviations:
  - 55 ex010 is a typed reformulation (*Ce film est ouf !*). 56 ex010 corrects *assister la réunion* (*assister le directeur* is correct French), and ex012 accepts only *rendu*.
  - 57 ex005 rebuts with *permettez-moi de vous contredire* (*j'en conviens* belongs to 58). 58 ex003 accepts *ayons* and *avons*, and ex009 labels the subjunctive as careful French.
  - 59 adds a "One sentence per unit" section (8 translated models), and its exercises cover all eight units.
- Register: spoken features appear in typed answers only where the instruction asks for the familiar register (53, 54, 55). The passé simple is in no typed answer.
- Lists and scripts:
  - COGNATES gained *populaire(s)*, *rap*, *énorme(s)*, *maths*, *exercice(s)*, *négation*, *université(s)*, *concession(s)*, *technique(s)*, *prononciation*, *grammaire*, *vocabulaire*, *correct(e)* and *difficulté(s)*.
  - IGNORE gained *deviendront*, *viendront*, *perdront* and *comprenais*; B2_ENGLISH gained 17 option words. NEW_MEANINGS already had *quoi* and *trop*.
- Checks: check:words 110 (baseline), check:structures 0, audit B2 rows only the accepted purpose-expressions ex014, validate OK, test:content and test:checker passed (29/29), build OK. A1 to B1 and Units 1 to 7 unchanged.
- review-needed.md: 7 sections (53 to 59), plus *rendu* vs *rendue* in 56 ex012 and the new spoken features in 54. Not done: nothing; B2 is complete.

## B2 wrap-up

- Cross-level audit: scripts/b2-wrapup.ts (kept; run with `node --experimental-strip-types scripts/b2-wrapup.ts`) writes docs/b2-wrapup.md. Results: 0 limit rows, 1 missing target (the planned c1-passe-simple), 9 forward signposts, 1 B2 vocab repeat (*un tableau*, a deliberate new meaning), 1 repeated 3-word phrase (*à côté de*), 20 claim flags.
- Defects fixed (4 wrong credits):
  - review-nuance credited *certes* to b2-nuancing-opinions; that sentence now names only the two words that lesson teaches.
  - politics-and-society credited the passive to b1-reported-speech-present; it's now linked to b1-passive-voice-intro.
  - review-science credited *ait donné* to b2-subjunctive-conjunctions; it's now linked to b2-subjonctif-passe.
  - debating claimed the whole phrase *si je comprends bien, vous dites que*; it now claims only *si je comprends bien* from b2-negotiating.
- The other 16 claim flags are artefacts (inflected forms, or a term that belongs to another link in the same sentence), checked by hand.
- Judgement calls for you, at the top of docs/b2-wrapup.md: keep or unlink the 9 forward signposts; accept *un tableau*, *à côté de* and the Coming-soon link to c1-passe-simple.
- Review bundles: docs/review/b2-unit-1.txt to b2-unit-8.txt (59 lessons, 88 to 166 KB each), so they stay tracked and .gitignore is unchanged.
- Reviewer brief: docs/b2-reviewer-brief.md (the B1 brief is unchanged). It has a one-page introduction and reply format, then 229 items from review-needed.md, grouped by lesson in syllabus order, numbered, High first (85 High, 121 Medium, 23 Low).
- docs/b2-browser-test.md: 12 exercises (3 per new type) and the five inputs to try. docs/project-state.md is updated with B2 status, the scripts, a conventions summary, gaps and the next stage (C1 conventions, then planning).
- Checks: check:words 110 (baseline), check:structures 0, audit B2 rows only the accepted purpose-expressions ex014, validate OK, test:content and test:checker passed (29/29), build OK. A1 to B1 and Units 1 to 8 are unchanged apart from the 4 claim fixes.

## Unit 1 review fixes

- nuancing-opinions: ex005 distractors are now wrong in the sentence (*Grâce à*, *Pourquoi*); the *il me semble que* rule is limited to affirmative sentences, in the text and the warning (*il ne me semble pas que* + subjunctive); ex007 is a reformulation; ids sorted. Both B1 claims verified.
- social-issues: *de plus en plus de* + noun is taught in b1-environment (verified); *un signe* (untaught) replaced with *cela montre la crise*; ids sorted.
- subjunctive-conjunctions: "won't need to think about the mood each time"; *à condition que tu la rendes*; ex012 accepts *me téléphones*; real example *Je pars avant que nous ne finissions*, with *le ne explétif* named in the résumé; the B1 expletive *ne* is verified.
- idioms-everyday: "more recent" removed; ex010 uses *cette voiture*. *Patronne* and *tomber amoureux* verified.
- logical-connectors: tip says "often at the start", naming the mid-sentence ones. *Polluer* and *supprimer* verified.
- purpose-expressions: the rule, tip, résumé and dialogue use the same-subject test, with the *mes parents travaillent pour me payer* example; *de sorte qu'ils puissent*; "the main purpose expressions"; *pour* + infinitive (a2) and *merci de* (a2-polite-requests) verified; vocab renumbered v001 to v016; the *gaspillent* example became *soit*.
- review-nuance: *prévoir quelques logements sociaux dans chaque nouveau projet… soit ouvert*, and the bullet says *soit*; the title is *quelle piste ?*; ex015 accepts *Notre but est de…* (6 answers, deliberate, like purpose-expressions ex014).
- Claims table (wrap-up NOT FOUND, verdict, action):
  - Real, fixed: the 4 *tout* phrases in tout (now linked to a1-ordering-at-a-cafe, a2-telling-a-story and b1-agreeing-disagreeing); *ce serait bien* in conditionnel-passe (now *ce serait*); *ne vous en faites pas* in review-pronouns (now credited as *s'en faire*).
  - Artefacts (a term that belongs to another link, an ellipsis or an inflected form), no action: *il est vrai que… mais*, *je ne pense pas que ce soit vrai*, *un débat de société*, *un juste milieu*, *un carrefour*, *la loi a été adoptée*, *c'est qui*, *à court / moyen terme* (the claim is *à long terme*), *plus… plus*, *parlez-vous ?*, *réaliser*, *une objection*, *si je comprends bien, vous dites que*.
  - Forward signposts: 2 of 9 didn't say "later" (si-plus-que-parfait, regret-and-reproach) and now do.
- Scan of Units 2 to 8:
  - Vocab ids sorted in 9 lessons; no ids missing.
  - Softened claims: *si bien que* "never after a full stop", "*plutôt* is the most common", "*courant* is never wrong", "the most common mistake", "always credit the source", "the most common use", "the most common professional situation".
  - Mood heuristic: only the purpose-expressions *gaspillent* example needed changing.
  - Not done in full: distractor validity and "rule tested but not explained" were spot-checked only.
- Checks: check:words 110 (baseline), check:structures 0, audit B2 rows only purpose-expressions ex014 and review-nuance ex015 (both deliberate). CLAUDE.md Self-audit gained the 4 new rules. validate OK, test:content and test:checker passed (29/29), build OK, b2-wrapup 0 limit rows with 15 claim flags (all artefacts). A1 to B1 unchanged.

## Unit 2 fixes

- futur-anterieur: the rule is now "finished before the second begins". The futur simple stays correct for overlapping actions (*quand j'arriverai, je t'appellerai*, linked to b1-time-connectors), and the present or passé composé is what's wrong. The warning, résumé (still 60 to 100 words) and ex005/ex010 explanations match. The dialogue says *aurez écrit le rapport*; ex011 accepts *d'ici*, *avant* and *pour*; ex012 to ex014 cues pinned with infinitives; *après que tu seras parti* and the tip sentence are glossed.
- conditionnel-passe: ex002 is *Avec un meilleur horaire de train*; Examples added for *non confirmé* (*Ce matin, le bilan est encore non confirmé*; *pour l'instant* isn't taught) and *la médecine*; vocab renumbered (no other file uses the ids). Item 8 was already fixed in the Unit 1 review ("One common use").
- si-plus-que-parfait: *faillir* "nearly the same as *presque*"; the *si* check names the imparfait of *avoir*/*être*, never *-rai-*; "a frequent mistake in speech"; ids renumbered; two sentences glossed.
- mixed-conditionals: Example and *prudent* sentence on separate lines; *quinze ans*. ex012's no-article rule is taught in a2-jobs-and-workplace (verified), so no Note.
- subjonctif-passe: reflexive lines added (*qu'il se soit rétabli*, *qu'elle se soit rétablie*); Chloé says *le dernier examen ait été facile*; the *de justesse* sentence removed; *féliciter* takes *de* or *pour*; ex014 cues pinned; three phrases glossed.
- regret-and-reproach: "you could have warned me"; *Tu aurais pu vérifier !*; *on* labelled as spoken for *nous* (a1-subject-pronouns teaches it); ex013 pinned and accepts *Ça*/*Cela* × *pas*/*plus*; ex014 accepts *À l'avenir*; ex007 accepts *de mon absence*. The email says *Mon train a été annulé* and *avant la réunion* (*à temps* isn't taught as a phrase). *C'est ma faute* is the standard form; two sentences glossed.
- review-what-might-have-been: the new sentence uses *le jour d'après* instead of *le lendemain* (taught only in Unit 3), and the restaurant is now five years old; English updated; ex014 pins *basculer*; ex015 cue fixed and accepts *habiterais*/*vivrais* × *Avec le recul*/*Rétrospectivement*. The reorder component keys chips by index, so the repeated *a* in ex016 works; it's added to docs/b2-browser-test.md.
- Claims verified, all true: the rumour conditionnel and *apparemment*; *rater*, *prévoir*, *tant pis*, *imprévu*; *sûrement*; *c'est dommage que*, *ravi*, the infinitive with one subject; *fier*, *déçu*; *ce n'est pas grave*; *carrefour*; *carrière*; *depuis*; *quand*/*lorsque*/*dès que*; *après que*, *à moins que*; *même si*; double pronouns. Reported speech (b2-reported-speech-past) and *si* = whether (b2-reported-questions-orders) exist later in B2. The passive is taught in b1-passive-voice-intro, so *a été annulé* needs no Note.
- review-needed.md: *je m'excuse*, *ça* in a formal email, *c'est (de) ma faute*, the futur antérieur rule and *faillir*.
- Checks: check:words 110 (baseline), check:structures 0, audit B2 rows only the two deliberate 6-answer rows, validate OK, test:content and test:checker passed (29/29), build OK, b2-wrapup 0 limit rows. A1 to B1 unchanged. docs/review/b2-unit-1 to 8 regenerated.
