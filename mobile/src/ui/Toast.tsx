import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { dismissToast, useGame } from '../game/store';
import { T } from './kit';
import { colors, space } from './theme';

/** The result of the last action. Rendered in the flow of whichever HUD is on screen. */
export function Toast({ style }: { style?: StyleProp<ViewStyle> }) {
  const toast = useGame((s) => s.toast);
  if (!toast) return null;
  const tint = toast.kind === 'error' ? colors.danger : toast.kind === 'ok' ? colors.amber : colors.accent;
  return (
    <Pressable style={[styles.toast, { borderColor: tint }, style]} onPress={dismissToast} testID="toast">
      <T style={styles.text}>{toast.text}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toast: { backgroundColor: colors.panel, borderWidth: 2, padding: space.md },
  text: { fontSize: 14 },
});
