import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, EmptyState, Inline, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';
import { DecisionCard } from './components';

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function App() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    invoke('pageDecisions').then(setData).catch((e) => setError(String(e.message || e)));
  }, []);

  const rescan = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await invoke('scanThisPage');
      setResult(r);
      setData({ pageId: r.page.id, decisions: r.decisions });
    } catch (e) {
      setError(String(e.message || e));
    }
    setBusy(false);
  };

  if (!data && !error) return <Spinner label="Loading decisions" />;
  const decisions = data?.decisions || [];

  // The scan button and its result sit at the top: the popup can be taller than the viewport.
  return (
    <Stack space="space.150">
      <Inline space="space.100" alignBlock="center" spread="space-between">
        <Text size="small" color="color.text.subtle">
          {plural(decisions.length, 'decision')} captured from this page
        </Text>
        <Button appearance="primary" spacing="compact" isDisabled={busy} onClick={rescan}>
          {busy ? 'Scanning…' : 'Scan this page now'}
        </Button>
      </Inline>
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      {result ? (
        <SectionMessage appearance={result.conflicts ? 'warning' : 'success'}>
          <Text>
            {plural(result.total, 'decision')} on this page · {result.added} new · {plural(result.conflicts, 'possible conflict')}
          </Text>
        </SectionMessage>
      ) : null}
      {decisions.length ? (
        decisions.map((d) => (
          <DecisionCard
            key={d.id}
            d={d}
            compact
            hideSource
            warn={d.conflictsWith?.length > 0 && d.status !== 'superseded'}
            extra={
              d.conflictsWith?.length && d.status !== 'superseded' ? (
                <Text size="small">⚠ May contradict “{d.conflictsWith[0].text}” — {d.conflictsWith[0].reasons?.[0]}</Text>
              ) : null
            }
          />
        ))
      ) : (
        <EmptyState
          header="No decisions captured"
          description='Type /decision in the editor, add a "Decisions" heading, or write "Decision: …". The ledger picks it up when you publish.'
        />
      )}
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
