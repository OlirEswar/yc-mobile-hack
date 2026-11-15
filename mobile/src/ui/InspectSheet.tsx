import { StyleSheet, View } from 'react-native';
import { RESOURCE_LABELS, type ResourceId } from '../../shared/colony';
import type { Id } from '../../shared/types';
import { clearSelection, follow, startPower, useAgent, useAgentDetail } from '../game/store';
import { firstName, occupationLabel } from './format';
import { Bar, Button, HeaderButton, KeyValue, L, Portrait, Section, Sheet, T } from './kit';
import { colors, space } from './theme';

const SOURCE_LABEL = { observed: 'saw it', told: 'was told', rumor: 'rumor', divine: 'whisper', inference: 'worked it out' } as const;

/** The colonist inspector: what they are doing, need, want, believe, and who they know. */
export function InspectSheet({ id }: { id: Id }) {
  const lite = useAgent(id);
  const detail = useAgentDetail(id);
  if (!lite) return null;
  const c = detail ?? lite;
  const hunger = c.needs.hunger;
  const rest = 100 - c.needs.fatigue;

  return (
    <Sheet right={<HeaderButton label="Close" onPress={clearSelection} />} testID="inspect-sheet">
      <View style={styles.head}>
        <Portrait spriteId={c.spriteId} size={60} dim={!c.alive} />
        <View style={styles.grow}>
          <T style={styles.name}>{c.name}</T>
          <T style={styles.dim}>{occupationLabel(c.occupation) + (c.alive ? ' · feels ' + c.mood : ' · died')}</T>
        </View>
      </View>
      {c.alive ? (
        <View style={styles.actions}>
          <Button label="Follow" kind="primary" style={styles.grow} onPress={() => follow(id)} testID="inspect-follow" />
          <Button label="Whisper" kind="earth" style={styles.grow} onPress={() => startPower('whisper', id)} />
          <Button label="Drop" style={styles.grow} onPress={() => startPower('grant', id)} />
        </View>
      ) : null}

      <Section title="Doing">
        <T>{detail?.death ? 'Died: ' + detail.death.cause : c.activityLabel}</T>
        {detail?.plan ? <T style={styles.dim}>{detail.plan.intent}</T> : null}
      </Section>

      <Section title="Needs">
        <View style={styles.needs}>
          <Bar label="Hunger" value={hunger} tint={hunger > 55 ? colors.amber : colors.good} width={64} />
          <Bar label="Thirst" value={c.needs.thirst} tint={c.needs.thirst > 55 ? colors.amber : colors.good} width={64} />
          <Bar label="Rest" value={rest} tint={rest < 35 ? colors.amber : colors.good} width={64} />
          <Bar label="Health" value={c.health} tint={c.health < 40 ? colors.danger : colors.good} width={64} />
        </View>
        {detail
          ? (Object.entries(detail.inventory) as [ResourceId, number][]).map(([r, n]) => (
              <KeyValue key={r} k={RESOURCE_LABELS[r]} v={r === 'credits' ? Math.round(n) + 'cr' : String(Math.round(n))} />
            ))
          : null}
      </Section>

      {detail?.goals.length ? (
        <Section title="Wants most">
          {detail.goals.slice(0, 3).map((g) => (
            <T key={g.id} style={g.source === 'divine' ? { color: colors.earth } : undefined}>
              {'> ' + g.description}
            </T>
          ))}
        </Section>
      ) : null}

      {detail?.beliefs.length ? (
        <Section title="Believes" footer={'Beliefs are what ' + firstName(c.name) + ' thinks, not what is true.'}>
          {detail.beliefs.map((b) => {
            const divine = b.sourceType === 'divine';
            return (
              <View key={b.id} style={[styles.belief, divine && styles.divine]}>
                <T style={[styles.grow, divine && { color: colors.earth }]}>{(divine ? '* ' : '') + b.text}</T>
                <View style={styles.right}>
                  <L>{Math.round(b.confidence * 100) + '%'}</L>
                  <T style={[styles.small, { color: divine ? colors.earth : colors.textDim }]}>{b.sourceAgentName ?? SOURCE_LABEL[b.sourceType]}</T>
                </View>
              </View>
            );
          })}
        </Section>
      ) : null}

      {detail?.relationships.length ? (
        <Section title="Ties">
          {detail.relationships.map((r) => (
            <View key={r.toAgentId} style={styles.belief}>
              <View style={styles.grow}>
                <T style={!r.toAgentAlive ? styles.dim : undefined}>{r.toAgentName}</T>
                <T style={styles.small}>{r.kind}</T>
              </View>
              <L style={{ color: r.trust < 0 ? colors.danger : colors.text }}>{(r.trust >= 0 ? '+' : '') + r.trust.toFixed(2)}</L>
            </View>
          ))}
        </Section>
      ) : null}

      {detail?.lastThought ? (
        <Section title="Why">
          <T>{detail.lastThought.intent}</T>
          <T style={styles.small}>{'after ' + detail.lastThought.trigger}</T>
        </Section>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  grow: { flex: 1 },
  name: { fontSize: 22 },
  dim: { color: colors.textDim },
  small: { fontSize: 12, color: colors.textDim },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  needs: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginBottom: 4 },
  belief: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 2 },
  divine: { backgroundColor: colors.earth + '22', marginHorizontal: -6, paddingHorizontal: 6 },
  right: { alignItems: 'flex-end' },
});
