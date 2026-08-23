import { useState } from 'react';
import { BpSparkline, ValueSparkline } from './Sparkline';
import { PatientView } from './PatientView';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import { roleLabel, type Role } from '../../shared/roles';
import type { Result } from '../../shared/ipc';
import type {
  RecallCard as Card, VitalsReading, IntakeAnswerView, IntakeCorrectionView, TodayIntake,
} from '../../shared/recall';

/**
 * The single most important screen in the product.
 *
 * One screen at 1366x768 with no scrolling, read across a desk in
 * under twenty seconds. The order down and across the screen is the
 * order of clinical priority, not the order the data was convenient to
 * fetch:
 *
 *   red flag, who this is, what they told the front desk, today's
 *   vitals against the last two, the last visit, tests still
 *   outstanding, the trends, recurring diagnoses, current medicines,
 *   every visit ever.
 *
 * The intake block is walled off on purpose. What a patient told an
 * assistant at a desk and what a clinician recorded are different kinds
 * of fact, and a screen that lets them blur together is a screen that
 * will eventually put an unverified sentence into someone's record.
 */

const QUESTION_LABELS: Record<string, string> = {
  presenting_complaint: 'In their own words',
  body_region: 'Where',
  duration: 'How long',
  severity: 'How bad (their word)',
  medicines_already_taken: 'Already taken for this',
  known_conditions: 'Known conditions',
  allergies: 'Allergies',
  most_worried_about: 'Most worried about',
  hoping_for: 'Hoping for',
};

/**
 * The questions between the complaint and the two that matter most.
 * These are the ones allowed to scroll if the panel runs out of room.
 */
const MIDDLE_QUESTIONS = [
  'duration', 'severity', 'body_region', 'medicines_already_taken',
  'known_conditions', 'allergies',
];

/**
 * The order the card puts the questions in, which is the order the
 * doctor has just read them in. The correction sheet uses the same
 * order: a sheet that shuffles them makes him hunt for the sentence he
 * is trying to put right, and the answer he corrects by mistake
 * becomes part of somebody's record.
 */
const CARD_ORDER = ['presenting_complaint', ...MIDDLE_QUESTIONS, 'most_worried_about', 'hoping_for'];

function inCardOrder(answers: IntakeAnswerView[]): IntakeAnswerView[] {
  const rank = (key: string) => {
    const i = CARD_ORDER.indexOf(key);
    return i === -1 ? CARD_ORDER.length : i;
  };
  return [...answers].sort((a, b) => rank(a.questionKey) - rank(b.questionKey)
    || a.questionKey.localeCompare(b.questionKey));
}

/**
 * Whether there is an answer here to correct at all.
 *
 * A question the patient skipped, or left blank, has nothing to put
 * right. What the doctor learns when he asks it himself is his own
 * history-taking and belongs in his notes, not in the front desk's
 * record of a conversation he was not present at.
 */
function hasSomethingToCorrect(answer: IntakeAnswerView): boolean {
  if (answer.skipped) return false;
  const text = answer.freeText ?? answer.value;
  return text !== null && text.trim() !== '';
}

function OriginalAnswer({ answer, small = false }: { answer: IntakeAnswerView | undefined; small?: boolean }) {
  const extra = small ? ' small' : '';
  if (answer === undefined) return <div className={`a skipped${extra}`}>not asked</div>;
  if (answer.skipped) return <div className={`a skipped${extra}`}>skipped</div>;
  const text = answer.freeText ?? answer.value;
  if (text === null || text.trim() === '') return <div className={`a skipped${extra}`}>left blank</div>;
  const isQuote = answer.freeText !== null;
  return <div className={`${isQuote ? 'a quote' : 'a'}${extra}`}>{text}</div>;
}

/**
 * One answer, and the doctor's correction of it if he made one.
 *
 * The correction never replaces the original. What a patient said to
 * an assistant is evidence of what they said, and a screen that
 * quietly swaps in a tidier version destroys that evidence. So the
 * doctor's wording is shown as the answer, and underneath it, smaller,
 * is what the front desk actually wrote down, struck through when he
 * marked it wrong.
 */
function Answer({ answer, correction }: { answer: IntakeAnswerView | undefined; correction?: IntakeCorrectionView }) {
  if (correction === undefined) return <OriginalAnswer answer={answer} />;

  const corrected = correction.correctedFreeText ?? correction.correctedValue;
  const hasText = corrected !== null && corrected.trim() !== '';
  const when = new Date(correction.correctedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="corrected">
      {hasText
        ? <div className="a fixed">{corrected}</div>
        : <div className="a fixed wrong">the doctor marked this wrong</div>}
      <div className={correction.markedWrong ? 'was struck' : 'was'}>
        <span className="tag">front desk had</span>
        <OriginalAnswer answer={answer} small />
      </div>
      <div className="by">corrected by {correction.correctedByName ?? 'the doctor'} at {when}</div>
    </div>
  );
}

/**
 * What the front desk did about the alerts, in one line. The doctor
 * needs to know whether anyone actually told him, or whether this is
 * the first he is hearing of it.
 */
/**
 * Whether this history was taken with permission, said plainly.
 *
 * A doctor reading somebody's history has a right to know it was taken
 * with their agreement, and if it was not, to know that before relying
 * on it. Health information is sensitive personal data under the
 * Personal Data Protection Act and this is the line that shows the
 * permission was actually obtained.
 */
function ConsentLine({ consent }: { consent: Card['consent'] }) {
  const told = consent.method === 'audio' ? 'the recording was played'
    : consent.method === 'read_aloud' ? 'read aloud to them'
    : consent.method === 'screen_only' ? 'shown on screen only'
    : null;
  const who = consent.givenBy === 'self' ? null
    : consent.givenBy === null ? null
    : `agreed by someone with them (${consent.givenBy.replace('_', ' ')})`;

  if (consent.careRecord === 'given') {
    return (
      <p className="consent-line ok">
        Permission given{consent.decidedAt !== null && ` ${consent.decidedAt.slice(0, 10)}`}
        {told !== null && ` · ${told}`}{who !== null && ` · ${who}`}
      </p>
    );
  }
  if (consent.careRecord === 'declined') {
    return <p className="consent-line bad">This patient asked for no history to be kept. Nothing below was recorded with permission.</p>;
  }
  if (consent.careRecord === 'withdrawn') {
    return <p className="consent-line bad">This patient has withdrawn permission. Do not record anything further without asking again.</p>;
  }
  if (consent.careRecord === 'out_of_date') {
    return <p className="consent-line warn">Agreed to older wording — needs asking again on this visit.</p>;
  }
  return <p className="consent-line warn">Permission was never asked for.</p>;
}

function acknowledgementSummary(flags: Card['today']['redFlags']): string {
  const acknowledged = flags.filter((f) => f.acknowledgedAt !== null);
  if (acknowledged.length === 0) return 'not acknowledged at the front desk';
  if (acknowledged.length < flags.length) return `${acknowledged.length} of ${flags.length} acknowledged at the front desk`;
  const first = acknowledged[0]!;
  const time = new Date(first.acknowledgedAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return flags.length === 1
    ? `told by ${first.acknowledgedByName ?? 'front desk'} at ${time}`
    : `all acknowledged at the front desk, first at ${time}`;
}

function vitalsRow(label: string, unit: string, pick: (v: VitalsReading) => number | null,
                   today: VitalsReading | null, previous: VitalsReading[], decimals = 0) {
  const format = (v: VitalsReading | null | undefined) => {
    if (v === null || v === undefined) return '·';
    const value = pick(v);
    return value === null ? '·' : value.toFixed(decimals);
  };
  return (
    <tr key={label}>
      <th>{label}<span className="dim"> {unit}</span></th>
      <td className="num now">{format(today)}</td>
      <td className="num dim">{format(previous[0])}</td>
      <td className="num dim">{format(previous[1])}</td>
    </tr>
  );
}

/**
 * Confirm and Correct.
 *
 * Confirming is the moment the front desk's history becomes part of
 * the medical record, so it is the doctor's alone. When the laptop is
 * set to anybody else the buttons are dead and the reason is written
 * underneath rather than left for the user to work out.
 */
function IntakeActions(
  { intake, role, busy, failure, onConfirm, onUndo, onCorrect }: {
    intake: TodayIntake | null; role: Role; busy: boolean; failure: Failure | null;
    onConfirm: () => void; onUndo: () => void; onCorrect: () => void;
  },
) {
  if (intake === null) {
    return (
      <div className="rc-actions">
        <div className="mock-note">Nothing was taken at the front desk, so there is nothing to confirm.</div>
      </div>
    );
  }

  const isDoctor = role === 'doctor';
  const confirmed = intake.confirmedAt !== null;
  const disabled = !isDoctor || busy;

  return (
    <div className="rc-actions">
      {failure !== null && <FailureNotice failure={failure} />}
      {confirmed
        ? <button className="secondary" disabled={disabled} onClick={onUndo}>Undo confirmation</button>
        : <button disabled={disabled} onClick={onConfirm}>Confirm</button>}
      <button className="secondary" disabled={disabled} onClick={onCorrect}>Correct</button>
      <div className="mock-note">
        {!isDoctor
          ? `Only the doctor can confirm a history. This laptop is set to ${roleLabel(role).en.toLowerCase()}.`
          : confirmed
            ? 'This is part of the record now. The words are still the patient’s, not yours.'
            : 'Until you confirm, none of this is part of the record.'}
      </div>
    </div>
  );
}

/**
 * The correction sheet.
 *
 * It stops the screen rather than squeezing into the intake column:
 * correcting somebody's history is a deliberate act, not something
 * done in passing while reading. Every question that was actually put
 * to the patient is listed, with what they answered above the box, so
 * the doctor is always correcting a specific sentence rather than
 * typing into a blank form.
 */
function CorrectSheet(
  { intake, onClose, onSaved }: { intake: TodayIntake; onClose: () => void; onSaved: () => Promise<void> },
) {
  const existing = new Map(intake.corrections.map((c) => [c.questionKey, c]));
  const ordered = inCardOrder(intake.answers);
  const correctable = ordered.filter(hasSomethingToCorrect);
  const empty = ordered.filter((a) => !hasSomethingToCorrect(a));
  const [drafts, setDrafts] = useState<Record<string, { text: string; wrong: boolean }>>(() => {
    const initial: Record<string, { text: string; wrong: boolean }> = {};
    for (const answer of correctable) {
      const correction = existing.get(answer.questionKey);
      initial[answer.questionKey] = {
        text: correction === undefined ? '' : (correction.correctedFreeText ?? correction.correctedValue ?? ''),
        wrong: correction?.markedWrong ?? false,
      };
    }
    return initial;
  });
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [failedAt, setFailedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const label = (key: string) => QUESTION_LABELS[key] ?? key;

  const changed = correctable.filter((answer) => {
    const draft = drafts[answer.questionKey]!;
    const correction = existing.get(answer.questionKey);
    const wasText = correction === undefined ? '' : (correction.correctedFreeText ?? correction.correctedValue ?? '');
    const wasWrong = correction?.markedWrong ?? false;
    return draft.text.trim() !== wasText.trim() || draft.wrong !== wasWrong;
  });

  async function save() {
    setSaving(true);
    setFailure(null);
    setFailedAt(null);
    // One write per question, in order, stopping at the first refusal.
    // Whatever was written before the refusal stays written - it is
    // already in the record with its own timestamp - and the sheet
    // says which question it stopped at.
    for (const answer of changed) {
      const draft = drafts[answer.questionKey]!;
      const text = draft.text.trim();
      const result = unwrap(await api.intakeCorrect(intake.intakeId, {
        questionKey: answer.questionKey,
        correctedFreeText: text === '' ? null : text,
        markedWrong: draft.wrong,
        note: note.trim() === '' ? null : note.trim(),
      }));
      if (result.failure !== null) {
        setFailure(result.failure);
        setFailedAt(label(answer.questionKey));
        setSaving(false);
        await onSaved();
        return;
      }
    }
    setSaving(false);
    await onSaved();
    onClose();
  }

  return (
    <div className="correct-overlay" role="dialog" aria-label="Correct the front desk history">
      <div className="correct-box">
        <h2>Correct what the front desk wrote down</h2>
        <p className="lede">
          What the patient told the assistant is kept exactly as it was recorded. Your wording is
          added beside it with your name and the time, and both stay in the record. Leave a box
          empty to change nothing about that question.
        </p>

        {failure !== null && (
          <>
            {failedAt !== null && <p className="lede"><b>Stopped at &ldquo;{failedAt}&rdquo;.</b> Corrections before it were saved.</p>}
            <FailureNotice failure={failure} />
          </>
        )}

        <div className="correct-list">
          {correctable.length === 0 && (
            <p className="muted">Nothing was answered at the front desk, so there is nothing here to correct.</p>
          )}
          {correctable.map((answer) => {
            const draft = drafts[answer.questionKey]!;
            return (
              <div className="correct-row" key={answer.questionKey}>
                <div className="k">{label(answer.questionKey)}</div>
                <div className={draft.wrong ? 'said struck' : 'said'}>
                  <OriginalAnswer answer={answer} />
                </div>
                <input
                  type="text"
                  value={draft.text}
                  placeholder="What it should say"
                  aria-label={`Correction for ${label(answer.questionKey)}`}
                  onChange={(e) => setDrafts({ ...drafts, [answer.questionKey]: { ...draft, text: e.target.value } })}
                />
                <label className="wrong">
                  <input
                    type="checkbox"
                    checked={draft.wrong}
                    onChange={(e) => setDrafts({ ...drafts, [answer.questionKey]: { ...draft, wrong: e.target.checked } })}
                  />
                  This answer is wrong
                </label>
              </div>
            );
          })}

          {empty.length > 0 && (
            <div className="correct-row nothing">
              <div className="k">Not answered at the front desk</div>
              <div className="said">{empty.map((a) => label(a.questionKey)).join(', ')}</div>
              <p className="muted">
                There is nothing here to put right. What the patient tells you when you ask these
                yourself is your own history-taking, and it belongs in your notes rather than in
                the front desk's record of a conversation you were not at.
              </p>
            </div>
          )}
        </div>

        <div className="correct-foot">
          <input
            type="text"
            className="grow"
            value={note}
            placeholder="Why (optional, kept with the correction)"
            aria-label="Note about these corrections"
            onChange={(e) => setNote(e.target.value)}
          />
          <button disabled={saving || changed.length === 0} onClick={() => { void save(); }}>
            {changed.length === 0 ? 'Nothing changed' : `Save ${changed.length} correction${changed.length === 1 ? '' : 's'}`}
          </button>
          <button className="secondary" disabled={saving} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function RecallCardScreen(
  { card, onClose, role, onReload, onRecord }: {
    card: Card; onClose: () => void; role: Role; onReload: () => Promise<void>;
    /** Into the consultation for this same patient, without losing the card. */
    onRecord?: () => void;
  },
) {
  const [patientFacing, setPatientFacing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionFailure, setActionFailure] = useState<Failure | null>(null);

  async function run(promise: Promise<Result<Record<string, never>>>) {
    setBusy(true);
    const { failure } = unwrap(await promise);
    setBusy(false);
    setActionFailure(failure);
    if (failure === null) await onReload();
  }

  if (patientFacing) return <PatientView card={card} onClose={() => setPatientFacing(false)} />;

  const { patient, today, lastVisit } = card;
  const answersByKey = new Map((today.intake?.answers ?? []).map((a) => [a.questionKey, a]));
  const correctionsByKey = new Map((today.intake?.corrections ?? []).map((c) => [c.questionKey, c]));
  const name = patient.nameBn ?? patient.nameEn ?? 'unnamed';
  const altName = patient.nameBn !== null && patient.nameEn !== null ? patient.nameEn : null;

  return (
    <div className="recall">
      {/* 1 - the red flag, above everything, impossible to miss.
          ONE banner however many rules fired. An earlier version gave
          each rule its own full-width banner; three firing at once ate
          a fifth of the screen and pushed the vitals off the bottom -
          on exactly the patient whose card most needed to stay whole. */}
      {today.redFlags.length > 0 && (
        <div className="rc-flag">
          <span className="word">
            {today.redFlags.length === 1 ? 'RED FLAG' : `RED FLAG ×${today.redFlags.length}`}
          </span>
          {/* With three or more firing, the text shrinks rather than
              scrolling a warning out of sight. */}
          <div className={today.redFlags.length >= 3 ? 'msgs many' : 'msgs'}>
            {today.redFlags.map((flag) => (
              <div className="msg" key={flag.eventId}>
                {flag.messageEn}
                <span className="ref">{flag.ruleId} · v{flag.ruleVersion}</span>
              </div>
            ))}
          </div>
          <span className="ack">{acknowledgementSummary(today.redFlags)}</span>
        </div>
      )}

      {/* Missing information, said plainly. Amber, never red: an
          unanswered question is a gap, not a warning. */}
      {!today.screening.ran && (
        <div className="rc-gap">
          <b>No screening was done.</b> Nobody asked this patient any questions at the front desk,
          so no red flag rule has been checked for them. Take the history yourself.
        </div>
      )}
      {today.screening.ran && today.screening.incomplete && (
        <div className="rc-gap">
          <b>Screening incomplete.</b> Not answered at the front desk:{' '}
          {today.screening.missingQuestions.map((q) => QUESTION_LABELS[q] ?? q).join(', ')}.
          Red flag rules needing these could not be checked — ask directly.
        </div>
      )}

      {/* 2 - who this is */}
      <div className="rc-id">
        <span className="name">{name}</span>
        {altName !== null && <span className="name-alt">{altName}</span>}
        <span className="facts">
          {patient.ageYears === null ? 'age not recorded' : `${patient.ageYears}${patient.ageIsApproximate ? ' approx' : ''}`}
          {patient.sex !== null && ` · ${patient.sex}`}
          {patient.phone !== null && ` · ${patient.phone}`}
        </span>
        <span className="right">
          <span>serial {today.serialNo} · {today.chamberName}</span>
          <span>{card.attachmentCount} attachment{card.attachmentCount === 1 ? '' : 's'}</span>
          {onRecord !== undefined && <button onClick={onRecord}>Record</button>}
          <button className="secondary" onClick={() => setPatientFacing(true)}>Show the patient</button>
          <button className="secondary" onClick={onClose}>Close</button>
        </span>
      </div>

      <div className="rc-body">
        {/* ---- left: what they said at the desk ---- */}
        <div className="rc-col">
          <div className="panel intake grow">
            <div>
              {today.intake?.confirmedAt != null
                ? <span className="intake-stamp confirmed">
                    Confirmed by {today.intake.confirmedByName ?? 'the doctor'}
                    {' · '}
                    {new Date(today.intake.confirmedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                : <span className="intake-stamp">Reported at front desk — not verified</span>}
            </div>
            <ConsentLine consent={card.consent} />
            <p className="intake-who">
              {today.intake === null
                ? 'No intake was taken.'
                : <>Taken by {today.intake.recordedByName ?? 'unknown'} at{' '}
                   {new Date(today.intake.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                   {today.intake.completedAt === null && ' · not finished'}
                   {today.intake.helperPresent === true && ' · a family member was answering'}</>}
            </p>

            {/* The complaint and the two questions at the bottom are
                pinned outside the scrolling area. An earlier version let
                them scroll, and "what are you most worried about" - the
                question this whole interface exists to ask - ended up
                below the fold where the doctor would never see it. */}
            <div className="q pinned">
              <div className="k">{QUESTION_LABELS['presenting_complaint']}</div>
              <Answer answer={answersByKey.get('presenting_complaint')} correction={correctionsByKey.get('presenting_complaint')} />
            </div>

            <div className="panel-scroll">
              {MIDDLE_QUESTIONS.map((key) => (
                <div className="q" key={key}>
                  <div className="k">{QUESTION_LABELS[key]}</div>
                  <Answer answer={answersByKey.get(key)} correction={correctionsByKey.get(key)} />
                </div>
              ))}
              <div className="q">
                <div className="k">Private history</div>
                <div className="a skipped">
                  Not taken at the front desk — ask directly. These questions cannot be asked
                  aloud within earshot of other patients.
                </div>
              </div>
            </div>

            <div className="q pinned heard">
              <div className="k">{QUESTION_LABELS['most_worried_about']}</div>
              <Answer answer={answersByKey.get('most_worried_about')} correction={correctionsByKey.get('most_worried_about')} />
              <div className="k" style={{ marginTop: 5 }}>{QUESTION_LABELS['hoping_for']}</div>
              <Answer answer={answersByKey.get('hoping_for')} correction={correctionsByKey.get('hoping_for')} />
            </div>

            <IntakeActions
              intake={today.intake}
              role={role}
              busy={busy}
              failure={actionFailure}
              onConfirm={() => { void run(api.intakeConfirm(today.intake!.intakeId)); }}
              onUndo={() => { void run(api.intakeUnconfirm(today.intake!.intakeId)); }}
              onCorrect={() => { setActionFailure(null); setCorrecting(true); }}
            />
          </div>
        </div>

        {/* ---- middle: the record ---- */}
        <div className="rc-col">
          <div className="panel last grow">
            <h3>
              Last visit
              {lastVisit !== null && lastVisit.doctorConfirmedAt === null &&
                <span className="unconfirmed note">never confirmed by the doctor</span>}
            </h3>
            {lastVisit === null ? (
              <p className="muted">First visit — there is nothing before this one.</p>
            ) : (
              <div className="panel-scroll">
                <div className="last-when">{lastVisit.visitDate} · {lastVisit.chamberName}</div>
                <div className="last-row"><span className="k">Complaint</span><span className="v">{lastVisit.chiefComplaint ?? '—'}</span></div>
                <div className="last-row"><span className="k">Diagnosis</span><span className="v dx">{lastVisit.workingDiagnosis ?? '—'}</span></div>
                <div className="last-row"><span className="k">Examination</span><span className="v">{lastVisit.examinationNotes ?? '—'}</span></div>
                <div className="last-row"><span className="k">Decision</span><span className="v">
                  {lastVisit.decisionNotes ?? '—'}
                  {lastVisit.followUpAfterDays !== null && <> · follow up after {lastVisit.followUpAfterDays} days</>}
                </span></div>
                <div className="last-row"><span className="k">Prescribed</span><span className="v">
                  {lastVisit.medications.length === 0 ? '—' : lastVisit.medications.map((m, i) => (
                    <div key={i}>{m.drugName} {m.strength} · {m.dose} · {m.frequency}{m.durationDays !== null && ` · ${m.durationDays} days`}</div>
                  ))}
                </span></div>
                <div className="last-row"><span className="k">Ordered</span><span className="v">
                  {lastVisit.investigationsOrdered.length === 0 ? '—' : lastVisit.investigationsOrdered.join(', ')}
                </span></div>
              </div>
            )}
          </div>

          <div className="panel outstanding">
            <h3>
              Ordered, no result recorded
              <span className="note">{card.outstandingInvestigations.length} outstanding</span>
            </h3>
            <div className="panel-scroll">
              {card.outstandingInvestigations.length === 0
                ? <p className="muted">Nothing outstanding.</p>
                : card.outstandingInvestigations.slice(0, 6).map((investigation, i) => (
                  <div className="osi" key={i}>
                    <span className="t">{investigation.testName}</span>
                    <span className="d">{investigation.daysWaiting} days</span>
                    <span className="c">{investigation.orderedDate}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* ---- right: the numbers ---- */}
        <div className="rc-col">
          <div className="panel">
            <h3>Vitals <span className="note">today and the two before</span></h3>
            <table className="vitals">
              <thead>
                <tr>
                  <th />
                  <th className="num">today</th>
                  <th className="num">{card.previousVitals[0]?.visitDate.slice(5) ?? '—'}</th>
                  <th className="num">{card.previousVitals[1]?.visitDate.slice(5) ?? '—'}</th>
                </tr>
              </thead>
              <tbody>
                {vitalsRow('BP sys', 'mmHg', (v) => v.systolic, today.vitals, card.previousVitals)}
                {vitalsRow('BP dia', 'mmHg', (v) => v.diastolic, today.vitals, card.previousVitals)}
                {vitalsRow('Pulse', '/min', (v) => v.pulse, today.vitals, card.previousVitals)}
                {vitalsRow('Weight', 'kg', (v) => v.weightKg, today.vitals, card.previousVitals, 1)}
                {vitalsRow('Sugar', 'mmol/L', (v) => v.randomBloodSugar, today.vitals, card.previousVitals, 1)}
                {vitalsRow('SpO2', '%', (v) => v.spo2, today.vitals, card.previousVitals)}
                {vitalsRow('Temp', '°C', (v) => v.temperatureC, today.vitals, card.previousVitals, 1)}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <h3>Trend <span className="note">every visit</span></h3>
            <BpSparkline points={card.trend.bp} />
            <ValueSparkline label="Weight" unit="kg" points={card.trend.weight} decimals={1} />
            <ValueSparkline label="Blood sugar" unit="mmol/L" points={card.trend.sugar} decimals={1} />
          </div>

        </div>
      </div>

      {/* 8, 9, 10 - the history, along the bottom. Lowest priority on
          the screen, so it gets the last strip rather than competing
          with the vitals for the right-hand column. */}
      <div className="rc-foot">
        <div className="panel">
          <h3>All visits <span className="note">{card.totalVisits} in total</span></h3>
          <div className="panel-scroll">
            {card.timeline.map((entry, i) => (
              <div className="tl-row" key={i}>
                <span className="d">{entry.visitDate}</span>
                <span className="c">{entry.chamberName}</span>
                <span className="x">{entry.complaint ?? '—'}</span>
                <span className="y">{entry.diagnosis ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h3>Recurring <span className="note">grouped by exact wording</span></h3>
          <div className="panel-scroll">
            {card.recurringDiagnoses.length === 0
              ? <p className="muted">No diagnoses recorded yet.</p>
              : card.recurringDiagnoses.map((diagnosis, i) => (
                <div className="dx-line" key={i}>
                  <span className="n">{diagnosis.count}×</span>
                  <span>{diagnosis.text}</span>
                </div>
              ))}
          </div>
        </div>

        <div className="panel">
          <h3>Current medicines <span className="note">{card.currentMedicationsFrom ?? 'none recorded'}</span></h3>
          <div className="panel-scroll">
            {card.currentMedications.length === 0
              ? <p className="muted">Nothing recorded.</p>
              : card.currentMedications.map((medication, i) => (
                <div className="med-line" key={i}>
                  <b>{medication.drugName}</b> {medication.strength} <span>{medication.dose} · {medication.frequency}</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {correcting && today.intake !== null && (
        <CorrectSheet
          intake={today.intake}
          onClose={() => setCorrecting(false)}
          onSaved={onReload}
        />
      )}
    </div>
  );
}
