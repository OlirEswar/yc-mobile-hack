import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { boot, useGame } from './src/game/store';
import { GameScreen } from './src/ui/GameScreen';
import { LoadingScreen } from './src/ui/LoadingScreen';
import { colors, fonts } from './src/ui/theme';

export default function App() {
  const [fontsLoaded] = useFonts(fonts.load);
  const phase = useGame((s) => s.phase);
  const loadError = useGame((s) => s.loadError);

  useEffect(() => {
    void boot();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {fontsLoaded && phase === 'ready' ? <GameScreen /> : <LoadingScreen fontsLoaded={fontsLoaded} error={phase === 'error' ? loadError : undefined} onRetry={boot} />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.space } });
