import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WorldView } from '../render/WorldView';
import { openStore, useGame } from '../game/store';
import { OFFERS } from '../../shared/plans';
import { StoreSheet } from './StoreSheet';
import { colors, fonts, space } from './theme';

export function GameScreen() {
  const world = useGame((s) => s.world);
  const patron = useGame((s) => s.plan === 'patron');
  const storeOpen = useGame((s) => s.panel === 'store');
  return (
    <View style={styles.root}>
      <WorldView />
      <View style={styles.debug} pointerEvents="none">
        <Text style={styles.text}>tick {world?.tick ?? '-'} v{world?.version ?? '-'}</Text>
      </View>
      <Pressable style={[styles.pass, patron && styles.passOwned]} onPress={openStore}>
        <Text style={[styles.passText, patron && { color: colors.gold }]}>
          {patron ? 'Patron' : 'Become a Patron · $' + OFFERS.patron_monthly.priceUsd + '/mo'}
        </Text>
      </Pressable>
      {storeOpen ? <StoreSheet /> : null}
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
