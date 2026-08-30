import { useEffect, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import type { PrescriptionView, PrescriptionStatus } from '../../shared/prescription';

/**
 * The prescription, as paper.
 *
 * This is the only part of the whole system that leaves the chamber.
 * It may be read tonight by a pharmacist, next year by another doctor,
 * or in an emergency by a hospital, and none of them will have this
 * software or any way to ask it a question. So the sheet has to stand
 * completely on its own: who prescribed, their registration number,
 * which chamber, which patient, what day, and what was actually
 * prescribed.
 *
 * Every word on it was typed by a person. Nothing here suggests,
 * completes, calculates or checks anything.
 *
 * What is on screen is the sheet itself, at the real paper size, so
 * what the doctor sees before pressing Print is what comes out.
 */
export function PrescriptionSheet(
  { visitId, onClose }: { visitId: string; onClose: () => void },
) {
  const [view, setView] = useState<PrescriptionView | null>(null);
  const [status, setStatus] = useState<PrescriptionStatus | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [printedJustNow, setPrintedJustNow] = useState(false);

  useEffect(() => {
    void (async () => {
      const both = await Promise.all([api.prescriptionView(visitId), api.prescriptionStatus()]);
      const sheet = unwrap(both[0]);
      const state = unwrap(both[1]);
      if (state.failure) { setFailure(state.failure); return; }
      setStatus(state.value!.status);
      if (sheet.failure) { setFailure(sheet.failure); return; }
      setView(sheet.value!.view);
    })();
  }, [visitId]);

  async function print() {
    window.print();
    // Recorded after the dialog closes. A cancelled dialog is
    // indistinguishable from a printed page in a browser, so this
    // counts "the doctor pressed Print" rather than "paper came out" -
    // and the audit entry says so rather than claiming more.
    const { failure } = unwrap(await api.prescriptionPrinted(visitId));
    if (failure) { setFailure(failure); return; }
    setPrintedJustNow(true);
    const again = unwrap(await api.prescriptionView(visitId));
    if (again.value?.view !== undefined) setView(again.value.view);
  }

  if (failure !== null) {
    return (
      <div className="page no-print">
        <FailureNotice failure={failure} />
        <button onClick={onClose}>Go back</button>
      </div>
    );
  }
  if (view === null || status === null) return <div className="page"><p className="muted">Getting the sheet ready…</p></div>;

  // A letterhead that still says PLACEHOLDER must never be handed to a
  // real patient. In the practice database it prints anyway, stamped,
  // so the layout can be looked at and shown to people.
  const unfilled = status.blocksLiveUse.length > 0;
  if (unfilled && !status.demo) {
    return (
      <div className="page no-print">
        <FailureNotice failure={{
          userMessage: 'The letterhead has not been filled in, so nothing can be printed for a real patient.',
          whatToDo: `${status.blocksLiveUse.map((b) => b.reason).join(' ')} Open ${status.path}, replace every PLACEHOLDER with the real wording, save the file and press Print again. Nothing needs restarting.`,
          technical: `prescription.yaml at ${status.path} still contains placeholders`,
        }} />
        <button onClick={onClose}>Go back</button>
      </div>
    );
  }

  const { letterhead: head, patient } = view;
  const name = patient.nameBn ?? patient.nameEn ?? 'unnamed';
  const altName = patient.nameBn !== null && patient.nameEn !== null ? patient.nameEn : null;

  return (
    <div className="rx-screen">
      {/* The paper size comes from the letterhead file, so a chamber
          using A4 pads gets A4 without anybody changing the software. */}
      <style>{`@page { size: ${head.paper}; margin: 10mm; }`}</style>

      <div className="rx-bar no-print">
        <span className="what">
          Prescription for {name} · serial {view.serialNo} · {view.visitDate}
        </span>
        {view.timesPrinted > 0 && (
          <span className="reprint">
            printed {view.timesPrinted} time{view.timesPrinted === 1 ? '' : 's'} already
          </span>
        )}
        {printedJustNow && <span className="ok">recorded</span>}
        <span className="spacer" />
        <button onClick={() => { void print(); }}>Print</button>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>

      {unfilled && status.demo && (
        <div className="rx-bar warn no-print">
          The letterhead is still the template — this is a practice sheet and every line marked
          PLACEHOLDER has to be replaced before a real patient is given one.
        </div>
      )}
      {!head.addressKnown && (
        <div className="rx-bar warn no-print">
          The letterhead file has no address for "{head.chamberName}". The sheet will print without
          one. Add a chambers entry with that exact name.
        </div>
      )}

      <div className={`sheet ${head.paper.toLowerCase()}`}>
        {unfilled && status.demo && <div className="rx-stamp">PRACTICE — NOT A REAL PRESCRIPTION</div>}

        <div className="rx-head">
          <div className="who">
            <div className="dn-bn">{head.doctorNameBn}</div>
            <div className="dn-en">{head.doctorNameEn}</div>
            <div className="q">{head.qualifications}</div>
            {head.designation !== '' && <div className="q">{head.designation}</div>}
            <div className="reg">{head.registration}</div>
          </div>
          <div className="where">
            <div className="cn">{head.chamberName}</div>
            {head.addressBn !== '' && <div>{head.addressBn}</div>}
            {head.addressEn !== '' && <div>{head.addressEn}</div>}
            {head.phone !== '' && <div>{head.phone}</div>}
            {head.hoursBn !== '' && <div>{head.hoursBn}</div>}
          </div>
        </div>

        <div className="rx-patient">
          <span className="n">{name}{altName !== null && <span className="alt"> · {altName}</span>}</span>
          <span className="f">
            {patient.ageYears === null ? 'age not recorded' : `${patient.ageYears} yrs${patient.ageIsApproximate ? ' (approx)' : ''}`}
            {patient.sex !== null && ` · ${patient.sex}`}
          </span>
          <span className="d">{view.visitDate} · serial {view.serialNo}</span>
        </div>

        {view.vitalsLine !== '' && <div className="rx-vitals">{view.vitalsLine}</div>}
        {view.diagnosis !== null && view.diagnosis !== '' && (
          <div className="rx-dx"><span className="k">Dx</span> {view.diagnosis}</div>
        )}

        <div className="rx-body">
          {/* Written out rather than the ℞ character, which lands on
              whatever glyph the printer's font happens to have. */}
          <div className="rx-sign">Rx</div>
          <div className="rx-lines">
            {view.medications.length === 0
              ? <div className="none">No medicine prescribed.</div>
              : view.medications.map((m, i) => (
                <div className="line" key={i}>
                  <span className="no">{i + 1}.</span>
                  <span className="text">
                    <b>{m.drugName}</b>{m.strength !== null && ` ${m.strength}`}
                    <div className="how">
                      {[m.dose, m.frequency, m.durationDays === null ? null : `${m.durationDays} days`]
                        .filter((part) => part !== null && part !== '').join('  ·  ')}
                      {m.instructions !== null && m.instructions !== '' && <div className="ins">{m.instructions}</div>}
                    </div>
                  </span>
                </div>
              ))}
          </div>
        </div>

        {view.investigations.length > 0 && (
          <div className="rx-block">
            <div className="k">Investigations</div>
            <ol>{view.investigations.map((t, i) => <li key={i}>{t}</li>)}</ol>
          </div>
        )}

        {view.advice !== null && view.advice !== '' && (
          <div className="rx-block">
            <div className="k">Advice</div>
            <div className="advice">{view.advice}</div>
          </div>
        )}

        {view.followUpAfterDays !== null && (
          <div className="rx-followup">
            Next visit after {view.followUpAfterDays} days
            {view.followUpDate !== null && <> — on or after <b>{view.followUpDate}</b></>}
          </div>
        )}

        <div className="rx-foot">
          <div className="note">
            {head.footerBn !== '' && <div>{head.footerBn}</div>}
            {head.footerEn !== '' && <div>{head.footerEn}</div>}
          </div>
          <div className="sig">
            <div className="line" />
            <div className="nm">{head.doctorNameEn}</div>
            <div className="rg">{head.registration}</div>
          </div>
        </div>
        {/* WHAT THIS PATIENT WAS ON BEFORE.
            Below the signature, inside its own box, headed so that it
            cannot be read as part of today's prescription. It is here
            for the doctor at the next hospital, who has this sheet and
            nothing else and whose first question is what the patient
            has been taking. Every word of it was typed by the doctor
            who wrote it, at the time he wrote it. */}
        {view.previousVisits.length > 0 && (
          <div className="rx-history">
            {/* The patient's name and today's date again. This block
                can fall onto a second sheet of paper, and a loose page
                of medicine names with no patient on it is worse than
                no page at all. */}
            <div className="hh">
              For information only — not to be dispensed
              <span>
                {view.patient.nameBn ?? view.patient.nameEn} · {view.visitDate} · serial {view.serialNo}
              </span>
            </div>
            <div className="hs">
              What this patient was prescribed at their last
              {view.previousVisits.length === 1 ? ' visit' : ' two visits'}, by the doctor above.
              Not part of today’s prescription.
            </div>
            {view.previousVisits.map((pv, i) => (
              <div className="pv" key={i}>
                <div className="pvd">{pv.visitDate} · {pv.chamberName}</div>
                {pv.medications.length === 0
                  ? <div className="pvn">No medicine was prescribed.</div>
                  : (
                    <ol className="pvm">
                      {pv.medications.map((m, j) => (
                        <li key={j}>
                          <b>{m.drugName}</b>{m.strength !== null && ` ${m.strength}`}
                          {[m.dose, m.frequency, m.durationDays === null ? null : `${m.durationDays} days`]
                            .filter((part) => part !== null && part !== '').length > 0 && ' — '}
                          {[m.dose, m.frequency, m.durationDays === null ? null : `${m.durationDays} days`]
                            .filter((part) => part !== null && part !== '').join('  ·  ')}
                        </li>
                      ))}
                    </ol>
                  )}
                {pv.investigations.length > 0 && (
                  <div className="pvi"><span className="k">Tests</span> {pv.investigations.join(' · ')}</div>
                )}
                {pv.advice !== null && pv.advice !== '' && (
                  <div className="pva"><span className="k">Advice</span> {pv.advice}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
