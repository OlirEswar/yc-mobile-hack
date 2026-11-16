import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { OCCUPATIONS, SPRITE_VARIANTS, TRAIT_KEYS, VALUE_KEYS, type SpriteId, type TraitKey, type ValueKey } from '../../shared/colony';
import type { NewCharacterInput } from '../../shared/types';
import { applyPower, closePanel } from '../game/store';
import { Button, Chips, HeaderButton, Meter, Portrait, Section, Segmented, Sheet, Stepper, T } from './kit';
import { colors, fonts, space } from './theme';

const NAMES = ['Corin Vale', 'Sefa Lund', 'Idris Kwan', 'Maren Holt', 'Tovi Arce'];
const GOALS = ['Dominate the water trade', 'Map the far crater', 'Open a second canteen', 'Earn a seat on the council'];
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];
const tenth = () => Math.round(Math.random() * 10) / 10;

/** New Arrival: design a colonist and land them at the pad. */
export function CreatorSheet() {
  const [name, setName] = useState('Corin Vale');
  const [occupation, setOccupation] = useState('trader');
  const [variant, setVariant] = useState(0);
  const [ageBand, setAgeBand] = useState<NewCharacterInput['ageBand']>('adult');
  const [home, setHome] = useState<NewCharacterInput['homeLocationId']>('habitat_b');
  const [traits, setTraits] = useState<Record<TraitKey, number>>({ ambition: 0.9, empathy: 0.3, caution: 0.5, curiosity: 0.5, sociability: 0.8, stubbornness: 0.5 });
  const [credits, setCredits] = useState(40);
  const [food, setFood] = useState(6);
  const [goal, setGoal] = useState(GOALS[0]);
  const [sending, setSending] = useState(false);

  const occ = OCCUPATIONS.find((o) => o.id === occupation)!;
  const spriteId = (occ.archetype + '_' + variant) as SpriteId;
  const valid = name.trim().length >= 2 && name.trim().length <= 40;
  const setTrait = (k: TraitKey) => (v: number) => setTraits({ ...traits, [k]: v });

  const randomize = () => {
    setName(pick(NAMES));
    setOccupation(pick(OCCUPATIONS).id);
    setVariant(Math.floor(Math.random() * SPRITE_VARIANTS));
    setTraits(Object.fromEntries(TRAIT_KEYS.map((k) => [k, tenth()])) as Record<TraitKey, number>);
    setCredits(Math.floor(Math.random() * 17) * 5);
    setFood(Math.floor(Math.random() * 13));
    setGoal(pick(GOALS));
  };

  const land = async () => {
    setSending(true);
    const ok = await applyPower({
      type: 'create_character',
      params: {
        name: name.trim(),
        spriteId,
        ageBand,
        occupation,
        homeLocationId: home,
        traits,
        values: Object.fromEntries(VALUE_KEYS.map((k) => [k, 0.5])) as Record<ValueKey, number>,
        backstory: 'Came up on the latest shuttle hoping to ' + goal.charAt(0).toLowerCase() + goal.slice(1) + '.',
        startingResources: { credits, food },
        goals: goal.trim() ? [{ kind: 'custom', description: goal.trim() }] : [],
      },
    });
    if (!ok) setSending(false);
  };

  return (
    <Sheet
      title="New Arrival"
      tall
      left={<HeaderButton label="Cancel" onPress={closePanel} />}
      right={<HeaderButton label={sending ? '...' : 'Land'} onPress={() => void land()} tint={colors.amber} disabled={!valid || sending} />}
      testID="creator-sheet"
    >
      <View style={styles.hero}>
        <Portrait spriteId={spriteId} size={84} />
        <T style={styles.name}>{name.trim() || 'Unnamed'}</T>
        <Button label="Next face" onPress={() => setVariant((variant + 1) % SPRITE_VARIANTS)} />
      </View>
      <Section>
        <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={colors.textFaint} maxLength={40} accessibilityLabel="Name" />
      </Section>
      <Section title="Occupation">
        <Chips options={OCCUPATIONS.map((o) => ({ value: o.id, label: o.label }))} isOn={(id) => id === occupation} onToggle={setOccupation} />
      </Section>
      <Section title="Age and home">
        <Segmented
          value={ageBand}
          onChange={setAgeBand}
          options={[
            { value: 'young', label: 'Young' },
            { value: 'adult', label: 'Adult' },
            { value: 'elder', label: 'Elder' },
          ]}
        />
        <Segmented
          value={home}
          onChange={setHome}
          options={[
            { value: 'habitat_a', label: 'Ring A' },
            { value: 'habitat_b', label: 'Ring B' },
          ]}
        />
      </Section>
      <Section title="Temperament">
        <Meter label="Ambition" value={traits.ambition} onChange={setTrait('ambition')} />
        <Meter label="Empathy" value={traits.empathy} onChange={setTrait('empathy')} />
        <Meter label="Sociability" value={traits.sociability} onChange={setTrait('sociability')} />
      </Section>
      <Section title="Arrives with">
        <Stepper label={credits + ' credits'} value={credits} min={0} max={300} step={5} onChange={setCredits} />
        <Stepper label={food + ' food'} value={food} min={0} max={20} onChange={setFood} />
      </Section>
      <Section title="First goal">
        <TextInput
          style={styles.input}
          value={goal}
          onChangeText={setGoal}
          placeholder="Goal"
          placeholderTextColor={colors.textFaint}
          multiline
          maxLength={120}
          accessibilityLabel="First goal"
        />
      </Section>
      <Button label="Randomize" onPress={randomize} style={styles.random} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.sm },
  name: { fontSize: 22 },
  input: { color: colors.text, fontFamily: fonts.body, fontSize: 16, paddingVertical: 4 },
  random: { marginTop: space.lg },
});
