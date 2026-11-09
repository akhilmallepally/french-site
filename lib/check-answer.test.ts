// Run: npm run test:checker
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkAnswer, checkChoice, sameWords } from "./check-answer.ts";

const status = (input: string, answers: string[]) => checkAnswer(input, answers).status;

describe("checkAnswer", () => {
  test("ignores capitals", () => {
    assert.equal(status("JE SUIS ÉTUDIANT", ["Je suis étudiant"]), "correct");
  });

  test("ignores trailing punctuation", () => {
    for (const input of ["Merci.", "Merci!", "Merci?", "Merci !?"]) assert.equal(status(input, ["Merci"]), "correct");
    assert.equal(status("Merci", ["Merci !"]), "correct");
  });

  test("ignores the French space before ? and !, including non-breaking spaces", () => {
    for (const input of ["Tu habites où ?", "Tu habites où?", "Tu habites où ?", "Tu habites où ?"]) {
      assert.equal(status(input, ["Tu habites où ?"]), "correct");
    }
    assert.equal(status("Salut !", ["Salut"]), "correct");
  });

  test("ignores apostrophe style", () => {
    assert.equal(status("C’est Paul", ["C'est Paul"]), "correct");
    assert.equal(status("C'est Paul", ["C’est Paul"]), "correct");
  });

  test("ignores surrounding and repeated spaces", () => {
    assert.equal(status("  Je   suis  étudiant ", ["Je suis étudiant"]), "correct");
  });

  test("ignores inner commas and treats hyphens as spaces", () => {
    assert.equal(status("Moi c'est Paul", ["Moi, c'est Paul"]), "correct");
    assert.equal(status("dix sept", ["dix-sept"]), "correct");
  });

  test("a trailing apostrophe doesn't matter in a gap", () => {
    assert.equal(status("j'", ["J"]), "correct");
    assert.equal(status("l", ["l'"]), "correct");
  });

  test("treats œ as oe and æ as ae", () => {
    assert.equal(status("soeur", ["sœur"]), "correct");
    assert.equal(status("sœur", ["soeur"]), "correct");
    assert.equal(status("ex aequo", ["ex æquo"]), "correct");
  });

  test("accent-less input is correct-accents, never an exact match", () => {
    assert.deepEqual(checkAnswer("etes", ["êtes"]), { status: "correct-accents", expected: "êtes" });
  });

  test("wrong accents are also correct-accents", () => {
    assert.equal(status("ètes", ["êtes"]), "correct-accents");
  });

  test("returns the accented accepted answer that matched, not the first", () => {
    const result = checkAnswer("je te presente lea", ["Voici Léa", "Je te présente Léa"]);
    assert.deepEqual(result, { status: "correct-accents", expected: "Je te présente Léa" });
  });

  test("prefers an exact match over an accent-less one", () => {
    assert.deepEqual(checkAnswer("ou", ["où", "ou"]), { status: "correct", expected: "ou" });
  });

  test("accepts any listed phrasing", () => {
    assert.equal(status("Moi, c'est Paul", ["Je m'appelle Paul", "Moi, c'est Paul"]), "correct");
  });

  test("a wrong answer is incorrect and returns the first accepted answer", () => {
    assert.deepEqual(checkAnswer("Je suis Paul", ["Je m'appelle Paul", "Moi, c'est Paul"]), {
      status: "incorrect",
      expected: "Je m'appelle Paul",
    });
  });

  test("blank or punctuation-only input is incorrect", () => {
    assert.equal(status("   ", ["Merci"]), "incorrect");
    assert.equal(status("?!", ["Merci"]), "incorrect");
  });
});

describe("checkAnswer with strictAccents", () => {
  test("an answer that only matches without accents is incorrect and keeps the accented answer", () => {
    assert.deepEqual(checkAnswer("mange", ["mangé"], true), { status: "incorrect", expected: "mangé", accentMismatch: true });
  });

  test("wrong accents are incorrect too", () => {
    assert.deepEqual(checkAnswer("ôu", ["où"], true), { status: "incorrect", expected: "où", accentMismatch: true });
  });

  test("reports the accepted answer that nearly matched, not the first one", () => {
    const result = checkAnswer("Ou tu habites", ["Tu habites où", "Où tu habites"], true);
    assert.equal(result.expected, "Où tu habites");
  });

  test("the correct accented answer is still correct", () => {
    assert.deepEqual(checkAnswer("dû", ["dû"], true), { status: "correct", expected: "dû" });
  });

  test("a truly wrong answer has no accent mismatch", () => {
    assert.deepEqual(checkAnswer("chat", ["mangé"], true), { status: "incorrect", expected: "mangé" });
  });

  test("capitals and punctuation are still ignored", () => {
    assert.equal(checkAnswer("MANGÉ !", ["mangé"], true).status, "correct");
  });

  test("without strictAccents the same input is correct-accents", () => {
    assert.equal(checkAnswer("mange", ["mangé"]).status, "correct-accents");
  });
});

describe("checkChoice", () => {
  test("an exact option matches", () => {
    assert.deepEqual(checkChoice("Je suis français.", ["Je suis français."]), {
      status: "correct",
      expected: "Je suis français.",
    });
  });

  test("any listed answer matches", () => {
    assert.equal(checkChoice("b", ["a", "b"]).status, "correct");
  });

  test("capitals matter, because some questions test them", () => {
    assert.deepEqual(checkChoice("Je suis Français.", ["Je suis français."]), {
      status: "incorrect",
      expected: "Je suis français.",
    });
  });
});

describe("sameWords", () => {
  const words = ["Nous", "sommes", "en", "retard"];

  test("matches the same words, ignoring capitals and punctuation", () => {
    assert.equal(sameWords(words, "nous sommes en retard !"), true);
  });

  test("ignores punctuation chips", () => {
    assert.equal(sameWords(["Tu", "es", "où", "?"], "Tu es où"), true);
  });

  test("counts repeated words", () => {
    assert.equal(sameWords(["vous", "vous", "appelez"], "vous appelez"), false);
  });

  test("rejects missing or extra words", () => {
    assert.equal(sameWords(words, "Nous sommes en"), false);
    assert.equal(sameWords(words, "Nous sommes très en retard"), false);
  });
});
