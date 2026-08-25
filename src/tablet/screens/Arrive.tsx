import { useState } from 'react';
import { api, outbox, storedToken } from '../api';
import { loadDirectory, searchDirectory } from '../directory';
import { takeSerial } from '../serials';
import type { PatientSearchResult, RegisterPatientInput } from '../../shared/patients';

/** A patient described at the desk, to be created on the laptop when
 *  the arrival lands. The deskRef makes a repeat harmless. */
export type DeskNewPatient = RegisterPatientInput & { deskRef: string };

/** Unique enough for one desk on one evening, and readable in a log. */
function newRef(): string {
  return `desk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
  { bn, onDone, onCancel, deskChamber, visitDate, takenBy }: {
    bn: boolean;
    onDone: (serialNo: number, name: string) => void;
    onCancel: () => void;
    /** Which chamber this tablet speaks for. Null before it has ever
     *  heard from the laptop, which is the one case the desk cannot
     *  give out a number in. */
    deskChamber: { id: string; name: string } | null;
    visitDate: string;
    /** The assistant standing at the desk. Their name goes on the
     *  record, not the name of whoever the laptop has signed in when
     *  this finally reaches it two hours later. */
    takenBy: string | null;
  },
) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  /** True when the results came off this tablet's own list of names
   *  rather than from the laptop. The screen says so, because what it
   *  can show is thinner. */
  const [fromCopy, setFromCopy] = useState(false);
  /**
   * Why they came. Asked once, before the number is given, because it
   * decides whether the assistant asks them anything else at all.
   * Somebody bringing back a test the doctor ordered has no new
   * complaint, and a screening full of "nothing" reads exactly like a
   * screening nobody took.
   */
  const [kind, setKind] = useState<'consultation' | 'reports_only'>('consultation');

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

  /**
   * The laptop first, because it knows how many times somebody has been
   * before and when. When it cannot be reached, the copy of names and
   * numbers kept on this tablet answers instead -- which is enough to
   * tell a returning patient from a new one, and is all this tablet is
   * ever allowed to hold.
   */
  async function search(value: string) {
    setQuery(value);
    setProblem(null);
    if (value.trim().length < 2) { setResults(null); setFromCopy(false); return; }
    setSearching(true);
    try {
      const found = await api.post('/api/patients/search', { query: value }) as { results: PatientSearchResult[] };
      setResults(found.results);
      setFromCopy(false);
    } catch {
      const token = storedToken();
      const directory = token === null ? null : await loadDirectory(token);
      if (directory === null) {
        setResults(null);
        setFromCopy(false);
        setProblem({
          error: bn ? 'ল্যাপটপ পাওয়া যাচ্ছে না, আর এই ট্যাবে নামের তালিকাও নেই।'
            : 'The laptop cannot be reached, and this tablet has no list of names yet.',
          whatToDo: bn ? 'নতুন রোগী হিসেবে যোগ করুন। ল্যাপটপ এলে মিলিয়ে নেওয়া যাবে।'
            : 'Add them as a new patient. It can be matched up when the laptop arrives.',
        });
      } else {
        setResults(searchDirectory(directory, value).map((m) => ({
          id: m.id, nameBn: m.nameBn, nameEn: m.nameEn, phone: m.phone,
          sex: null, ageYears: null, ageIsApproximate: false,
          // visitCount stays zero because this copy does not carry it.
          // Nothing on screen reads it while fromCopy is true.
          visitCount: 0,
          lastVisitDate: m.lastVisitDate, lastChamberName: m.lastChamberName,
          mergedIntoPatientId: null, mergedIntoName: null,
        })));
        setFromCopy(true);
      }
    } finally {
      setSearching(false);
    }
  }

  /**
   * Give out a number and put the arrival in the outbox.
   *
   * ONE path, whether the laptop is reachable or not. The number comes
   * from this tablet's own count for this chamber, which the laptop
   * corrects every time it is in reach; the arrival goes into the
   * outbox and is sent when it can be. With the laptop present that is
   * immediate and nothing looks different.
   *
   * Doing it the same way every day is the point. Code that only runs
   * when the wifi drops is code nobody has tried.
   */
  function giveSerial(patient: { id: string | null; nameBn: string | null; nameEn: string | null },
    newPatient?: DeskNewPatient) {
    if (deskChamber === null) {
      setProblem({
        error: bn ? 'এই ট্যাব কোন চেম্বারের, তা এখনো জানা নেই।'
          : 'This tablet has not been told which chamber it is at.',
        whatToDo: bn ? 'ডাক্তারের ল্যাপটপে একবার যুক্ত করে নিতে হবে।'
          : 'It needs to reach the laptop once, so it can be told.',
      });
      return;
    }
    if (takenBy === null) {
      setProblem({
        error: bn ? 'কেউ সাইন ইন করেননি।' : 'Nobody is signed in at this desk.',
        whatToDo: bn ? 'নিজের নাম ও পিন দিয়ে শুরু করুন।'
          : 'Sign in first, so the record carries the name of who took it.',
      });
      return;
    }

    setBusy(true);
    setProblem(null);
    const serialNo = takeSerial(deskChamber.id, visitDate);
    outbox.add('/api/queue/desk-arrival', {
      deskRef: newRef(),
      takenBy,
      arrivedAt: new Date().toISOString(),
      visitDate,
      serialAnnounced: serialNo,
      patientId: patient.id,
      newPatient,
      visitKind: kind,
    });
    setBusy(false);
    onDone(serialNo, patient.nameBn ?? patient.nameEn ?? '');
  }

  /**
   * Somebody nobody has seen before. The patient is described here and
   * created on the laptop when the arrival lands, keyed by a reference
   * this tablet makes up -- so sending it twice makes one person, not
   * two.
   */
  function registerAndArrive() {
    giveSerial(
      { id: null, nameBn: nameBn.trim(), nameEn: null },
      {
        deskRef: newRef(),
        fullNameBn: nameBn.trim() === '' ? null : nameBn.trim(),
        fullNameEn: null,
        phone: phone.trim() === '' ? null : phone.trim(),
        dob: null,
        approxAgeYears: age.trim() === '' ? null : Number(age.trim()),
        sex,
        addressFreeText: null,
      },
    );
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

      {/* Asked before the number, because it decides what happens for
          the rest of this patient's visit at the desk. Not a lighter
          kind of patient: it changes what they are asked and nothing
          else -- not their place in the list, not the rules. */}
      <div className="why-here">
        <button className={kind === 'consultation' ? 'on' : ''}
          onClick={() => setKind('consultation')}>
          <span className="t">{bn ? 'ডাক্তার দেখাবেন' : 'To see the doctor'}</span>
          <span className="d">{bn ? 'নতুন কোনো সমস্যা' : 'a new complaint'}</span>
        </button>
        <button className={kind === 'reports_only' ? 'on' : ''}
          onClick={() => setKind('reports_only')}>
          <span className="t">{bn ? 'শুধু রিপোর্ট দেখাবেন' : 'Only showing reports'}</span>
          <span className="d">{bn ? 'গতবার ডাক্তার যে পরীক্ষা দিয়েছিলেন' : 'a test the doctor asked for'}</span>
        </button>
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

      {/* Where these names came from. The laptop knows how many times
          somebody has been before; this tablet only knows the name and
          the number, so it says so rather than looking like it knows
          less than it does by accident. */}
      {fromCopy && results !== null && (
        <div className="from-copy">
          {bn
            ? 'ল্যাপটপ পাওয়া যাচ্ছে না। এই ট্যাবে রাখা নাম ও নম্বরের তালিকা থেকে দেখানো হচ্ছে।'
            : "The laptop cannot be reached. These come from the list of names and numbers kept on this tablet."}
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
              {/* Off this tablet's own list, all that is known is a name
                  and a number. Printing "no previous visit" here would
                  be a lie -- the tablet has no idea, and the assistant
                  would read it as fact. So it says what it actually
                  knows and no more. */}
              {fromCopy ? (
                <>
                  <span className="sub">{patient.phone ?? (bn ? 'নম্বর নেই' : 'no number')}</span>
                  {/* When they were last seen, and WHERE. A patient last
                      seen at the other chamber is the same patient, and
                      the assistant needs to be able to say so out loud.
                      The rest of the history stays on the laptop. */}
                  <span className="sub">
                    {patient.lastVisitDate === null
                      ? (bn ? 'আগে আসেননি' : 'no previous visit')
                      : `${bn ? 'শেষ এসেছেন' : 'last seen'} ${patient.lastVisitDate}`
                        + (patient.lastChamberName === null ? '' : ` · ${patient.lastChamberName}`)}
                  </span>
                </>
              ) : (
                <>
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
                </>
              )}
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
