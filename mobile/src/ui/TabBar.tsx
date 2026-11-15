import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { goToEvent, setTab, useEvents, useGame, type Tab } from '../game/store';
import { eventTint, timeOf, visibleToPlayer } from './format';
import { L, T } from './kit';
import { colors, space } from './theme';

const TABS: { tab: Tab; label: string }[] = [
  { tab: 'colony', label: 'Colony' },
  { tab: 'people', label: 'People' },
  { tab: 'chronicle', label: 'Chronicle' },
];

/** The bottom tab bar with the latest consequence pinned above it. Reports its height through onHeight. */
export function TabBar({ onHeight }: { onHeight: (h: number) => void }) {
  const insets = useSafeAreaInsets();
  const tab = useGame((s) => s.tab);
  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]} onLayout={(e) => onHeight(e.nativeEvent.layout.height)}>
      <Ticker />
      <View style={styles.tabs}>
        {TABS.map((t) => {
          const on = t.tab === tab;
          return (
            <Pressable
              key={t.tab}
              style={[styles.tab, on && styles.tabOn]}
              onPress={() => setTab(t.tab)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              testID={'tab-' + t.tab}
            >
              <L style={[styles.tabText, on && { color: colors.amber }]}>{t.label}</L>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Ticker() {
  const events = useEvents();
  let latest = null;
  for (let i = events.length - 1; i >= 0; i--)
    if (visibleToPlayer(events[i])) {
      latest = events[i];
      break;
    }
  if (!latest) return null;
  const e = latest;
  return (
    <Pressable style={styles.ticker} onPress={() => goToEvent(e)} accessibilityLabel={'Latest: ' + e.summary} testID="ticker">
      <View style={[styles.dot, { backgroundColor: eventTint(e) }]} />
      <T style={styles.tickerText} lines={1}>
        {e.summary}
      </T>
      <L style={styles.tickerTime}>{timeOf(e.tick)}</L>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.ink, borderTopWidth: 2, borderColor: colors.border },
  ticker: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: space.lg, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.panelHi },
  dot: { width: 8, height: 8 },
  tickerText: { flex: 1, fontSize: 13 },
  tickerTime: { fontSize: 9, color: colors.textDim },
  tabs: { flexDirection: 'row' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderTopWidth: 2, borderColor: 'transparent', marginTop: -1 },
  tabOn: { borderColor: colors.amber },
  tabText: { fontSize: 11, color: colors.textDim },
});
