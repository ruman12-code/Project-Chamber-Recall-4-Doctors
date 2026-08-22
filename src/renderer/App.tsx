import { useCallback, useEffect, useState } from 'react';
import { api, unwrap, type Failure } from './api';
import { FailureNotice } from './Failure';
import { Setup } from './screens/Setup';
import { Unlock } from './screens/Unlock';
import { Status } from './screens/Status';
import type { InstallationStatus } from '../shared/ipc';

export function App() {
  const [status, setStatus] = useState<InstallationStatus | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const refresh = useCallback(async () => {
    const { value, failure } = unwrap(await api.status());
    if (failure) { setFailure(failure); return; }
    setStatus(value!.status);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (failure) return <div className="page"><FailureNotice failure={failure} /></div>;
  if (status === null) return <div className="page"><p className="muted">Starting…</p></div>;
  if (status.unlocked) return <Status />;
  if (!status.provisioned) return <Setup onDone={refresh} />;
  return <Unlock onUnlocked={refresh} />;
}
