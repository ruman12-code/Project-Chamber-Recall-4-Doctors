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
 * "I have sent them in" is the usual one.
 *
 * "Nobody came" is the other, and it is deliberately narrow: it moves
 * this screen on to whoever has been called the fewest times, and it
 * writes down that the number was called and not answered. It does not
 * mark anybody as gone, move anybody down the queue, or take anybody
 * off the doctor's list -- see src/main/queue/noAnswer.ts. Somebody
 * outside on the phone comes back round in a minute; somebody who has
 * really gone home is the doctor's decision, made on the laptop, with
 * "called twice, no answer" in front of him.
 *
 * It is offered only when the desk is working down the list on its own.
 * When the DOCTOR has asked for a particular patient by number, "nobody
 * came" is news for him, not something for the desk to move past.
 */
export function CalledIn(
  { serialNo, nameBn, nameEn, outOfTurn, nextUp, noAnswer, onlyOneWaiting,
    stuckOnFlagged, flaggedWaiting, silent, bn, onSent, onNoAnswer, onSkipPriority }: {
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
     * Every patient a rule flagged has been called and none of them
     * came. The desk cannot be moved past them -- a flagged patient is
     * never called after an unflagged one -- so the tablet says so
     * rather than looking as though it ignored the tap.
     */
    stuckOnFlagged: boolean;
    /** How many of them there are, this one included. Said out loud so
     *  the desk can see the list getting shorter with each tap. */
    flaggedWaiting: number;
    /** The tablet cannot make a noise yet, so the screen has to say so. */
    silent: boolean;
    bn: boolean;
    onSent: () => void;
    /** Absent when this is a patient the doctor asked for by number. */
    onNoAnswer?: () => void;
    /**
     * The way out of the priority loop.
     *
     * A flagged patient is never called after an unflagged one, so when
     * the flagged ones are not in the room the calling order cannot get
     * past them and the same numbers come round for ever. This is a
     * person saying, for THIS named patient, that they are not here.
     * The flag, the place in the queue and the serial all stay; only
     * the calling order moves on, and the doctor is told.
     */
    onSkipPriority?: () => void;
  },
) {
  const name = nameBn ?? nameEn ?? '';
  // The amber panel is a lot of extra reading on a screen whose whole
  // point is one enormous number. When it is up, the number gives way
  // a little so the way out of the loop is on the screen and not
  // somewhere below it.
  const crowded = onNoAnswer !== undefined && stuckOnFlagged;
  return (
    <div className={crowded ? 'called-in crowded' : 'called-in'}>
      <div className="lead">
        {nextUp
          ? (bn ? 'এই নম্বর ডেকে বলুন' : 'Call this number out')
          : (bn ? 'ডাক্তার ডেকেছেন' : 'The doctor has called')}
      </div>
      <div className="serial">{serialNo}</div>
      <div className="name">{name}</div>

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
      {onNoAnswer !== undefined && stuckOnFlagged && (
        <div className="stuck">
          <div className="t">
            {bn
              ? `স্ক্রিনিংয়ে সতর্কতা আসা ${flaggedWaiting} জনকেই ডাকা হয়েছে, কেউ সাড়া দেননি।`
              : `${flaggedWaiting} ${flaggedWaiting === 1 ? 'person whose' : 'people whose'} screening raised a warning `
                + `${flaggedWaiting === 1 ? 'has' : 'have'} all been called, and none of them came.`}
          </div>
          {/* Exactly what one press does, and what it does NOT do. One
              name at a time is the whole safety of it: the assistant is
              saying this named person is not in the room, not turning
              the warnings off. */}
          <div className="d">
            {bn
              ? 'এই রোগী তালিকাতেই থাকবেন এবং ডাক্তারের পর্দায় সতর্কতা চিহ্ন থাকবেই। শুধু ডাকার ক্রম এগোবে, আর ডাক্তার দেখতে পাবেন যে এগোনো হয়েছে।'
              : 'This patient stays on the list and keeps their warning on the doctor’s screen. Only the calling order moves on, and the doctor is shown that it did.'}
          </div>
          {flaggedWaiting > 1 && (
            <div className="d">
              {bn
                ? `একবারে একজন। বাকি ${flaggedWaiting - 1} জনের নম্বরও একইভাবে একটি একটি করে এগোবে, তারপর সিরিয়াল অনুযায়ী পরের রোগী আসবেন।`
                : `One name at a time. ${flaggedWaiting === 2 ? 'The other one' : `The other ${flaggedWaiting - 1}`} `
                  + 'will come up the same way, and after them the list goes back to plain serial order.'}
            </div>
          )}
          {onSkipPriority !== undefined && (
            <button className="btn breaker" onClick={onSkipPriority}>
              {bn
                ? 'ইনি এখন নেই — পরের জনকে ডাকুন'
                : 'This one is not here — call somebody else'}
            </button>
          )}
        </div>
      )}

      {onNoAnswer !== undefined && !stuckOnFlagged && (
        <div className="reassure">
          {onlyOneWaiting
            ? (bn
              ? 'আর কেউ অপেক্ষায় নেই। এই রোগী তালিকাতেই থাকবেন — ডাক্তারের কাছে দেখাবে যে ডাকা হয়েছিল।'
              : 'Nobody else is waiting. This patient stays on the list either way — the doctor will see that they were called.')
            : (bn
              ? 'এই রোগী তালিকা থেকে বাদ যাবেন না। পরের জনকে ডাকা হবে, আর কিছুক্ষণ পর আবার ইনার নম্বর আসবে।'
              : 'This patient is not taken off the list. The next one comes up, and this number comes round again.')}
        </div>
      )}
    </div>
  );
}
