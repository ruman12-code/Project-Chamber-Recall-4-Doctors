import { useState } from 'react';
import { api, LaptopUnreachableError } from '../api';
import {
  verifyOffline, offlineLocked, offlineFailures, OFFLINE_ATTEMPTS, type DeskKeys,
} from '../deskKeys';

/**
 * Who is holding the tablet.
 *
 * Pairing says this tablet is allowed to talk to the laptop. It says
 * nothing about which assistant is using it, and that is what goes
 * into the record next to every answer a patient gives.
 *
 * One sign-in at the start of the evening. Nothing is asked again
 * until the laptop is closed.
 *
 * TWO WAYS IN, AND THEY ARE NOT THE SAME WAY
 *
 * The laptop is asked first, every time. It checks the PIN against the
 * scrypt hash it has never let out of itself, and a person signed in
 * that way is signed in for real: the laptop knows whose name goes on
 * what this tablet sends.
 *
 * Only when the laptop cannot be REACHED -- not when it says no -- does
 * the tablet fall back to checking the PIN itself, from what it was
 * given while the laptop was in reach. That opens the kiosk so the desk
 * can work. It does not sign anybody in to the laptop, and the laptop
 * has still never seen this evening's PIN, so everything the desk does
 * waits in the outbox until the laptop is back and the real sign-in
 * happens. See src/tablet/deskKeys.ts.
 */
export interface DeskPerson { id: string; displayName: string; role: string }

const ROLE_BN: Record<string, string> = {
  doctor: 'ডাক্তার',
  clinical_assistant: 'সহকারী',
  front_desk: 'অভ্যর্থনা',
};

export function DeskSignIn(
  { people, bn, deskKeys, onSignedIn, onOffline }: {
    people: DeskPerson[];
    bn: boolean;
    /**
     * What this tablet can open itself with, or null for a tablet that
     * has never reached the laptop. Passed in rather than read here:
     * on a tablet being paired for the first time this screen is
     * already up before the keys have finished arriving, and a screen
     * that read them once at the start would show a first evening with
     * no badges on it and be wrong for the rest of the session.
     */
    deskKeys: DeskKeys | null;
    onSignedIn: () => void;
    /**
     * Opened without the laptop. The PIN is handed up with it, held in
     * memory only, so that the moment the laptop is reachable the
     * tablet can sign in to it properly and stop holding the outbox.
     */
    onOffline: (who: { id: string; displayName: string; role: string }, pin: string) => void;
  },
) {
  const [chosen, setChosen] = useState<DeskPerson | null>(null);
  const [pin, setPin] = useState('');
  const [problem, setProblem] = useState<{ error: string; whatToDo: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(offlineLocked());
  const keys = deskKeys;

  /** Whether this tablet could let this particular person in on its own. */
  const canOpenAlone = (person: DeskPerson): boolean =>
    keys !== null && keys.keys.some((k) => k.userId === person.id);
  const knownNeedsPin = (person: DeskPerson): boolean =>
    keys !== null && keys.needPinSetAgain.some((k) => k.userId === person.id);

  async function go() {
    if (chosen === null) return;
    setBusy(true);
    try {
      await api.post('/api/signin', { userId: chosen.id, pin });
      setProblem(null);
      onSignedIn();
    } catch (caught) {
      // The laptop said no. That is an answer, and the tablet takes it.
      if (!(caught instanceof LaptopUnreachableError)) {
        const error = caught as Error & { whatToDo?: string; errorBn?: string | null; whatToDoBn?: string | null };
        setProblem(bn && error.errorBn != null
          ? { error: error.errorBn, whatToDo: error.whatToDoBn ?? '' }
          : { error: error.message, whatToDo: error.whatToDo ?? '' });
        setBusy(false);
        setPin('');
        return;
      }

      // The laptop could not be asked. Fall back to what this tablet
      // was given while it could be.
      if (keys === null) {
        setProblem(bn
          ? {
            error: 'ল্যাপটপ পাওয়া যাচ্ছে না।',
            whatToDo: 'এই ট্যাবলেটে নিজে থেকে খোলার ব্যবস্থা এখনো নেওয়া হয়নি। ল্যাপটপ চালু করুন।',
          }
          : {
            error: 'The laptop cannot be reached.',
            whatToDo: 'This tablet has not been given a way to open itself yet. Turn the laptop on, and once it has been reached once, this will work without it.',
          });
        setBusy(false);
        setPin('');
        return;
      }

      const result = await verifyOffline(keys, chosen.id, pin);
      setLocked(offlineLocked());
      if (result.ok) {
        setProblem(null);
        onOffline({ id: result.userId, displayName: result.displayName, role: 'front_desk' }, pin);
      } else if (result.reason === 'locked') {
        setProblem(bn
          ? {
            error: 'অনেকবার ভুল পিন দেওয়া হয়েছে।',
            whatToDo: 'এই ট্যাবলেট আর নিজে থেকে খুলবে না। ল্যাপটপ চালু করুন, অথবা ডাক্তারকে জানান।',
          }
          : {
            error: 'Too many wrong PINs on this tablet.',
            whatToDo: 'It will not open itself again until the laptop has been reached. Turn the laptop on, or tell the doctor.',
          });
      } else if (result.reason === 'unknown') {
        setProblem(bn
          ? {
            error: 'ল্যাপটপ ছাড়া এই নামে খোলা যাচ্ছে না।',
            whatToDo: 'শুধু অভ্যর্থনার লোকজন ল্যাপটপ ছাড়া ট্যাবলেট খুলতে পারেন। ডাক্তার ও সহকারীর পিন ল্যাপটপেই থাকে।',
          }
          : {
            error: 'This tablet cannot open for that person on its own.',
            whatToDo: 'Only the front desk can open it without the laptop. The doctor’s PIN and the assistant’s PIN are checked on the laptop and are not kept here.',
          });
      } else {
        const left = OFFLINE_ATTEMPTS - offlineFailures();
        setProblem(bn
          ? {
            error: 'পিন মেলেনি।',
            whatToDo: `আবার লিখুন। আর ${left} বার চেষ্টা করা যাবে, তারপর ল্যাপটপ লাগবে।`,
          }
          : {
            error: 'That PIN is not right.',
            whatToDo: `Type it again. ${left} more ${left === 1 ? 'try' : 'tries'} before this tablet needs the laptop.`,
          });
      }
    } finally {
      setBusy(false);
      setPin('');
    }
  }

  // Front desk people whose PIN was set before this tablet had a way to
  // check PINs itself. Named, because the fix is the doctor setting
  // their PIN again on the laptop and nobody would guess that from a
  // sign-in that simply does not work when the laptop is away.
  const needPin = keys?.needPinSetAgain ?? [];

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

      {locked && (
        <div className="pair-problem">
          <b>{bn ? 'এই ট্যাবলেট নিজে থেকে খুলবে না।' : 'This tablet will not open itself.'}</b>
          <span>
            {bn
              ? 'অনেকবার ভুল পিন দেওয়া হয়েছে। ল্যাপটপ চালু হলে আবার কাজ করবে।'
              : 'Too many wrong PINs. It will work again once the laptop has been reached.'}
          </span>
        </div>
      )}

      <div className="desk-people">
        {people.map((person) => (
          <button key={person.id}
            className={chosen?.id === person.id ? 'desk-person on' : 'desk-person'}
            onClick={() => { setChosen(person); setPin(''); setProblem(null); }}>
            <span className="n">{person.displayName}</span>
            <span className="r">{bn ? (ROLE_BN[person.role] ?? person.role) : person.role.replace('_', ' ')}</span>
            {/* Said on the button rather than discovered at the moment
                the laptop is away and somebody is waiting. */}
            {canOpenAlone(person) && (
              <span className="alone">{bn ? 'ল্যাপটপ ছাড়াও খোলে' : 'opens without the laptop'}</span>
            )}
            {knownNeedsPin(person) && (
              <span className="alone need">{bn ? 'ল্যাপটপ লাগবে' : 'needs the laptop'}</span>
            )}
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

      {needPin.length > 0 && (
        <p className="lede small">
          {bn
            ? `${needPin.map((p) => p.displayName).join(', ')} — ল্যাপটপ ছাড়া খুলতে পারবেন না। ডাক্তার ল্যাপটপ থেকে আবার পিন দিলে কাজ করবে।`
            : `${needPin.map((p) => p.displayName).join(', ')} cannot open this tablet without the laptop. The doctor setting their PIN again on the laptop fixes it.`}
        </p>
      )}
    </div>
  );
}
