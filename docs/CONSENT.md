# Consent: what the law requires, and what this software does

**Read this before approving `consent.yaml`.** It is written for two
readers: the supervising physician, and a lawyer in Bangladesh. It sets
out what each part of the consent screen is there to satisfy, so that
whoever reviews it can check the reasoning rather than guess at it.

**I am not a lawyer and this is not legal advice.** It is a developer's
reading of a new statute, done so that the software was not built on an
assumption. A Bangladeshi lawyer must confirm it before a real patient
is asked anything.

---

## The law as it stands

Bangladesh now has comprehensive data protection legislation, and it is
recent enough that most people have not caught up with it.

- The **Personal Data Protection Ordinance 2025** was gazetted on
  6 November 2025 — the country's first comprehensive data protection
  law.
- It was **amended in February 2026**, mainly on data residency.
- It was **replaced by the Personal Data Protection Act 2026**, passed
  in April 2026.
- Enforcement and penalties are reported as phased in over roughly
  **18 months from the November 2025 gazette, so around May 2027**.

That last point matters for a twelve-week pilot starting now: the pilot
sits inside the run-up period. It does not make compliance optional; it
means there is time to get it right cheaply, before anything has to be
retrofitted across thousands of records.

## Why this project cannot treat consent casually

**Health information is sensitive personal data.** The sensitive
category is reported to cover biometrics, religion, caste, political
affiliation, trade union membership, sexual orientation, **health**,
legal affairs and geo-location. Processing it requires **explicit
consent** and heightened security.

Everything this software exists to collect falls in that category.

## What valid consent has to look like, and where it is in the software

The Act requires consent that is **voluntary, specific, informed,
unambiguous and withdrawable**.

| Requirement | Where it is met |
|---|---|
| **Explicit** | A separate screen with an explicit tap. Consent is never bundled into "carry on" and is never implied by the patient sitting down. |
| **Specific** | Two permissions, asked and answered separately: keeping a history, and anonymised research. Agreeing to one says nothing about the other, and the research screen says so in its first line. |
| **Informed** | The screen says what is recorded, why, where it is kept, who can see it, and what happens if the patient says no. Crucially, **agreeing is not possible until the patient has actually been told** — either the recording has played, or the assistant has confirmed they read the words aloud. Which of the two happened is stored. |
| **Voluntary** | Refusing is one tap and is available the moment the screen appears, before anything has been played or read. It is never behind a scroll, a checkbox or a delay. The wording says plainly that refusing does not affect the serial number or how the doctor treats them. |
| **Unambiguous** | The buttons say "Yes, you may keep it" and "No, do not keep it", not "OK" and "Cancel". |
| **Withdrawable** | Withdrawal is recorded as its own decision and takes effect at once. See below. |
| **Demonstrable** | Every decision is a row in an append-only table: the version of the wording, the time, who recorded it, who agreed, in which language, and how they were told. It cannot be edited or deleted afterwards. |

## Consent is per patient, and versioned

Asking the same person at every visit is not better consent; it is a
ritual both sides learn to tap through. Consent is therefore recorded
**once per patient against a version of the wording**. Change the
meaning of the wording, change the version, and everybody is asked
again. Each visit records which version was in force.

## Who actually agreed

Patients arrive with a son, a daughter-in-law, a neighbour who does the
talking. The software records whether the patient answered themselves or
somebody with them did, because a record that quietly treats a
relative's agreement as the patient's own is a record that lies.

**Open point for the lawyer:** where a patient lacks capacity, or is a
child, the rules on who may consent on their behalf need confirming.
The software records that somebody else answered but does not currently
model guardianship formally.

## Withdrawal, and the honest limit of it

The Act gives a right to withdraw at any time, and once withdrawn,
processing must stop. The two permissions are not the same in practice
and the software does not pretend they are:

- **Research consent stops completely and immediately.** Nothing
  withdrawn is ever included in an anonymised export again. The export
  list is built from who said *yes*, never from a list of who to leave
  out — a mistake in an opt-out list quietly includes somebody who
  refused; the same mistake here quietly leaves out somebody who agreed,
  which harms nobody.
- **Withdrawing consent to a care record stops anything new being
  recorded.** What is already there is a medical record. Destroying it
  is a clinical and legal decision for the doctor to make and to
  document — not something an assistant does with one tap at a front
  desk. The request is recorded so the doctor sees it and acts on it.

**Open point for the lawyer:** the interaction between the right to
erasure and a physician's duty to retain medical records needs a
documented position. The doctor should be able to say, in one sentence,
what he does when a patient asks for their record to be destroyed.

## Where the data lives

The Act's residency provisions require, for restricted data, that a
real-time copy be kept inside Bangladesh.

This architecture satisfies that by construction and by a wide margin:
**there is no cloud at all.** One encrypted file on one laptop in the
chamber, no internet at any point, no cross-border transfer to analyse.
This was chosen for reliability rather than for compliance, but it
happens to remove the hardest category of obligation entirely.

## What is still the doctor's responsibility, not the software's

1. **A breach has to be reported.** The Act requires prompt notification
   to the regulator. A stolen or lost laptop is a reportable event. The
   database is encrypted, which limits the harm, but *encrypted* is not
   *not a breach*. The chamber needs to know who to call.
2. **Retention.** Data may not be kept longer than necessary for the
   purpose, while records of processing are to be kept for at least five
   years. The audit log in this software is append-only and satisfies
   the second. The first — how long a patient's history is kept after
   they stop attending — is a decision nobody has made yet.
3. **Approving the wording.** The software will not take an intake until
   `approved_by` and `approved_on` are filled in and the version is no
   longer marked a draft.
4. **Recording the audio.** It has to be a human voice reading these
   exact words in Bangla. Until it exists the tablet tells the assistant
   to read them aloud and records that this is what happened.

## Sources

- [Bangladesh's Personal Data Protection Ordinance 2025: key takeaways — The Daily Star](https://www.thedailystar.net/tech-startup/news/bangladeshs-personal-data-protection-ordinance-2025-key-takeaways-4015401)
- [An Overview of Bangladesh's Personal Data Protection Act, 2026 — Securiti](https://securiti.ai/bangladesh-personal-data-protection-act-overview/)
- [Personal Data Protection (Amendment) Ordinance, 2026 — Digital Policy Alert](https://digitalpolicyalert.org/change/18757-personal-data-protection-amendment-ordinance-2026-ordinance-no-23-of-2026)
- [Bangladesh Data Privacy Laws: the PDPO 2025 and complete legal framework — Recording Law](https://www.recordinglaw.com/world-laws/world-data-privacy-laws/bangladesh-data-privacy-laws/)
- [What every Bangladeshi business must do before the clock runs out — SCL Insights](https://bd-scl.com/insights/personal-data-protection-ordinance-2025-compliance.html)
- [Bangladesh Medical & Dental Council, Code of Medical Ethics](https://www.bmdc.org.bd/code-of-medical-ethics-3/)

The BMDC code covers confidentiality but I could not find a published
retention period for private practice records. That gap is one for the
lawyer, or a direct question to the Council.
