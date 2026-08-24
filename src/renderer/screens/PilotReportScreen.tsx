import { useEffect, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import type { PilotReport } from '../../shared/pilot';

/**
 * The report the decision is made from.
 *
 * It counts and it does not conclude. There is no score anywhere on
 * it, no verdict, and nothing that argues for the software's own
 * continuation — the last section is a list of questions, because the
 * answers are a clinical and practical judgement that belongs to the
 * doctor.
 *
 * Two rules run through the layout. Every number carries its
 * denominator, and below twenty there is no percentage at all: "4 of
 * 7" is honest where "57%" is arithmetic pretending to be evidence.
 * And what did not work is a section near the top rather than a
 * footnote, because a report carrying only good news is a report
 * nobody should act on.
 */

const TOO_FEW = 20;

function share(n: number, of: number): string {
  if (of === 0) return 'none yet';
  if (of < TOO_FEW) return `${n} of ${of}`;
  return `${Math.round((n / of) * 100)}%  (${n} of ${of})`;
}

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="pr-row">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      {note !== undefined && <span className="n">{note}</span>}
    </div>
  );
}

export function PilotReportScreen({ onClose }: { onClose: () => void }) {
  const [report, setReport] = useState<PilotReport | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { value, failure } = unwrap(await api.pilotReport());
      if (failure) { setFailure(failure); return; }
      setReport(value!.report);
    })();
  }, []);

  async function exportForResearch() {
    setBusy(true);
    const { value, failure } = unwrap(await api.researchExport());
    setBusy(false);
    if (failure) { setFailure(failure); return; }
    if (value!.folder === null) return;
    setNote(`${value!.rows} visits from ${value!.patients} patients who agreed to it, written to ${value!.folder}. `
      + `${value!.excluded} patients are not in it.`);
  }

  if (failure !== null && report === null) {
    return <div className="page"><FailureNotice failure={failure} /><button onClick={onClose}>Go back</button></div>;
  }
  if (report === null) return <div className="page"><p className="muted">Counting…</p></div>;

  const period = report.firstDay === null
    ? 'Nothing has been recorded yet.'
    : `${report.firstDay} to ${report.lastDay}`;

  return (
    <div className="rx-screen">
      <style>{'@page { size: A4; margin: 14mm; }'}</style>

      <div className="rx-bar no-print">
        <span className="what">Pilot report</span>
        {note !== null && <span className="ok">{note}</span>}
        <span className="spacer" />
        <button onClick={() => window.print()}>Print</button>
        <button className="secondary" disabled={busy} onClick={() => { void exportForResearch(); }}>
          Export for research
        </button>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>

      {failure !== null && <div className="no-print"><FailureNotice failure={failure} /></div>}

      <div className="sheet a4">
        <div className="pc-head">
          <div>
            <div className="t">Chamber Recall — pilot report</div>
            <div className="s">{period} · {report.eveningsHeld} chamber evenings · {report.chambers.join(', ')}</div>
          </div>
          <div className="when">Made on {report.madeAt.slice(0, 10)}</div>
        </div>

        {report.dataMode === 'demo' && (
          <div className="pr-demo">
            These are invented patients in the practice database. Nothing on this page is about a
            real person.
          </div>
        )}

        <p className="pr-lede">
          This page counts what was done. It does not say whether it worked: that is a judgement
          about patients and about a chamber, and it belongs to the doctor. Where there are fewer
          than {TOO_FEW} of something, the count is given as "4 of 7" rather than as a percentage,
          because a percentage of seven is arithmetic pretending to be evidence.
        </p>

        {/* The failures first, deliberately. */}
        <div className="pr-block gaps">
          <h3>What did not work</h3>
          {report.gaps.length === 0
            ? <p className="pr-none">Nothing in this list — which for a real chamber usually means it is too early rather than that everything went well.</p>
            : report.gaps.map((gap, i) => (
              <div className="pr-gap" key={i}>
                <div className="head"><b>{gap.count}</b> {gap.what}</div>
                <div className="why">{gap.why}</div>
              </div>
            ))}
        </div>

        <div className="pr-block">
          <h3>The safety layer</h3>
          <Row k="Warnings raised by the questions" v={String(report.safety.flagsFired)}
            note={`on ${report.safety.visitsFlagged} visit${report.safety.visitsFlagged === 1 ? '' : 's'}`} />
          <Row k="Acknowledged at the front desk"
            v={share(report.safety.acknowledgedAtTheDesk, report.safety.flagsFired)} />
          <Row k="Times somebody was moved up the queue" v={String(report.safety.movedUpTheQueue)} />
          <Row k="Screenings a rule could not be checked on" v={String(report.safety.screeningIncomplete)}
            note="a question was skipped that a rule needed" />
          <Row k="Flagged patients who left without being seen"
            v={String(report.safety.flaggedLeftUnseen)}
            note="the number to look at first" />
        </div>

        <div className="pr-block">
          <h3>Who was seen</h3>
          <Row k="Patients" v={String(report.patientsSeen)} />
          <Row k="Visits" v={String(report.visits)} />
          <Row k="Visits by somebody who had been before" v={share(report.returningVisits, report.visits)} />
          <Row k="Patients with two or more visits" v={String(report.record.patientsWithTwoOrMoreVisits)}
            note="the ones a recall card is for" />
          <Row k="Waiting time, middle of the range"
            v={report.waiting.medianMinutes === null ? 'not enough to say' : `${report.waiting.medianMinutes} minutes`}
            note={report.waiting.counted === 0 ? undefined
              : `longest ${report.waiting.longestMinutes} · from ${report.waiting.counted} visits`} />
        </div>

        <div className="pr-block">
          <h3>The questions at the front desk</h3>
          <Row k="Arrivals who were asked anything at all"
            v={share(report.screening.intakesStarted, report.screening.arrivals)} />
          <Row k="Intakes finished rather than abandoned"
            v={share(report.screening.intakesFinished, report.screening.intakesStarted)} />

          {report.screening.perPerson.length > 0 && (
            <table className="pr-table">
              <thead>
                <tr><th>Who</th><th className="num">started</th><th className="num">finished</th>
                  <th className="num">questions skipped</th><th className="num">minutes each</th></tr>
              </thead>
              <tbody>
                {report.screening.perPerson.map((person) => (
                  <tr key={person.userId}>
                    <td>{person.name}</td>
                    <td className="num">{person.intakesStarted}</td>
                    <td className="num">{person.intakesFinished}</td>
                    <td className="num">{share(person.questionsSkipped, person.questionsAsked)}</td>
                    <td className="num">{person.medianMinutes === null ? '—' : person.medianMinutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="pr-note">
            Broken out per person on purpose. An average across two assistants hides the difference
            worth seeing: one who asks every question and one who skips half of them look identical
            when they are added together.
          </p>
        </div>

        <div className="pr-block">
          <h3>What is now in the record</h3>
          <Row k="Consultations written" v={String(report.record.encountersWritten)} />
          <Row k="Consultations the doctor confirmed"
            v={share(report.record.encountersConfirmed, report.record.encountersWritten)} />
          <Row k="Front desk histories the doctor confirmed"
            v={share(report.record.intakesConfirmedByDoctor, report.screening.intakesStarted)} />
          <Row k="Answers the doctor corrected" v={String(report.record.answersCorrectedByDoctor)}
            note="a lot of these means the questions need changing" />
          <Row k="Prescriptions printed" v={String(report.record.prescriptionsPrinted)}
            note={report.record.prescriptionsReprinted > 0
              ? `${report.record.prescriptionsReprinted} reprinted` : undefined} />
          <Row k="Papers photographed" v={String(report.record.papersPhotographed)} />
        </div>

        <div className="pr-block">
          <h3>Permission</h3>
          <Row k="Patients asked" v={String(report.consent.asked)} />
          <Row k="Agreed to a history being kept" v={String(report.consent.given)} />
          <Row k="Said no" v={String(report.consent.declined)} />
          <Row k="Withdrew afterwards" v={String(report.consent.withdrawn)} />
          <Row k="Also agreed to research use" v={String(report.consent.researchGiven)} />
          <Row k="Never asked" v={String(report.consent.neverAsked)}
            note={report.consent.neverAsked > 0 ? 'these need putting right' : undefined} />
        </div>

        <div className="pr-block">
          <h3>Backups</h3>
          <Row k="Backups taken" v={String(report.backups.taken)} />
          <Row k="Longest gap between them"
            v={report.backups.longestGapDays === null ? 'only one, or none' : `${report.backups.longestGapDays} days`} />
          <Row k="Days since the last one"
            v={report.backups.daysSinceLast === null ? 'never backed up' : String(report.backups.daysSinceLast)} />
        </div>

        <div className="pr-block questions">
          <h3>The questions this page cannot answer</h3>
          <ol>
            <li>Did the card change what you did for anybody? Which patient, and how?</li>
            <li>Did a warning from the front desk ever bring somebody in sooner than they would have been?</li>
            <li>Did a warning ever fire for something that did not matter, often enough to be ignored?</li>
            <li>Is the front desk slower than the paper book was, and by how much?</li>
            <li>Would you have missed anything if the laptop had not been there that evening?</li>
            <li>What did you want to look up and could not find?</li>
          </ol>
          <p className="pr-note">
            These are the ones worth writing an answer to before deciding anything. The counts above
            cannot reach them, and a piece of software should not pretend that it can.
          </p>
        </div>
      </div>
    </div>
  );
}
