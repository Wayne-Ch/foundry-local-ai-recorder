import { describe, expect, it } from "vitest";
import {
  applyClinicAnswerSafety,
  CLINICIAN_HANDOFF_SENTENCE,
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
  ])("detects bounded medical-decision wording: %s", (question) => {
    expect(clinicQuestionNeedsClinicianHandoff(question)).toBe(true);
  });

  it.each([
    "Explain the first-order decay equation.",
    "Summarize the visible labels.",
    "What does this diagnostic axis mean in the math diagram?",
    "What should the student do next?",
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
      "x".repeat(MAX_ASSISTANT_DISPLAY_CHARS),
    );

    expect(answer).toHaveLength(MAX_ASSISTANT_DISPLAY_CHARS);
    expect(answer).toMatch(/\.\.\.\n\nDiagnosis,/u);
    expect(answer.endsWith(CLINICIAN_HANDOFF_SENTENCE)).toBe(true);
  });
});
