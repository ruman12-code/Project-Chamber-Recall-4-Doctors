import { useState } from 'react';
import { api } from '../api';

/**
 * Who is holding the tablet.
 *
 * Pairing says this tablet is allowed to talk to the laptop. It says
 * nothing about which assistant is using it, and that is what goes
 * into the record next to every answer a patient gives.
 *
 * One sign-in at the start of the evening. Nothing is asked again
 * until the laptop is closed.
 */
export interface DeskPerson { id: string; displayName: string; role: string }

const ROLE_BN: Record<string, string> = {
  doctor: 'ডাক্তার',
  clinical_assistant: 'সহকারী',
  front_desk: 'অভ্যর্থনা',
};

export function DeskSignIn(
  { people, bn, onSignedIn }: { people: DeskPerson[]; bn: boolean; onSignedIn: () => void },
) {
  const [chosen, setChosen] = useState<DeskPerson | null>(null);
  const [pin, setPin] = useState('');
  const [problem, setProblem] = useState<{ error: string; whatToDo: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function go() {
    if (chosen === null) return;
    setBusy(true);
    try {
      await api.post('/api/signin', { userId: chosen.id, pin });
      setProblem(null);
      onSignedIn();
    } catch (caught) {
      const error = caught as Error & { whatToDo?: string; errorBn?: string | null; whatToDoBn?: string | null };
      setProblem(bn && error.errorBn != null
        ? { error: error.errorBn, whatToDo: error.whatToDoBn ?? '' }
        : { error: error.message, whatToDo: error.whatToDo ?? '' });
    } finally {
      setBusy(false);
      setPin('');
    }
  }

  return (
    <div className="pair">
      <h1>{bn ? 'আপনি কে?' : 'Who is using this?'}</h1>
      <p className="lede">
        {bn
          ? 'রোগী যা বলবেন তা কার হাতে লেখা হলো, রেকর্ডে সেটাও থাকে। তাই শুরুতে একবার নিজের নাম ও পিন দিন।'
          : 'Whatever a patient tells you is recorded with your name beside it. So the tablet needs to know which of you is holding it.'}
      </p>

      {people.length === 0 && (
        <p className="lede">
          {bn ? 'ল্যাপটপে এখনো কারো নাম যোগ করা হয়নি।' : 'Nobody has been added on the laptop yet.'}
        </p>
      )}

      <div className="desk-people">
        {people.map((person) => (
          <button key={person.id}
            className={chosen?.id === person.id ? 'desk-person on' : 'desk-person'}
            onClick={() => { setChosen(person); setPin(''); setProblem(null); }}>
            <span className="n">{person.displayName}</span>
            <span className="r">{bn ? (ROLE_BN[person.role] ?? person.role) : person.role.replace('_', ' ')}</span>
          </button>
        ))}
      </div>

      {chosen !== null && (
        <div className="desk-pin">
          <label htmlFor="deskpin">{bn ? 'আপনার পিন' : 'Your PIN'}</label>
          <input id="deskpin" type="password" inputMode="numeric" value={pin} autoFocus
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') void go(); }} />
          <button disabled={busy || pin.length < 4} onClick={() => { void go(); }}>
            {bn ? 'শুরু করুন' : 'Start'}
          </button>
        </div>
      )}

      {problem !== null && (
        <div className="pair-problem">
          <b>{problem.error}</b>
          <span>{problem.whatToDo}</span>
        </div>
      )}
    </div>
  );
}
