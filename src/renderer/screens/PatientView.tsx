import { BpSparkline, ValueSparkline } from './Sparkline';
import type { RecallCard } from '../../shared/recall';

/**
 * The screen turned towards the patient.
 *
 * This is a clinical feature, not decoration. Showing someone the shape
 * of their own illness is how a consultation improves rather than
 * degrades when a screen enters the room.
 *
 * What it deliberately does NOT show: diagnoses, medicines, the
 * doctor's notes, anything written about them rather than measured from
 * them, and above all nothing resembling a score or a severity. It
 * shows when they came and what their own numbers have done. Bangla,
 * and large, because someone is being asked to read it from the far
 * side of a desk while it is being explained to them.
 */
export function PatientView({ card, onClose }: { card: RecallCard; onClose: () => void }) {
  const name = card.patient.nameBn ?? card.patient.nameEn ?? '';

  return (
    <div className="pv">
      <h1>{name}</h1>
      <p className="sub">আপনি এ পর্যন্ত {card.totalVisits} বার এসেছেন</p>

      <div className="pv-grid">
        <div>
          <h2>আপনার আসার তারিখ</h2>
          <div className="pv-visits">
            {card.timeline.map((entry, i) => (
              <div className="pv-visit" key={entry.visitDate + i}>
                <span className="d">{entry.visitDate}</span>
                <span>{entry.chamberName}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2>আপনার শারীরিক মাপ, সময়ের সাথে</h2>
          <BpSparkline points={card.trend.bp} size="patient" label="রক্তচাপ / Blood pressure" />
          <ValueSparkline label="ওজন / Weight" unit="kg" points={card.trend.weight} decimals={1} size="patient" />
          <ValueSparkline label="রক্তে চিনি / Blood sugar" unit="mmol/L" points={card.trend.sugar} decimals={1} size="patient" />
        </div>
      </div>

      <div className="pv-foot">
        <button onClick={onClose}>ফিরে যান / Back</button>
      </div>
    </div>
  );
}
