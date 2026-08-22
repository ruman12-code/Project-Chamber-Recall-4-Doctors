import { useEffect, useState } from 'react';
import { api, unwrap, type Failure } from '../api';
import { FailureNotice } from '../Failure';
import type { DatabaseSummary } from '../../shared/ipc';

const LABELS: Record<string, string> = {
  patient: 'Patients',
  chamber: 'Chambers',
  visit: 'Visits',
  intake: 'Intakes taken',
  intake_answer: 'Intake answers',
  red_flag_event: 'Red flag events',
  vitals: 'Vitals recorded',
  encounter: 'Encounters',
  medication: 'Medication lines',
  investigation: 'Investigations',
  investigations_outstanding: 'Investigations with no result yet',
  attachment: 'Attachments',
  app_user: 'Users',
  audit_log: 'Audit entries',
  usage_event: 'Usage events',
};

/**
 * Milestone 1 only. This screen exists to prove the foundations are
 * real: the database opened, the schema is there, the seeded history
 * is the right size, and the audit log is recording. It is scaffolding
 * for the build, not a screen anyone will use in a chamber.
 */
export function Status() {
  const [summary, setSummary] = useState<DatabaseSummary | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  useEffect(() => {
    void (async () => {
      const { value, failure } = unwrap(await api.summary());
      if (failure) { setFailure(failure); return; }
      setSummary(value!.summary);
    })();
  }, []);

  if (failure) return <div className="page"><FailureNotice failure={failure} /></div>;
  if (summary === null) return <div className="page"><p className="muted">Reading the records…</p></div>;

  return (
    <div className="page">
      {summary.dataMode === 'demo' && (
        <div className="banner">
          PRACTICE DATABASE — the people in here are invented. Never enter a real patient.
        </div>
      )}

      <h1>Foundations</h1>
      <p className="subtitle">
        Milestone 1: encrypted database, full schema, roles, append-only audit log, and seeded history.
      </p>

      <h2>What is in the database</h2>
      <div className="grid">
        {Object.entries(summary.counts).map(([key, n]) => (
          <div className="stat" key={key}>
            <div className="n">{n.toLocaleString()}</div>
            <div className="k">{LABELS[key] ?? key}</div>
          </div>
        ))}
      </div>

      <h2>Most recent audit entries</h2>
      <p className="muted">
        This log can be added to and never changed or removed. The database itself refuses
        an edit or a delete, so no part of this program can quietly rewrite its own history.
      </p>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table>
          <thead>
            <tr><th>When</th><th>Who</th><th>What happened</th><th>To what</th></tr>
          </thead>
          <tbody>
            {summary.recentAudit.map((entry) => (
              <tr key={entry.id}>
                <td className="muted">{new Date(entry.timestamp).toLocaleString()}</td>
                <td>{entry.actor_role}</td>
                <td>{entry.action}</td>
                <td className="muted">{entry.entity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted">
        Created {summary.createdAt ? new Date(summary.createdAt).toLocaleString() : 'unknown'}
        {summary.seededAt && ` · practice data added ${new Date(summary.seededAt).toLocaleString()}`}
      </p>
    </div>
  );
}
