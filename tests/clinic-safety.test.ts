import { describe, expect, it } from "vitest";
import {
  applyClinicAnswerSafety,
  CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE,
  CLINICIAN_HANDOFF_SENTENCE,
  clinicModelAnswerForHistory,
  clinicQuestionNeedsClinicianHandoff,
} from "../src/assistant/clinic-safety";
import { MAX_ASSISTANT_DISPLAY_CHARS } from "../src/assistant/plain-text";

describe("Clinic answer safety", () => {
  it.each([
    "Could this be a diagnosis?",
    "Can this image diagnose the patient?",
    "Is this urgent?",
    "Is this an emergency?",
    "What treatment should they start?",
    "How should the clinician treat it?",
    "Which medication should the patient take?",
    "Should they start this medicine?",
    "Would this require a prescription?",
    "What should the patient do?",
    "What should this patient start?",
    "What should a patient take?",
    "Should the patient start antibiotics?",
    "What should they do next?",
    "Should I take these pills?",
    "The patient needs to start supportive care.",
    "What disease does this patient have?",
    "What medical condition does the patient have?",
    "What does this patient have?",
  ])("detects bounded medical-decision wording: %s", (question) => {
    expect(clinicQuestionNeedsClinicianHandoff(question)).toBe(true);
  });

  it.each([
    "Explain the first-order decay equation.",
    "Summarize the visible labels.",
    "What does this diagnostic axis mean in the math diagram?",
    "What should the student do next?",
    "What condition makes this equation stable?",
  ])("does not match unrelated wording: %s", (question) => {
    expect(clinicQuestionNeedsClinicianHandoff(question)).toBe(false);
  });

  it("appends the deterministic handoff only to matching Clinic answers", () => {
    const raw = "No, this image is a mathematical first-order decay model.";
    const question = "Does this image diagnose a patient, and what treatment should they start?";

    expect(applyClinicAnswerSafety("clinic", question, raw)).toBe(`${raw}\n\n${CLINICIAN_HANDOFF_SENTENCE}`);
    expect(applyClinicAnswerSafety("classroom", question, raw)).toBe(raw);
    expect(applyClinicAnswerSafety("clinic", "Explain the equation.", raw)).toBe(raw);
  });

  it("does not duplicate a model-supplied deterministic handoff", () => {
    const answer = `This image is educational only.\n\n${CLINICIAN_HANDOFF_SENTENCE}`;

    expect(applyClinicAnswerSafety("clinic", "What treatment should they start?", answer)).toBe(answer);
    expect(answer.match(new RegExp(CLINICIAN_HANDOFF_SENTENCE, "gu"))).toHaveLength(1);
  });

  it("normalizes an equivalent clinician referral to one canonical final handoff", () => {
    const answer =
      "Visible structures can be described for education. Please consult the treating clinician for diagnosis and treatment decisions.";
    const visible = applyClinicAnswerSafety("clinic", "Should the patient start antibiotics?", answer);

    expect(visible).toBe(
      `Visible structures can be described for education.\n\n${CLINICIAN_HANDOFF_SENTENCE}`,
    );
    expect(visible).not.toContain("Please consult");
    expect(visible.split(CLINICIAN_HANDOFF_SENTENCE)).toHaveLength(2);
  });

  it("replaces a direct treatment recommendation with the canonical educational boundary", () => {
    const unsafe =
      "The patient should start with the treatment that solves the equation. I would recommend this treatment.";
    const question = "What treatment should a patient start?";

    expect(applyClinicAnswerSafety("clinic", question, unsafe)).toBe(
      `${CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE}\n\n${CLINICIAN_HANDOFF_SENTENCE}`,
    );
    expect(clinicModelAnswerForHistory("clinic", question, unsafe)).toBe(
      CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE,
    );
  });

  it("replaces a model recommendation phrased as the treatment being to start something", () => {
    const unsafe =
      "The equation describes exponential decay. Therefore, the treatment is to start with the solution y(t) = 3e^(-2t).";
    const question = "What treatment should a patient start?";

    expect(applyClinicAnswerSafety("clinic", question, unsafe)).toBe(
      `${CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE}\n\n${CLINICIAN_HANDOFF_SENTENCE}`,
    );
    expect(clinicModelAnswerForHistory("clinic", question, unsafe)).toBe(
      CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE,
    );
  });

  it.each([
    "The diagnosis is pneumonia.",
    "The disease is pneumonia.",
    "The medical condition is pneumonia.",
    "This is pneumonia.",
    "You have pneumonia.",
    "The patient has pneumonia.",
    "It looks like appendicitis.",
    "The image confirms pneumonia.",
    "This is a medical emergency.",
    "The treatment would be to start antibiotics.",
    "The treatment is to immediately start antibiotics.",
    "Treatment is to start supportive medication.",
    "Start antibiotics immediately.",
    "You should go to the emergency department now.",
    "The patient needs urgent evaluation.",
    "Urgent evaluation is required.",
    "Antibiotics should be started immediately.",
    "These findings are diagnostic of pneumonia.",
    "This can safely wait until next week.",
    "This does not require emergency care.",
    "You should probably start antibiotics.",
    "I strongly recommend taking antibiotics.",
    "Antibiotics could be started promptly.",
    "Promptly seek emergency care.",
  ])("fails closed for asserted diagnosis, triage, or treatment wording: %s", (unsafe) => {
    const question = "What is the diagnosis, is this urgent, and what treatment should they start?";

    expect(applyClinicAnswerSafety("clinic", question, unsafe)).toBe(
      `${CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE}\n\n${CLINICIAN_HANDOFF_SENTENCE}`,
    );
    expect(clinicModelAnswerForHistory("clinic", question, unsafe)).toBe(
      CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE,
    );
  });

  it.each([
    "This is pneumonia.",
    "You have pneumonia.",
    "The patient has pneumonia.",
    "The patient needs urgent evaluation.",
    "Start antibiotics immediately.",
  ])("scans every Clinic answer even when the question classifier does not match: %s", (unsafe) => {
    const question = "Describe the visible labels.";

    expect(clinicQuestionNeedsClinicianHandoff(question)).toBe(false);
    expect(applyClinicAnswerSafety("clinic", question, unsafe)).toBe(CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE);
    expect(clinicModelAnswerForHistory("clinic", question, unsafe)).toBe(
      CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE,
    );
  });

  it("adds the clinician handoff when a disease question receives an unsafe diagnosis", () => {
    const question = "What disease does this patient have?";

    expect(applyClinicAnswerSafety("clinic", question, "This is pneumonia.")).toBe(
      `${CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE}\n\n${CLINICIAN_HANDOFF_SENTENCE}`,
    );
  });

  it("rejects an unsafe assertion even when the same answer also contains safe boundary wording", () => {
    const answer =
      "I cannot diagnose from this image, but the diagnosis is pneumonia. Please consult a clinician.";
    const question = "Can this image diagnose the patient?";

    expect(applyClinicAnswerSafety("clinic", question, answer)).toBe(
      `${CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE}\n\n${CLINICIAN_HANDOFF_SENTENCE}`,
    );
  });

  it.each([
    "I cannot diagnose, assess urgency, or recommend treatment from this image.",
    "This is educational context only, not a diagnosis.",
    "Visible structures can be described for education.",
  ])("preserves explicit safe refusal or educational wording: %s", (safe) => {
    const question = "What is the diagnosis and treatment?";
    const visible = applyClinicAnswerSafety("clinic", question, safe);

    expect(visible).toBe(`${safe}\n\n${CLINICIAN_HANDOFF_SENTENCE}`);
    expect(visible).not.toContain("pneumonia");
  });

  it("preserves non-decision Clinic visible-structure education unchanged", () => {
    const answer = "Visible text includes AP and upright labels; the right side marker is uncertain.";

    expect(applyClinicAnswerSafety("clinic", "Describe the visible labels.", answer)).toBe(answer);
  });

  it.each([
    "This is a first-order decay equation.",
    "This is a local model cache example.",
    "Use separation of variables for this equation.",
  ])("preserves bounded nonmedical educational statements: %s", (answer) => {
    expect(applyClinicAnswerSafety("clinic", "Explain the visible material.", answer)).toBe(answer);
  });

  it("preserves a safe refusal without storing the clinician handoff in chat history", () => {
    const safe = `I cannot recommend treatment from this image.\n\n${CLINICIAN_HANDOFF_SENTENCE}`;
    const question = "What treatment should they start?";

    expect(applyClinicAnswerSafety("clinic", question, safe)).toBe(safe);
    expect(clinicModelAnswerForHistory("clinic", question, safe)).toBe(
      "I cannot recommend treatment from this image.",
    );
  });

  it("moves a model-supplied handoff to the end without duplicating it", () => {
    const answer = `Educational context.\n\n${CLINICIAN_HANDOFF_SENTENCE}\n\nVisible features remain uncertain.`;
    const visible = applyClinicAnswerSafety("clinic", "Is this an emergency?", answer);

    expect(visible.split(CLINICIAN_HANDOFF_SENTENCE)).toHaveLength(2);
    expect(visible).toContain("Visible features remain uncertain.");
    expect(visible.endsWith(CLINICIAN_HANDOFF_SENTENCE)).toBe(true);
  });

  it("keeps the guarded visible answer within the display bound", () => {
    const answer = applyClinicAnswerSafety(
      "clinic",
      "Could this image diagnose the patient?",
      `Educational context only. ${"x".repeat(MAX_ASSISTANT_DISPLAY_CHARS)}`,
    );

    expect(answer).toHaveLength(MAX_ASSISTANT_DISPLAY_CHARS);
    expect(answer).toMatch(/\.\.\.\n\nDiagnosis,/u);
    expect(answer.endsWith(CLINICIAN_HANDOFF_SENTENCE)).toBe(true);
  });
});
