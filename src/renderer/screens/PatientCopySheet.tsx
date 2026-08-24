import { useEffect, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import { KIND_LABEL, type AttachmentKind } from '../../shared/attachments';
import type { PatientCopy } from '../../shared/patientCopy';

/**
 * The copy a patient is entitled to ask for.
 *
 * The consent wording promises it in as many words — "you can ask for
 * a copy of your information at any time" — and the Personal Data
 * Protection Act requires it. A promise that takes ten minutes at a
 * busy desk is a promise that will not be kept, so this is one screen
 * and one button.
 *
 * The printed sheet is a summary. What it deliberately leaves out is
 * the front desk screening warnings: a warning is an instruction to an
 * assistant to fetch the doctor sooner, and printing it for the
 * patient turns it into a statement about how ill they are, which this
 * software does not make. Nothing is hidden by that — the sheet says
 * that a complete copy can be given as a file, and the file has
 * everything.
 */

const QUESTION_LABELS: Record<string, string> = {
  presenting_complaint: 'In their own words',
  body_region: 'Where',
  duration: 'How long',
  severity: 'How bad',
  medicines_already_taken: 'Already taken',
  known_conditions: 'Known conditions',
  allergies: 'Allergies',
  most_worried_about: 'Most worried about',
  hoping_for: 'Hoping for',
};

export function PatientCopySheet(
  { patientId, onClose }: { patientId: string; onClose: () => void },
) {
  const [copy, setCopy] = useState<PatientCopy | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const { value, failure } = unwrap(await api.patientCopyView(patientId));
      if (failure) { setFailure(failure); return; }
      setCopy(value!.copy);
    })();
  }, [patientId]);

  async function print() {
    window.print();
    const { failure } = unwrap(await api.patientCopyPrinted(patientId));
    if (failure) { setFailure(failure); return; }
    setNote('The printed copy has been recorded.');
  }

  async function toFile() {
    setBusy(true);
    const { value, failure } = unwrap(await api.patientCopyToFile(patientId));
    setBusy(false);
    if (failure) { setFailure(failure); return; }
    if (value!.folder === null) return;
    setNote(`Written to ${value!.folder} — ${value!.papers} photograph${value!.papers === 1 ? '' : 's'} included.`);
  }

  if (failure !== null && copy === null) {
    return <div className="page"><FailureNotice failure={failure} /><button onClick={onClose}>Go back</button></div>;
  }
  if (copy === null) return <div className="page"><p className="muted">Getting the record together…</p></div>;

  const name = copy.patient.nameBn ?? copy.patient.nameEn ?? 'unnamed';
  const alt = copy.patient.nameBn !== null && copy.patient.nameEn !== null ? copy.patient.nameEn : null;

  return (
    <div className="rx-screen">
      <style>{'@page { size: A4; margin: 14mm; }'}</style>

      <div className="rx-bar no-print">
        <span className="what">A copy of the record for {name}</span>
        {note !== null && <span className="ok">{note}</span>}
        <span className="spacer" />
        <button onClick={() => { void print(); }}>Print the summary</button>
        <button className="secondary" disabled={busy} onClick={() => { void toFile(); }}>
          Everything, as a file
        </button>
        <button className="secondary" onClick={onClose}>Close</button>
      </div>

      {failure !== null && <div className="no-print"><FailureNotice failure={failure} /></div>}

      <div className="sheet a4">
        <div className="pc-head">
          <div>
            <div className="t">A copy of your record</div>
            <div className="s">আপনার তথ্যের কপি</div>
          </div>
          <div className="when">Made on {copy.madeAt.slice(0, 10)}</div>
        </div>

        <div className="pc-who">
          <span className="n">{name}{alt !== null && <span className="alt"> · {alt}</span>}</span>
          <span>
            {copy.patient.ageYears === null ? 'age not recorded' : `${copy.patient.ageYears} yrs${copy.patient.ageIsApproximate ? ' (approx)' : ''}`}
            {copy.patient.sex !== null && ` · ${copy.patient.sex}`}
            {copy.patient.phone !== null && ` · ${copy.patient.phone}`}
          </span>
          <span className="dim">First seen here {copy.patient.firstKnownHere} · {copy.visits.length} visit{copy.visits.length === 1 ? '' : 's'}</span>
        </div>

        {copy.visits.length === 0 && <p className="pc-none">There are no visits recorded.</p>}

        {copy.visits.map((visit, i) => (
          <div className="pc-visit" key={i}>
            <div className="pc-when">
              {visit.visitDate} · {visit.chamberName} · serial {visit.serialNo}
              {!visit.confirmedByDoctor && visit.diagnosis !== null && (
                <span className="dim"> · not confirmed by the doctor</span>
              )}
            </div>

            {visit.whatTheyTold.filter((a) => !a.skipped && (a.freeText ?? a.value) !== null).length > 0 && (
              <div className="pc-block">
                <div className="k">What you told the front desk</div>
                {visit.whatTheyTold.filter((a) => !a.skipped && (a.freeText ?? a.value) !== null).map((a, j) => (
                  <div className="pc-line" key={j}>
                    <span className="q">{QUESTION_LABELS[a.questionKey] ?? a.questionKey}</span>
                    <span>{a.freeText ?? a.value}</span>
                  </div>
                ))}
              </div>
            )}

            {visit.vitals !== null && (
              <div className="pc-block">
                <div className="k">Measured</div>
                <div className="pc-vitals">
                  {[
                    visit.vitals.systolic !== null && visit.vitals.diastolic !== null
                      ? `BP ${visit.vitals.systolic}/${visit.vitals.diastolic}` : null,
                    visit.vitals.pulse !== null ? `Pulse ${visit.vitals.pulse}` : null,
                    visit.vitals.temperatureC !== null ? `Temp ${visit.vitals.temperatureC.toFixed(1)}°C` : null,
                    visit.vitals.weightKg !== null ? `Weight ${visit.vitals.weightKg} kg` : null,
                    visit.vitals.randomBloodSugar !== null ? `Blood sugar ${visit.vitals.randomBloodSugar} mmol/L` : null,
                    visit.vitals.spo2 !== null ? `SpO₂ ${visit.vitals.spo2}%` : null,
                  ].filter((part) => part !== null).join('  ·  ')}
                </div>
              </div>
            )}

            {(visit.complaint ?? visit.diagnosis ?? visit.decision) !== null && (
              <div className="pc-block">
                <div className="k">What the doctor recorded</div>
                {visit.complaint !== null && <div className="pc-line"><span className="q">Complaint</span><span>{visit.complaint}</span></div>}
                {visit.diagnosis !== null && <div className="pc-line"><span className="q">Diagnosis</span><span>{visit.diagnosis}</span></div>}
                {visit.decision !== null && <div className="pc-line"><span className="q">Advice</span><span>{visit.decision}</span></div>}
                {visit.followUpAfterDays !== null && (
                  <div className="pc-line"><span className="q">Follow up</span><span>after {visit.followUpAfterDays} days</span></div>
                )}
              </div>
            )}

            {visit.medications.length > 0 && (
              <div className="pc-block">
                <div className="k">Prescribed</div>
                {visit.medications.map((m, j) => (
                  <div className="pc-med" key={j}>
                    <b>{m.drugName}</b>{m.strength !== null && ` ${m.strength}`}
                    {' — '}
                    {[m.dose, m.frequency, m.durationDays === null ? null : `${m.durationDays} days`]
                      .filter((part) => part !== null && part !== '').join(' · ')}
                    {m.instructions !== null && <span className="dim"> · {m.instructions}</span>}
                  </div>
                ))}
              </div>
            )}

            {visit.investigations.length > 0 && (
              <div className="pc-block">
                <div className="k">Tests</div>
                {visit.investigations.map((t, j) => (
                  <div className="pc-line" key={j}>
                    <span className="q">{t.testName}</span>
                    <span>
                      ordered {t.orderedDate}
                      {t.resultDate !== null ? ` · result recorded ${t.resultDate}` : ' · no result recorded here'}
                      {t.resultSummary !== null && ` · ${t.resultSummary}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {copy.papers.length > 0 && (
          <div className="pc-visit">
            <div className="pc-when">Papers you brought in, photographed here</div>
            {copy.papers.map((paper, i) => (
              <div className="pc-line" key={i}>
                <span className="q">{KIND_LABEL[paper.kind as AttachmentKind]?.en ?? paper.kind}</span>
                <span>
                  {paper.documentDate ?? paper.photographedAt.slice(0, 10)}
                  {paper.caption !== null && ` · ${paper.caption}`}
                </span>
              </div>
            ))}
          </div>
        )}

        {copy.permissions.length > 0 && (
          <div className="pc-visit">
            <div className="pc-when">What you agreed to</div>
            {copy.permissions.map((permission, i) => (
              <div className="pc-line" key={i}>
                <span className="q">{permission.kind === 'research' ? 'Research use' : 'Keeping a history'}</span>
                <span>{permission.decision} on {permission.decidedAt.slice(0, 10)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="pc-foot">
          This is a summary of what is held about you here. A complete copy, including everything
          recorded at the front desk, can be given to you as a file on request — ask at the desk.
          <div className="bn">
            এটি আপনার তথ্যের সংক্ষিপ্ত কপি। চাইলে সম্পূর্ণ কপি ফাইল আকারেও দেওয়া যাবে — অভ্যর্থনায় বলুন।
          </div>
        </div>
      </div>
    </div>
  );
}
