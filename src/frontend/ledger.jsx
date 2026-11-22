import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, EmptyState, Heading, Inline, Label, Lozenge, Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle,
  ModalTransition, SectionMessage, Select, Spinner, Stack, Strong, Tab, TabList, TabPanel, Tabs, Text, TextArea,
  Textfield, Toggle, User, xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { Confidence, DecisionCard, fmtDate, statBox } from './components';

const STATUS = [
  { label: 'Active', value: 'active' },
  { label: 'Superseded', value: 'superseded' },
  { label: 'All', value: 'all' },
];
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// Personal spaces have keys like "~5f3a…"; show a readable label instead of the raw key.
const spaceLabel = (s) => (String(s.key).startsWith('~') ? `${s.name} (personal space)` : `${s.name} (${s.key})`);

const SOURCES = [
  { label: 'All sources', value: 'all' },
  { label: 'Confluence pages', value: 'confluence-page' },
  { label: 'Jira comments', value: 'jira-comment' },
  { label: 'Jira issues', value: 'jira-issue' },
  { label: 'Manual', value: 'manual' },
];

function Stat({ label, value, tone }) {
  return (
    <Box xcss={statBox}>
      <Stack space="space.050">
        <Text size="small" color="color.text.subtle">
          {label}
        </Text>
        <Heading size="large" color={tone}>
          {String(value ?? '–')}
        </Heading>
      </Stack>
    </Box>
  );
}

function ConflictNotes({ d }) {
  if (!d.conflictsWith?.length || d.status === 'superseded') return null;
  return (
    <SectionMessage appearance="warning" title="May contradict another decision">
      {d.conflictsWith.map((c) => (
        <Text key={c.id}>
          “{c.text}” — {c.reasons?.[0] || 'opposing stance'} ({Math.round(c.confidence * 100)}%)
        </Text>
      ))}
    </SectionMessage>
  );
}

function LedgerTab({ data, filters, setFilters, reload, labels }) {
  const [supersedeOf, setSupersedeOf] = useState(null);
  const [newText, setNewText] = useState('');
  const [newWhy, setNewWhy] = useState('');
  const [people, setPeople] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const openSupersede = (d) => {
    setNewText('');
    setNewWhy('');
    setActionError(null);
    setSupersedeOf(d);
  };
  const doSupersede = async () => {
    setBusy(true);
    try {
      await invoke('supersede', { id: supersedeOf.id, text: newText, rationale: newWhy.trim() || undefined });
      setSupersedeOf(null);
      reload();
    } catch (e) {
      setActionError(String(e.message || e));
    }
    setBusy(false);
  };
  const toggleStatus = async (d) => {
    try {
      await invoke('setStatus', { id: d.id, status: d.status === 'superseded' ? 'active' : 'superseded' });
      reload();
    } catch (e) {
      setActionError(String(e.message || e));
    }
  };
  const showPeople = async (d) => {
    setPeople({ loading: true, decision: d });
    try {
      setPeople(await invoke('stakeholders', { id: d.id }));
    } catch (e) {
      setPeople({ decision: d, people: [], teams: [], error: String(e.message || e) });
    }
  };

  return (
    <Stack space="space.200">
      <Inline space="space.150" alignBlock="end" shouldWrap>
        <Box xcss={xcss({ minWidth: '280px' })}>
          <Label labelFor="q">Search decisions</Label>
          {/* Uncontrolled on purpose: a controlled UI Kit Textfield drops keystrokes during fast typing. */}
          <Textfield
            id="q"
            placeholder="e.g. database, Friday deploys, refunds"
            defaultValue={filters.query}
            onChange={(e) => {
              const query = e.target.value;
              setFilters((f) => ({ ...f, query }));
            }}
          />
        </Box>
        <Box xcss={xcss({ minWidth: '150px' })}>
          <Label labelFor="status">Status</Label>
          <Select
            inputId="status"
            options={STATUS}
            value={STATUS.find((s) => s.value === filters.status)}
            onChange={(o) => setFilters((f) => ({ ...f, status: o.value }))}
          />
        </Box>
        <Box xcss={xcss({ minWidth: '180px' })}>
          <Label labelFor="source">Source</Label>
          <Select
            inputId="source"
            options={SOURCES}
            value={SOURCES.find((s) => s.value === filters.source)}
            onChange={(o) => setFilters((f) => ({ ...f, source: o.value }))}
          />
        </Box>
        <Box xcss={xcss({ minWidth: '160px' })}>
          <Label labelFor="label">Label</Label>
          <Select
            inputId="label"
            isClearable
            options={labels.map((l) => ({ label: l, value: l }))}
            value={filters.label ? { label: filters.label, value: filters.label } : null}
            onChange={(o) => setFilters((f) => ({ ...f, label: o ? o.value : '' }))}
          />
        </Box>
      </Inline>

      {actionError && !supersedeOf ? <SectionMessage appearance="error">{actionError}</SectionMessage> : null}
      {!data ? (
        <Spinner label="Loading ledger" />
      ) : data.results.length === 0 ? (
        <EmptyState
          header={filters.query ? 'No matching decisions' : 'No decisions yet'}
          description='Add a decision to any Confluence page (type /decision, a "Decisions" heading, or "Decision: …"), scan a space from the Capture tab, or ask the Decision Ledger agent in Rovo.'
        />
      ) : (
        <Stack space="space.150">
          {data.results.map((r) => (
            <DecisionCard
              key={r.decision.id}
              d={r.decision}
              warn={r.decision.status !== 'superseded' && r.decision.conflictsWith?.length > 0}
              extra={
                <Stack space="space.050">
                  {r.score != null ? (
                    <Text size="small" color="color.text.subtlest">
                      Relevance {Math.round(r.score * 100)}% · matched: {r.matchedTerms.join(', ')}
                    </Text>
                  ) : null}
                  <ConflictNotes d={r.decision} />
                </Stack>
              }
              actions={[
                <Button key="p" appearance="subtle" spacing="compact" onClick={() => showPeople(r.decision)}>
                  Who to involve
                </Button>,
                r.decision.status !== 'superseded' ? (
                  <Button key="s" appearance="subtle" spacing="compact" onClick={() => openSupersede(r.decision)}>
                    Supersede…
                  </Button>
                ) : null,
                <Button key="t" appearance="subtle" spacing="compact" onClick={() => toggleStatus(r.decision)}>
                  {r.decision.status === 'superseded' ? 'Reactivate' : 'Retire'}
                </Button>,
              ].filter(Boolean)}
            />
          ))}
        </Stack>
      )}

      <ModalTransition>
        {supersedeOf ? (
          <Modal onClose={() => setSupersedeOf(null)}>
            <ModalHeader>
              <ModalTitle>Supersede decision</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Stack space="space.150">
                <Text>
                  Replacing: <Strong>{supersedeOf.text}</Strong>
                </Text>
                <Label labelFor="nt">New decision</Label>
                <TextArea id="nt" placeholder="One clear sentence" onChange={(e) => setNewText(e.target.value)} />
                <Label labelFor="nw">Why it changed (optional)</Label>
                <TextArea id="nw" onChange={(e) => setNewWhy(e.target.value)} />
                <Text size="small" color="color.text.subtle">
                  The old decision stays in the ledger as history, linked to the new one.
                </Text>
                {actionError ? <SectionMessage appearance="error">{actionError}</SectionMessage> : null}
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setSupersedeOf(null)}>
                Cancel
              </Button>
              <Button appearance="primary" isDisabled={newText.trim().length < 6 || busy} onClick={doSupersede}>
                {busy ? 'Superseding…' : 'Supersede'}
              </Button>
            </ModalFooter>
          </Modal>
        ) : null}
        {people ? (
          <Modal onClose={() => setPeople(null)}>
            <ModalHeader>
              <ModalTitle>Who to involve</ModalTitle>
            </ModalHeader>
            <ModalBody>
              {people.loading ? (
                <Spinner />
              ) : (
                <Stack space="space.150">
                  <Text>
                    Before changing <Strong>{people.decision?.text}</Strong>, consult:
                  </Text>
                  {people.error ? <SectionMessage appearance="error">{people.error}</SectionMessage> : null}
                  {people.people.length ? (
                    people.people.map((p) => (
                      <Inline key={p.accountId || p.name} space="space.100" alignBlock="center">
                        {p.accountId ? <User accountId={p.accountId} /> : <Text>{p.name}</Text>}
                        <Lozenge>{p.role}</Lozenge>
                      </Inline>
                    ))
                  ) : (
                    <Text>No owner recorded.</Text>
                  )}
                  {people.teams?.length ? <Text>Teams: {people.teams.join(', ')}</Text> : null}
                  <Text size="small" color="color.text.subtlest">
                    Source: {people.via === 'teamwork-graph' ? 'Atlassian Teamwork Graph (page owners, contributors and their teams)' : 'decision record'}
                  </Text>
                </Stack>
              )}
            </ModalBody>
            <ModalFooter>
              <Button onClick={() => setPeople(null)}>Close</Button>
            </ModalFooter>
          </Modal>
        ) : null}
      </ModalTransition>
    </Stack>
  );
}

function CheckTab() {
  const [text, setText] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setRes(await invoke('checkText', { text }));
    } catch (e) {
      setError(String(e.message || e));
    }
    setBusy(false);
  };
  return (
    <Stack space="space.200">
      <Text>Paste an RFC paragraph, a plan or a ticket description to see which recorded decisions it touches or contradicts.</Text>
      <TextArea
        placeholder="e.g. Proposal: move the user store to MongoDB so we can iterate on the schema faster."
        onChange={(e) => setText(e.target.value)}
      />
      <Inline>
        <Button appearance="primary" isDisabled={text.trim().length < 8 || busy} onClick={run}>
          {busy ? 'Checking…' : 'Check against ledger'}
        </Button>
      </Inline>
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      {res ? (
        <Stack space="space.150">
          {res.conflicts.length ? (
            <SectionMessage appearance="warning" title={`${plural(res.conflicts.length, 'possible contradiction')}`}>
              <Text>Review these before going ahead, or supersede the decision.</Text>
            </SectionMessage>
          ) : (
            <SectionMessage appearance="success" title="No contradictions found">
              <Text>Nothing in the ledger argues against this.</Text>
            </SectionMessage>
          )}
          {res.conflicts.map((c) => (
            <DecisionCard
              key={c.decision.id}
              d={c.decision}
              warn
              extra={
                <Stack space="space.050">
                  <Confidence value={c.confidence} />
                  {c.reasons.map((r) => (
                    <Text key={r} size="small">
                      {r}
                    </Text>
                  ))}
                </Stack>
              }
            />
          ))}
          {(() => {
            const rel = res.related.filter((r) => !res.conflicts.some((c) => c.decision.id === r.decision.id));
            return rel.length ? (
              <Stack space="space.100">
                <Heading size="small">Related decisions</Heading>
                {rel.map((r) => (
                  <DecisionCard key={r.decision.id} d={r.decision} />
                ))}
              </Stack>
            ) : null;
          })()}
        </Stack>
      ) : null}
    </Stack>
  );
}

function CaptureTab({ reload }) {
  const [spaces, setSpaces] = useState([]);
  const [space, setSpace] = useState(null);
  const [scan, setScan] = useState(null);
  const [busy, setBusy] = useState(false);
  const emptyForm = { text: '', rationale: '', labels: '', sourceUrl: '' };
  const [form, setForm] = useState(emptyForm);
  const [formKey, setFormKey] = useState(0); // bumping it remounts (clears) the uncontrolled fields
  const [saved, setSaved] = useState(null);
  const [recordError, setRecordError] = useState(null);

  useEffect(() => {
    invoke('spaces').then(setSpaces).catch(() => setSpaces([]));
  }, []);

  const runScan = async (cursor) => {
    setBusy(true);
    try {
      const r = await invoke('scanSpace', { spaceKey: space.value, cursor });
      setScan((prev) => ({
        scanned: (cursor ? prev?.scanned || 0 : 0) + r.scanned,
        found: (cursor ? prev?.found || 0 : 0) + r.found,
        conflicts: (cursor ? prev?.conflicts || 0 : 0) + r.conflicts,
        cursor: r.cursor,
      }));
      reload();
    } catch (e) {
      setScan({ error: String(e.message || e) });
    }
    setBusy(false);
  };

  const record = async () => {
    setBusy(true);
    setRecordError(null);
    try {
      const r = await invoke('record', { ...form, labels: form.labels.split(',') });
      setSaved(r);
      setForm(emptyForm);
      setFormKey((k) => k + 1);
      reload();
    } catch (e) {
      setRecordError(String(e.message || e));
    }
    setBusy(false);
  };
  const field = (k) => (e) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  return (
    <Stack space="space.300">
      <Stack space="space.150">
        <Heading size="small">Backfill from a Confluence space</Heading>
        <Text>
          New and edited pages are captured automatically. To import existing meeting notes and ADRs, scan a space 25 pages at a time.
        </Text>
        <Inline space="space.150" alignBlock="end">
          <Box xcss={xcss({ minWidth: '260px' })}>
            <Label labelFor="space">Space</Label>
            <Select inputId="space" options={spaces.map((s) => ({ label: spaceLabel(s), value: s.key }))} value={space} onChange={setSpace} />
          </Box>
          <Button appearance="primary" isDisabled={!space || busy} onClick={() => runScan(null)}>
            {busy ? 'Scanning…' : 'Scan space'}
          </Button>
          {scan?.cursor ? (
            <Button isDisabled={busy} onClick={() => runScan(scan.cursor)}>
              Scan next 25
            </Button>
          ) : null}
        </Inline>
        {scan?.error ? <SectionMessage appearance="error">{scan.error}</SectionMessage> : null}
        {scan && !scan.error ? (
          <SectionMessage appearance={scan.conflicts ? 'warning' : 'success'}>
            <Text>
              Scanned {plural(scan.scanned, 'page')} · {plural(scan.found, 'decision')} found · {plural(scan.conflicts, 'possible conflict')}
              {scan.cursor ? ' · more pages available' : ''}
            </Text>
          </SectionMessage>
        ) : null}
      </Stack>

      <Stack space="space.150">
        <Heading size="small">Record a decision</Heading>
        <Stack space="space.150" key={formKey}>
          <Stack space="space.050">
            <Label labelFor="dt">Decision</Label>
            <Textfield id="dt" placeholder="One clear sentence, e.g. Refunds over €200 need finance approval" onChange={field('text')} />
          </Stack>
          <Stack space="space.050">
            <Label labelFor="dr">Why</Label>
            <TextArea id="dr" onChange={field('rationale')} />
          </Stack>
          <Inline space="space.150" shouldWrap>
            <Box xcss={xcss({ minWidth: '220px' })}>
              <Label labelFor="dl">Labels (comma-separated)</Label>
              <Textfield id="dl" placeholder="e.g. payments, refunds" onChange={field('labels')} />
            </Box>
            <Box xcss={xcss({ minWidth: '320px' })}>
              <Label labelFor="du">Link (optional)</Label>
              <Textfield id="du" placeholder="https://…" onChange={field('sourceUrl')} />
            </Box>
          </Inline>
        </Stack>
        <Inline>
          <Button appearance="primary" isDisabled={form.text.trim().length < 6 || busy} onClick={record}>
            Add to ledger
          </Button>
        </Inline>
        {recordError ? <SectionMessage appearance="error">{recordError}</SectionMessage> : null}
        {saved ? (
          <SectionMessage appearance={saved.conflicts.length ? 'warning' : 'success'} title={saved.conflicts.length ? 'Recorded — but check these' : 'Recorded'}>
            {saved.conflicts.length ? (
              saved.conflicts.map((c) => (
                <Text key={c.decision.id}>
                  “{c.decision.text}” — {c.reasons[0]}
                </Text>
              ))
            ) : (
              <Text>{saved.decision.text}</Text>
            )}
          </SectionMessage>
        ) : null}
      </Stack>
    </Stack>
  );
}

function ActivityTab({ activity }) {
  if (!activity?.length) return <EmptyState header="No activity yet" description="Scans, new decisions and conflict flags will show up here." />;
  return (
    <Stack space="space.100">
      {activity.map((a, i) => (
        <Inline key={i} space="space.100" alignBlock="center">
          <Lozenge appearance={a.kind === 'conflict' ? 'removed' : a.kind === 'record' ? 'new' : a.kind === 'status' ? 'moved' : 'default'}>
            {a.kind}
          </Lozenge>
          <Text size="small" color="color.text.subtlest">
            {fmtDate(a.at)}
          </Text>
          <Text>{a.message}</Text>
        </Inline>
      ))}
    </Stack>
  );
}

function SettingsTab() {
  const [s, setS] = useState(null);
  useEffect(() => {
    invoke('getSettings').then(setS);
  }, []);
  if (!s) return <Spinner />;
  const set = async (k, v) => setS(await invoke('saveSettings', { [k]: v }));
  const row = (k, label, help) => (
    <Inline space="space.150" alignBlock="center" key={k}>
      <Toggle id={k} isChecked={!!s[k]} onChange={() => set(k, !s[k])} />
      <Stack space="space.0">
        <Label labelFor={k}>{label}</Label>
        <Text size="small" color="color.text.subtle">
          {help}
        </Text>
      </Stack>
    </Inline>
  );
  return (
    <Stack space="space.200">
      {row('autoScanPages', 'Capture from Confluence automatically', 'Extract decisions whenever a page is created or edited.')}
      {row('autoScanComments', 'Capture from Jira comments', 'Lines like "Decision: …" in Jira comments are added to the ledger.')}
      {row('checkIssues', 'Check new Jira work', 'New issues and comments are checked against active decisions.')}
      {row('autoComment', 'Post a heads-up comment', 'When a likely contradiction is found, add a short warning comment on the issue.')}
    </Stack>
  );
}

function App() {
  const [filters, setFilters] = useState({ query: '', status: 'active', source: 'all', label: '' });
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    const h = setTimeout(() => {
      invoke('ledger', filters)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError(String(e.message || e)));
    }, 250);
    return () => clearTimeout(h);
  }, [filters, tick]);

  const st = data?.stats || {};
  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Heading size="xlarge">Decision Ledger</Heading>
        <Text color="color.text.subtle">
          Every decision your team made in Confluence and Jira — what, why, who and when — and a warning when new work contradicts one.
        </Text>
      </Stack>
      <Inline space="space.150" shouldWrap>
        <Stat label="Active decisions" value={st.active} />
        <Stat label="Flagged Jira issues" value={st.flaggedIssues} tone={st.flaggedIssues ? 'color.text.warning' : undefined} />
        <Stat label="Conflicting decisions" value={st.withConflicts} tone={st.withConflicts ? 'color.text.warning' : undefined} />
        <Stat label="From Confluence" value={st.fromConfluence} />
        <Stat label="From Jira" value={st.fromJira} />
        <Stat label="Superseded" value={st.superseded} />
      </Inline>
      {error ? <SectionMessage appearance="error">{error}</SectionMessage> : null}
      <Tabs id="ledger-tabs">
        <TabList>
          <Tab>Ledger</Tab>
          <Tab>Check a proposal</Tab>
          <Tab>Capture</Tab>
          <Tab>Activity</Tab>
          <Tab>Settings</Tab>
        </TabList>
        <TabPanel>
          <Box xcss={xcss({ paddingTop: 'space.200', width: '100%' })}>
            <LedgerTab data={data} filters={filters} setFilters={setFilters} reload={reload} labels={data?.labels || []} />
          </Box>
        </TabPanel>
        <TabPanel>
          <Box xcss={xcss({ paddingTop: 'space.200', width: '100%' })}>
            <CheckTab />
          </Box>
        </TabPanel>
        <TabPanel>
          <Box xcss={xcss({ paddingTop: 'space.200', width: '100%' })}>
            <CaptureTab reload={reload} />
          </Box>
        </TabPanel>
        <TabPanel>
          <Box xcss={xcss({ paddingTop: 'space.200', width: '100%' })}>
            <ActivityTab activity={data?.activity} />
          </Box>
        </TabPanel>
        <TabPanel>
          <Box xcss={xcss({ paddingTop: 'space.200', width: '100%' })}>
            <SettingsTab />
          </Box>
        </TabPanel>
      </Tabs>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
