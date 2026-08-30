/**
 * The next patient, across the whole screen.
 *
 * This is the tablet's loudest screen and it exists for one moment:
 * the doctor's room has just emptied, and somebody in a waiting room
 * has to hear their number. So the number is the size of the screen,
 * the name is under it, and there is nothing else to read.
 *
 * It takes over from whatever the assistant was doing, does not time
 * out, and does not dismiss itself. A patient walks in when a person
 * sends them in, and the tablet has no way of knowing that has
 * happened. Whatever was underneath is still there afterwards; nothing
 * being typed is lost to this.
 *
 * TWO ANSWERS, AND ONLY ONE OF THEM IS ABOUT THE PATIENT
 *
 * "I have sent them in" is the usual one. It tells the laptop, which
 * asks the doctor to accept it -- see the hand-off in App.tsx.
 *
 * "Nobody came" is the other, and it is deliberately narrow: it writes
 * down that the number was called and not answered, and moves the
 * calling order on. It does not mark anybody as gone, move anybody
 * down the queue, take anybody off the doctor's list, or touch their
 * serial -- see src/main/queue/noAnswer.ts. Somebody outside on the
 * phone comes back round in a minute; somebody who has really gone
 * home is marked LEFT by a person, on the list, by name.
 *
 * ONE TAP, AND NO LOOP
 *
 * A flagged patient is called ahead of everybody. That is the
 * escalation and it does not bend. But it used to mean that when the
 * flagged patients were not in the room the order could not get past
 * them, and the desk tapped the same two or three numbers round and
 * round with a full waiting room. So "nobody came" now moves the
 * calling order past THIS named patient as well as recording the call
 * -- one tap, one patient, and the doctor is shown that it happened.
 * A flagged patient is still called first; just once each, not for
 * ever.
 *
 * It is offered only when the desk is working down the list on its
 * own. When the DOCTOR has asked for a particular patient by number,
 * "nobody came" is news for him, not something for the desk to move
 * past.
 */
export function CalledIn(
  { serialNo, nameBn, nameEn, outOfTurn, nextUp, noAnswer, onlyOneWaiting,
    flagged, silent, bn, onSent, onNoAnswer }: {
    serialNo: number;
    nameBn: string | null;
    nameEn: string | null;
    /** Somebody who was ahead of them is still waiting. */
    outOfTurn: boolean;
    /**
     * True when the doctor has just finished with somebody and this is
     * simply who is next, rather than a patient he asked for by number.
     * The desk is being told to call them in either way; what differs
     * is what the screen says, and whether "nobody came" is offered.
     */
    nextUp: boolean;
    /** Times this number has already been called with nobody coming. */
    noAnswer: number;
    /** Nobody else is waiting, so there is nobody to move on to. */
    onlyOneWaiting: boolean;
    /**
     * A screening rule flagged this patient, which is why they are
     * being called ahead of their turn. Said on the screen, so the
     * assistant knows why the numbers are not in order and does not
     * "correct" it.
     */
    flagged: boolean;
    /** The tablet cannot make a noise yet, so the screen has to say so. */
    silent: boolean;
    bn: boolean;
    onSent: () => void;
    /** Absent when this is a patient the doctor asked for by number. */
    onNoAnswer?: () => void;
  },
) {
  const name = nameBn ?? nameEn ?? '';
  return (
    <div className="called-in">
      <div className="lead">
        {nextUp
          ? (bn ? 'এই নম্বর ডেকে বলুন' : 'Call this number out')
          : (bn ? 'ডাক্তার ডেকেছেন' : 'The doctor has called')}
      </div>
      <div className="serial">{serialNo}</div>
      <div className="name">{name}</div>

      {/* Why this number and not the one before it. Without this the
          desk sees the order jump and has no idea whether the tablet
          is working. Nothing about the patient's condition is on here
          -- only that the doctor is to see them sooner. */}
      {flagged && (
        <div className="sooner">
          {bn
            ? 'স্ক্রিনিংয়ে সতর্কতা এসেছে — ডাক্তার ইনাকে আগে দেখবেন।'
            : 'Their screening raised a warning — the doctor is seeing them sooner.'}
        </div>
      )}

      {/* Said plainly, because the assistant calling it out for the
          second time should know that is what they are doing. */}
      {noAnswer > 0 && (
        <div className="again">
          {bn
            ? `এই নম্বর আগে ${noAnswer} বার ডাকা হয়েছে, কেউ আসেননি।`
            : `Called ${noAnswer} ${noAnswer === 1 ? 'time' : 'times'} already with nobody coming.`}
        </div>
      )}

      {outOfTurn && (
        <div className="out-of-turn">
          {bn
            ? 'সিরিয়াল অনুযায়ী নয় — ইনার আগের রোগীরা এখনো অপেক্ষা করছেন। ডাক্তার এই রোগীকেই চেয়েছেন।'
            : 'Not in serial order — people ahead of them are still waiting. The doctor has asked for this patient.'}
        </div>
      )}

      {silent && (
        <div className="silent-note">
          {bn
            ? 'এই ট্যাব এখনো শব্দ করতে পারছে না। একবার পর্দায় স্পর্শ করলেই পারবে।'
            : 'This tablet cannot make a sound yet. One touch anywhere fixes that for the rest of the evening.'}
        </div>
      )}

      <div className="acts">
        <button className="btn" onClick={onSent}>
          {bn ? 'রোগীকে পাঠিয়ে দিয়েছি' : 'I have sent them in'}
        </button>

        {onNoAnswer !== undefined && (
          <button className="btn secondary" onClick={onNoAnswer}>
            {bn ? 'কেউ আসেননি — পরের জন' : 'Nobody came — next patient'}
          </button>
        )}
      </div>

      {/* What that button will actually do, before it is pressed. The
          assistant has to be able to press it without wondering whether
          they are about to send somebody home. */}
      {onNoAnswer !== undefined && (
        <div className="reassure">
          {onlyOneWaiting
            ? (bn
              ? 'আর কেউ অপেক্ষায় নেই। এই রোগী তালিকাতেই থাকবেন — ডাক্তারের কাছে দেখাবে যে ডাকা হয়েছিল।'
              : 'Nobody else is waiting. This patient stays on the list either way — the doctor will see that they were called.')
            : flagged
              ? (bn
                ? 'এই রোগী তালিকাতেই থাকবেন, সিরিয়ালও বদলাবে না, আর ডাক্তারের পর্দায় সতর্কতা চিহ্ন থাকবেই। শুধু পরের জনকে ডাকা হবে, আর ডাক্তার দেখতে পাবেন যে এগোনো হয়েছে।'
                : 'This patient stays on the list, keeps their serial, and keeps their warning on the doctor’s screen. Only the calling order moves on, and the doctor is shown that it did.')
              : (bn
                ? 'এই রোগী তালিকা থেকে বাদ যাবেন না। সিরিয়াল অনুযায়ী পরের জনকে ডাকা হবে।'
                : 'This patient is not taken off the list. The next one by serial is called.')}
        </div>
      )}
    </div>
  );
}
