import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LOCATIONS, SPEEDS } from '../../shared/colony';
import type { Id } from '../../shared/types';
import { selectAgent, setSpeed, skipToNotable, unfollow, useAgent, useAgentDetail, useAgents, useGame } from '../game/store';
import { scene } from '../render/scene';
import { SPEED_LABEL } from './ColonyHud';
import { clock, occupationLabel } from './format';
import { Bar, Button, L, Panel, Portrait, Segmented, T } from './kit';
import { colors, space } from './theme';
import { Toast } from './Toast';

/** Follow mode: the camera tracks one colonist and this HUD shows their inner life. */
export function FollowHud({ id }: { id: Id }) {
  const insets = useSafeAreaInsets();
  const c = useAgent(id);
  const detail = useAgentDetail(id);
  const agents = useAgents();
  const world = useGame((s) => s.world);
  const skipping = useGame((s) => s.skipping);
  if (!c || !world) return null;

  const speed = world.status === 'running' ? world.speed : 0;
  const nearby = agents
    .filter((a) => a.id !== id && a.alive && !a.move && a.locationId === c.locationId)
    .slice(0, 2)
    .map((a) => a.name);
  const goal = detail?.goals[0]?.description;
  const beliefs = detail?.beliefs.slice(0, 2) ?? [];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="follow-hud">
      <View style={[styles.top, { paddingTop: insets.top + 4 }]} pointerEvents="box-none">
        <View style={styles.bar} onLayout={(e) => (scene.insetTop.value = e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
          <Button label="< Colony" onPress={unfollow} />
          <View style={styles.grow} />
          <Segmented style={styles.speed} value={speed} onChange={(s) => void setSpeed(s)} options={SPEEDS.map((s) => ({ value: s, label: s === 0 ? '||' : SPEED_LABEL[s] }))} />
        </View>
        <Toast />
      </View>
      <Panel style={[styles.card, { marginBottom: insets.bottom + space.sm }]}>
        <View onLayout={(e) => (scene.insetBottom.value = e.nativeEvent.layout.height + insets.bottom + space.lg)}>
          <View style={styles.head}>
            <Portrait spriteId={c.spriteId} />
            <View style={styles.grow}>
              <T style={styles.name}>{c.name}</T>
              <L style={styles.meta}>{occupationLabel(c.occupation) + ' · ' + clock(world.tick)}</L>
            </View>
            <View style={styles.bars}>
              <Bar label="Hunger" value={c.needs.hunger} tint={colors.amber} />
              <Bar label="Rest" value={100 - c.needs.fatigue} tint={colors.text} />
              <Bar label="Health" value={c.health} tint={colors.good} />
            </View>
          </View>
          <View style={styles.divider} />
          <Row k="Doing" v={c.activityLabel} />
          {goal ? <Row k="Wants" v={goal} /> : null}
          {beliefs.length ? (
            <View style={styles.row}>
              <L style={styles.key}>Believes</L>
              <View style={styles.grow}>
                {beliefs.map((b) => (
                  <T key={b.id} style={[styles.value, b.sourceType === 'divine' && { color: colors.earth }]} lines={2}>
                    {(b.sourceType === 'divine' ? '* ' : '') + b.text + '  ' + Math.round(b.confidence * 100) + '%'}
                  </T>
                ))}
              </View>
            </View>
          ) : null}
          <Row k="Nearby" v={(nearby.length ? nearby.join(', ') + ' · ' : '') + (c.move ? 'on the way to ' : '') + LOCATIONS[c.locationId].name} />
          <View style={styles.actions}>
            <Button label={skipping ? 'Skipping...' : 'Next notable event'} kind="primary" style={styles.grow} onPress={() => void skipToNotable()} disabled={skipping} />
            <Button
              label="Ties"
              onPress={() => {
                unfollow();
                selectAgent(id);
              }}
            />
          </View>
        </View>
      </Panel>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.row}>
      <L style={styles.key}>{k}</L>
      <T style={[styles.grow, styles.value]} lines={2}>
        {v}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.sm },
  bar: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
  speed: { width: 190 },
  card: { position: 'absolute', left: space.lg, right: space.lg, bottom: 0, padding: space.lg, borderColor: colors.borderHi },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: { fontSize: 19 },
  meta: { fontSize: 8, color: colors.textDim, marginTop: 2 },
  bars: { alignItems: 'flex-end', gap: 4 },
  divider: { height: 2, backgroundColor: colors.border, marginVertical: space.md },
  row: { flexDirection: 'row', gap: space.md, marginBottom: 8 },
  key: { width: 66, fontSize: 8, color: colors.textDim, paddingTop: 4 },
  value: { fontSize: 14 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
});
