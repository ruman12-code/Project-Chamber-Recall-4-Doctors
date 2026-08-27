import { useCallback, useEffect, useRef, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import { readTemperature, type TemperatureUnit } from '../../main/vitals/temperature';
import type {
  ChamberView, EncounterDraft, MedicationInput, VitalsInput, VitalsQuestion,
} from '../../shared/clinical';
import type { Role } from '../../shared/roles';

/**
 * The consultation screen.
 *
 * The doctor is looking at a patient, not at a laptop. So: everything
 * on one screen with no tabs, no dialogs in the way, nothing that has
 * to be opened before it can be typed into, and every box saving
 * itself a second after he stops typing. A power cut in the middle of
 * a consultation loses the last sentence at worst.
 *
 * WHAT IS NOT HERE, AND WILL NOT BE:
 *
 *   No list of drugs to pick from. No dose calculator. No interaction
 *   check. No suggested diagnosis, no autocomplete on the diagnosis
 *   box, no ranking of anything. Every word in the record is typed by
 *   a person, and this software does not contribute to a clinical
 *   judgement in any way at all.
 *
 * The one thing it does do is show what was written LAST time, because
 * "continue the same medicine" is the commonest sentence in a chamber
 * and retyping a dose from memory is how a dose changes by accident.
 */

const AUTOSAVE_MS = 1200;

type Draft = EncounterDraft;

function numberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function ChamberScreen(
  { view, role, onClose, onOpenCard, onReload, onPrint, onPapers, onFinished }: {
    view: ChamberView; role: Role; onClose: () => void;
    /**
     * The doctor is done with this patient.
     *
     * The same thing as pressing Seen on today's list, offered where he
     * actually is when he finishes: at the bottom of the consultation,
     * not back on a list he has to return to first. It ends the visit,
     * which empties the room, which is what makes the tablet put the
     * next serial on its screen.
     */
    onFinished: () => void;
    onOpenCard: () => void; onReload: () => Promise<void>;
    /** The printed prescription. Only once the consultation is signed. */
    onPrint: () => void;
    /** The papers the patient brought. */
    onPapers: () => void;
  },
) {
  const [failure, setFailure] = useState<Failure | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [questions, setQuestions] = useState<VitalsQuestion[]>([]);
  const confirmed = view.encounter.confirmedAt !== null;

  // ---- what is being typed ----
  const [draft, setDraft] = useState<Draft>({
    chiefComplaint: view.encounter.chiefComplaint,
    examinationNotes: view.encounter.examinationNotes,
    workingDiagnosis: view.encounter.workingDiagnosis,
    decisionNotes: view.encounter.decisionNotes,
    followUpAfterDays: view.encounter.followUpAfterDays,
  });
  const [vitals, setVitals] = useState<Record<string, string>>(() => ({
    systolic: view.vitals.systolic?.toString() ?? '',
    diastolic: view.vitals.diastolic?.toString() ?? '',
    pulse: view.vitals.pulse?.toString() ?? '',
    temperature: view.vitals.temperatureC?.toString() ?? '',
    weightKg: view.vitals.weightKg?.toString() ?? '',
    heightCm: view.vitals.heightCm?.toString() ?? '',
    randomBloodSugar: view.vitals.randomBloodSugar?.toString() ?? '',
    spo2: view.vitals.spo2?.toString() ?? '',
    notes: view.vitals.notes ?? '',
  }));
  const [unit, setUnit] = useState<TemperatureUnit>('C');
  const [medications, setMedications] = useState<MedicationInput[]>(view.encounter.medications);
  const [tests, setTests] = useState(view.encounter.investigations.join('\n'));

  const encounterId = view.encounter.id;
  const visitId = view.visitId;

  // ---- saving ----
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const vitalsInput = useCallback((): VitalsInput => {
    const typed = numberOrNull(vitals.temperature ?? '');
    return {
      systolic: numberOrNull(vitals.systolic ?? ''),
      diastolic: numberOrNull(vitals.diastolic ?? ''),
      pulse: numberOrNull(vitals.pulse ?? ''),
      temperature: typed === null ? null : { typed, unit },
      weightKg: numberOrNull(vitals.weightKg ?? ''),
      heightCm: numberOrNull(vitals.heightCm ?? ''),
      randomBloodSugar: numberOrNull(vitals.randomBloodSugar ?? ''),
      spo2: numberOrNull(vitals.spo2 ?? ''),
      notes: vitals.notes ?? null,
    };
  }, [vitals, unit]);

  const saveNow = useCallback(async () => {
    if (confirmed) return;
    setSaving(true);
    const draftResult = unwrap(await api.encounterSaveDraft(encounterId, draft));
    if (draftResult.failure !== null) { setFailure(draftResult.failure); setSaving(false); return; }
    const vitalsResult = unwrap(await api.vitalsSave(visitId, vitalsInput()));
    if (vitalsResult.failure !== null) { setFailure(vitalsResult.failure); setSaving(false); return; }
    setQuestions(vitalsResult.value!.questions);
    setFailure(null);
    setSavedAt(new Date().toISOString());
    setSaving(false);
    pending.current = false;
  }, [confirmed, encounterId, visitId, draft, vitalsInput]);

  // Autosave. Nothing here is a "Save" button the doctor has to
  // remember: the record is written while he types, because the thing
  // being defended against is a power cut, not a change of mind.
  useEffect(() => {
    if (confirmed || !pending.current) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void saveNow(); }, AUTOSAVE_MS);
    return () => { if (timer.current !== null) clearTimeout(timer.current); };
  }, [draft, vitals, unit, confirmed, saveNow]);

  const edit = (patch: Partial<Draft>) => { pending.current = true; setDraft({ ...draft, ...patch }); };
  const editVital = (field: string, value: string) => {
    pending.current = true;
    setVitals({ ...vitals, [field]: value });
  };

  async function saveMedications(lines: MedicationInput[]) {
    setMedications(lines);
    const { failure } = unwrap(await api.encounterMedications(encounterId, lines));
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    setSavedAt(new Date().toISOString());
  }

  async function saveTests(value: string) {
    const names = value.split('\n').map((n) => n.trim()).filter((n) => n !== '');
    const { failure } = unwrap(await api.encounterInvestigations(encounterId, names));
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    setSavedAt(new Date().toISOString());
  }

  async function confirm() {
    // Everything typed goes down before the signature does. Confirming
    // a consultation whose last sentence is still in a text box would
    // sign a record that is not the one on screen.
    await saveNow();
    await saveTests(tests);
    const { failure } = unwrap(await api.encounterConfirm(encounterId));
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    await onReload();
  }

  async function undoConfirm() {
    const { failure } = unwrap(await api.encounterUnconfirm(encounterId, null));
    if (failure) { setFailure(failure); return; }
    setFailure(null);
    await onReload();
  }

  const temperature = readTemperature(vitals.temperature ?? '', unit);
  const readOnly = confirmed;

  return (
    <div className="chamber">
      <div className="ch-head">
        <span className="name">{view.patientName}</span>
        {view.patientNameAlt !== null && <span className="name-alt">{view.patientNameAlt}</span>}
        <span className="facts">
          {view.ageYears === null ? 'age not recorded' : `${view.ageYears}${view.ageIsApproximate ? ' approx' : ''}`}
          {view.sex !== null && ` · ${view.sex}`} · serial {view.serialNo} · {view.chamberName}
        </span>
        <span className="right">
          <SaveState saving={saving} savedAt={savedAt} confirmed={confirmed} />
          <button className="secondary" onClick={onPapers}>Their papers</button>
          <button className="secondary" onClick={onOpenCard}>Their history</button>
          <button className="secondary" onClick={onClose}>Close</button>
        </span>
      </div>

      {failure !== null && <FailureNotice failure={failure} />}

      {confirmed && (
        <div className="ch-signed">
          <b>Confirmed by {view.encounter.confirmedByName ?? 'the doctor'}</b> at{' '}
          {new Date(view.encounter.confirmedAt!).toLocaleString()} — this consultation is part of the record and
          cannot be changed. Undo the confirmation to amend it; that is recorded.
        </div>
      )}

      <div className="ch-body">
        {/* ---- vitals ---- */}
        <div className="ch-col narrow">
          <div className="panel">
            <h3>Vitals <span className="note">{view.vitals.recordedByName ?? 'not taken yet'}</span></h3>
            <div className="vt-grid">
              <VitalBox label="BP upper" unit="mmHg" value={vitals.systolic!} readOnly={readOnly}
                onChange={(v) => editVital('systolic', v)} />
              <VitalBox label="BP lower" unit="mmHg" value={vitals.diastolic!} readOnly={readOnly}
                onChange={(v) => editVital('diastolic', v)} />
              <VitalBox label="Pulse" unit="/min" value={vitals.pulse!} readOnly={readOnly}
                onChange={(v) => editVital('pulse', v)} />
              <VitalBox label="SpO₂" unit="%" value={vitals.spo2!} readOnly={readOnly}
                onChange={(v) => editVital('spo2', v)} />
              <VitalBox label="Weight" unit="kg" value={vitals.weightKg!} readOnly={readOnly}
                onChange={(v) => editVital('weightKg', v)} />
              <VitalBox label="Height" unit="cm" value={vitals.heightCm!} readOnly={readOnly}
                onChange={(v) => editVital('heightCm', v)} />
              <VitalBox label="Blood sugar" unit="mmol/L" value={vitals.randomBloodSugar!} readOnly={readOnly}
                onChange={(v) => editVital('randomBloodSugar', v)} />
            </div>

            {/* The scale is chosen, never guessed from the number. See
                temperature.ts for why a guess is unacceptable here. */}
            <div className="vt-temp">
              <label className="k">Temperature</label>
              <div className="row">
                <input type="text" inputMode="decimal" value={vitals.temperature} readOnly={readOnly}
                  aria-label="Temperature" onChange={(e) => editVital('temperature', e.target.value)} />
                <div className="units">
                  {(['C', 'F'] as const).map((u) => (
                    <button key={u} className={unit === u ? 'unit on' : 'unit'} disabled={readOnly}
                      onClick={() => { pending.current = true; setUnit(u); }}>°{u}</button>
                  ))}
                </div>
              </div>
              {temperature.echo !== null && <div className="echo">{temperature.echo}</div>}
              {temperature.question !== null && <div className="ask">{temperature.question}</div>}
            </div>

            <label className="k" htmlFor="vnotes">Note about the readings</label>
            <input id="vnotes" type="text" value={vitals.notes} readOnly={readOnly}
              onChange={(e) => editVital('notes', e.target.value)} />

            {/* Questions, never refusals. The value is saved either way. */}
            {questions.length > 0 && (
              <div className="vt-questions">
                {questions.map((q) => <div className="ask" key={q.field}>{q.question}</div>)}
              </div>
            )}
          </div>
        </div>

        {/* ---- the consultation ---- */}
        <div className="ch-col">
          <div className="panel grow">
            <h3>This consultation <span className="note">{view.encounter.enteredByName ?? ''}</span></h3>
            <div className="panel-scroll">
              <Field label="Complaint" value={draft.chiefComplaint} readOnly={readOnly}
                onChange={(v) => edit({ chiefComplaint: v })} />
              <Field label="Examination" value={draft.examinationNotes} readOnly={readOnly} lines={4}
                onChange={(v) => edit({ examinationNotes: v })} />
              <Field label="Working diagnosis" value={draft.workingDiagnosis} readOnly={readOnly} big lines={2}
                onChange={(v) => edit({ workingDiagnosis: v })} />
              {view.previousDiagnosis !== null && (
                <div className="last-time">
                  Last time ({view.previousVisitDate}): {view.previousDiagnosis}
                </div>
              )}
              <Field label="Decision and advice" value={draft.decisionNotes} readOnly={readOnly} lines={3}
                onChange={(v) => edit({ decisionNotes: v })} />
              <div className="q">
                <label className="k" htmlFor="followup">Follow up after (days)</label>
                <input id="followup" type="text" inputMode="numeric" className="days" readOnly={readOnly}
                  value={draft.followUpAfterDays?.toString() ?? ''}
                  onChange={(e) => edit({ followUpAfterDays: numberOrNull(e.target.value) })} />
              </div>
            </div>
          </div>
        </div>

        {/* ---- prescription and tests ---- */}
        <div className="ch-col">
          <div className="panel grow">
            <h3>
              Prescription
              <span className="note">every word typed by you — nothing is suggested</span>
            </h3>
            <div className="panel-scroll">
              <Prescription lines={medications} readOnly={readOnly} onChange={(l) => { void saveMedications(l); }} />
              {view.previousMedications.length > 0 && !readOnly && (
                <button className="secondary small"
                  onClick={() => { void saveMedications([...medications, ...view.previousMedications]); }}>
                  Add last visit's {view.previousMedications.length} medicine{view.previousMedications.length === 1 ? '' : 's'}
                </button>
              )}
            </div>
          </div>

          <div className="panel">
            <h3>Tests ordered <span className="note">one on each line</span></h3>
            <textarea rows={4} value={tests} readOnly={readOnly}
              aria-label="Tests ordered"
              onChange={(e) => setTests(e.target.value)}
              onBlur={() => { void saveTests(tests); }} />
          </div>
        </div>
      </div>

      <div className="ch-foot">
        {confirmed
          ? <>
              <button onClick={onPrint}>Print prescription</button>
              {/* Ends the visit and closes this screen. The room is then
                  empty, and the front desk tablet says so by itself. */}
              <button disabled={role !== 'doctor'} onClick={onFinished}>
                Finished — call the next patient
              </button>
              <button className="secondary" disabled={role !== 'doctor'} onClick={() => { void undoConfirm(); }}>
                Undo confirmation
              </button>
            </>
          : <>
              <button disabled={role !== 'doctor'} onClick={() => { void confirm(); }}>Confirm this consultation</button>
              {/* Printing before the signature would put a draft in a
                  patient's hand that nobody could tell from a signed
                  one the moment it left the desk. */}
              <button className="secondary" disabled title="Confirm the consultation first">Print prescription</button>
            </>}
        <span className="note">
          {role !== 'doctor'
            ? 'You can write all of this, but only the doctor can confirm it. Until he does it stays a draft.'
            : confirmed
              ? 'Signed. Any change from here is an amendment and is recorded as one.'
              : 'Everything is saved as you type. Confirming is your signature on it.'}
        </span>
      </div>
    </div>
  );
}

function SaveState({ saving, savedAt, confirmed }: { saving: boolean; savedAt: string | null; confirmed: boolean }) {
  if (confirmed) return <span className="ch-save signed">confirmed</span>;
  if (saving) return <span className="ch-save">saving…</span>;
  if (savedAt === null) return <span className="ch-save dim">saved as you type</span>;
  return <span className="ch-save ok">saved {new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
}

function Field(
  { label, value, onChange, readOnly, lines = 1, big = false }: {
    label: string; value: string | null; onChange: (v: string) => void;
    readOnly: boolean; lines?: number; big?: boolean;
  },
) {
  return (
    <div className="q">
      <label className="k" htmlFor={`f-${label}`}>{label}</label>
      {lines === 1
        ? <input id={`f-${label}`} type="text" value={value ?? ''} readOnly={readOnly}
            className={big ? 'big' : ''} onChange={(e) => onChange(e.target.value)} />
        : <textarea id={`f-${label}`} rows={lines} value={value ?? ''} readOnly={readOnly}
            className={big ? 'big' : ''} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

function VitalBox(
  { label, unit, value, onChange, readOnly }: {
    label: string; unit: string; value: string; onChange: (v: string) => void; readOnly: boolean;
  },
) {
  return (
    <div className="vt">
      <label className="k" htmlFor={`v-${label}`}>{label}<span>{unit}</span></label>
      <input id={`v-${label}`} type="text" inputMode="decimal" value={value} readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * The prescription.
 *
 * A blank row is always at the bottom, so writing the next medicine is
 * typing rather than pressing Add first. Removing a line asks nothing:
 * it has not been signed yet, and the audit log has the previous
 * version either way.
 */
function Prescription(
  { lines, onChange, readOnly }: {
    lines: MedicationInput[]; onChange: (lines: MedicationInput[]) => void; readOnly: boolean;
  },
) {
  const [rows, setRows] = useState<MedicationInput[]>(lines);
  useEffect(() => { setRows(lines); }, [lines]);

  const blank: MedicationInput = {
    drugName: '', strength: null, dose: null, frequency: null, durationDays: null, instructions: null,
  };
  const shown = readOnly ? rows : [...rows, blank];

  function change(index: number, patch: Partial<MedicationInput>) {
    const next = [...rows];
    if (index === rows.length) next.push({ ...blank, ...patch });
    else next[index] = { ...next[index]!, ...patch };
    setRows(next);
  }

  function commit() { onChange(rows.filter((r) => r.drugName.trim() !== '')); }

  return (
    <div className="rx">
      {shown.length === 0 && <p className="muted">Nothing prescribed.</p>}
      {shown.map((line, i) => (
        <div className="rx-row" key={i}>
          <input className="drug" placeholder="Medicine" value={line.drugName} readOnly={readOnly}
            aria-label={`Medicine ${i + 1}`}
            onChange={(e) => change(i, { drugName: e.target.value })} onBlur={commit} />
          <input className="str" placeholder="Strength" value={line.strength ?? ''} readOnly={readOnly}
            aria-label={`Strength ${i + 1}`}
            onChange={(e) => change(i, { strength: e.target.value })} onBlur={commit} />
          <input className="dose" placeholder="Dose" value={line.dose ?? ''} readOnly={readOnly}
            aria-label={`Dose ${i + 1}`}
            onChange={(e) => change(i, { dose: e.target.value })} onBlur={commit} />
          <input className="freq" placeholder="1+0+1" value={line.frequency ?? ''} readOnly={readOnly}
            aria-label={`Frequency ${i + 1}`}
            onChange={(e) => change(i, { frequency: e.target.value })} onBlur={commit} />
          <input className="days" placeholder="days" value={line.durationDays?.toString() ?? ''} readOnly={readOnly}
            aria-label={`Days ${i + 1}`}
            onChange={(e) => change(i, { durationDays: numberOrNull(e.target.value) })} onBlur={commit} />
          {!readOnly && i < rows.length && (
            <button className="secondary tiny" aria-label={`Remove medicine ${i + 1}`}
              onClick={() => { const next = rows.filter((_, j) => j !== i); setRows(next); onChange(next.filter((r) => r.drugName.trim() !== '')); }}>
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
