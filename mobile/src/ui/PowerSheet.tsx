import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LOCATION_IDS, LOCATIONS, RESOURCE_LABELS, RESOURCES, RUMOR_PRESETS, WHISPER_PRESETS, type LocationId, type ResourceId } from '../../shared/colony';
import type { AgentLite, Intervention } from '../../shared/types';
import {
  applyPower,
  cancelPower,
  closePicker,
  openPicker,
  pickPowerAgent,
  retryPower,
  setPowerPicking,
  togglePowerLocation,
  useAgent,
  useAgents,
  useGame,
  type PowerDraft,
} from '../game/store';
import { powerTitle } from './ColonyHud';
import { firstName, occupationLabel } from './format';
import { Button, Chips, HeaderButton, L, Meter, Panel, Portrait, Section, Segmented, Sheet, Stepper, T } from './kit';
import { colors, fonts, space } from './theme';

const CAUSES = ['Accident', 'Illness', 'Suit failure'];
const GRANT_STEP: Record<ResourceId, number> = { food: 2, water: 2, parts: 1, medicine: 1, credits: 10 };
const GRANT_MAX: Record<ResourceId, number> = { food: 60, water: 60, parts: 30, medicine: 20, credits: 500 };

/** The active god power: its parameter sheet, or a bar asking for a tap on the map. */
export function PowerLayer() {
  const draft = useGame((s) => s.power);
  if (!draft) return null;
  const picking = draft.picking === 'agent' || draft.picking === 'about';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[StyleSheet.absoluteFill, picking && styles.hidden]} pointerEvents="box-none">
        <PowerSheet key={draft.type} draft={draft} />
      </View>
      {picking ? <PickBar draft={draft} /> : null}
    </View>
  );
}

function pickFromList(draft: PowerDraft, which: 'agent' | 'about') {
  setPowerPicking(which);
  openPicker({ title: which === 'about' ? 'About whom?' : powerTitle(draft.type) + ': who?', aliveOnly: which === 'agent' && draft.type !== 'rumor', onPick: pickPowerAgent });
}

function PickBar({ draft }: { draft: PowerDraft }) {
  const insets = useSafeAreaInsets();
  const which = draft.picking as 'agent' | 'about';
  const has = which === 'about' ? draft.aboutAgentId : draft.agentId;
  return (
    <Panel style={[styles.pickBar, { paddingBottom: insets.bottom + space.md }]}>
      <L style={{ color: colors.amber }}>{powerTitle(draft.type)}</L>
      <T>{which === 'about' ? 'Tap the colonist this is about.' : 'Tap a colonist on the map.'}</T>
      <View style={styles.row}>
        <Button label="Choose from list" style={styles.grow} onPress={() => pickFromList(draft, which)} />
        <Button label="Cancel" onPress={() => (has || which === 'about' ? setPowerPicking(null) : cancelPower())} />
      </View>
    </Panel>
  );
}

function Who({ label, agent, onChoose, onList }: { label: string; agent?: AgentLite; onChoose: () => void; onList: () => void }) {
  return (
    <View style={styles.row}>
      {agent ? <Portrait spriteId={agent.spriteId} size={36} dim={!agent.alive} /> : null}
      <View style={styles.grow}>
        <L style={styles.dimLabel}>{label}</L>
        <T>{agent ? agent.name : 'No one chosen'}</T>
      </View>
      <HeaderButton label="Map" onPress={onChoose} tint={colors.amber} />
      <HeaderButton label="List" onPress={onList} tint={colors.amber} />
    </View>
  );
}

function PowerSheet({ draft }: { draft: PowerDraft }) {
  const target = useAgent(draft.agentId);
  const about = useAgent(draft.aboutAgentId);
  const [severity, setSeverity] = useState(0.7);
  const [days, setDays] = useState(3);
  const [resource, setResource] = useState<ResourceId>('food');
  const [amount, setAmount] = useState(12);
  const [cause, setCause] = useState(CAUSES[0]);
  const [confirm, setConfirm] = useState(false);
  const presets = draft.type === 'rumor' ? RUMOR_PRESETS : WHISPER_PRESETS;
  const [presetKey, setPresetKey] = useState(presets[0].key);
  const [text, setText] = useState<string | null>(null);
  const [strength, setStrength] = useState(0.7);
  const [seed, setSeed] = useState<LocationId | undefined>();

  const preset = presets.find((p) => p.key === presetKey)!;
  const subject = draft.type === 'rumor' ? target : about;
  const idea = text ?? preset.text.replace('{name}', subject?.name ?? 'someone');
  const name = target ? firstName(target.name) : 'They';

  const built = ((): Intervention | null => {
    switch (draft.type) {
      case 'drought':
        return { type: 'drought', params: { severity, durationDays: days } };
      case 'storm':
        return { type: 'storm', params: { severity, locationIds: draft.locationIds.length ? draft.locationIds : undefined } };
      case 'grant':
        return target ? { type: 'grant', params: { agentId: target.id, resource, amount } } : null;
      case 'kill':
        return target ? { type: 'kill', params: { agentId: target.id, cause } } : null;
      case 'whisper':
        if (!target || !idea.trim() || (preset.needsSubject && !about)) return null;
        return { type: 'whisper', params: { agentId: target.id, presetKey, text: idea.trim(), strength, aboutAgentId: preset.needsSubject ? about?.id : undefined } };
      case 'rumor':
        if (!target || !idea.trim()) return null;
        return { type: 'rumor', params: { aboutAgentId: target.id, presetKey, text: idea.trim(), seedLocationId: seed } };
      case 'create_character':
        return null;
    }
  })();

  const action = draft.type === 'kill' ? (confirm ? 'Confirm' : 'End') : draft.type === 'whisper' ? 'Whisper' : draft.type === 'rumor' ? 'Spread' : 'Begin';
  const tint = draft.type === 'kill' ? colors.danger : draft.type === 'whisper' || draft.type === 'rumor' ? colors.earth : colors.amber;
  const submit = () => {
    if (!built) return;
    if (draft.type === 'kill' && !confirm) return setConfirm(true);
    void applyPower(built);
  };

  const ideaFields = (
    <>
      <Section title={draft.type === 'rumor' ? 'The rumor' : name + ' will come to suspect'}>
        <Chips
          options={presets.map((p) => ({ value: p.key, label: p.label }))}
          isOn={(k) => k === presetKey}
          onToggle={(k) => {
            setPresetKey(k);
            setText(null);
          }}
          tint={colors.earth}
        />
        <TextInput
          style={styles.idea}
          value={idea}
          onChangeText={setText}
          placeholder="An idea"
          placeholderTextColor={colors.textFaint}
          multiline
          maxLength={200}
          accessibilityLabel="Idea"
        />
      </Section>
    </>
  );

  return (
    <Sheet
      title={powerTitle(draft.type)}
      left={<HeaderButton label="Cancel" onPress={cancelPower} />}
      right={<HeaderButton label={draft.sending ? '...' : action} onPress={submit} tint={tint} disabled={!built || draft.sending} />}
      testID="power-sheet"
    >
      {draft.type === 'drought' ? (
        <Section footer="The ice wells fail, water runs short, then the hydroponics yield falls. What people do about it is up to them.">
          <Meter label="Severity" value={severity} onChange={setSeverity} />
          <Stepper label={'Lasts ' + days + ' sols'} value={days} min={1} max={7} onChange={setDays} />
        </Section>
      ) : null}

      {draft.type === 'storm' ? (
        <Section title="Strikes" footer="Tap sites here or on the map. With none picked it hits every exposed site. Damage interrupts work until someone repairs it.">
          <Chips
            options={LOCATION_IDS.map((id) => ({ value: id, label: LOCATIONS[id].name }))}
            isOn={(id) => draft.locationIds.includes(id)}
            onToggle={togglePowerLocation}
            tint={colors.danger}
          />
          <Meter label="Severity" value={severity} onChange={setSeverity} tint={colors.danger} />
        </Section>
      ) : null}

      {draft.type === 'grant' || draft.type === 'kill' || draft.type === 'whisper' || draft.type === 'rumor' ? (
        <Section>
          <Who label={draft.type === 'rumor' ? 'About' : 'Who'} agent={target} onChoose={() => setPowerPicking('agent')} onList={() => pickFromList(draft, 'agent')} />
        </Section>
      ) : null}

      {draft.type === 'grant' ? (
        <Section footer={'Others may notice ' + name + "'s sudden luck."}>
          <Segmented
            options={RESOURCES.map((r) => ({ value: r, label: RESOURCE_LABELS[r] }))}
            value={resource}
            onChange={(r) => {
              setResource(r);
              setAmount(Math.min(amount, GRANT_MAX[r]));
            }}
          />
          <Stepper
            label={amount + ' ' + RESOURCE_LABELS[resource].toLowerCase()}
            value={amount}
            min={1}
            max={GRANT_MAX[resource]}
            step={GRANT_STEP[resource]}
            onChange={setAmount}
          />
        </Section>
      ) : null}

      {draft.type === 'kill' ? (
        <Section title="Cause" footer="Their plans stop, their goods pass to their household, and those who knew them will learn of it.">
          <Segmented options={CAUSES.map((c) => ({ value: c, label: c }))} value={cause} onChange={setCause} tint={colors.danger} />
          {confirm ? <T style={{ color: colors.danger }}>{'End ' + (target?.name ?? 'this life') + '? This cannot be undone. Tap Confirm.'}</T> : null}
        </Section>
      ) : null}

      {draft.type === 'whisper' ? (
        <>
          {ideaFields}
          {preset.needsSubject ? (
            <Section>
              <Who label="About" agent={about} onChoose={() => setPowerPicking('about')} onList={() => pickFromList(draft, 'about')} />
            </Section>
          ) : null}
          <Section footer={'Only ' + name + ' hears this. They may believe it, resist it, or tell someone. It does not have to be true.'}>
            <Meter label="Strength" value={strength} onChange={setStrength} tint={colors.earth} showValue />
          </Section>
        </>
      ) : null}

      {draft.type === 'rumor' ? (
        <>
          {ideaFields}
          <Section title="Starts at" footer="It spreads from person to person through talk, changing as it goes.">
            <Chips
              options={LOCATION_IDS.map((id) => ({ value: id, label: LOCATIONS[id].name }))}
              isOn={(id) => id === seed}
              onToggle={(id) => setSeed(id === seed ? undefined : id)}
              tint={colors.earth}
            />
          </Section>
        </>
      ) : null}

      {draft.error ? (
        <Section>
          <T style={{ color: colors.danger }}>{draft.error}</T>
          {draft.canRetry ? <Button label="Try again" kind="danger" onPress={() => void retryPower()} disabled={draft.sending} /> : null}
        </Section>
      ) : null}
    </Sheet>
  );
}

/** A searchable list for picking a colonist, used by the power flows. */
export function PickerSheet() {
  const picker = useGame((s) => s.picker);
  const agents = useAgents();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    if (!picker) return [];
    const q = query.trim().toLowerCase();
    return agents.filter((a) => (!picker.aliveOnly || a.alive) && (!q || a.name.toLowerCase().includes(q) || occupationLabel(a.occupation).toLowerCase().includes(q)));
  }, [agents, picker, query]);
  if (!picker) return null;
  return (
    <Sheet title={picker.title} tall left={<HeaderButton label="Cancel" onPress={closePicker} />} testID="picker-sheet">
      <TextInput style={styles.search} value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={colors.textFaint} autoCorrect={false} />
      <FlatList
        scrollEnabled={false}
        data={shown}
        keyExtractor={(a) => a.id}
        renderItem={({ item: a }) => (
          <Pressable style={styles.pickRow} onPress={() => picker.onPick(a.id)}>
            <Portrait spriteId={a.spriteId} size={32} dim={!a.alive} />
            <T style={styles.grow}>{a.name}</T>
            <L style={styles.dimLabel}>{occupationLabel(a.occupation)}</L>
          </Pressable>
        )}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hidden: { display: 'none' },
  pickBar: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, gap: space.sm, borderColor: colors.amber },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  grow: { flex: 1 },
  dimLabel: { fontSize: 8, color: colors.textDim },
  idea: {
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 17,
    padding: space.sm,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  search: {
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.panelLo,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
    paddingHorizontal: space.md,
    paddingVertical: 8,
    marginBottom: space.sm,
  },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 6, borderBottomWidth: 1, borderColor: colors.panelHi },
});
