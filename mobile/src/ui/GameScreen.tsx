import { StyleSheet, Text, View } from 'react-native';
import { WorldView } from '../render/WorldView';
import { useGame } from '../game/store';
import { colors, fonts } from './theme';

export function GameScreen() {
  const world = useGame((s) => s.world);
  return (
    <View style={styles.root}>
      <WorldView />
      <View style={styles.debug} pointerEvents="none">
        <Text style={styles.text}>tick {world?.tick ?? '-'} v{world?.version ?? '-'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.space },
  debug: { position: 'absolute', top: 60, left: 12 },
  text: { color: colors.text, fontFamily: fonts.label, fontSize: 12 },
});
