import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buyPremium, useGame } from '../game/store';
import { Button, HeaderButton, L, T } from './kit';
import { colors, space } from './theme';

const PERKS: [string, string][] = [
  ['Deeper minds', '60 thoughts a sol. Free colonies get 20.'],
  ['Time passes while you are away', 'Up to 3 sols of offline catch-up.'],
  ['A colony of 120', 'The free cap is 60.'],
  ['Three colonies', 'Run separate histories side by side.'],
];

/** The Colony Pass pitch. Buying opens the Whop checkout; billing:status flips premium afterwards. */
export function PatronSheet({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const premium = useGame((s) => s.premium);
  const checkingOut = useGame((s) => s.checkingOut);
  return (
    <View style={[styles.root, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.lg }]} testID="patron-sheet">
      <View style={styles.close}>
        <HeaderButton label="Close" onPress={onClose} />
      </View>
      <View style={styles.moon} />
      <L style={styles.title}>{premium ? 'You tend more worlds' : 'Tend more worlds'}</L>
      <T style={styles.sub}>Every power stays free.</T>
      <View style={styles.perks}>
        {PERKS.map(([title, text]) => (
          <View key={title} style={styles.perk}>
            <View style={styles.bullet} />
            <View style={styles.grow}>
              <L style={styles.perkTitle}>{title}</L>
              <T style={styles.perkText}>{text}</T>
            </View>
          </View>
        ))}
      </View>
      <View style={styles.grow} />
      {premium ? (
        <Pressable style={styles.owned} onPress={onClose}>
          <L style={{ color: colors.gold }}>Colony Pass active</L>
        </Pressable>
      ) : (
        <Button
          label={checkingOut ? 'Opening checkout...' : 'Unlock Colony Pass · $4.99'}
          kind="primary"
          onPress={() => void buyPremium()}
          disabled={checkingOut}
          testID="buy-pass"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.space, paddingHorizontal: space.xl, alignItems: 'stretch' },
  close: { alignItems: 'flex-end' },
  moon: { alignSelf: 'center', width: 112, height: 112, backgroundColor: '#c9cbd6', borderWidth: 4, borderColor: '#7d8094', marginTop: space.md, marginBottom: space.xl },
  title: { fontSize: 20, textAlign: 'center' },
  sub: { color: colors.textDim, textAlign: 'center', marginTop: 6 },
  perks: { gap: space.lg, marginTop: space.xl },
  perk: { flexDirection: 'row', gap: space.md },
  bullet: { width: 10, height: 10, backgroundColor: colors.amber, marginTop: 4 },
  grow: { flex: 1 },
  perkTitle: { fontSize: 11 },
  perkText: { color: colors.textDim, fontSize: 14, marginTop: 2 },
  owned: { borderWidth: 2, borderColor: colors.gold, alignItems: 'center', paddingVertical: 12 },
});
