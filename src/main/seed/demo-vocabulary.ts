// ===================================================================
// Vocabulary for SYNTHETIC PRACTICE DATA ONLY.
// ===================================================================
// Read this before you read the seed script.
//
// This file is split into two halves on purpose, and the split is a
// safety rule, not a style choice.
//
// SAFE TO WRITE HERE: things a patient says. Complaints, symptoms,
// durations, worries, hopes. These are the patient's own words. Making
// up realistic examples of them carries no clinical risk, and the
// Recall Card cannot be judged for legibility against text that is the
// wrong length or shape.
//
// NOT WRITTEN HERE: diagnoses, medicine names, and test names. Those
// appear below only as obvious placeholders. The reason is the standing
// rule for this project - this software never produces a diagnosis and
// never names a medicine. That rule does not stop applying because the
// data is fake. If I invented two hundred plausible diagnoses and drug
// names to make a demo look good, they would be my clinical text
// sitting in the database, and the first person to see the demo would
// reasonably assume a clinician wrote them.
//
// TO MAKE THE DEMO READ REALISTICALLY: replace the three placeholder
// lists at the bottom with real text supplied by the supervising
// physician - the twenty diagnoses he actually writes most often, the
// medicines he actually prescribes, the tests he actually orders. That
// is a five minute edit to this one file, and then the seeded data
// looks like his own chamber. It should be his words, not mine.
// ===================================================================

// ---------- The patient's own words: safe to author ----------

export const COMPLAINTS: Array<{ bn: string; en: string }> = [
  { bn: 'তিন দিন ধরে জ্বর', en: 'fever for three days' },
  { bn: 'পেটে ব্যথা, খাওয়ার পরে বাড়ে', en: 'stomach pain, worse after eating' },
  { bn: 'মাথা ব্যথা আর ঘুম হয় না', en: 'headache and not sleeping' },
  { bn: 'বুকে চাপ লাগে সিঁড়ি ভাঙলে', en: 'chest tightness on climbing stairs' },
  { bn: 'কাশি দুই সপ্তাহ, রাতে বেশি', en: 'cough for two weeks, worse at night' },
  { bn: 'হাঁটুতে ব্যথা, সকালে শক্ত লাগে', en: 'knee pain, stiff in the morning' },
  { bn: 'শরীর দুর্বল, কাজে মন বসে না', en: 'weakness, cannot concentrate at work' },
  { bn: 'পায়ে পানি আসছে', en: 'swelling in the legs' },
  { bn: 'বারবার প্রস্রাব হয়, রাতে উঠতে হয়', en: 'passing urine often, up at night' },
  { bn: 'শ্বাস নিতে কষ্ট হয় হাঁটলে', en: 'shortness of breath on walking' },
  { bn: 'পিঠে ব্যথা, ভারী কিছু তুললে বাড়ে', en: 'back pain, worse lifting anything heavy' },
  { bn: 'চোখে ঝাপসা দেখি কিছুদিন ধরে', en: 'blurred vision for some time' },
  { bn: 'গলা ব্যথা আর ঢোক গিলতে কষ্ট', en: 'sore throat and difficulty swallowing' },
  { bn: 'পাতলা পায়খানা দুই দিন', en: 'loose motions for two days' },
  { bn: 'চামড়ায় চুলকানি আর দাগ', en: 'itching and a rash on the skin' },
  { bn: 'ওজন কমে যাচ্ছে, খিদে নেই', en: 'losing weight, no appetite' },
  { bn: 'বুক জ্বালাপোড়া করে রাতে', en: 'burning in the chest at night' },
  { bn: 'মাথা ঘোরে, উঠে দাঁড়ালে বেশি', en: 'dizziness, worse on standing up' },
];

export const WORRIES: Array<{ bn: string; en: string }> = [
  { bn: 'বড় কিছু হয়েছে কিনা ভয় লাগে', en: 'afraid it is something serious' },
  { bn: 'বাবার যে অসুখ ছিল সেটাই কিনা', en: 'worried it is what my father had' },
  { bn: 'কাজ করতে পারব কিনা', en: 'whether I will be able to keep working' },
  { bn: 'অপারেশন লাগবে কিনা', en: 'whether an operation will be needed' },
  { bn: 'ওষুধ সারাজীবন খেতে হবে কিনা', en: 'whether I will be on medicine for life' },
  { bn: 'খরচ কেমন হবে', en: 'how much this is going to cost' },
  { bn: 'ছেলের বিয়ের আগে ঠিক হবে কিনা', en: 'whether it will settle before my son’s wedding' },
];

export const HOPES: Array<{ bn: string; en: string }> = [
  { bn: 'ব্যথাটা যেন কমে', en: 'that the pain settles' },
  { bn: 'রাতে যেন ঘুমাতে পারি', en: 'to be able to sleep at night' },
  { bn: 'জানতে চাই আসলে কী হয়েছে', en: 'to know what is actually wrong' },
  { bn: 'পরীক্ষা লাগলে করাতে চাই', en: 'to get tests done if they are needed' },
  { bn: 'আগের ওষুধটা কাজ করছে না, দেখাতে চাই', en: 'the earlier medicine is not working, want it looked at' },
  { bn: 'কাজে ফিরতে চাই', en: 'to get back to work' },
];

export const BODY_REGIONS = [
  'head', 'chest', 'abdomen', 'back', 'arm', 'leg', 'skin', 'throat', 'whole_body',
] as const;

export const DURATIONS: Array<{ bn: string; en: string }> = [
  { bn: '১-২ দিন', en: '1-2 days' },
  { bn: 'প্রায় এক সপ্তাহ', en: 'about a week' },
  { bn: '২-৩ সপ্তাহ', en: '2-3 weeks' },
  { bn: '১ মাসের বেশি', en: 'more than a month' },
  { bn: '৬ মাসের বেশি', en: 'more than 6 months' },
];

// Medicines already taken before coming. Captured as the patient
// describes them, which is often not a name at all. These strings are
// what a patient actually says at a front desk.
export const SELF_MEDICATION_ANSWERS: Array<{ bn: string; en: string }> = [
  { bn: 'ফার্মেসি থেকে কিনে খেয়েছি, নাম জানি না', en: 'bought something from the pharmacy, do not know the name' },
  { bn: 'স্ট্রিপ সাথে এনেছি', en: 'brought the strip with me' },
  { bn: 'আগের প্রেসক্রিপশনের ওষুধ চালিয়ে যাচ্ছি', en: 'still taking what was prescribed last time' },
  { bn: 'কিছু খাইনি', en: 'have not taken anything' },
  { bn: 'পাশের দোকানদার দিয়েছিল', en: 'the shopkeeper next door gave me something' },
  { bn: 'মনে নেই', en: 'do not remember' },
];

// ---------- Placeholders: to be replaced by the physician ----------
// See the note at the top of this file. These are deliberately not
// clinical text, and are deliberately ugly so that nobody mistakes a
// demo database for a real one.

export const PLACEHOLDER_DIAGNOSES = [
  'PLACEHOLDER DIAGNOSIS A — replace with the physician’s own wording',
  'PLACEHOLDER DIAGNOSIS B — replace with the physician’s own wording',
  'PLACEHOLDER DIAGNOSIS C — long-standing, under review',
  'PLACEHOLDER DIAGNOSIS D — first presentation',
  'PLACEHOLDER DIAGNOSIS E — recurrence of earlier problem',
  'PLACEHOLDER DIAGNOSIS F — awaiting investigation results',
];

export const PLACEHOLDER_DRUGS = [
  { drug_name: 'PLACEHOLDER DRUG 1', strength: '500 mg' },
  { drug_name: 'PLACEHOLDER DRUG 2', strength: '10 mg' },
  { drug_name: 'PLACEHOLDER DRUG 3', strength: '250 mg' },
  { drug_name: 'PLACEHOLDER DRUG 4', strength: '20 mg' },
  { drug_name: 'PLACEHOLDER DRUG 5', strength: '5 mg' },
  { drug_name: 'PLACEHOLDER SYRUP 6', strength: '100 ml' },
];

// Investigations. These are REAL test names, supplied by the doctor and
// extended with the common ones a chamber orders, at his instruction.
//
// Note the difference from the two lists above: naming a test that was
// ordered is not a diagnosis and not a prescription. These are the
// names as they are written on a Bangladeshi chamber slip.
export const INVESTIGATIONS = [
  'X-ray chest PA view',
  'Urine R/E',
  'CBC with ESR',
  'CRP',
  'CT scan',
  'Dengue NS1 antigen',
  'Dengue IgG / IgM',
  'RBS',
  'FBS and 2 hours ABF',
  'HbA1c',
  'Serum creatinine',
  'Serum electrolytes',
  'Lipid profile',
  'SGPT',
  'TSH',
  'Ultrasonogram of whole abdomen',
  'ECG',
  'Stool R/E',
  'Widal test',
  'X-ray K.U.B.',
];

// Kept as a name the code can still refer to. Unlike diagnoses and
// medicines, this list no longer holds placeholders.
export const PLACEHOLDER_TESTS = INVESTIGATIONS;
