import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGame } from '../game/store';
import { WorldView } from '../render/WorldView';
import { ChronicleView } from './ChronicleView';
import { ColonyHud } from './ColonyHud';
import { CreatorSheet } from './CreatorSheet';
import { FollowHud } from './FollowHud';
import { InspectSheet } from './InspectSheet';
import { PatronSheet } from './PatronSheet';
import { PeopleView } from './PeopleView';
import { PickerSheet, PowerLayer } from './PowerSheet';
import { TabBar } from './TabBar';
import { Toast } from './Toast';
import { colors, space } from './theme';

/**
 * The game shell. The map stays mounted underneath everything; the Colony tab overlays the god-mode
 * HUD on it, People and Chronicle cover it, and follow mode swaps the HUD for the follow card.
 * One inspector, one power layer and one patron sheet serve every tab.
 */
export function GameScreen() {
  const tab = useGame((s) => s.tab);
  const followId = useGame((s) => s.followAgentId);
  const selectedId = useGame((s) => s.selectedAgentId);
  const power = useGame((s) => s.power);
  const panel = useGame((s) => s.panel);
  const [tabBarHeight, setTabBarHeight] = useState(0);
  const [patron, setPatron] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <WorldView />
      {followId ? (
        <FollowHud id={followId} />
      ) : (
        <>
          {tab === 'colony' ? <ColonyHud onPatron={() => setPatron(true)} bottomInset={tabBarHeight} /> : null}
          {tab === 'people' ? <PeopleView bottomInset={tabBarHeight} /> : null}
          {tab === 'chronicle' ? <ChronicleView bottomInset={tabBarHeight} /> : null}
          <TabBar onHeight={setTabBarHeight} />
          {selectedId && !power && panel === 'none' ? <InspectSheet id={selectedId} /> : null}
        </>
      )}
      <PowerLayer />
      {panel === 'creator' ? <CreatorSheet /> : null}
      <PickerSheet />
      {patron ? <PatronSheet onClose={() => setPatron(false)} /> : null}
      {!followId && tab !== 'colony' ? <Toast style={[styles.toast, { top: insets.top + 56 }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.space },
  toast: { position: 'absolute', left: space.lg, right: space.lg },
});
