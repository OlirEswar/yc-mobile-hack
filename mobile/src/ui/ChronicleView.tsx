import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Id, WorldEventPublic } from '../../shared/types';
import { getSource, goToEvent, openChronicle, useEvents, useGame } from '../game/store';
import { eventTint, timeOf, visibleToPlayer } from './format';
import { Button, L, Segmented, T } from './kit';
import { colors, space } from './theme';

const CATEGORY_LABEL: Record<WorldEventPublic['category'], string> = {
  environment: 'Environment',
  economy: 'Economy',
  social: 'Social',
  politics: 'Politics',
  health: 'Health',
  action: 'Action',
  intervention: 'Intervention',
};
const sol = (tick: number) => Math.floor((tick * 10 + 360) / 1440) + 1;

/** The cause chain through one event, or the world feed. Tapping a feed entry opens its chain. */
export function ChronicleView({ bottomInset }: { bottomInset: number }) {
  const insets = useSafeAreaInsets();
  const events = useEvents();
  const pinned = useGame((s) => s.chronicleEventId);
  const [mode, setMode] = useState<'chain' | 'feed'>('chain');
  const feed = useMemo(() => events.filter(visibleToPlayer).reverse(), [events]);

  // With nothing pinned, show the chain behind the newest event that has a recorded cause.
  const focus: Id | null = useMemo(() => {
    if (pinned) return pinned;
    return feed.find((e) => e.causationEventId)?.id ?? feed.find((e) => e.category === 'intervention')?.id ?? feed[0]?.id ?? null;
  }, [pinned, feed]);

  useEffect(() => {
    if (pinned) setMode('chain');
  }, [pinned]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.sm }]} testID="chronicle-view">
      <View style={styles.head}>
        <L style={styles.title}>Chronicle</L>
        <Segmented
          style={styles.mode}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'chain', label: 'Cause chain' },
            { value: 'feed', label: 'World feed' },
          ]}
        />
      </View>
      {mode === 'chain' ? (
        <Chain eventId={focus} bottomInset={bottomInset} />
      ) : (
        <FlatList
          data={feed}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ paddingBottom: bottomInset + space.lg }}
          renderItem={({ item: e }) => (
            <Pressable style={({ pressed }) => [styles.feedRow, pressed && { backgroundColor: colors.panelHi }]} onPress={() => openChronicle(e.id)}>
              <View style={[styles.square, { backgroundColor: eventTint(e) }]} />
              <View style={styles.grow}>
                <T>{e.summary}</T>
                <L style={styles.meta}>{'Sol ' + sol(e.tick) + ' · ' + timeOf(e.tick) + ' · ' + CATEGORY_LABEL[e.category]}</L>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={<T style={styles.empty}>Nothing has happened yet.</T>}
        />
      )}
    </View>
  );
}

function Chain({ eventId, bottomInset }: { eventId: Id | null; bottomInset: number }) {
  const eventsRev = useGame((s) => s.eventsRev);
  const [chain, setChain] = useState<WorldEventPublic[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    setError(false);
    if (!eventId) return setChain([]);
    const source = getSource();
    if (!source) return;
    source
      .chain(eventId)
      .then((c) => live && setChain(c))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [eventId, eventsRev]);

  if (error) return <T style={styles.empty}>Could not load this chain.</T>;
  if (!chain) return <ActivityIndicator color={colors.amber} style={{ marginTop: space.xl }} />;
  if (chain.length === 0) return <T style={styles.empty}>Nothing has happened yet.</T>;
  const byId = new Map(chain.map((e) => [e.id, e]));

  return (
    <FlatList
      data={chain}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: bottomInset + space.lg }}
      renderItem={({ item: e, index }) => {
        const tint = eventTint(e);
        const mine = e.category === 'intervention';
        const cause = e.causationEventId ? byId.get(e.causationEventId) : undefined;
        return (
          <Pressable style={styles.chainRow} onPress={() => goToEvent(e)} accessibilityLabel={e.summary}>
            <View style={styles.rail}>
              <View style={[styles.node, { borderColor: tint }, mine && { backgroundColor: tint }, e.id === eventId && styles.nodeFocus]} />
              <View style={[styles.line, index === chain.length - 1 && { opacity: 0 }]} />
            </View>
            <View style={styles.chainBody}>
              <View style={styles.chainMeta}>
                <L style={[styles.meta, { color: mine ? tint : colors.textDim }]}>{(mine ? 'You · ' : '') + 'Sol ' + sol(e.tick) + ' · ' + timeOf(e.tick)}</L>
                <L style={styles.meta}>{CATEGORY_LABEL[e.category]}</L>
              </View>
              <T>{e.summary}</T>
              {cause ? (
                <T style={styles.because} lines={1}>
                  {'because ' + cause.summary.charAt(0).toLowerCase() + cause.summary.slice(1)}
                </T>
              ) : null}
            </View>
          </Pressable>
        );
      }}
      ListFooterComponent={
        <View style={styles.footer}>
          <T style={styles.footerText}>Every link is a recorded cause. Amber is something you did; blue is something someone only believes.</T>
          <Button label="See it on the map" onPress={() => byId.get(eventId!) && goToEvent(byId.get(eventId!)!)} />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.space },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, marginBottom: space.md },
  title: { fontSize: 18 },
  mode: { flex: 1 },
  grow: { flex: 1, gap: 3 },
  feedRow: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.panel },
  square: { width: 8, height: 8, marginTop: 6 },
  meta: { fontSize: 8, color: colors.textDim },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: space.xl },
  chainRow: { flexDirection: 'row', gap: space.md },
  rail: { width: 14, alignItems: 'center', paddingTop: 14 },
  node: { width: 12, height: 12, borderWidth: 2, backgroundColor: colors.space },
  nodeFocus: { width: 14, height: 14 },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 2 },
  chainBody: { flex: 1, paddingVertical: 10, gap: 4 },
  chainMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  because: { fontSize: 13, color: colors.textDim },
  footer: { gap: space.md, marginTop: space.md },
  footerText: { fontSize: 13, color: colors.textFaint },
});
