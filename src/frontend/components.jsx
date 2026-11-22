import React from 'react';
import { Box, Inline, Link, Lozenge, Stack, Strong, Tag, TagGroup, Text, Tooltip, User, xcss } from '@forge/react';

export const card = xcss({
  padding: 'space.150',
  borderRadius: 'border.radius.200',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
  backgroundColor: 'elevation.surface.raised',
});

export const warnCard = xcss({
  padding: 'space.150',
  borderRadius: 'border.radius.200',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border.warning',
  backgroundColor: 'color.background.warning',
});

export const statBox = xcss({
  padding: 'space.150',
  borderRadius: 'border.radius.200',
  backgroundColor: 'color.background.neutral',
  minWidth: '120px',
});

const SOURCE_LABEL = {
  'confluence-page': 'Confluence',
  'jira-comment': 'Jira comment',
  'jira-issue': 'Jira issue',
  manual: 'Manual',
};

export const sourceLabel = (t) => SOURCE_LABEL[t] || 'Manual';

export const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
};

export function StatusLozenge({ status }) {
  return status === 'superseded' ? (
    <Lozenge appearance="removed">Superseded</Lozenge>
  ) : (
    <Lozenge appearance="success">Active</Lozenge>
  );
}

export function Confidence({ value }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  return (
    <Tooltip content="Rule-based confidence that this contradicts the decision">
      <Lozenge appearance={pct >= 60 ? 'removed' : 'moved'} isBold={pct >= 60}>
        {pct >= 60 ? 'Likely conflict' : 'Possible conflict'} · {pct}%
      </Lozenge>
    </Tooltip>
  );
}

export function Owner({ owner }) {
  if (!owner) return null;
  if (owner.accountId) return <User accountId={owner.accountId} />;
  return <Text size="small">{owner.name}</Text>;
}

export function SourceLink({ source }) {
  if (!source) return null;
  // Manually recorded decisions that point at a page or issue just show that title.
  const label =
    source.type === 'manual' && source.title && source.title !== 'Recorded manually'
      ? source.title
      : `${sourceLabel(source.type)}${source.title ? `: ${source.title}` : ''}`;
  return source.url ? (
    <Link href={source.url} openNewTab>
      {label}
    </Link>
  ) : (
    <Text size="small" color="color.text.subtlest">
      {label}
    </Text>
  );
}

/**
 * One decision. `extra` renders under the meta line.
 * `compact` (narrow surfaces such as the page byline popup): status goes on the meta line
 * so long titles don't squeeze it, and the source link can be hidden when it is the current page.
 */
export function DecisionCard({ d, extra, actions, warn, compact, hideSource }) {
  return (
    <Box xcss={warn ? warnCard : card}>
      <Stack space="space.075">
        {compact ? (
          <Text>
            <Strong>{d.text}</Strong>
          </Text>
        ) : (
          <Inline space="space.100" alignBlock="start" spread="space-between">
            <Text>
              <Strong>{d.text}</Strong>
            </Text>
            <StatusLozenge status={d.status} />
          </Inline>
        )}
        {d.rationale ? (
          <Text size="small" color="color.text.subtle">
            Why: {d.rationale}
          </Text>
        ) : null}
        {d.status === 'superseded' && d.supersededByText ? (
          <Text size="small" color="color.text.subtle">
            Replaced by: {d.supersededByText}
          </Text>
        ) : null}
        <Inline space="space.150" alignBlock="center" shouldWrap>
          {compact ? <StatusLozenge status={d.status} /> : null}
          <Owner owner={d.owner} />
          <Text size="small" color="color.text.subtlest">
            {fmtDate(d.decidedAt)}
          </Text>
          {hideSource ? null : <SourceLink source={d.source} />}
        </Inline>
        {d.labels?.length ? (
          <TagGroup>
            {d.labels.slice(0, 6).map((l) => (
              <Tag key={l} text={l} />
            ))}
          </TagGroup>
        ) : null}
        {extra}
        {actions ? <Inline space="space.100">{actions}</Inline> : null}
      </Stack>
    </Box>
  );
}
