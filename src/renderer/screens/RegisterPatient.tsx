import { useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';

/**
 * Registering someone new.
 *
 * Almost every field is optional. An assistant blocked behind a box the
 * patient cannot answer abandons the tool and goes back to the paper
 * book, and plenty of patients genuinely do not know their date of
 * birth or have no phone of their own. A name is the only thing
 * required, because a register of unnamed people is not a register.
 *
 * If the search text looked like a phone number it arrives pre-filled,
 * because the assistant has just typed it once already.
 */
export function RegisterPatient(
  { initialQuery, onDone, onCancel }:
  { initialQuery: string; onDone: (id: string) => void; onCancel: () => void },
) {
  const looksLikePhone = /^[\d\s+-]{4,}$/.test(initialQuery.trim());
  const [nameBn, setNameBn] = useState('');
  const [nameEn, setNameEn] = useState(looksLikePhone ? '' : initialQuery.trim());
  const [phone, setPhone] = useState(looksLikePhone ? initialQuery.trim() : '');
  const [ageMode, setAgeMode] = useState<'estimate' | 'dob' | 'unknown'>('estimate');
  const [age, setAge] = useState('');
  const [dob, setDob] = useState('');
  const [sex, setSex] = useState<'male' | 'female' | 'other' | ''>('');
  const [address, setAddress] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  const hasName = nameBn.trim() !== '' || nameEn.trim() !== '';

  async function save() {
    setBusy(true);
    setFailure(null);
    const { value, failure } = unwrap(await api.patientRegister({
      fullNameBn: nameBn.trim() === '' ? null : nameBn.trim(),
      fullNameEn: nameEn.trim() === '' ? null : nameEn.trim(),
      phone: phone.trim() === '' ? null : phone.trim(),
      dob: ageMode === 'dob' && dob !== '' ? dob : null,
      approxAgeYears: ageMode === 'estimate' && age.trim() !== '' ? Number(age) : null,
      sex: sex === '' ? null : sex,
      addressFreeText: address.trim() === '' ? null : address.trim(),
    }));
    setBusy(false);
    if (failure) { setFailure(failure); return; }
    onDone(value!.id);
  }

  return (
    <div className="patients">
      <div className="patients-head">
        <h1>Register a new patient</h1>
        <span className="spacer" />
        <button className="secondary" onClick={onCancel}>Back to search</button>
      </div>

      <p className="muted" style={{ margin: 0 }}>
        Only a name is required. Leave anything else blank if the patient does not know it —
        it can be filled in later and a blank is better than a guess.
      </p>

      {failure !== null && <FailureNotice failure={failure} />}

      <div className="card" style={{ overflowY: 'auto' }}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="nbn">Name in Bangla</label>
            <input id="nbn" value={nameBn} onChange={(e) => setNameBn(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="nen">Name in English</label>
            <input id="nen" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
            <div className="why">Either one is enough. Both is better for searching later.</div>
          </div>

          <div className="field">
            <label htmlFor="ph">Phone</label>
            <input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <div className="why">
              Write it however the patient says it. Families share handsets, so this is not proof
              of who somebody is — it is only a way to find them again.
            </div>
          </div>

          <div className="field">
            <label htmlFor="sx">Sex</label>
            <select id="sx" value={sex} onChange={(e) => setSex(e.target.value as typeof sex)}>
              <option value="">not recorded</option>
              <option value="male">male</option>
              <option value="female">female</option>
              <option value="other">other</option>
            </select>
          </div>

          <div className="field">
            <label>Age</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={ageMode} onChange={(e) => setAgeMode(e.target.value as typeof ageMode)} style={{ width: 190 }}>
                <option value="estimate">about this many years</option>
                <option value="dob">exact date of birth</option>
                <option value="unknown">not known</option>
              </select>
              {ageMode === 'estimate' && (
                <input value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))}
                       inputMode="numeric" placeholder="45" style={{ width: 110 }} />
              )}
              {ageMode === 'dob' && (
                <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              )}
            </div>
            <div className="why">
              An estimate is recorded with today's date, so it ages forward on its own instead of
              staying at this number for ever.
            </div>
          </div>

          <div className="field full">
            <label htmlFor="ad">Address</label>
            <input id="ad" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
        </div>

        <button disabled={!hasName || busy} onClick={save}>
          {busy ? 'Saving…' : 'Register this patient'}
        </button>
        {!hasName && <span className="muted" style={{ marginLeft: 12 }}>A name is needed first.</span>}
      </div>
    </div>
  );
}
