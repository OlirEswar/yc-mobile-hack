import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLONY_NAME } from '../../shared/colony';
import { colors } from './theme';

/** Shown while fonts and the world load, and when loading fails (with a retry). */
export function LoadingScreen({ fontsLoaded, error, onRetry }: { fontsLoaded: boolean; error?: string; onRetry: () => void }) {
  const title = fontsLoaded ? { fontFamily: 'Silkscreen_700Bold' } : null;
  const body = fontsLoaded ? { fontFamily: 'PixelifySans_500Medium' } : null;
  return (
    <View style={styles.root} testID="loading-screen">
      <Text style={[styles.title, title]}>LIVING WORLD</Text>
      <Text style={[styles.sub, body]}>{COLONY_NAME}</Text>
      {error ? (
        <>
          <Text style={[styles.error, body]}>The colony could not be reached.</Text>
          <Text style={[styles.detail, body]} numberOfLines={4}>
            {error}
          </Text>
          <Pressable style={styles.button} onPress={onRetry} accessibilityRole="button" testID="retry-button">
            <Text style={[styles.buttonText, title]}>TRY AGAIN</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator color={colors.accent} style={styles.spinner} />
          <Text style={[styles.detail, body]}>Waking 100 colonists...</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.space, alignItems: 'center', justifyContent: 'center', padding: 32 },
  title: { color: colors.accent, fontSize: 26, letterSpacing: 2 },
  sub: { color: colors.textDim, fontSize: 16, marginTop: 6 },
  spinner: { marginTop: 28 },
  detail: { color: colors.textDim, fontSize: 14, marginTop: 12, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 17, marginTop: 28, textAlign: 'center' },
  button: { marginTop: 20, borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.panel, paddingHorizontal: 22, paddingVertical: 12 },
  buttonText: { color: colors.accent, fontSize: 14 },
});
