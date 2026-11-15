import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { jumpToAgent, useAgents } from '../game/store';
import { occupationLabel } from './format';
import { L, Portrait, T } from './kit';
import { colors, fonts, space } from './theme';

/** Everyone in the colony, searchable by name or occupation. Tapping one shows them on the map. */
export function PeopleView({ bottomInset }: { bottomInset: number }) {
  const insets = useSafeAreaInsets();
  const agents = useAgents();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? agents.filter((a) => a.name.toLowerCase().includes(q) || occupationLabel(a.occupation).toLowerCase().includes(q)) : agents;
    return [...list].sort((a, b) => Number(b.alive) - Number(a.alive));
  }, [agents, query]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.sm }]} testID="people-view">
      <L style={styles.title}>People</L>
      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Name or occupation"
        placeholderTextColor={colors.textFaint}
        autoCorrect={false}
        clearButtonMode="while-editing"
        accessibilityLabel="Search people"
      />
      <FlatList
        data={shown}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ paddingBottom: bottomInset + space.lg }}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: a }) => (
          <Pressable style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.panelHi }]} onPress={() => jumpToAgent(a.id)} accessibilityLabel={a.name}>
            <Portrait spriteId={a.spriteId} size={40} dim={!a.alive} />
            <View style={styles.grow}>
              <T style={!a.alive ? { color: colors.textDim } : undefined}>{a.name}</T>
              <T style={styles.sub} lines={1}>
                {a.alive ? a.activityLabel : 'Died'}
              </T>
            </View>
            <L style={styles.job}>{occupationLabel(a.occupation)}</L>
          </Pressable>
        )}
        ListEmptyComponent={<T style={styles.empty}>No one matches.</T>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.space },
  title: { fontSize: 20, color: colors.text, paddingHorizontal: space.lg, marginBottom: space.sm },
  search: {
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.panelLo,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
    paddingHorizontal: space.md,
    paddingVertical: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.panel },
  grow: { flex: 1 },
  sub: { fontSize: 13, color: colors.textDim },
  job: { fontSize: 8, color: colors.textDim, maxWidth: 96, textAlign: 'right' },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: space.xl },
});
