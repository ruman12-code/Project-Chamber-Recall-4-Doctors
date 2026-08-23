/**
 * The red flag screen, on the tablet.
 *
 * Covers everything. The only way past it is the acknowledgement
 * button. It says nothing about how serious anything is - no score, no
 * level, no word like urgent - because the patient and whoever came
 * with them can read this screen from across the desk. It says what to
 * do, and the physician's own words for that rule.
 */
export function Alarm(
  { messages, acknowledging, onAcknowledge }:
  { messages: Array<{ ruleId: string; ruleVersion: string; bn: string; en: string }>;
    acknowledging: boolean; onAcknowledge: () => void },
) {
  return (
    <div className="alarm" role="alertdialog" aria-modal="true">
      <div className="bn">এখনই ডাক্তারকে জানান।<br />সিরিয়ালে অপেক্ষা করবেন না।</div>
      <div className="en">Tell the doctor now. Do not wait in the queue.</div>

      <div className="msg">
        {messages.map((message) => (
          <div key={`${message.ruleId}-${message.ruleVersion}`}>
            <p>{message.bn}</p>
            <p>{message.en}</p>
          </div>
        ))}
      </div>

      <button onClick={onAcknowledge} disabled={acknowledging} autoFocus>
        {acknowledging ? 'রেকর্ড হচ্ছে…' : 'আমি ডাক্তারকে জানিয়েছি / I have told the doctor'}
      </button>

      <div className="ref">{messages.map((m) => `${m.ruleId} · v${m.ruleVersion}`).join('  ·  ')}</div>
    </div>
  );
}
