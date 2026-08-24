import { useState } from 'react';
import { api } from '../api';
import type { PatientSearchResult } from '../../shared/patients';

/**
 * The serial register, at the desk.
 *
 * This is the paper book. A patient walks in, the assistant finds them
 * or writes them down, and they get a number that is called out across
 * the room. Everything else this tablet does is worth nothing if this
 * part is slower than the book was.
 *
 * Two rules carried over from the laptop screens, and they matter more
 * here because the desk is busier:
 *
 *   The search always shows a LIST. It never picks a patient by
 *   itself, however sure it looks - two brothers on one phone number
 *   is normal here, and the wrong pick puts one man's history under
 *   another man's name.
 *
 *   Registering somebody new is available at every step, because the
 *   commonest thing at a front desk is a patient who is not in there
 *   yet, and making that the hard path is how names get typed into the
 *   search box until something matches.
 *
 * This is also the one part of the tablet that cannot work offline. A
 * serial number has to be unique and in order for the whole chamber,
 * and two tablets handing out number 14 out of their own buffers would
 * be worse than a screen that says plainly it cannot reach the laptop.
 */

type Problem = { error: string; whatToDo: string } | null;

function ageOf(p: PatientSearchResult, bn: boolean): string {
  if (p.ageYears === null) return bn ? 'বয়স জানা নেই' : 'age not known';
  return `${p.ageYears}${p.ageIsApproximate ? (bn ? ' (আনুমানিক)' : ' approx') : ''}`;
}

export function Arrive(
  { bn, onDone, onCancel }: { bn: boolean; onDone: (serialNo: number, name: string) => void; onCancel: () => void },
) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);

  // The new-patient form.
  const [nameBn, setNameBn] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<'male' | 'female' | 'other' | null>(null);

  function failed(caught: unknown): void {
    const error = caught as Error & { whatToDo?: string; errorBn?: string | null; whatToDoBn?: string | null };
    setProblem(bn && error.errorBn != null
      ? { error: error.errorBn, whatToDo: error.whatToDoBn ?? '' }
      : {
        error: error.message,
        // A failed reach to the laptop is the likeliest thing that
        // happens here, and "try again" is not enough to act on.
        whatToDo: error.whatToDo ?? (bn
          ? 'ল্যাপটপের সঙ্গে সংযোগ আছে কিনা দেখুন। সিরিয়াল নম্বর ল্যাপটপ থেকেই আসে।'
          : 'Check the tablet can still reach the laptop. The serial number comes from the laptop.'),
      });
  }

  async function search(value: string) {
    setQuery(value);
    setProblem(null);
    if (value.trim().length < 2) { setResults(null); return; }
    setSearching(true);
    try {
      const found = await api.post('/api/patients/search', { query: value }) as { results: PatientSearchResult[] };
      setResults(found.results);
    } catch (caught) {
      failed(caught);
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  async function giveSerial(patient: PatientSearchResult, allowSecondVisitToday = false) {
    setBusy(true);
    setProblem(null);
    try {
      const result = await api.post('/api/queue/arrive', {
        patientId: patient.id, allowSecondVisitToday,
      }) as { serialNo: number; alreadyOnListVisitId: string | null };

      if (result.alreadyOnListVisitId !== null && !allowSecondVisitToday) {
        // Already on today's list. Nearly always the assistant adding
        // them twice; not impossible though, so it asks rather than
        // refusing, and the question is in their own language.
        const again = window.confirm(bn
          ? 'ইনি আজ আগেই তালিকায় আছেন।\n\nআবার যোগ করবেন? সত্যিই দ্বিতীয়বার এসে থাকলেই কেবল করুন।'
          : 'This patient is already on today\'s list.\n\nAdd them again? Only if they really have come back a second time.');
        setBusy(false);
        if (again) await giveSerial(patient, true);
        return;
      }
      setBusy(false);
      onDone(result.serialNo, patient.nameBn ?? patient.nameEn ?? '');
    } catch (caught) {
      setBusy(false);
      failed(caught);
    }
  }

  async function registerAndArrive() {
    setBusy(true);
    setProblem(null);
    try {
      const created = await api.post('/api/patients/register', {
        fullNameBn: nameBn.trim() === '' ? null : nameBn.trim(),
        fullNameEn: null,
        phone: phone.trim() === '' ? null : phone.trim(),
        dob: null,
        approxAgeYears: age.trim() === '' ? null : Number(age.trim()),
        sex,
        addressFreeText: null,
      }) as { id: string };
      setBusy(false);
      await giveSerial({
        id: created.id, nameBn: nameBn.trim(), nameEn: null, phone: phone.trim(), sex,
        ageYears: age.trim() === '' ? null : Number(age.trim()), ageIsApproximate: true,
        visitCount: 0, lastVisitDate: null, lastChamberName: null,
        mergedIntoPatientId: null, mergedIntoName: null,
      });
    } catch (caught) {
      setBusy(false);
      failed(caught);
    }
  }

  if (registering) {
    return (
      <>
        <div className="prompt">
          <div className="bn">{bn ? 'নতুন রোগী' : 'A new patient'}</div>
          <div className="en">{bn ? 'A new patient' : 'নতুন রোগী'}</div>
        </div>

        <div className="arrive-form">
          <label htmlFor="a-name">{bn ? 'নাম' : 'Name'}</label>
          <input id="a-name" type="text" value={nameBn} autoFocus onChange={(e) => setNameBn(e.target.value)} />

          <label htmlFor="a-phone">{bn ? 'মোবাইল নম্বর' : 'Mobile number'}</label>
          <input id="a-phone" type="tel" inputMode="numeric" value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^0-9+]/g, ''))} />

          <label htmlFor="a-age">{bn ? 'বয়স (আনুমানিক হলেও চলবে)' : 'Age (an estimate is fine)'}</label>
          <input id="a-age" type="text" inputMode="numeric" value={age}
            onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, ''))} />

          <label>{bn ? 'লিঙ্গ' : 'Sex'}</label>
          <div className="arrive-sex">
            {([['female', bn ? 'মহিলা' : 'female'], ['male', bn ? 'পুরুষ' : 'male'], ['other', bn ? 'অন্যান্য' : 'other']] as const)
              .map(([value, label]) => (
                <button key={value} className={sex === value ? 'on' : ''} onClick={() => setSex(value)}>{label}</button>
              ))}
          </div>
        </div>

        {problem !== null && (
          <div className="pair-problem">
            <b>{problem.error}</b>
            <span>{problem.whatToDo}</span>
          </div>
        )}

        <div className="arrive-actions">
          <button disabled={busy || nameBn.trim() === ''} onClick={() => { void registerAndArrive(); }}>
            {bn ? 'সিরিয়াল দিন' : 'Give a serial'}
          </button>
          <button className="quiet" onClick={() => { setRegistering(false); setProblem(null); }}>
            {bn ? 'ফিরে যান' : 'Back'}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="prompt">
        <div className="bn">{bn ? 'রোগী এসেছেন' : 'A patient has arrived'}</div>
        <div className="en">{bn ? 'A patient has arrived' : 'রোগী এসেছেন'}</div>
      </div>

      <div className="arrive-search">
        <input
          type="text" autoFocus value={query}
          placeholder={bn ? 'মোবাইল নম্বর বা নাম' : 'Mobile number or name'}
          aria-label={bn ? 'মোবাইল নম্বর বা নাম' : 'Mobile number or name'}
          onChange={(e) => { void search(e.target.value); }}
        />
      </div>

      {problem !== null && (
        <div className="pair-problem">
          <b>{problem.error}</b>
          <span>{problem.whatToDo}</span>
        </div>
      )}

      <div className="patient-list">
        {searching && <div className="empty">{bn ? 'খোঁজা হচ্ছে…' : 'Looking…'}</div>}
        {!searching && results !== null && results.length === 0 && (
          <div className="empty">
            {bn ? 'এই নামে বা নম্বরে কাউকে পাওয়া যায়নি।' : 'Nobody found with that name or number.'}
          </div>
        )}
        {!searching && results !== null && results.map((patient) => (
          <button key={patient.id} className="patient" disabled={busy}
            onClick={() => { void giveSerial(patient); }}>
            <span className="who">
              <span className="nm">{patient.nameBn ?? patient.nameEn}</span>
              <span className="sub">
                {ageOf(patient, bn)}
                {patient.sex !== null && ` · ${patient.sex}`}
                {patient.phone !== null && ` · ${patient.phone}`}
              </span>
              <span className="sub">
                {patient.visitCount === 0
                  ? (bn ? 'আগে আসেননি' : 'no previous visit')
                  : `${patient.visitCount} ${bn ? 'বার এসেছেন' : 'previous'} · ${patient.lastVisitDate}`}
              </span>
            </span>
            {patient.mergedIntoPatientId !== null && (
              <span className="state">{bn ? 'অন্য রেকর্ডে যুক্ত' : 'merged'}</span>
            )}
          </button>
        ))}
      </div>

      <div className="arrive-actions">
        <button onClick={() => { setRegistering(true); setProblem(null); }}>
          {bn ? 'নতুন রোগী যোগ করুন' : 'A new patient'}
        </button>
        <button className="quiet" onClick={onCancel}>{bn ? 'ফিরে যান' : 'Back'}</button>
      </div>
    </>
  );
}
