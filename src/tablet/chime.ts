// ===================================================================
// The sound that makes somebody look up.
// ===================================================================
// The desk is not watching the tablet. The assistant is talking to a
// patient, writing on a card, answering the phone. A message that only
// appears on screen is a message nobody sees for two minutes, and two
// minutes is the doctor sitting in an empty room.
//
// So it makes a noise. Two short notes, a fifth apart, twice - close
// enough to a doorbell that nobody has to be taught what it means, and
// short enough not to become the thing everybody hates by Thursday.
//
// ANDROID WILL NOT LET A PAGE MAKE A NOISE UNTIL IT IS TOUCHED
//
// That is a rule of the browser and it cannot be argued with: audio
// started before any tap is silently refused. So the sound is armed on
// the first touch of the session, which the assistant makes anyway when
// they sign in, and the screen says plainly when it is not armed rather
// than pretending it will be heard.
let context: AudioContext | null = null;

/** Call from a real touch. Anything else and Android refuses. */
export function armChime(): void {
  if (context !== null) return;
  try {
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return;
    context = new Ctor();
    // Some versions start suspended even after a touch.
    void context.resume?.();
  } catch {
    context = null;
  }
}

export function chimeIsArmed(): boolean {
  return context !== null && context.state !== 'suspended';
}

function note(at: number, hz: number, seconds: number): void {
  if (context === null) return;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'sine';
  osc.frequency.value = hz;
  // Eased in and out. A square edge on a cheap tablet speaker is a
  // click, and a click twenty times an evening is why people turn the
  // sound off.
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(gain).connect(context.destination);
  osc.start(at);
  osc.stop(at + seconds + 0.02);
}

/** Two notes, twice. Loud enough to look up, short enough to forgive. */
export function chime(): void {
  if (context === null) return;
  try {
    void context.resume?.();
    const now = context.currentTime;
    for (const offset of [0, 0.62]) {
      note(now + offset, 660, 0.16);
      note(now + offset + 0.18, 988, 0.22);
    }
  } catch { /* a tablet that cannot make a noise still shows the screen */ }
}
