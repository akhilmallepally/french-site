# Reviewer brief: Parlons, level B2

**Parlons** is a free, text-only website that teaches French to English speakers, from beginner (A1) to advanced (C1). Each lesson explains a point in English, shows French examples with translations, has a short dialogue and ends with exercises that the site marks automatically.

**B2** is the upper-intermediate level: 59 lessons in 8 units (nuance, the unreal past, news and reporting, pronouns, work, science and health, culture and the arts, registers and debate). At B2 the learner already knows everyday French and is learning to be precise: moods, tenses, register and idiom.

**How to read a lesson file.** The bundles in `docs/review/b2-unit-1.txt` to `b2-unit-8.txt` contain every lesson, one after the other, each starting with `=== lesson id ===`. At the top of each lesson, between the `---` lines, are the vocab list (`fr` is the French, `en` the English) and the exercises (`prompt` is the question, `answers` are the answers the site accepts). After the second `---` comes the lesson itself: English explanations, French in *italics* with its translation in brackets, `<Example fr="…" en="…" />` lines, the dialogue under "En français", and sometimes a longer French text.

**What to check.**
- Is the French correct and natural, as a native speaker would say or write it?
- Is the register right (familiar, standard or formal), and is it labelled correctly?
- Are the mood and tense right (subjunctive or indicative, passé composé, conditionnel)?
- Would the site mark a valid answer wrong? If so, give the missing answer.
- Are the facts right (history, culture, the French-speaking world)?

**How to reply.** One line per item, using the lesson id and the item number below:

`b2-tout 2: OK` · `b2-tout 3: change to "…"` · `b2-registers 1: remove`

You don't need to check items marked OK by someone else, or anything not listed. If you notice another problem in a lesson file, add a line with the lesson id and the exact sentence.

**Priority.** **High** items are grammar or meaning claims a learner would rely on: please answer these first. **Medium** items are about register, slang or usage. **Low** items are facts and dates.

---

## Items to check, by lesson

### Nuancing your opinion (b2-nuancing-opinions)

1. **High.** Is this correct? "Il me semble que gives your own impression, and it takes the indicative. Il semble que reports a general impression, as if from the outside, and it takes the subjunctive."
2. **High.** Does this sound natural? "Mitigé means mixed or lukewarm. It's a false friend: it doesn't mean 'mitigated'."
3. **Medium.** Is this correct? "*A priori* and *à première vue* (at first sight) introduce a first impression."

### Social issues (b2-social-issues)

1. **Medium.** Does this read as neutral? "These are sensitive subjects in France, as everywhere, so it's worth using neutral words and avoiding generalizations." Sensitive topic (immigration), with *Un immigré is someone who has moved to France from another country* and *Apprendre la langue aide beaucoup à s'intégrer*
2. **Medium.** Is the register of each right? "*Un sans-abri* (a homeless person) is the neutral, respectful word; in everyday speech you'll also hear *un SDF*, short for *sans domicile fixe*."
3. **Medium.** Is this correct? "The word *association* covers charities, but also sports clubs and neighbourhood groups."
4. **Medium.** Is this correct? "Cette association aide les immigrés à trouver un logement." and "Il y a eu une grande manifestation dans le centre-ville samedi." Sensitive topic: check that both read as neutral

### Subjunctive after conjunctions (b2-subjunctive-conjunctions)

1. **High.** Is this correct? "In conversation you may hear the indicative [after *bien que*], but it's considered a mistake."
2. **High.** Is this correct? "*Après que* (after) takes the indicative in careful French, in contrast with *avant que* ... Many speakers use the subjunctive after *après que*, but the indicative is the standard."
3. **Medium.** Is this correct? "After *avant que* and *à moins que*, careful or formal French often adds a small *ne*, called *le ne explétif*. It doesn't make the sentence negative."
4. **Medium.** Does this read as neutral? "Il faut faire beaucoup de démarches avant d'obtenir un titre de séjour." Sensitive topic (immigration), and the dialogue at the drop-in centre

### Concession and opposition (b2-concession-opposition)

1. **High.** Does this sound natural? "*Même si* (even if, even though) also concedes a point, but it takes the indicative, like *si*."
2. **High.** Is this correct? "Unlike *bien que*, they [*alors que*, *tandis que*] take the indicative."
3. **Medium.** Does this sound natural? "*J'ai beau trouver la ville trop calme, je sors avec mes amis tous les week-ends.*" (dialogue)
4. **Medium.** Is the register right? "*Quand même* (all the same, still) is the spoken way to say that something happens despite an obstacle."
5. **Medium.** Is this correct? *Malgré que* is described as not standard, here and in the b2-review-nuance warning ("You'll hear it, but it's not accepted in careful writing")

### Everyday idioms (b2-idioms-everyday)

1. **High.** Is this correct? The meaning and register note of each of the 21 idioms (for example *coûter un rein*: very informal; *mettre les pieds dans le plat*: neutral; *avoir le cafard*: informal)

### Logical connectors (b2-logical-connectors)

1. **High.** Is this correct? "*Tellement* goes before the adjective, the adverb or the participle; *si* can replace it before an adjective."
2. **Medium.** Is this correct? "*Vu que* is common in speech; *étant donné que* and *du fait que* are more formal."
3. **Low.** Is this correct? "*Or* ... introduces a new fact that changes the reasoning ... It's mostly written, and it usually comes after a full stop, followed by a comma."

### Expressing purpose (b2-purpose-expressions)

1. **High.** Is this correct? "With the subjunctive, it [*de sorte que*] gives a purpose (so that). With the indicative, it gives a result."
2. **Medium.** Is this correct? "After *de peur que* and *de crainte que*, you'll often see the expletive *ne* ... It's common in writing and optional in speech."
3. **Medium.** Is this correct? "*En vue de* (with a view to) is usually followed by a noun."

### Review: Nuance and society (b2-review-nuance)

1. **Medium.** Is this correct? "A *tribune* is the French name for a signed opinion text in a newspaper or on a website."

### The conditionnel passé (b2-conditionnel-passe)

1. **High.** Is the meaning (toll) right? "*Un bilan* here is the number of victims of an event."
2. **Medium.** Is the figurative use in *j'ai bifurqué* right? "*Bifurquer* (to change course) comes from the image of a road that splits in two."
3. **Low.** Is this correct? "In news reports, the conditionnel passé gives a past fact that the journalist can't confirm yet. It's like 'is said to have' or 'reportedly' in English."

### Si + plus-que-parfait, conditionnel passé (b2-si-plus-que-parfait)

1. **High.** Is this correct? "*Se douter que* takes the indicative, because you think it's true."
2. **High.** Is this correct? "*Faillir* + infinitive, in the passé composé, says that something nearly happened."
3. **Medium.** Is this correct? "*Si j'aurais su* is a very common mistake, even among French speakers, but it's wrong in standard French."
4. **Medium.** Is the pronunciation claim right? "*J'avais* and *j'aurais* ... differ in two sounds: the vowel (*a* in *j'avais*, *o* in *j'aurais*) and the *r*."

### Mixed si-clauses (b2-mixed-conditionals)

1. **High.** Is this correct? "*Au cas où* (in case) ... takes the conditionnel."
2. **High.** Is this correct? "*Sauf si* (unless) ... takes the indicative ... the everyday partner of *à moins que* + subjunctive."
3. **High.** Is this correct? "*Même si* ... follows exactly the same tense rules as *si*."
4. **High.** Is the meaning and register right? "*Tracer sa route* means to follow your own way."

### The futur antérieur (b2-futur-anterieur)

1. **High.** Is this correct? "*Après que* ... takes the indicative, so it works in the same way: *après que tu seras parti, je fermerai la porte*."
2. **High.** Is the supposition use and that it's common in speech right? "*Il aura oublié* means the same as *il a sûrement oublié*."
3. **Medium.** Is the register right? "*Boucler un projet* is an informal but common way to say 'to wrap up a project' at work."

### The past subjunctive (b2-subjonctif-passe)

1. **High.** Is this correct? "In everyday French these two forms are the only subjunctives you need: the other two tenses of the subjunctive belong to old literary texts."
2. **High.** Is this correct? "*Ému* (moved) usually takes *de* or stands alone."
3. **Medium.** Is this correct? Dialogue: "Chloé says *vous* to her grandmother, as some families do."

### Regret and reproach (b2-regret-and-reproach)

1. **High.** Is this correct? Fixed phrases: *je m'en veux*, *Je m'en veux tellement*, *regretter d'avoir*, *je regrette d'avoir dit ça*, *ça ne se reproduira pas*, *et ça ne se reproduira pas*. Je m'en veux uses idiomatic en (b2-idiomatic-y-en), regretter d'avoir + participle the past infinitive (b2-infinitif-passe), and ça ne se reproduira pas the pronominal passive (b2-alternatives-to-passive). All three are taught later; here they're labelled fixed phrases
2. **High.** Is this correct? "In context it's a reproach: *tu aurais pu me prévenir !* means 'you should have warned me'."
3. **High.** Is this correct? "After an apology, [*ce n'est pas grave*] means 'it doesn't matter'."
4. **Medium.** Is this correct? "*C'est (de) ma faute* ... *c'est ma faute* is the more careful form."
5. **Medium.** Is this correct? "*Tu aurais dû* is firmer than *tu aurais pu*."

### Politics and institutions (b2-politics-and-society)

1. **High.** Is this correct? "*Voter une loi* means the same, but only Parliament does it: citizens vote in elections, not on most laws."
2. **High.** Is this correct? "*Le gouvernement* is a narrower word than in English: it means the Prime Minister and the ministers."
3. **Medium.** Is this correct? "*Le Parlement* (Parliament) has two chambers: *l'Assemblée nationale* ... whose members, *les députés*, are elected directly by citizens, and *le Sénat*."
4. **Medium.** Is this correct? "A law usually starts as *un projet de loi* (a bill), proposed by the government."
5. **Medium.** Is this correct? "In France, the head of State is *le président de la République*, and *le Premier ministre* leads the government."
6. **Medium.** Is this correct? "Many French elections have two rounds: *le premier tour* and *le second tour*."
7. **Medium.** Is this correct? "In a conversation with people you don't know well, many French speakers avoid saying which party they vote for."

### Reported speech in the past (b2-reported-speech-past)

1. **High.** Is the list right? "Some tenses can't move further back ... the imparfait, the plus-que-parfait and the conditionnel."
2. **Medium.** Is this correct? "*Paul a dit qu'il viendra, mais il n'est pas venu* is wrong."
3. **Low.** Is this correct? "When the fact is still true when you report it, you may keep the present ... *Il m'a dit qu'il habitait à Lyon* is also correct, and it's the safer choice in writing."

### Reported questions and orders (b2-reported-questions-orders)

1. **High.** Is this correct? "*Insister pour que* ... takes *que* + subjunctive."
2. **High.** Is this correct? "*Une audition* is a false friend in the news: it's usually a formal hearing by the police, a judge or a parliamentary committee."
3. **Medium.** Is this correct? "*Dire de* is neutral, and *demander de* is more polite."

### Reporting verbs (b2-reporting-verbs)

1. **High.** Is this correct? "After *nier que*, the verb usually goes in the subjunctive."
2. **Medium.** Is this correct? "*Prétendre* ... suggests that the reporter doubts the claim."
3. **Medium.** Is this correct? "*Démentir* is the word for a government or a company that says a piece of news is false."
4. **Medium.** Is this correct? "French headlines usually put the reporting verb in the present, even for yesterday's news."

### The passive voice in all tenses (b2-passive-voice)

1. **High.** Is this correct? "*De* is usual when the participle describes a state or a feeling ... *aimé par ses élèves* is possible, but *aimé de ses élèves* sounds more natural."
2. **Medium.** Is this correct? "*Entouré de policiers* describes a situation, while *entouré par les policiers* stresses the action."
3. **Medium.** Is this correct? "Many French buildings have a small plaque by the door, often in the passive."
4. **Low.** Is this correct? "A building that's *classé monument historique* is protected by the State, and any change to it must be approved."

### Alternatives to the passive (b2-alternatives-to-passive)

1. **High.** Is this correct? "*Se voir* + infinitive ... is more formal than *on*, and frequent in the news."
2. **High.** Is the rule for verbs with *à* + a person right? "'I was told' is never *j'ai été dit*. It's *on m'a dit*."
3. **High.** Is this correct? À + infinitive (hand check): earlier lessons use it only as glossed fixed phrases (b1-reviewing-a-film-or-book: *à voir absolument*, *à éviter*; b1-housing-and-renting: *un appartement à louer*) and once in a2-review-travel (*beaucoup de choses à voir*)
4. **Medium.** Is this correct? "In the passé composé, careful writers leave *vu* unchanged in this structure (*elle s'est vu refuser*) ... You'll often see *vue* too."
5. **Medium.** Is this correct? Customs in the dialogue: "*le pain se pose sur la table, à côté de l'assiette*", "*le fromage se mange avant le dessert*"

### Nominalisation (b2-nominalisation)

1. **Medium.** Is this correct? "Nouns in *-age* are masculine, with a few common exceptions: *la page*, *la plage* and *une image*."
2. **Medium.** Is this correct? "When [*-eur*] comes from a verb, it usually names a person and is masculine ...; when it comes from an adjective, it names a quality and is feminine."
3. **Medium.** Is this correct? "This *style nominal* ... journalists, reports and official documents use it. In speech, French uses verbs."
4. **Medium.** Is this correct? "*La gratuité* is often used for public services that people don't pay for."

### Summarising an article (b2-summarizing-an-article)

1. **High.** Is this correct? "*Il ressort que* (it emerges that) + indicative."
2. **Medium.** Is the term right? "*Le chapeau*, the short text in bold under the headline."

### The French press (b2-culture-french-press)

1. **Medium.** Is this correct? Types and formats: "Le Monde. A national general daily…", "Le Figaro. A national general daily with a strong section on the economy, and a weekend magazine", "Libération. A national general daily, often called *Libé*, known for its bold front pages". Confirm. (Political leanings were removed from the lesson.)
2. **Medium.** Is this correct? "Ouest-France ... is one of the most widely read daily papers in the country."
3. **Medium.** Is this correct? "Le Canard enchaîné. A satirical weekly that comes out on Wednesdays ... known for carrying no advertising."
4. **Medium.** Is this correct? "*L'audiovisuel public* ... They're funded mainly by the State."
5. **Medium.** Is this correct? "The AFP ... Its journalists, in France and abroad, send news to newspapers, radio and television."
6. **Medium.** Does this read as neutral? Sensitive topic: the satirical press is presented only as a genre ("mocks the powerful with humour"), with no mention of attacks
7. **Medium.** Is this correct? "Ce dessin de presse est une caricature d'un ministre." Sensitive topic: check that it reads as neutral (the lesson doesn't mention the attacks)

### Review: News and reporting (b2-review-news)

1. **High.** Is this correct? "*Interview* is borrowed from English but pronounced the French way."

### lequel, auquel, duquel (b2-relative-lequel)

1. **High.** Is this correct? "*Dont* can't follow a preposition made of several words that ends in *de*, such as *près de*, *à côté de*, *au cours de* or *en face de*."
2. **Medium.** Is this correct? "*La raison pour laquelle* is the usual way to say 'the reason why'."
3. **Medium.** Is this correct? "For a place, *où* is often simpler than *dans lequel* ... *où* is more common in speech."

### Prepositions with relative pronouns (b2-relative-prepositions)

1. **High.** Is this correct? "For a person after a preposition, French prefers *qui* ... *Lequel* is also correct for people ... but it sounds more formal."
2. **High.** Is this correct? "*Quoique* (one word) ... means 'although', like *bien que*."
3. **Medium.** Is this correct? "After *parmi* (among) and *entre* (between), French uses *lesquels* or *lesquelles*, even for people."
4. **Medium.** Does this sound natural? "*Ce n'est pas ce à quoi je m'attendais*" and "*Ce n'est pas ce que j'attendais*" (ex013, both accepted)

### Subjunctive in relative clauses (b2-subjunctive-relative-clauses)

1. **High.** Is this correct? "In speech, you'll also hear the indicative here (*le meilleur film que j'ai vu*) ... In careful writing, the subjunctive is the standard."
2. **High.** Is this correct? "After *il n'y a personne qui*, *il n'y a rien qui* ... the standard is the subjunctive."
3. **High.** Is this correct? The meaning contrast (*je cherche un livre qui explique ça* / *le livre qui explique ça*)

### Idiomatic y and en (b2-idiomatic-y-en)

1. **High.** Is this correct? Meanings and registers: *en avoir marre* informal, *en avoir assez* neutral, *ne plus en pouvoir* (exhausted), *s'en faire* (to worry), *ne pas en revenir* (to be amazed)
2. **Medium.** Is this correct? "Leaving it out (*comme je t'ai dit*) is common in speech, but the full form is standard."

### Emphasis: c'est… qui / que (b2-mise-en-relief)

1. **High.** Is this correct? "*C'est moi qui a* is a frequent mistake ... the verb must agree with *moi*."
2. **High.** Is this correct? "With a plural noun, careful French says *ce sont* ... In speech, *c'est* is common there too."
3. **Medium.** Is this correct? "Dislocation ... is very common in speech but sounds informal in writing."

### Review: Precision with pronouns (b2-review-pronouns)

1. **High.** Is the agreement checklist right? "*Elle s'est lavé les mains* ... *les mains qu'elle s'est lavées*" and "*Elles se sont parlé*" (no agreement)

### The economy and business (b2-economy-and-business)

1. **Medium.** Is this correct? "*Le bénéfice* is the profit, what remains after costs ... *le chiffre d'affaires* is turnover."
2. **Medium.** Is this correct? "*Une PME* is a small or medium-sized business" (no thresholds given)
3. **Medium.** Is this correct? "*Une société* is the usual word for a company in business French, alongside *une entreprise*."
4. **Medium.** Is this correct? "*Une prime* is extra pay on top of the salary, often at the end of the year."

### Faire + infinitive (b2-faire-causatif)

1. **High.** Is this correct? "In the passé composé, *fait* never agrees before an infinitive."
2. **High.** Is this correct? "*Laissé* may agree or not before an infinitive: *je les ai laissé partir* and *je les ai laissés partir* are both accepted."
3. **Medium.** Is the registers right? "*Se faire avoir* (to be conned) is informal"; "*laisser tomber* ... is informal."

### Present participle, gerund, verbal adjective (b2-participles-and-gerund)

1. **Medium.** Is this correct? The five spelling pairs (*fatiguant/fatigant*, *convainquant/convaincant*, *négligeant/négligent*, *précédant/précédent*, *différant/différent*)
2. **Medium.** Is this correct? "The participe présent ... is mainly used in writing."
3. **Medium.** Is this correct? "*En arrivant, le train était en retard* is clumsy."

### The past infinitive (b2-infinitif-passe)

1. **High.** Is this correct? "*Nier* takes the infinitive without *de*."
2. **Medium.** Is this correct? "In the negative, *ne pas* usually goes before the auxiliary ... In careful writing, you'll also see *de n'avoir pas fini*. Both are correct."
3. **Medium.** Is this correct? "*Remercier de* and *remercier pour* are both used: *de* is more common before an infinitive, *pour* before a noun."

### Meetings and professional calls (b2-meetings-and-calls)

1. **Medium.** Is this correct? "Teams that use *vous* in emails often switch to *tu* in internal calls, and many speakers use *on* for *nous* in meetings, even formal ones." Spoken habits, labelled
2. **Low.** Is this correct? "French minutes usually start with the date and the list of participants, then give one numbered item per point of the agenda."

### Negotiating (b2-negotiating)

1. **High.** Is this correct? "*Quitte à* + infinitive means 'even if it means'."
2. **High.** Is this correct? "Si + imparfait with the conditionnel sounds more polite than si + present" (ex008)
3. **Medium.** Is the nuance right? "*Une remise* is a discount" (vs *une réduction*)

### Presenting data and trends (b2-presenting-data)

1. **High.** Is this correct? "*Augmenter de* + the size of the change; *passer de… à* gives the starting and the final figure; *passer* takes *être* here."
2. **High.** Is this correct? "*Les données* (data) is plural in French."
3. **Medium.** Is this correct? "French writes a space before the % sign: *10 %*."
4. **Low.** Is this correct? All figures in the lesson are invented (no real statistics)

### Writing a report (b2-formal-report)

1. **High.** Is this correct? "*Il importe que* ... takes the subjunctive"; "*il apparaît que* takes the indicative."
2. **Medium.** Is this correct? The report plan (*objet*, *contexte*, *constat*, *analyse*, *recommandations*, *suivi*)
3. **Medium.** Is this correct? "When you need a personal voice, for a team, *nous* is acceptable in the recommendations."

### Review: Work and the economy (b2-review-work)

1. **Medium.** Is this correct? "*Un collaborateur* is the formal word many companies use for an employee or a colleague."
2. **Medium.** Is this correct? "*La qualité de vie au travail* is a common phrase in French companies."

### Science and research (b2-science-and-research)

1. **High.** Is this correct? "Science news ... uses the conditionnel for results that aren't confirmed: *ce traitement aiderait les malades*."
2. **Medium.** Is this correct? "*Une revue scientifique* (a scientific journal); outside science, *une revue* is a magazine."
3. **Medium.** Is this correct? "In a laboratory, *une expérience* is an experiment ... You *fais une expérience*, but you *as de l'expérience*."
4. **Medium.** Is the nuance right? "*Démontrer* and *prouver* are strong; a result that only *montre* a link is weaker."
5. **Medium.** Is this correct? "*Faire une étude* is also correct, but *mener* is more formal" (ex003 explanation)
6. **Low.** Is this correct? "Research needs *le financement* (funding), often from the State, universities or companies."

### Health and the health system (b2-health-system)

1. **High.** Is this correct? "*La prise en charge* means coverage ... and also the care given to a patient."
2. **Medium.** Is this correct? "Going through this doctor first, before seeing *un spécialiste*, is called the coordinated care route, and it gives better reimbursement."
3. **Medium.** Is this correct? "Most people also have *une mutuelle*, a top-up insurance, often through their employer."
4. **Medium.** Is this correct? "*Une clinique* ... is usually a private hospital, not a GP's surgery."
5. **Medium.** Does this read as neutral? "The doctor gives you *un arrêt maladie* (a sick note), which you send to your employer."
6. **Medium.** Is this correct? "*Les déserts médicaux* are areas, often rural, where there are too few doctors."
7. **Medium.** Does this sound natural? "*Passer par le médecin traitant*" for going through the GP first (new entry *passer par*)

### Certainty and probability (b2-certainty-and-probability)

1. **High.** Is this correct? "*Il est probable que* + indicative; *il est possible que*, *il se peut que*, *il est peu probable que*, *il n'est pas certain que* + subjunctive."
2. **High.** Is this correct? "*Il semblerait que* ... keeps the subjunctive."
3. **High.** Is this correct? "*Sans doute* ... means 'probably' ... To say 'without any doubt', add *aucun*."
4. **High.** Is this correct? "*Le fait que* ... usually takes the subjunctive, especially at the start of the sentence ... the subjunctive is the safe choice."
5. **High.** Is this correct? "With a compound tense ... [the adverb] usually goes between the auxiliary and the participle ... this position inside the verb group is the safest one."
6. **High.** Is this correct? "*Il a dû oublier* ... is close to the futur antérieur of supposition: *il aura oublié*."
7. **High.** Is this correct? "On the scale in this lesson, only the certain and likely expressions keep the indicative."
8. **High.** Is this correct? "You'll also see the indicative, especially when *le fait que* comes after the verb: *on oublie souvent le fait que la recherche prend du temps*."

### Writing an argumentative essay (b2-argumentative-essay)

1. **High.** Is this correct? "*Force est de constater que* + indicative"; "*il s'agit de*: its subject is only *il*."
2. **High.** Is this correct? "*Une ouverture*" as the final wider question is a new meaning of b2-nominalisation's *l'ouverture*
3. **Medium.** Is this correct? "French students learn one classic plan for it, the dialectical plan, in three parts" (thèse, antithèse, synthèse)
4. **Medium.** Is this correct? "A French dissertation avoids *je* ... use *nous* for the writer."
5. **Medium.** Is this correct? "For other subjects, a plan in two parts is also common."
6. **Medium.** Is the terms right? The introduction moves (*amorce*, *problématique*, *annonce du plan*) and the conclusion with an *ouverture*
7. **Medium.** Is this correct? "For a plan in three parts ... Some writers then say *dans un deuxième temps* for the second part." (note on *dans un troisième temps*)

### Review: Science and health (b2-review-science)

1. **Medium.** Does this read as neutral? "*Le principe de précaution* says that a risk can justify action before science is certain."
2. **Medium.** Is this correct? "*Un comité d'éthique* is a group that gives its opinion on what is right in research or medicine."
3. **Medium.** Does this read as neutral? The model essay on compulsory prevention gives general arguments only, with no figures and no medical advice

### Arts and literature (b2-arts-and-literature)

1. **High.** Is this correct? "It means the same as the passé composé (a finished action), but it belongs to written, literary French ... people don't use [it] in speech."
2. **High.** Is this correct? The passé simple table (*il parla / ils parlèrent*, *il partit / ils partirent*, *il attendit*, *il voulut / ils voulurent*, *il connut*) and the irregular forms *fut*, *eut*, *fit*, *vint*, *prit*
3. **High.** Is this correct? Tip: "An *-a* added straight to the verb stem (*parl-a*), or the endings *-èrent*, *-irent* and *-urent*, tell you it's the passé simple. On its own, *-a* proves nothing."
4. **Medium.** Is this correct? "*Un comédien* ... it's an actor, especially on stage. Someone who tells jokes is *un humoriste*."
5. **Medium.** Is this correct? "*Un vers* ... it's one line, not a whole verse"; "*une strophe*: a verse, a stanza"
6. **Medium.** Does this sound natural? "*Ce comédien joue dans une pièce de Molière*" (warning callout)
7. **Low.** Is this correct? Movement dates: "In the early 19th century, *le romantisme*..."; "In the late 19th century, *l'impressionnisme* was above all a painting movement ... painters worked outside and tried to show light and movement"; "In the 1920s, *le surréalisme* looked for the world of dreams"

### Key moments in French history (b2-culture-french-history)

1. **Medium.** Is this correct? "Each year, on 11 November and 8 May, people meet there for une commémoration."
2. **Medium.** Is this correct? Warning: "say la Seconde Guerre mondiale or la Deuxième Guerre mondiale, with Guerre in capitals and mondiale in lowercase."
3. **Medium.** Does this read as neutral? Not covered: the Vichy regime and the persecution of Jews during the Occupation
4. **Medium.** Is this correct? "France already had colonies before the Revolution, such as *la Nouvelle-France* in North America."
5. **Low.** Is this correct? "In 1804, he became *empereur* ... The same year, the *Code civil* was published ... It has been changed many times, but it's still in use."
6. **Low.** Is this correct? "La Première Guerre mondiale lasted from 1914 to 1918 ... Much of the fighting happened in the north and east of France ... It ended with l'armistice of 11 November 1918."
7. **Low.** Is this correct? "In 1940, the German army occupied a large part of France ... Paris was freed in August 1944 ... The war ended in Europe on 8 May 1945."
8. **Low.** Does this read as neutral? Decolonization (sensitive): "After 1945, these territories asked for their independence, and most of them became independent in the 1950s and 1960s ... In some countries, independence came peacefully; in others, after a war, as in Algeria, independent since 1962. The subject is still discussed in France today."
9. **Low.** Is this correct? "In 1957, six countries, including France and Germany, signed le traité de Rome, which created a common market. This community later became l'Union européenne."

### Adjectives that change meaning (b2-adjective-position-meaning)

1. **High.** Is this correct? Every pair's meanings, especially: "*Brave* before is 'decent, kind', and after 'brave', though *courageux* is more common for that"; "*Curieux* before is 'odd', and after, for a person, 'curious' or 'inquisitive'"; "*Simple* before the noun means 'just, mere' ... after it 'easy, plain'"
2. **High.** Is this correct? "*Grand* ... With people ... Un grand homme is a great man; un homme grand is a tall man. For things, grand stays before and simply means 'big'."
3. **High.** Is this correct? "*Certain* before a plural noun means 'some' ... *Différent* before a plural noun means 'various'."
4. **Medium.** Is this correct? "*Dernier* and *prochain* go after the noun when you count from today ... before the noun for the last or next one in a series."
5. **Medium.** Is the register note right? "*Sale* ... Before a person, it's an informal insult: *un sale type*."

### Tout, toute, tous, toutes (b2-tout)

1. **High.** Is this correct? "As an adverb, it doesn't change, with one exception: it agrees before a feminine adjective that starts with a consonant" (*toute contente*, but *tout heureuse*)
2. **High.** Is this correct? "As a pronoun, *tous* is pronounced with an s sound at the end ... In this role [determiner], the s of tous is silent."
3. **High.** Is this correct? "*Quiconque* means 'anyone who' or 'whoever'. It's formal, and it takes a singular verb."
4. **High.** Is this correct? "*Quelconque* ... Said of a work or a person, it means 'ordinary, nothing special'."
5. **Medium.** Is the example right? "(or an aspirate *h*, as in *toute honteuse*, very ashamed)"

### Describing a work of art (b2-describing-a-work-of-art)

1. **Medium.** Is this correct? "*Sobre* is a compliment in art criticism: understated, with no unnecessary effects."
2. **Medium.** Is the nuance right? "*Frappant* (striking) is for a detail that catches the eye; *saisissant* (gripping) is stronger."
3. **Medium.** Is this correct? "*Il s'en dégage*" as the pronominal form; "*il en dégage une impression de calme* is wrong"
4. **Low.** Is this correct? The painter Claire Morel and the painting « L'Attente » are invented, and labelled as invented

### Francophone Africa (b2-culture-francophone-africa)

1. **Medium.** Is this correct? "Aujourd'hui, la francophonie est de plus en plus africaine." (magazine piece)
2. **Low.** Is this correct? Facts: "Le Sénégal. French is the official language, and Wolof is the most widely spoken national language"; "La Côte d'Ivoire. French is the official language"; "Le Cameroun. The country is officially bilingue, in French and English."
3. **Low.** Is this correct? The Maghreb: "the official languages are Arabic and, in Algeria and Morocco, Tamazight (Berber). French isn't an official language there, but it remains widely used in education, business, science and the media."
4. **Low.** Does this read as neutral? "After independence, many countries kept French as one of their official languages."
5. **Low.** Is this correct? Nouchi and camfranglais: "Le nouchi was born in the streets of Abidjan ... mixes French with Ivorian languages and English"; "Le camfranglais, in Cameroon, mixes French, English and local languages ... above all a language of young people in the cities."
6. **Low.** Is this correct? Local words: *une essencerie* (Senegal, petrol station); *s'enjailler* (Côte d'Ivoire, from English "enjoy", informal); *un taxi-brousse* ("in much of West and Central Africa")
7. **Low.** Is this correct? Négritude and Senghor: "a literary movement born in Paris in the 1930s, among black students from Africa and the Caribbean writing in French"; Senghor "later became the first president of independent Senegal, and the first African member of the Académie française."
8. **Low.** Is this correct? Warning: "French is the official language there; the national languages are the country's own languages."

### Review: Culture and the arts (b2-review-arts)

1. **High.** Is this correct? "*Une œuvre engageante* ... means 'an appealing work'. The word for a committed work is *engagée*."
2. **Low.** Is this correct? The painter Jean Varenne and the painting « Après la pluie » are invented, and labelled as invented

### Registers of French (b2-registers)

1. **High.** Is this correct? "After *peut-être* and *sans doute*, the inversion is the formal choice; in speech, people say *peut-être que* with normal order."
2. **High.** Is this correct? "After *aussi*, the inversion changes the meaning: at the start of a sentence, *aussi* means 'therefore'."
3. **Medium.** Is this correct? Every register label, including the word table (*bagnole / voiture / automobile*, *bouquin / livre / ouvrage*, *boulot / travail / emploi*, *se dépêcher / se hâter*, *habiter / demeurer*)
4. **Medium.** Is this correct? "With *pouvoir* and *savoir*, formal French can use *ne* alone, without *pas*: *je ne saurais dire*, *je ne peux vous répondre*."
5. **Medium.** Is this correct? "For 'we', familiar and standard speech use *on*; careful writing prefers *nous*."

### Spoken, everyday French (b2-colloquial-french)

1. **Medium.** Is this correct? Every register label (*trop* = very, *vachement*, *carrément*, *grave*, *un truc*, *un machin*)
2. **Medium.** Is this correct? "*Du coup* ... many people find it overused."
3. **Medium.** Is this correct? "*Grave*, used as an adverb, is youth speech"; "*Vachement* ... is common among all ages."
4. **Medium.** Is this correct? ex013 accepts *on est partis* and *on est parti*
5. **Medium.** Is the labels (spoken) right? "Speakers drop *il* in *il faut*"; "They use *c'est* for *ce sont*"; "They announce the subject first, then repeat it as a pronoun."

### Verlan and slang (b2-culture-verlan-and-slang)

1. **Medium.** Is this correct? "Verlan is old, but it spread widely from the 1980s and 1990s, in the suburbs of big cities and then in rap music."
2. **Medium.** Is this correct? "Some, like *relou* or *meuf*, are now understood by most French people."
3. **Medium.** Is the explanation right? "*Lourd* gives *relou*: the final sound comes first."
4. **Low.** Is this correct? Each word's meaning, origin and current use (*ouf*, *relou*, *chelou*, *zarbi*, *vénère*, *meuf*, *mec*, *nana*, *pote*, *fric*, *thune*, *kiffer*, *crevé*, *flipper*, *se marrer*, *c'est la galère*); some may be dated. No ethnic terms are used

### False friends (b2-false-friends)

1. **High.** Is this correct? Every meaning, especially *rude* (harsh), *supporter* ("also to support a team ... but not for supporting an idea"), *un préjudice* (formal, legal)
2. **High.** Is this correct? "*Assister quelqu'un* means 'to help someone'."
3. **High.** Confirm, and decide whether *rendue* should also be accepted? ex012: "Rendu never agrees here, because compte is its direct object" (*je me suis rendu compte*, not *rendue*, for a woman too)
4. **Medium.** Is this correct? "Many people also use *réaliser* for 'to realize', but careful speakers prefer *se rendre compte que*."
5. **Medium.** Is this correct? "*Excité* ... can have a sexual sense."

### Taking part in a debate (b2-debating)

1. **Medium.** Is this correct? The register of each interruption phrase (*si je peux me permettre*, *permettez-moi de*, *laissez-moi finir*, *je ne vous ai pas interrompu*, *vous me coupez la parole*)
2. **Medium.** Is this correct? "In French debates, people interrupt more than in many English-speaking ones."
3. **Medium.** Is this correct? "*Contredire* is irregular in one form: *vous contredisez*, not *vous contredites*."
4. **Medium.** Is this correct? The debate on cars in city centres gives both sides their main arguments; check it reads as balanced

### Persuasion and hedging (b2-persuasion-and-hedging)

1. **High.** Is this correct? "*Avouez que* ... *convenez que* ... Both take the indicative."
2. **High.** Is this correct? "After *ne pensez-vous pas que*, both moods are used: the indicative when you present the idea as obvious, the subjunctive in more formal speech."
3. **High.** Is this correct? "*Imaginons que* / *admettons que* ... In careful French, both usually take the subjunctive ... you'll also hear the indicative."
4. **Medium.** Is this correct? "*Qui plus est* and *sans compter que* ... are more formal than *en plus* or *de plus*."

### B2 final review (b2-review-final)

1. **High.** Is this correct? "Fixé doesn't agree: the direct object, un objectif, comes after the verb" (warning callout)
2. **Medium.** Is this correct? ex014 accepts *qui ait un jardin* and *qui a un jardin*
