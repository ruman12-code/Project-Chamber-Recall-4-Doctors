import { useCallback, useEffect, useState } from 'react';
import { api, unwrap, type Failure } from './api';
import { FailureNotice } from './Failure';
import { Setup } from './screens/Setup';
import { Unlock } from './screens/Unlock';
import { Status } from './screens/Status';
import { RulesBlocked } from './screens/RulesBlocked';
import type { InstallationStatus, RedFlagStatus } from '../shared/ipc';

export function App() {
  const [status, setStatus] = useState<InstallationStatus | null>(null);
  const [rules, setRules] = useState<RedFlagStatus | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const refresh = useCallback(async () => {
    const installation = unwrap(await api.status());
    if (installation.failure) { setFailure(installation.failure); return; }
    setStatus(installation.value!.status);

    const rulebook = unwrap(await api.redFlagStatus());
    if (rulebook.failure) { setFailure(rulebook.failure); return; }
    setRules(rulebook.value!.status);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (failure) return <div className="page"><FailureNotice failure={failure} /></div>;
  if (status === null) return <div className="page"><p className="muted">Starting…</p></div>;

  // The guard. A live database does not open at all until the red flag
  // rules are fit to use. It is checked here, before any screen that
  // could show or record a patient.
  if (status.unlocked && status.dataMode === 'live' && rules !== null && rules.blocksLiveUse.length > 0) {
    return <RulesBlocked status={rules} />;
  }

  if (status.unlocked) return <Status />;
  if (!status.provisioned) return <Setup onDone={refresh} />;
  return <Unlock onUnlocked={refresh} />;
}
