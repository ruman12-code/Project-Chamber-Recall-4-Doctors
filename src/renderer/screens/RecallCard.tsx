import { useState } from 'react';
import { BpSparkline, ValueSparkline } from './Sparkline';
import { PatientView } from './PatientView';
import type { RecallCard as Card, VitalsReading, IntakeAnswerView } from '../../shared/recall';

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

function Answer({ answer }: { answer: IntakeAnswerView | undefined }) {
  if (answer === undefined) return <div className="a skipped">not asked</div>;
  if (answer.skipped) return <div className="a skipped">skipped</div>;
  const text = answer.freeText ?? answer.value;
  if (text === null || text.trim() === '') return <div className="a skipped">left blank</div>;
  const isQuote = answer.freeText !== null;
  return <div className={isQuote ? 'a quote' : 'a'}>{text}</div>;
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

export function RecallCardScreen({ card, onClose }: { card: Card; onClose: () => void }) {
  const [patientFacing, setPatientFacing] = useState(false);
  if (patientFacing) return <PatientView card={card} onClose={() => setPatientFacing(false)} />;

  const { patient, today, lastVisit } = card;
  const answersByKey = new Map((today.intake?.answers ?? []).map((a) => [a.questionKey, a]));
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
          <button className="secondary" onClick={() => setPatientFacing(true)}>Show the patient</button>
          <button className="secondary" onClick={onClose}>Close</button>
        </span>
      </div>

      <div className="rc-body">
        {/* ---- left: what they said at the desk ---- */}
        <div className="rc-col">
          <div className="panel intake grow">
            <div>
              <span className="intake-stamp">Reported at front desk — not verified</span>
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
              <Answer answer={answersByKey.get('presenting_complaint')} />
            </div>

            <div className="panel-scroll">
              {MIDDLE_QUESTIONS.map((key) => (
                <div className="q" key={key}>
                  <div className="k">{QUESTION_LABELS[key]}</div>
                  <Answer answer={answersByKey.get(key)} />
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
              <Answer answer={answersByKey.get('most_worried_about')} />
              <div className="k" style={{ marginTop: 5 }}>{QUESTION_LABELS['hoping_for']}</div>
              <Answer answer={answersByKey.get('hoping_for')} />
            </div>

            <div className="rc-actions">
              <button disabled>Confirm</button>
              <button className="secondary" disabled>Correct</button>
              <div className="mock-note">Wired at milestone 8. Until confirmed, none of this is part of the record.</div>
            </div>
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
    </div>
  );
}
