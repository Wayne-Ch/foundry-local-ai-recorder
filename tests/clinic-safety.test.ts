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
  const canonicalFailClosedAnswer = `${CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE}\n\n${CLINICIAN_HANDOFF_SENTENCE}`;

  function expectFailsClosed(
    unsafe: string,
    question = "Describe this clinical image's visible findings.",
  ): void {
    const visible = applyClinicAnswerSafety("clinic", question, unsafe);

    expect(visible).toBe(canonicalFailClosedAnswer);
    expect(visible.split(CLINICIAN_HANDOFF_SENTENCE)).toHaveLength(2);
    expect(visible).not.toContain(unsafe);
    expect(clinicModelAnswerForHistory("clinic", question, unsafe)).toBe(
      CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE,
    );
  }

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
    '"This is pneumonia."',
    "(This is pneumonia.)",
    "**This is pneumonia.**",
    "I recommend antibiotics.",
    "The diagnosis is pneumonia on this image.",
  ])("closes every current reviewer bypass: %s", (unsafe) => {
    expectFailsClosed(unsafe);
  });

  it.each([
    '"This is xylomycosis."',
    '"This is xylomycosis".',
    "(I recommend zymoplasty.)",
    "(I recommend zymoplasty).",
    "**The patient has oryctosis.**",
    "**The patient has oryctosis**.",
    "*You should undergo peloroplasty.*",
    "*You should undergo peloroplasty*.",
    "_They must receive velymab._",
    "`I advise cryoneurolysis.`",
    "`I advise cryoneurolysis`.",
  ])("normalizes wrappers before classifying diagnoses and treatments: %s", (unsafe) => {
    expectFailsClosed(unsafe);
  });

  it("splits terminal punctuation before closing quotes, brackets, and Markdown", () => {
    const unsafe =
      'The image shows lungs, ribs, and the heart silhouette. "This is xylomycosis." (I recommend zymoplasty.) **They should undergo peloroplasty.**';

    expectFailsClosed(unsafe);
  });

  it.each([
    "This is pneumonia.",
    "You have pneumonia.",
    "The patient has pneumonia.",
    "The patient needs urgent evaluation.",
    "Start antibiotics immediately.",
  ])("scans every Clinic answer even when the question classifier does not match: %s", (unsafe) => {
    const question = "Describe this clinical image's visible labels.";

    expect(clinicQuestionNeedsClinicianHandoff(question)).toBe(false);
    expectFailsClosed(unsafe, question);
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
    "I cannot diagnose from this image, but this is leukemia.",
    "I cannot recommend treatment, but the patient should start chemotherapy.",
    "You should undergo surgery. Please consult your doctor.",
  ])("closes the reported disclaimer or referral bypass: %s", (unsafe) => {
    expectFailsClosed(unsafe);
  });

  it.each([
    "The patient has glioblastoma.",
    "You likely have sarcoidosis.",
    "The disease is amyloidosis.",
    "The medical condition appears to be moyamoya disease.",
    "This clinical image appears consistent with mesothelioma.",
    "This appears consistent with Erdheim-Chester disease.",
    "It appears likely to be lymphangioleiomyomatosis.",
    "These findings are consistent with histiocytosis.",
    "That scan likely represents histiocytosis.",
  ])("fails closed for unlisted patient-specific conditions: %s", (unsafe) => {
    expectFailsClosed(unsafe);
  });

  it.each([
    "The diagnosis is xylomycosis on this image.",
    "The condition appears consistent with oryctosis on the scan.",
    "The disease is pelorosis on this x-ray.",
    "The diagnostic conclusion likely is velymosis in the radiograph.",
  ])("does not let image tokens exempt an explicit diagnosis: %s", (unsafe) => {
    expectFailsClosed(unsafe);
  });

  it.each([
    "You must receive plasmapheresis.",
    "They should stop immunotherapy.",
    "He needs to take blinatumomab.",
    "She ought to avoid anticoagulation.",
    "The patient should undergo transcatheter embolectomy.",
    "I recommend that you start photopheresis.",
    "Brachytherapy should be started promptly.",
  ])("fails closed for unlisted second- or third-person medical actions: %s", (unsafe) => {
    expectFailsClosed(unsafe);
  });

  it.each([
    "You should undergo zymoplasty.",
    "They must receive velymab.",
    "He needs to take oryctine.",
    "She ought to avoid pelorotherapy.",
    "The patient has to start xylomedicine.",
    "I recommend zymoplasty.",
    "We suggest pelorotherapy.",
    "Undergo cryoneurolysis.",
  ])("fails closed across recommendation subjects and unknown actions: %s", (unsafe) => {
    expectFailsClosed(unsafe);
  });

  it.each([
    "I cannot diagnose from this image. However, this is leukemia.",
    "I cannot diagnose this patient; nevertheless, that is sarcoidosis.",
    "I cannot recommend treatment. Yet you should take vorinostat.",
    "I cannot assess urgency, but the patient needs immediate decompression.",
    "This cannot wait until tomorrow.",
    "Same-day neurosurgical evaluation is required.",
  ])("fails closed for contrastive diagnosis, treatment, or urgency tails: %s", (unsafe) => {
    expectFailsClosed(unsafe);
  });

  it.each([
    "I cannot diagnose from this image, but this is xylomycosis.",
    "I cannot diagnose from this image. However, **this is oryctosis.**",
    "I cannot recommend treatment. Yet `I recommend zymoplasty.`",
    "I cannot assess urgency. Nevertheless, the patient needs same-day evaluation.",
    "I cannot diagnose; start zymoplasty.",
    "This is educational context only, not a diagnosis; this is xylomycosis.",
    `Visible anatomy is educational. You should undergo peloroplasty. ${CLINICIAN_HANDOFF_SENTENCE}`,
  ])("scans every contrastive tail and ignores an appended referral: %s", (unsafe) => {
    expectFailsClosed(unsafe);
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
    "This is the trachea.",
    "This is the left lung.",
    "The image shows lungs, ribs, and the heart silhouette.",
    "The diaphragm, mediastinum, clavicles, spine, airways, and lung fields are visible.",
    "The AP marker shows the image orientation.",
    "The PA marker is on the right side.",
    "The heart lies between the lungs, and the ribs surround the chest.",
    "This is an AP chest x-ray showing lungs, ribs, and the heart silhouette.",
    "The image shows the trachea in the midline and the heart centered between the lungs.",
  ])("preserves bounded anatomy and orientation descriptions: %s", (answer) => {
    expect(applyClinicAnswerSafety("clinic", "Describe the visible image structures.", answer)).toBe(answer);
  });

  it.each([
    "You should use separation of variables for this equation.",
    "I recommend using the AP marker to orient the image.",
    "They should graph the model.",
    "He should check the software cache.",
    "She should compare the derivative graph.",
    "The patient should use the PA marker to orient the image.",
    "I recommend checking the software provider latency.",
    "I advise using the PA marker to orient the image.",
    "We strongly suggest checking the model cache latency.",
    "The patient ought to graph the exponential decay model.",
  ])("preserves wholly educational or orientation recommendations: %s", (answer) => {
    expect(applyClinicAnswerSafety("clinic", "Explain the visible educational material.", answer)).toBe(
      answer,
    );
  });

  it.each([
    "This is a first-order decay equation.",
    "This is a local model cache example.",
    "Use separation of variables for this equation.",
    "This image shows lungs, ribs, and the heart silhouette.",
    "The lungs, ribs, and heart silhouette are visible in this image.",
    "The heart lies between the lungs, and the ribs surround the chest.",
    "A clinician should make diagnosis and treatment decisions.",
  ])("preserves bounded nonmedical educational statements: %s", (answer) => {
    expect(applyClinicAnswerSafety("clinic", "Explain the visible material.", answer)).toBe(answer);
  });

  it.each([
    "A clinician should make diagnosis, urgency, and treatment decisions.",
    "A qualified physician must determine the diagnosis and treatment plan.",
    "The diagnosis is for the treating clinician to determine.",
    "Urgency is a matter for the treating physician.",
    "Please consult the treating clinician for diagnosis and treatment decisions.",
  ])("preserves clinician-decision boundaries: %s", (answer) => {
    expect(applyClinicAnswerSafety("clinic", "Explain the visible material.", answer)).toBe(answer);
  });

  it("preserves a safe answer exactly while classifying normalized text", () => {
    const answer = "  **This is the trachea.**\n";
    const question = "Describe the visible image structures.";

    expect(applyClinicAnswerSafety("clinic", question, answer)).toBe(answer);
    expect(clinicModelAnswerForHistory("clinic", question, answer)).toBe(answer);
  });

  it("preserves a safe anatomy answer and appends the handoff for a decision question", () => {
    const answer = "This is the trachea.";
    const question = "What is the diagnosis?";

    expect(applyClinicAnswerSafety("clinic", question, answer)).toBe(
      `${answer}\n\n${CLINICIAN_HANDOFF_SENTENCE}`,
    );
    expect(clinicModelAnswerForHistory("clinic", question, answer)).toBe(answer);
  });

  it("fails the whole mixed answer without retaining unsafe visible or history text", () => {
    const unsafeCondition = "The patient has xylomycosis.";
    const unsafeTreatment = "I recommend zymoplasty.";
    const answer = `This is the trachea. ${unsafeCondition} The AP marker shows orientation. ${unsafeTreatment} ${CLINICIAN_HANDOFF_SENTENCE}`;
    const question = "Describe this clinical image.";
    const visible = applyClinicAnswerSafety("clinic", question, answer);
    const history = clinicModelAnswerForHistory("clinic", question, answer);

    expect(visible).toBe(canonicalFailClosedAnswer);
    expect(visible.split(CLINICIAN_HANDOFF_SENTENCE)).toHaveLength(2);
    expect(visible).not.toContain("xylomycosis");
    expect(visible).not.toContain("zymoplasty");
    expect(history).toBe(CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE);
    expect(history).not.toContain("xylomycosis");
    expect(history).not.toContain("zymoplasty");
  });

  it.each(["You should use the trachea.", "I recommend using the lungs.", "Use the diaphragm."])(
    "does not mistake anatomy words for an educational or orientation action: %s",
    (unsafe) => {
      expectFailsClosed(unsafe);
    },
  );

  it("preserves the canonical refusal and single handoff", () => {
    const safe = `${CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE}\n\n${CLINICIAN_HANDOFF_SENTENCE}`;

    expect(applyClinicAnswerSafety("clinic", "What is the diagnosis and treatment?", safe)).toBe(safe);
    expect(safe.split(CLINICIAN_HANDOFF_SENTENCE)).toHaveLength(2);
    expect(clinicModelAnswerForHistory("clinic", "What is the diagnosis and treatment?", safe)).toBe(
      CLINIC_EDUCATIONAL_BOUNDARY_SENTENCE,
    );
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
