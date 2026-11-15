/**
 * Small building blocks shared by every panel: text in the two pixel fonts, hard-bordered panels,
 * buttons, segmented controls, steppers, pip meters, need bars, portraits and the bottom sheet.
 */
import { useState, type ReactNode } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SpriteId } from '../../shared/colony';
import { MANIFEST } from '../art';
import { colors, fonts, space } from './theme';

type TProps = { children: ReactNode; style?: StyleProp<TextStyle>; lines?: number };

/** Reading text (Pixelify Sans). */
export function T({ children, style, lines }: TProps) {
  return (
    <Text style={[styles.body, style]} numberOfLines={lines}>
      {children}
    </Text>
  );
}
/** Labels, headings and buttons (Silkscreen). */
export function L({ children, style, lines }: TProps) {
  return (
    <Text style={[styles.label, style]} numberOfLines={lines}>
      {children}
    </Text>
  );
}

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

type ButtonKind = 'primary' | 'plain' | 'danger' | 'earth';
const BUTTON_TINT: Record<ButtonKind, string> = { primary: colors.amber, plain: colors.border, danger: colors.danger, earth: colors.earth };

export function Button({
  label,
  onPress,
  kind = 'plain',
  disabled,
  style,
  testID,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const tint = BUTTON_TINT[kind];
  const filled = kind !== 'plain';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        { borderColor: tint, backgroundColor: filled ? tint + '2e' : colors.panelHi },
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <L style={[styles.buttonText, { color: filled ? tint : colors.text }]} lines={1}>
        {label}
      </L>
    </Pressable>
  );
}

export function Segmented<V extends string | number>({
  options,
  value,
  onChange,
  tint = colors.amber,
  style,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  tint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.segmented, style]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.segment, on && { backgroundColor: tint + '33', borderColor: tint }]}
          >
            <L style={[styles.segmentText, on && { color: tint }]} lines={1}>
              {o.label}
            </L>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A row of tappable chips; several may be on. */
export function Chips<V extends string>({
  options,
  isOn,
  onToggle,
  tint = colors.amber,
}: {
  options: { value: V; label: string }[];
  isOn: (value: V) => boolean;
  onToggle: (value: V) => void;
  tint?: string;
}) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = isOn(o.value);
        return (
          <Pressable key={o.value} onPress={() => onToggle(o.value)} style={[styles.chip, on && { borderColor: tint, backgroundColor: tint + '2e' }]}>
            <T style={[styles.chipText, on && { color: tint }]}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.row}>
      <T style={styles.grow}>{label}</T>
      <Pressable style={styles.stepButton} onPress={() => onChange(Math.max(min, value - step))} disabled={value <= min} accessibilityLabel={'Less ' + label}>
        <L style={[styles.stepText, value <= min && styles.disabled]}>-</L>
      </Pressable>
      <Pressable style={styles.stepButton} onPress={() => onChange(Math.min(max, value + step))} disabled={value >= max} accessibilityLabel={'More ' + label}>
        <L style={[styles.stepText, value >= max && styles.disabled]}>+</L>
      </Pressable>
    </View>
  );
}

/** A 0..1 value set by tapping one of ten pips. Stands in for a slider. */
export function Meter({
  label,
  value,
  onChange,
  tint = colors.amber,
  showValue,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  tint?: string;
  showValue?: boolean;
}) {
  const filled = Math.round(value * 10);
  return (
    <View style={styles.row}>
      <T style={styles.meterLabel}>{label}</T>
      <View style={styles.pips}>
        {Array.from({ length: 10 }, (_, i) => (
          <Pressable
            key={i}
            hitSlop={{ top: 10, bottom: 10 }}
            onPress={() => onChange((i + 1) / 10)}
            style={[styles.pip, i < filled && { backgroundColor: tint, borderColor: tint }]}
            accessibilityLabel={label + ' ' + (i + 1) * 10 + '%'}
          />
        ))}
      </View>
      {showValue ? <L style={styles.meterValue}>{value.toFixed(1)}</L> : null}
    </View>
  );
}

/** A thin 0..100 bar. */
export function Bar({ label, value, tint, width = 52 }: { label: string; value: number; tint: string; width?: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <View style={styles.barRow} accessible accessibilityLabel={label + ' ' + Math.round(v) + ' of 100'}>
      <L style={styles.barLabel}>{label}</L>
      <View style={[styles.barTrack, { width }]}>
        <View style={[styles.barFill, { width: (v / 100) * (width - 2), backgroundColor: tint }]} />
      </View>
    </View>
  );
}

export function Portrait({ spriteId, size = 44, dim }: { spriteId: SpriteId; size?: number; dim?: boolean }) {
  const art = MANIFEST.portraits[spriteId];
  return (
    <View style={[styles.portrait, { width: size, height: size }, dim && styles.dead]}>
      {art ? <Image source={art.source} style={{ width: size - 4, height: size - 4 }} resizeMode="stretch" /> : null}
    </View>
  );
}

export function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      {title ? <L style={styles.sectionTitle}>{title}</L> : null}
      <View style={styles.sectionBody}>{children}</View>
      {footer ? <T style={styles.footer}>{footer}</T> : null}
    </View>
  );
}

export function KeyValue({ k, v, tint }: { k: string; v: string; tint?: string }) {
  return (
    <View style={styles.row}>
      <T style={[styles.grow, styles.dim]}>{k}</T>
      <T style={tint ? { color: tint } : undefined}>{v}</T>
    </View>
  );
}

/**
 * A panel docked to the bottom of the screen that leaves the map above it usable. Tapping the
 * grabber toggles between half and nearly full height.
 */
export function Sheet({
  title,
  left,
  right,
  children,
  tall,
  testID,
}: {
  title?: string;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  /** Start expanded. */
  tall?: boolean;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(!!tall);
  return (
    <View style={[styles.sheet, { height: expanded ? '90%' : '52%', paddingBottom: insets.bottom }]} testID={testID}>
      <Pressable onPress={() => setExpanded(!expanded)} style={styles.grabberHit} accessibilityLabel={expanded ? 'Shrink panel' : 'Expand panel'}>
        <View style={styles.grabber} />
      </Pressable>
      {title || left || right ? (
        <View style={styles.sheetHeader}>
          <View style={styles.sheetSide}>{left}</View>
          <L style={styles.sheetTitle} lines={1}>
            {title ?? ''}
          </L>
          <View style={[styles.sheetSide, styles.sheetRight]}>{right}</View>
        </View>
      ) : null}
      <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

/** A borderless text button for sheet headers. */
export function HeaderButton({ label, onPress, tint = colors.textDim, disabled }: { label: string; onPress: () => void; tint?: string; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={10} accessibilityRole="button" style={disabled && styles.disabled}>
      <L style={[styles.headerButton, { color: tint }]}>{label}</L>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { color: colors.text, fontFamily: fonts.body, fontSize: 15 },
  label: { color: colors.text, fontFamily: fonts.label, fontSize: 11 },
  dim: { color: colors.textDim },
  panel: { backgroundColor: colors.panel + 'ee', borderWidth: 2, borderColor: colors.border },
  button: { borderWidth: 2, paddingHorizontal: space.md, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 11 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  segmented: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.panelLo, paddingVertical: 8, alignItems: 'center' },
  segmentText: { fontSize: 10, color: colors.textDim },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 2, borderColor: colors.border, backgroundColor: colors.panelLo, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { fontSize: 13, color: colors.textDim },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 34 },
  grow: { flex: 1 },
  stepButton: { width: 38, height: 32, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.panelHi, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 16 },
  meterLabel: { width: 92 },
  pips: { flex: 1, flexDirection: 'row', gap: 3 },
  pip: { flex: 1, height: 18, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.panelLo },
  meterValue: { width: 30, textAlign: 'right', color: colors.textDim },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  barLabel: { fontSize: 8, color: colors.textDim },
  barTrack: { height: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panelLo },
  barFill: { height: 6 },
  portrait: { borderWidth: 2, borderColor: colors.border, backgroundColor: colors.panelLo, alignItems: 'center', justifyContent: 'center' },
  dead: { opacity: 0.4 },
  section: { marginTop: space.lg },
  sectionTitle: { color: colors.textDim, fontSize: 10, marginBottom: 6 },
  sectionBody: { backgroundColor: colors.panelLo, borderWidth: 2, borderColor: colors.border, padding: space.md, gap: 6 },
  footer: { color: colors.textFaint, fontSize: 13, marginTop: 6 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.panel, borderTopWidth: 2, borderColor: colors.borderHi },
  grabberHit: { alignItems: 'center', paddingVertical: 8 },
  grabber: { width: 44, height: 4, backgroundColor: colors.border },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.sm },
  sheetSide: { flex: 1, flexDirection: 'row' },
  sheetRight: { justifyContent: 'flex-end' },
  sheetTitle: { fontSize: 13, color: colors.text },
  sheetContent: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  headerButton: { fontSize: 11 },
});

export const ui = styles;
