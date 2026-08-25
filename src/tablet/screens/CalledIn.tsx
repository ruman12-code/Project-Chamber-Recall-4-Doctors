/**
 * The doctor has called somebody in.
 *
 * This takes the whole screen, on top of whatever the assistant was
 * doing, because it is the one thing on this tablet that somebody in
 * another room is waiting on. It does not time out and it does not
 * dismiss itself: a patient walks in when a person sends them in, and
 * the tablet has no way of knowing that has happened.
 *
 * Whatever was on screen underneath is still there afterwards. Nothing
 * being typed is lost to this.
 */
export function CalledIn(
  { serialNo, nameBn, nameEn, outOfTurn, nextUp, silent, bn, onSent }: {
    serialNo: number;
    nameBn: string | null;
    nameEn: string | null;
    /** Somebody who was ahead of them is still waiting. */
    outOfTurn: boolean;
    /**
     * True when the doctor has just finished with somebody and this is
     * simply who is next, rather than a patient he asked for by number.
     * The desk is being told to send them in either way; the difference
     * is only in what the screen says at the top.
     */
    nextUp: boolean;
    /** The tablet cannot make a noise yet, so the screen has to say so. */
    silent: boolean;
    bn: boolean;
    onSent: () => void;
  },
) {
  const name = nameBn ?? nameEn ?? '';
  return (
    <div className="called-in">
      <div className="lead">
        {nextUp
          ? (bn ? 'ডাক্তার ফাঁকা আছেন — পরের রোগী' : 'The doctor is free — next patient')
          : (bn ? 'ডাক্তার ডেকেছেন' : 'The doctor has called')}
      </div>
      <div className="serial">{serialNo}</div>
      <div className="name">{name}</div>

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

      <button className="btn" onClick={onSent}>
        {bn ? 'রোগীকে পাঠিয়ে দিয়েছি' : 'I have sent them in'}
      </button>
    </div>
  );
}
