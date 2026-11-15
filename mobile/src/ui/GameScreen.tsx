import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WorldView } from '../render/WorldView';
import { buyPremium, useGame } from '../game/store';
import { colors, fonts, space } from './theme';

export function GameScreen() {
  const world = useGame((s) => s.world);
  const premium = useGame((s) => s.premium);
  const checkingOut = useGame((s) => s.checkingOut);
  return (
    <View style={styles.root}>
      <WorldView />
      <View style={styles.debug} pointerEvents="none">
        <Text style={styles.text}>tick {world?.tick ?? '-'} v{world?.version ?? '-'}</Text>
      </View>
      {premium ? (
        <View style={[styles.pass, styles.passOwned]} pointerEvents="none">
          <Text style={[styles.passText, { color: colors.gold }]}>Colony Pass</Text>
        </View>
      ) : (
        <Pressable style={styles.pass} onPress={buyPremium} disabled={checkingOut}>
          <Text style={styles.passText}>{checkingOut ? 'Opening checkout…' : 'Unlock Colony Pass · $4.99'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.space },
  debug: { position: 'absolute', top: 60, left: 12 },
  text: { color: colors.text, fontFamily: fonts.label, fontSize: 12 },
  pass: {
    position: 'absolute',
    top: 56,
    right: 12,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    backgroundColor: colors.panel,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  passOwned: { borderColor: colors.gold },
  passText: { color: colors.accent, fontFamily: fonts.label, fontSize: 12 },
});
