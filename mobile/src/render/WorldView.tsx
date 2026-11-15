/**
 * The colony map: one Skia canvas, drawn back to front as ground, building bases, graves,
 * colonists sorted by y (one Atlas draw call), building overlays, location labels, effects,
 * then the selection marker, emotes and speech bubbles. Camera and animation run on the UI
 * thread from shared values; React renders this tree only when the set of things changes.
 */
import {
  Atlas,
  Canvas,
  Circle,
  Fill,
  FilterMode,
  Group,
  Image,
  ImageShader,
  MipmapMode,
  Rect,
  RoundedRect,
  Text,
  interpolateColors,
  useFont,
  useImage,
  useRSXformBuffer,
  useRectBuffer,
  type SkFont,
  type SkImage,
} from '@shopify/react-native-skia';
import { memo, useEffect, useMemo } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import { cancelAnimation, useDerivedValue, useFrameCallback, useSharedValue, withDecay, withTiming, Easing } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { LOCATIONS, LOCATION_IDS, MAX_POPULATION, TICK_MINUTES, START_HOUR, type LocationId } from '../../shared/colony';
import { LOCATION_LAYOUT } from '../../shared/mapLayout';
import type { ImageAsset } from '../../shared/assets';
import type { PowerType } from '../../shared/types';
import { EMOTES, MANIFEST } from '../art';
import { tapAgentSlot, tapWorld, useGame, type PowerFx, type Speech } from '../game/store';
import { colors, fonts } from '../ui/theme';
import { spriteScale, stepScene } from './frame';
import { DETAIL_ZOOM, MAP_H, MAP_W, MAX_ZOOM, clampAxis, clampCamera, fitZoom, scene } from './scene';

const NEAREST = { filter: FilterMode.Nearest, mipmap: MipmapMode.None } as const;
const CAP = MAX_POPULATION + 8;
const CH = MANIFEST.characters;
const FW = CH.frameWidth;
const FH = CH.frameHeight;
const FEET_X = CH.feet.x;
const FEET_Y = CH.feet.y;
const EW = EMOTES.width;
const EH = EMOTES.height;

// ---------- layers ----------

function Still({ asset, x, y, opacity }: { asset: ImageAsset; x: number; y: number; opacity?: number }) {
  const image = useImage(asset.source);
  return <Image image={image} x={x} y={y} width={asset.width} height={asset.height} sampling={NEAREST} fit="fill" opacity={opacity} />;
}

const BuildingBases = memo(function BuildingBases({ damage }: { damage: Partial<Record<LocationId, number>> }) {
  return (
    <>
      {LOCATION_IDS.map((id) => {
        const art = MANIFEST.buildings[id];
        const hurt = damage[id] ?? 0;
        return (
          <Group key={id}>
            <Still asset={art.base} x={art.x} y={art.y} />
            {art.damaged && hurt > 0 ? <Still asset={art.damaged} x={art.x} y={art.y} opacity={Math.min(1, 0.45 + hurt)} /> : null}
          </Group>
        );
      })}
    </>
  );
});

const BuildingOverlays = memo(function BuildingOverlays() {
  return (
    <>
      {LOCATION_IDS.map((id) => {
        const art = MANIFEST.buildings[id];
        return art.overlay ? <Still key={id} asset={art.overlay} x={art.x} y={art.y} /> : null;
      })}
    </>
  );
});

const Colonists = memo(function Colonists({ atlas }: { atlas: SkImage | null }) {
  const frame = scene.frame;
  const zoom = scene.zoom;
  const transforms = useRSXformBuffer(CAP, (val, i) => {
    'worklet';
    const f = frame.value;
    if (i >= f.count) {
      val.set(0, 0, -99999, -99999);
      return;
    }
    const k = f.order[i];
    const s = spriteScale(zoom.value);
    val.set(s, 0, f.xs[k] - FEET_X * s, f.ys[k] - FEET_Y * s);
  });
  const sprites = useRectBuffer(CAP, (val, i) => {
    'worklet';
    const f = frame.value;
    if (i >= f.count) {
      val.setXYWH(0, 0, 0, 0);
      return;
    }
    const k = f.order[i];
    val.setXYWH(f.cols[k] * FW, f.rows[k] * FH, FW, FH);
  });
  return <Atlas image={atlas} sprites={sprites} transforms={transforms} sampling={NEAREST} />;
});

const Emotes = memo(function Emotes({ sheet }: { sheet: SkImage | null }) {
  const frame = scene.frame;
  const zoom = scene.zoom;
  const transforms = useRSXformBuffer(CAP, (val, i) => {
    'worklet';
    const f = frame.value;
    const k = i < f.count ? f.order[i] : -1;
    if (k < 0 || f.emotes[k] < 0) {
      val.set(0, 0, -99999, -99999);
      return;
    }
    const s = spriteScale(zoom.value);
    val.set(1, 0, f.xs[k] - EW / 2, f.ys[k] - FEET_Y * s - EH + 2);
  });
  const sprites = useRectBuffer(CAP, (val, i) => {
    'worklet';
    const f = frame.value;
    const k = i < f.count ? f.order[i] : -1;
    if (k < 0 || f.emotes[k] < 0) {
      val.setXYWH(0, 0, 0, 0);
      return;
    }
    val.setXYWH(f.emotes[k] * EW, 0, EW, EH);
  });
  const opacity = useDerivedValue(() => Math.max(0, Math.min(1, (zoom.value - DETAIL_ZOOM + 0.15) / 0.15)));
  return (
    <Group opacity={opacity}>
      <Atlas image={sheet} sprites={sprites} transforms={transforms} sampling={NEAREST} />
    </Group>
  );
});

function SelectionMarker() {
  const image = useImage(MANIFEST.fx.selection.source);
  const { width, height } = MANIFEST.fx.selection;
  const transform = useDerivedValue(() => {
    const slot = scene.selectedSlot.value;
    const f = scene.frame.value;
    if (slot < 0 || slot >= f.xs.length || f.rows[slot] < 0) return [{ translateX: -99999 }, { translateY: -99999 }];
    const s = spriteScale(scene.zoom.value);
    const bob = Math.floor(scene.timeMs.value / 260) % 2;
    const lift = f.emotes[slot] >= 0 && scene.zoom.value >= DETAIL_ZOOM ? EH : 0;
    return [{ translateX: f.xs[slot] - (width * s) / 2 }, { translateY: f.ys[slot] - FEET_Y * s - lift - (height + 3 + bob) * s }, { scale: s }];
  });
  return (
    <Group transform={transform}>
      <Image image={image} x={0} y={0} width={width} height={height} sampling={NEAREST} fit="fill" />
    </Group>
  );
}

function Graves() {
  const graves = useGame((s) => s.graves);
  const image = useImage(MANIFEST.fx.grave.source);
  const { width, height } = MANIFEST.fx.grave;
  return (
    <>
      {graves.map((g) => (
        <Image key={g.id} image={image} x={g.x - width / 2} y={g.y - height + 4} width={width} height={height} sampling={NEAREST} fit="fill" />
      ))}
    </>
  );
}

/** Day and night, drought haze and storm debris. Drawn over the map in world space. */
function WorldEffects() {
  const storm = useImage(MANIFEST.fx.stormOverlay?.source ?? MANIFEST.fx.selection.source);
  const dust = useImage(MANIFEST.fx.droughtOverlay?.source ?? MANIFEST.fx.selection.source);
  const tint = useDerivedValue(() => {
    const minutes = (scene.displayTick.value * TICK_MINUTES + START_HOUR * 60) % 1440;
    const hour = minutes / 60;
    return interpolateColors(hour, [0, 5, 6.5, 8, 18, 19.5, 21, 24], ['#5a66a8', '#5a66a8', '#f2b79a', '#ffffff', '#ffffff', '#f0a68c', '#5a66a8', '#5a66a8']);
  });
  const droughtOpacity = useDerivedValue(() => scene.drought.value * 0.34);
  const dustOpacity = useDerivedValue(() => scene.drought.value);
  const dustShift = useDerivedValue(() => [{ scale: 2 }, { translateX: (scene.timeMs.value / 90) % 128 }, { translateY: 0 }]);
  const stormOpacity = useDerivedValue(() => scene.storm.value);
  const stormShift = useDerivedValue(() => [{ scale: 2 }, { translateX: -((scene.timeMs.value / 6) % 128) }, { translateY: (scene.timeMs.value / 6) % 128 }]);
  const flash = useDerivedValue(() => {
    const t = scene.timeMs.value % 2300;
    return scene.storm.value * (t < 90 ? 0.32 : t > 220 && t < 280 ? 0.2 : 0);
  });
  return (
    <>
      <Rect x={0} y={0} width={MAP_W} height={MAP_H} color={tint} blendMode="multiply" />
      <Rect x={0} y={0} width={MAP_W} height={MAP_H} color="#ffb061" blendMode="softLight" opacity={droughtOpacity} />
      {MANIFEST.fx.droughtOverlay ? (
        <Rect x={0} y={0} width={MAP_W} height={MAP_H} opacity={dustOpacity}>
          <ImageShader image={dust} tx="repeat" ty="repeat" sampling={NEAREST} transform={dustShift} />
        </Rect>
      ) : null}
      {MANIFEST.fx.stormOverlay ? (
        <Rect x={0} y={0} width={MAP_W} height={MAP_H} opacity={stormOpacity}>
          <ImageShader image={storm} tx="repeat" ty="repeat" sampling={NEAREST} transform={stormShift} />
        </Rect>
      ) : null}
      <Rect x={0} y={0} width={MAP_W} height={MAP_H} color="#fff4e0" opacity={flash} />
    </>
  );
}

/** Pulsing outline on the sites a storm is hitting, and on sites picked as a storm target. */
function SiteHighlight({ id, color }: { id: LocationId; color: string }) {
  const f = LOCATION_LAYOUT[id].footprint;
  const opacity = useDerivedValue(() => 0.35 + 0.45 * Math.abs(Math.sin(scene.timeMs.value / 320)));
  return <Rect x={f.x + 4} y={f.y + 4} width={f.w - 8} height={f.h - 8} color={color} style="stroke" strokeWidth={6} opacity={opacity} />;
}

const FX_COLOR: Record<PowerType, string> = {
  drought: '#ffb061',
  storm: '#ffe9c2',
  grant: '#ffd24a',
  kill: '#ff4d4d',
  whisper: '#b07cff',
  rumor: '#ff7ab8',
  create_character: '#59e0e6',
};

/** The visual answer to a god power: expanding rings where it landed. */
function PowerPulse({ fx }: { fx: PowerFx }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) });
  }, [p]);
  const big = fx.type === 'drought' || fx.type === 'storm';
  const r1 = useDerivedValue(() => (10 + p.value * (big ? 260 : 90)) / Math.max(0.5, Math.min(1.5, scene.zoom.value)));
  const r2 = useDerivedValue(() => (4 + Math.max(0, p.value - 0.25) * (big ? 240 : 80)) / Math.max(0.5, Math.min(1.5, scene.zoom.value)));
  const o = useDerivedValue(() => 1 - p.value);
  const core = useDerivedValue(() => Math.max(0, 0.5 - p.value) * 1.2);
  const width = useDerivedValue(() => 5 / Math.max(0.5, scene.zoom.value));
  return (
    <Group>
      <Circle cx={fx.x} cy={fx.y} r={r2} color={FX_COLOR[fx.type]} opacity={core} />
      <Circle cx={fx.x} cy={fx.y} r={r1} color={FX_COLOR[fx.type]} style="stroke" strokeWidth={width} opacity={o} />
      <Circle cx={fx.x} cy={fx.y} r={r2} color="#ffffff" style="stroke" strokeWidth={width} opacity={o} />
    </Group>
  );
}

function ScreenFlash({ fx }: { fx: PowerFx }) {
  const p = useSharedValue(0.4);
  useEffect(() => {
    p.value = withTiming(0, { duration: 700 });
  }, [p]);
  return <Fill color={FX_COLOR[fx.type]} opacity={p} />;
}

// ---------- screen-space overlays ----------

function LocationLabel({ id, font, damaged, picked }: { id: LocationId; font: SkFont; damaged: boolean; picked: boolean }) {
  const name = LOCATIONS[id].name.toUpperCase();
  const width = useMemo(() => font.measureText(name).width, [font, name]);
  const layout = LOCATION_LAYOUT[id];
  const anchorX = layout.center.x;
  const anchorY = layout.footprint.y + 2;
  const transform = useDerivedValue(() => [
    { translateX: Math.round(anchorX * scene.zoom.value + scene.tx.value - width / 2 - 5) },
    { translateY: Math.round(anchorY * scene.zoom.value + scene.ty.value - 15) },
  ]);
  const opacity = useDerivedValue(() => (scene.followSlot.value >= 0 ? 0.55 : 1));
  return (
    <Group transform={transform} opacity={opacity}>
      <RoundedRect x={0} y={0} width={width + 10} height={15} r={3} color={picked ? colors.accent : 'rgba(9,11,22,0.82)'} />
      <RoundedRect x={0.5} y={0.5} width={width + 9} height={14} r={3} color={damaged ? colors.danger : 'rgba(150,170,220,0.45)'} style="stroke" strokeWidth={1} />
      <Text x={5} y={11} text={name} font={font} color={picked ? colors.ink : damaged ? colors.warn : colors.text} />
    </Group>
  );
}

function wrap(text: string, font: SkFont, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (font.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '') + '...';
  }
  return lines;
}

function SpeechBubble({ speech, font }: { speech: Speech; font: SkFont }) {
  const lines = useMemo(() => wrap(speech.text, font, 150, 3), [speech.text, font]);
  const width = useMemo(() => Math.max(...lines.map((l) => font.measureText(l).width)) + 14, [lines, font]);
  const height = lines.length * 14 + 10;
  const slot = speech.slot;
  const transform = useDerivedValue(() => {
    const f = scene.frame.value;
    if (slot >= f.xs.length) return [{ translateX: -99999 }, { translateY: 0 }];
    const zoom = scene.zoom.value;
    const s = spriteScale(zoom);
    return [
      { translateX: Math.round(f.xs[slot] * zoom + scene.tx.value - width / 2) },
      { translateY: Math.round((f.ys[slot] - FEET_Y * s) * zoom + scene.ty.value - height - 9) },
    ];
  });
  const opacity = useDerivedValue(() => Math.max(0, Math.min(1, (scene.zoom.value - DETAIL_ZOOM + 0.15) / 0.15)));
  return (
    <Group transform={transform} opacity={opacity}>
      <RoundedRect x={0} y={0} width={width} height={height} r={5} color={colors.ink} />
      <RoundedRect x={2} y={2} width={width - 4} height={height - 4} r={3} color="#f2f4ff" />
      <Rect x={width / 2 - 4} y={height - 2} width={8} height={4} color={colors.ink} />
      <Rect x={width / 2 - 2} y={height - 3} width={4} height={3} color="#f2f4ff" />
      <Rect x={width / 2 - 2} y={height + 2} width={4} height={3} color={colors.ink} />
      {lines.map((line, i) => (
        <Text key={i} x={7} y={16 + i * 14} text={line} font={font} color={colors.ink} />
      ))}
    </Group>
  );
}

// ---------- the view ----------

export function WorldView() {
  const ground = useImage(MANIFEST.map.ground.source);
  const atlas = useImage(CH.atlas.source);
  const emoteSheet = useImage(EMOTES.source);
  const labelFont = useFont(fonts.files.label, 9);
  const speechFont = useFont(fonts.files.body, 13);
  const damage = useGame((s) => s.world?.damage) ?? NO_DAMAGE;
  const effects = useGame((s) => s.world?.activeEffects);
  const speeches = useGame((s) => s.speeches);
  const fx = useGame((s) => s.fx);
  const selectedLocation = useGame((s) => s.selectedLocationId);
  const pickedLocations = useGame((s) => s.power?.locationIds);
  const followId = useGame((s) => s.followAgentId);
  const selectedId = useGame((s) => s.selectedAgentId);

  useFrameCallback(stepScene);

  const stormSites = useMemo(() => {
    const ids = new Set<LocationId>();
    for (const e of effects ?? []) {
      if (e.type !== 'storm') continue;
      (e.locationIds.length ? e.locationIds : LOCATION_IDS.filter((id) => LOCATIONS[id].exposed)).forEach((id) => ids.add(id));
    }
    return [...ids];
  }, [effects]);

  // Bubbles for the colonist in focus first, then the rest, capped so the screen stays readable.
  const bubbles = useMemo(() => {
    const focus = followId ?? selectedId;
    return [...speeches].sort((a, b) => Number(b.id === focus) - Number(a.id === focus)).slice(0, 8);
  }, [speeches, followId, selectedId]);

  const camera = useDerivedValue(() => [{ translateX: scene.tx.value }, { translateY: scene.ty.value }, { scale: scene.zoom.value }]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    scene.viewW.value = width;
    scene.viewH.value = height;
    if (scene.unplaced.value) {
      const zoom = fitZoom(width, height);
      scene.unplaced.value = false;
      scene.zoom.value = zoom;
      scene.tx.value = clampAxis(0, MAP_W * zoom, 0, width);
      scene.ty.value = clampAxis(0, MAP_H * zoom, scene.insetTop.value, height - scene.insetBottom.value);
    }
  };

  const pan = usePanGesture({
    maxPointers: 2,
    onBegin: () => {
      cancelAnimation(scene.tx);
      cancelAnimation(scene.ty);
    },
    onUpdate: (e) => {
      if (scene.followSlot.value >= 0) return;
      scene.tx.value += e.changeX;
      scene.ty.value += e.changeY;
      clampCamera();
    },
    onDeactivate: (e) => {
      if (scene.followSlot.value >= 0) return;
      const zoom = scene.zoom.value;
      const w = MAP_W * zoom;
      const h = MAP_H * zoom;
      const top = scene.insetTop.value;
      const bottom = scene.viewH.value - scene.insetBottom.value;
      if (w > scene.viewW.value) scene.tx.value = withDecay({ velocity: e.velocityX, clamp: [scene.viewW.value - w, 0], deceleration: 0.996 });
      if (h > bottom - top) scene.ty.value = withDecay({ velocity: e.velocityY, clamp: [bottom - h, top], deceleration: 0.996 });
    },
  });
  const pinch = usePinchGesture({
    onUpdate: (e) => {
      const before = scene.zoom.value;
      const lowest = fitZoom(scene.viewW.value, scene.viewH.value);
      const after = Math.max(lowest, Math.min(MAX_ZOOM, before * e.scaleChange));
      scene.zoom.value = after;
      if (scene.followSlot.value >= 0) return;
      scene.tx.value = e.focalX - (e.focalX - scene.tx.value) * (after / before);
      scene.ty.value = e.focalY - (e.focalY - scene.ty.value) * (after / before);
      clampCamera();
    },
  });
  const tap = useTapGesture({
    maxDistance: 12,
    onActivate: (e) => {
      const zoom = scene.zoom.value;
      const wx = (e.x - scene.tx.value) / zoom;
      const wy = (e.y - scene.ty.value) / zoom;
      const f = scene.frame.value;
      const s = spriteScale(zoom);
      // Generous touch target: at least 22pt around the body, in world px.
      const reach = Math.max(22 / zoom, FH * s * 0.6);
      let best = -1;
      let bestD = reach * reach;
      for (let i = 0; i < f.count; i++) {
        const k = f.order[i];
        const dx = wx - f.xs[k];
        const dy = wy - (f.ys[k] - (FH * s) / 2);
        const d = dx * dx + dy * dy;
        if (d <= bestD) {
          bestD = d;
          best = k;
        }
      }
      if (best >= 0) scheduleOnRN(tapAgentSlot, best);
      else scheduleOnRN(tapWorld, wx, wy);
    },
  });
  const gesture = useSimultaneousGestures(pan, pinch, tap);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.fill} onLayout={onLayout} collapsable={false}>
        <Canvas style={styles.fill}>
          <Fill color={colors.space} />
          <Group transform={camera}>
            <Image image={ground} x={0} y={0} width={MAP_W} height={MAP_H} sampling={NEAREST} fit="fill" />
            <BuildingBases damage={damage} />
            <Graves />
            <Colonists atlas={atlas} />
            <BuildingOverlays />
          </Group>
          {labelFont ? LOCATION_IDS.map((id) => <LocationLabel key={id} id={id} font={labelFont} damaged={(damage[id] ?? 0) > 0} picked={pickedLocations?.includes(id) ?? false} />) : null}
          <Group transform={camera}>
            <WorldEffects />
            {stormSites.map((id) => (
              <SiteHighlight key={'storm' + id} id={id} color={colors.danger} />
            ))}
            {(pickedLocations ?? []).map((id) => (
              <SiteHighlight key={'pick' + id} id={id} color={colors.accent} />
            ))}
            {selectedLocation && !pickedLocations ? <SiteHighlight id={selectedLocation} color={colors.text} /> : null}
            <SelectionMarker />
            <Emotes sheet={emoteSheet} />
            {fx.map((f) => (
              <PowerPulse key={f.id} fx={f} />
            ))}
          </Group>
          {speechFont ? bubbles.map((b) => <SpeechBubble key={b.id} speech={b} font={speechFont} />) : null}
          {fx.slice(-1).map((f) => (
            <ScreenFlash key={f.id} fx={f} />
          ))}
        </Canvas>
      </View>
    </GestureDetector>
  );
}

const NO_DAMAGE: Partial<Record<LocationId, number>> = {};
const styles = StyleSheet.create({ fill: { flex: 1 } });
