import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button, EmptyState, Heading, Inline, Label, SectionMessage, Spinner, Stack, Text, TextArea, Textfield,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { Confidence, DecisionCard } from './components';

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ text: '', rationale: '' });
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    invoke('issueInsights')
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(String(e.message || e)));
  useEffect(() => {
    load();
  }, []);

  const dismiss = async (id) => {
    await invoke('dismissConflict', { decisionId: id });
    load();
  };
  const record = async () => {
    setBusy(true);
    try {
      const r = await invoke('recordFromIssue', { ...form, labels: data?.issue?.labels || [], sourceUrl: data?.issue?.url, sourceTitle: `${data?.issue?.key}: ${data?.issue?.summary}` });
      setSaved(r);
      setForm({ text: '', rationale: '' });
      setShowForm(false);
      load();
    } catch (e) {
      setError(String(e.message || e));
    }
    setBusy(false);
  };
  const recheck = async () => {
    setBusy(true);
    await load();
    setBusy(false);
  };

  if (error) return <SectionMessage appearance="error">{error}</SectionMessage>;
  if (!data) return <Spinner label="Checking the decision ledger" />;

  const conflicts = data.conflicts.filter((c) => !data.dismissed.includes(c.decision.id));
  const related = data.related.filter((r) => !conflicts.some((c) => c.decision.id === r.decision.id));

  return (
    <Stack space="space.200">
      {conflicts.length ? (
        <SectionMessage appearance="warning" title={`This work may contradict ${conflicts.length === 1 ? 'a team decision' : `${conflicts.length} team decisions`}`}>
          <Text>Check with the decision owner, adjust the plan, or supersede the decision in the ledger.</Text>
        </SectionMessage>
      ) : data.ledgerSize ? (
        <SectionMessage appearance="success" title="Consistent with recorded decisions">
          <Text>Checked against {data.ledgerSize} recorded {data.ledgerSize === 1 ? 'decision' : 'decisions'}.</Text>
        </SectionMessage>
      ) : null}

      {conflicts.map((c) => (
        <DecisionCard
          key={c.decision.id}
          d={c.decision}
          warn
          extra={
            <Stack space="space.050">
              <Inline space="space.100" alignBlock="center">
                <Confidence value={c.confidence} />
                <Text size="small" color="color.text.subtlest">
                  found in {c.where}
                </Text>
              </Inline>
              {c.reasons.map((r) => (
                <Text key={r} size="small">
                  {r}
                </Text>
              ))}
            </Stack>
          }
          actions={[
            <Button key="d" appearance="subtle" spacing="compact" onClick={() => dismiss(c.decision.id)}>
              Not a conflict
            </Button>,
          ]}
        />
      ))}

      {related.length ? (
        <Stack space="space.100">
          <Heading size="xsmall">Related decisions</Heading>
          {related.map((r) => (
            <DecisionCard
              key={r.decision.id}
              d={r.decision}
              extra={
                <Text size="small" color="color.text.subtlest">
                  Matched on: {r.matchedTerms.join(', ')}
                </Text>
              }
            />
          ))}
        </Stack>
      ) : null}

      {data.recordedHere.length ? (
        <Stack space="space.100">
          <Heading size="xsmall">Decided in this issue</Heading>
          {data.recordedHere.map((d) => (
            <DecisionCard key={d.id} d={d} />
          ))}
        </Stack>
      ) : null}

      {!conflicts.length && !related.length && !data.recordedHere.length ? (
        <EmptyState header="No related decisions" description='Nothing in the ledger matches this issue yet. Write "Decision: …" in a comment, or record one below.' />
      ) : null}

      {saved ? (
        <SectionMessage appearance={saved.conflicts.length ? 'warning' : 'success'} title="Decision recorded">
          <Text>{saved.decision.text}</Text>
          {saved.conflicts.map((c) => (
            <Text key={c.decision.id}>
              ⚠ may contradict “{c.decision.text}” — {c.reasons[0]}
            </Text>
          ))}
        </SectionMessage>
      ) : null}

      {showForm ? (
        <Stack space="space.100">
          <Label labelFor="t">Decision</Label>
          <Textfield id="t" placeholder="One clear sentence" onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))} />
          <Label labelFor="r">Why</Label>
          <TextArea id="r" onChange={(e) => setForm((f) => ({ ...f, rationale: e.target.value }))} />
          <Inline space="space.100">
            <Button appearance="primary" isDisabled={form.text.trim().length < 6 || busy} onClick={record}>
              Add to ledger
            </Button>
            <Button appearance="subtle" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </Inline>
        </Stack>
      ) : (
        <Inline space="space.100">
          <Button
            onClick={() => {
              setForm({ text: '', rationale: '' });
              setShowForm(true);
            }}
          >
            Record a decision
          </Button>
          <Button appearance="subtle" isDisabled={busy} onClick={recheck}>
            {busy ? 'Checking…' : 'Re-check'}
          </Button>
        </Inline>
      )}
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
