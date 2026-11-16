import { useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LOCATIONS, RESOURCE_LABELS, SPEEDS, TICKS_PER_DAY, type Speed } from '../../shared/colony';
import type { PowerType } from '../../shared/types';
import { MANIFEST } from '../art';
import { dismissBanner, getState, openBanner, setSpeed, startPower, useGame } from '../game/store';
import { scene } from '../render/scene';
import { clock } from './format';
import { L, Panel, T } from './kit';
import { Toast } from './Toast';
import { colors, space } from './theme';

/** The six powers of the mock's tray, in its order, plus the rumor the backend also offers. */
export const TRAY: { type: PowerType; short: string; title: string }[] = [
  { type: 'drought', short: 'Drought', title: 'Drought' },
  { type: 'storm', short: 'Meteors', title: 'Meteor Storm' },
  { type: 'grant', short: 'Drop', title: 'Supply Drop' },
  { type: 'create_character', short: 'Arrival', title: 'New Arrival' },
  { type: 'kill', short: 'End', title: 'End a Life' },
  { type: 'whisper', short: 'Whisper', title: 'Whisper' },
  { type: 'rumor', short: 'Rumor', title: 'Rumor' },
];
export const powerTitle = (type: PowerType) => TRAY.find((p) => p.type === type)?.title ?? type;

export const SPEED_LABEL: Record<Speed, string> = { 0: 'Pause', 1: '1x', 4: '4x', 8: '8x' };

/** The god-mode overlay on the colony map: clock, speed, stat chips, active effects and the power tray. */
export function ColonyHud({ onPatron, bottomInset }: { onPatron: () => void; bottomInset: number }) {
  const insets = useSafeAreaInsets();
  const world = useGame((s) => s.world);
  const banner = useGame((s) => s.banner);
  const premium = useGame((s) => s.premium);
  const location = useGame((s) => s.selectedLocationId);
  const [speedOpen, setSpeedOpen] = useState(false);
  const trend = useTrend();
  if (!world) return null;

  const food = Math.round(world.stockpiles.depot?.food ?? 0);
  const price = world.prices.food;
  const speed = world.status === 'running' ? world.speed : 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.top, { paddingTop: insets.top + 4 }]} pointerEvents="box-none">
        <View style={styles.measured} onLayout={(e: LayoutChangeEvent) => (scene.insetTop.value = e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
          <View style={styles.bar}>
            <Panel style={styles.clock}>
              <L style={styles.clockText}>{clock(world.tick)}</L>
            </Panel>
            <View style={styles.grow} />
            <Pressable onPress={() => setSpeedOpen(!speedOpen)} accessibilityRole="button" accessibilityLabel="Simulation speed" testID="speed-button">
              <Panel style={styles.iconButton}>
                <L style={styles.iconText}>{speed === 0 ? '||' : SPEED_LABEL[speed]}</L>
              </Panel>
            </Pressable>
            <Pressable onPress={onPatron} accessibilityRole="button" accessibilityLabel={premium ? 'Colony Pass' : 'Become a Patron'} testID="patron-button">
              <Panel style={[styles.iconButton, premium && { borderColor: colors.gold }]}>
                <L style={[styles.iconText, { color: premium ? colors.gold : colors.amber }]}>{premium ? 'PASS' : '...'}</L>
              </Panel>
            </Pressable>
          </View>
          <View style={styles.chips}>
            <StatChip label="People" value={String(world.population.alive)} />
            <StatChip label="Food" value={String(food)} trend={trend('food', food)} />
            <StatChip label="Price" value={price + 'cr'} trend={trend('price', price)} invert />
          </View>
        </View>
        {world.activeEffects.map((e) => {
          const sols = Math.max(1, Math.ceil((e.endTick - world.tick) / TICKS_PER_DAY));
          return (
            <Panel key={e.id} style={[styles.effect, { borderColor: e.type === 'storm' ? colors.danger : colors.amber }]}>
              <L style={[styles.effectText, { color: e.type === 'storm' ? colors.danger : colors.amber }]}>
                {e.label + ' · ' + (e.type === 'storm' ? 'passing' : sols + (sols === 1 ? ' sol left' : ' sols left'))}
              </L>
            </Panel>
          );
        })}
        {banner ? (
          <Pressable onPress={openBanner} onLongPress={dismissBanner} testID="banner">
            <Panel style={styles.banner}>
              <T style={styles.bannerText} lines={2}>
                {banner.summary}
              </T>
            </Panel>
          </Pressable>
        ) : null}
        <Toast />
        {speedOpen ? (
          <Panel style={[styles.speedMenu, { top: insets.top + 44 }]}>
            {SPEEDS.map((s) => (
              <Pressable
                key={s}
                style={[styles.speedItem, s === speed && styles.speedOn]}
                onPress={() => {
                  setSpeedOpen(false);
                  void setSpeed(s);
                }}
              >
                <L style={s === speed ? { color: colors.amber } : undefined}>{s === 0 ? 'Pause' : SPEED_LABEL[s] + ' speed'}</L>
              </Pressable>
            ))}
          </Panel>
        ) : null}
      </View>
      <View
        style={[styles.bottom, { paddingBottom: bottomInset + space.sm }]}
        pointerEvents="box-none"
        onLayout={(e: LayoutChangeEvent) => (scene.insetBottom.value = e.nativeEvent.layout.height)}
      >
        {location ? (
          <Panel style={styles.place}>
            <L style={styles.placeName}>{LOCATIONS[location].name + ((world.damage[location] ?? 0) > 0 ? ' · damaged' : '')}</L>
            <T style={styles.placeText} lines={2}>
              {LOCATIONS[location].description}
            </T>
            {world.stockpiles[location] ? (
              <T style={styles.placeStock}>
                {Object.entries(world.stockpiles[location]!)
                  .map(([r, n]) => RESOURCE_LABELS[r as keyof typeof RESOURCE_LABELS] + ' ' + Math.round(n ?? 0))
                  .join(' · ')}
              </T>
            ) : null}
          </Panel>
        ) : null}
        <PowerTray />
      </View>
    </View>
  );
}

/** Remembers the last different value of each stat so a chip can show which way it moved. */
function useTrend() {
  const last = useRef(new Map<string, { value: number; dir: number }>());
  return (key: string, value: number): number => {
    const prev = last.current.get(key);
    if (!prev) {
      last.current.set(key, { value, dir: 0 });
      return 0;
    }
    if (prev.value !== value) last.current.set(key, { value, dir: Math.sign(value - prev.value) });
    return last.current.get(key)!.dir;
  };
}

function StatChip({ label, value, trend = 0, invert }: { label: string; value: string; trend?: number; invert?: boolean }) {
  const good = invert ? trend < 0 : trend > 0;
  return (
    <Panel style={styles.chip}>
      <L style={styles.chipLabel}>{label}</L>
      <View style={styles.grow} />
      <T style={styles.chipValue}>{value}</T>
      {trend !== 0 ? <L style={[styles.chipTrend, { color: good ? colors.good : colors.danger }]}>{trend > 0 ? '^' : 'v'}</L> : null}
    </Panel>
  );
}

function PowerTray() {
  return (
    <Panel style={styles.tray}>
      {TRAY.map((p) => (
        <Pressable
          key={p.type}
          style={({ pressed }) => [styles.power, pressed && { opacity: 0.6 }]}
          onPress={() => startPower(p.type, getState().selectedAgentId ?? undefined)}
          accessibilityRole="button"
          accessibilityLabel={p.title}
          testID={'power-' + p.type}
        >
          <Image source={MANIFEST.icons.powers[p.type].source} style={styles.powerIcon} resizeMode="contain" />
          <L style={[styles.powerText, (p.type === 'whisper' || p.type === 'rumor') && { color: colors.earth }]} lines={1}>
            {p.short}
          </L>
        </Pressable>
      ))}
    </Panel>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: space.lg, gap: space.sm },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
  clock: { paddingHorizontal: space.md, paddingVertical: 8 },
  clockText: { fontSize: 12, color: colors.amber },
  iconButton: { minWidth: 44, height: 36, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  iconText: { fontSize: 11 },
  measured: { gap: space.sm },
  speedMenu: { position: 'absolute', right: space.lg, paddingVertical: 4 },
  speedItem: { paddingHorizontal: space.lg, paddingVertical: 10 },
  speedOn: { backgroundColor: colors.panelHi },
  chips: { flexDirection: 'row', gap: space.sm },
  chip: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7 },
  chipLabel: { fontSize: 9, color: colors.textDim },
  chipValue: { fontSize: 15 },
  chipTrend: { fontSize: 11 },
  effect: { alignSelf: 'center', paddingHorizontal: space.md, paddingVertical: 6 },
  effectText: { fontSize: 10 },
  banner: { paddingHorizontal: space.md, paddingVertical: 8, borderColor: colors.accent },
  bannerText: { fontSize: 14 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, gap: space.sm },
  place: { padding: space.md, gap: 4 },
  placeName: { fontSize: 11, color: colors.accent },
  placeText: { fontSize: 13, color: colors.textDim },
  placeStock: { fontSize: 13 },
  tray: { flexDirection: 'row', paddingHorizontal: 2, borderColor: colors.borderHi },
  power: { flex: 1, alignItems: 'center', paddingVertical: 8, gap: 5 },
  powerIcon: { width: 24, height: 24 },
  powerText: { fontSize: 8 },
});
