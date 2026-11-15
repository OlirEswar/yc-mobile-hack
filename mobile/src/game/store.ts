/**
 * The game store: everything the panels read and every action they can take.
 * It owns the WorldSource, keeps the colonists and events current from sync:updates, and drives
 * the renderer through the shared values in render/scene.ts (so database updates never re-render
 * the map through React).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { withTiming } from 'react-native-reanimated';
import { LOCATIONS, type LocationId, type Speed } from '../../shared/colony';
import { LOCATION_LAYOUT } from '../../shared/mapLayout';
import type { AgentDetail, AgentLite, Id, Intervention, InterventionResult, PowerType, WorldEventPublic, WorldPublic } from '../../shared/types';
import { createWorldSource, type WorldSource } from '../data';
import { cameraPose, flyTo, flyToPose, scene, setFollowSlot, type AnimAgent, type CameraPose } from '../render/scene';
import { toAnimAgent } from './anim';
import { locationAt } from './geometry';

export type Toast = { id: number; kind: 'ok' | 'error' | 'info'; text: string };
export type PowerFx = { id: number; type: PowerType; x: number; y: number };
export type Grave = { id: Id; x: number; y: number };
export type Speech = { id: Id; slot: number; text: string };

export type PowerDraft = {
  type: PowerType;
  /** What the next tap on the map (or pick from the list) fills in. Null shows the parameter sheet. */
  picking: 'agent' | 'about' | 'locations' | null;
  agentId?: Id;
  aboutAgentId?: Id;
  locationIds: LocationId[];
  sending: boolean;
  /** A recoverable failure: the sheet stays open and offers a retry. */
  error?: string;
  /** True when the failure was a transport error, so retrying the same command is safe. */
  canRetry?: boolean;
};

export type AgentPicker = { title: string; aliveOnly: boolean; onPick: (id: Id) => void };

export type GameState = {
  phase: 'loading' | 'ready' | 'error';
  loadError?: string;
  sourceKind: 'mock' | 'convex';
  /** Bought the Colony Pass through Whop. Kept current by billing:status. */
  premium: boolean;
  checkingOut: boolean;
  world: WorldPublic | null;
  /** Bumps whenever any colonist record changes. Read colonists with getAgent / listAgents. */
  agentsRev: number;
  /** Bumps whenever events arrive. */
  eventsRev: number;
  selectedAgentId: Id | null;
  selectedLocationId: LocationId | null;
  followAgentId: Id | null;
  panel: 'none' | 'chronicle' | 'creator';
  /** Event whose cause chain the chronicle shows, if any. */
  chronicleEventId: Id | null;
  power: PowerDraft | null;
  picker: AgentPicker | null;
  banner: WorldEventPublic | null;
  toast: Toast | null;
  fx: PowerFx[];
  graves: Grave[];
  speeches: Speech[];
  skipping: boolean;
  devOpen: boolean;
  dev: { lastApiError: string | null; syncs: number; lastSyncMs: number; failNext: boolean };
};

let state: GameState = {
  phase: 'loading',
  sourceKind: 'mock',
  premium: false,
  checkingOut: false,
  world: null,
  agentsRev: 0,
  eventsRev: 0,
  selectedAgentId: null,
  selectedLocationId: null,
  followAgentId: null,
  panel: 'none',
  chronicleEventId: null,
  power: null,
  picker: null,
  banner: null,
  toast: null,
  fx: [],
  graves: [],
  speeches: [],
  skipping: false,
  devOpen: false,
  dev: { lastApiError: null, syncs: 0, lastSyncMs: 0, failNext: false },
};

const listeners = new Set<() => void>();
function set(patch: Partial<GameState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
export const getState = () => state;
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Subscribe to one slice of the store. The selector must return a stable value for equal state. */
export function useGame<T>(selector: (s: GameState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

// ---------- non-reactive data (read through agentsRev / eventsRev) ----------
let source: WorldSource | null = null;
const agents = new Map<Id, AgentLite>();
const slots: Id[] = [];
const slotOf = new Map<Id, number>();
let anims: AnimAgent[] = [];
let events: WorldEventPublic[] = [];
const seenEvents = new Set<Id>();
let lastVersion = 0;
let pulling = false;
let pullAgain = false;
let nextLocalId = 1;
let savedPose: CameraPose | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let unsubscribeWorld: (() => void) | undefined;
let unsubscribePremium: (() => void) | undefined;
let pendingCommand: { intervention: Intervention; commandId: string } | null = null;

export const getAgent = (id: Id | null | undefined): AgentLite | undefined => (id ? agents.get(id) : undefined);
export const listAgents = (): AgentLite[] => slots.map((id) => agents.get(id)!);
export const getEvents = (): WorldEventPublic[] => events;
export const getSlot = (id: Id): number => slotOf.get(id) ?? -1;
export const getSource = (): WorldSource | null => source;

/** Colonists in the store, re-read whenever any of them changes. */
export function useAgents(): AgentLite[] {
  useGame((s) => s.agentsRev);
  return listAgents();
}
export function useAgent(id: Id | null | undefined): AgentLite | undefined {
  useGame((s) => s.agentsRev);
  return getAgent(id);
}
export function useEvents(): WorldEventPublic[] {
  useGame((s) => s.eventsRev);
  return events;
}

/** Reactive agents:get for the inspector and follow HUD. undefined while loading, null if gone. */
export function useAgentDetail(id: Id | null): AgentDetail | null | undefined {
  const [detail, setDetail] = useState<AgentDetail | null | undefined>(undefined);
  const phase = useGame((s) => s.phase);
  useEffect(() => {
    setDetail(undefined);
    if (!id || !source || phase !== 'ready') return;
    return source.subscribeAgent(id, setDetail);
  }, [id, phase]);
  return detail;
}

function apiError(where: string, error: unknown): string {
  const text = where + ': ' + (error instanceof Error ? error.message : String(error));
  set({ dev: { ...state.dev, lastApiError: text } });
  return text;
}

// ---------- toasts, banners, effects ----------
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(kind: Toast['kind'], text: string) {
  if (toastTimer) clearTimeout(toastTimer);
  set({ toast: { id: nextLocalId++, kind, text } });
  toastTimer = setTimeout(() => set({ toast: null }), kind === 'error' ? 6000 : 3600);
}
export const dismissToast = () => set({ toast: null });

const BANNER_MS = 4600;
const BANNER_GAP_MS = 700;
const BANNER_QUEUE_MAX = 5;
let bannerQueue: WorldEventPublic[] = [];
let bannerTimer: ReturnType<typeof setTimeout> | undefined;
const bannerKeys = new Map<string, number>();

function enqueueBanner(event: WorldEventPublic) {
  // Dedupe: the same event id never shows twice, and the same kind of news about the same
  // subject is suppressed for a while so one crisis does not flood the screen.
  const key = event.eventType + '|' + (event.actorId ?? '') + '|' + (event.locationId ?? '');
  const last = bannerKeys.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < 20000) return;
  bannerKeys.set(key, now);
  bannerQueue.push(event);
  bannerQueue.sort((a, b) => b.salience - a.salience);
  bannerQueue = bannerQueue.slice(0, BANNER_QUEUE_MAX);
  if (!state.banner && !bannerTimer) nextBanner();
}
function nextBanner() {
  bannerTimer = undefined;
  if (state.followAgentId) bannerQueue = [];
  const banner = bannerQueue.shift() ?? null;
  set({ banner });
  if (banner) bannerTimer = setTimeout(() => endBanner(), BANNER_MS);
}
function endBanner() {
  if (bannerTimer) clearTimeout(bannerTimer);
  set({ banner: null });
  bannerTimer = setTimeout(nextBanner, BANNER_GAP_MS);
}
export const dismissBanner = () => endBanner();
/** Tapping a banner takes the player to the news: the actor, else the place, else the chronicle. */
export function openBanner() {
  const event = state.banner;
  if (!event) return;
  endBanner();
  goToEvent(event);
}
export function goToEvent(event: WorldEventPublic) {
  const actor = getAgent(event.actorId);
  if (actor) return jumpToAgent(actor.id);
  if (event.locationId) return jumpToLocation(event.locationId);
  openChronicle(event.id);
}

function addFx(type: PowerType, x: number, y: number) {
  const fx = { id: nextLocalId++, type, x, y };
  set({ fx: [...state.fx, fx] });
  setTimeout(() => set({ fx: state.fx.filter((f) => f.id !== fx.id) }), 1600);
}

// ---------- sync ----------
function agentPoint(id: Id): { x: number; y: number } | null {
  const slot = getSlot(id);
  if (slot < 0) return null;
  const frame = scene.frame.value;
  if (slot < frame.xs.length) return { x: frame.xs[slot], y: frame.ys[slot] };
  return anims[slot] ? { x: anims[slot].x, y: anims[slot].y } : null;
}

function mergeAgents(changed: AgentLite[]) {
  if (changed.length === 0) return;
  const nowTick = scene.displayTick.value || (state.world?.tick ?? 0);
  const dirty = new Set<Id>();
  for (const agent of changed) {
    const before = agents.get(agent.id);
    if (!slotOf.has(agent.id)) {
      slotOf.set(agent.id, slots.length);
      slots.push(agent.id);
    }
    agents.set(agent.id, agent);
    dirty.add(agent.id);
    // A partner's spot depends on both sides of an interaction.
    if (agent.interactingWithId) dirty.add(agent.interactingWithId);
    if (before?.interactingWithId) dirty.add(before.interactingWithId);
  }
  const next = anims.slice();
  for (const id of dirty) {
    const agent = agents.get(id);
    const slot = slotOf.get(id);
    if (!agent || slot === undefined) continue;
    next[slot] = toAnimAgent(agent, getAgent(agent.interactingWithId), anims[slot], nowTick);
  }
  anims = next;
  scene.agents.value = next;

  const graves: Grave[] = [];
  const speeches: Speech[] = [];
  slots.forEach((id, slot) => {
    const agent = agents.get(id)!;
    if (!agent.alive) graves.push({ id, x: anims[slot].x, y: anims[slot].y });
    else if (agent.speech && !agent.move) speeches.push({ id, slot, text: agent.speech });
  });
  const patch: Partial<GameState> = { agentsRev: state.agentsRev + 1 };
  if (JSON.stringify(graves) !== JSON.stringify(state.graves)) patch.graves = graves;
  if (JSON.stringify(speeches) !== JSON.stringify(state.speeches)) patch.speeches = speeches;
  set(patch);

  const followed = getAgent(state.followAgentId);
  if (followed && !followed.alive) {
    unfollow();
    showToast('info', followed.name + ' has died. Returning to the colony view.');
  }
}

function mergeEvents(incoming: WorldEventPublic[], announce: boolean) {
  const fresh = incoming.filter((e) => !seenEvents.has(e.id));
  if (fresh.length === 0) return;
  fresh.forEach((e) => seenEvents.add(e.id));
  events = [...events, ...fresh].slice(-400);
  set({ eventsRev: state.eventsRev + 1 });
  if (!announce || state.followAgentId) return;
  for (const e of fresh) if (e.banner && e.visibility !== 'private') enqueueBanner(e);
}

async function pullUpdates() {
  if (!source) return;
  if (pulling) {
    pullAgain = true;
    return;
  }
  pulling = true;
  try {
    do {
      pullAgain = false;
      const started = Date.now();
      const updates = await source.updates(lastVersion);
      const first = lastVersion === 0;
      lastVersion = Math.max(lastVersion, updates.version);
      mergeAgents(updates.agents);
      mergeEvents(updates.events, !first);
      set({ dev: { ...state.dev, syncs: state.dev.syncs + 1, lastSyncMs: Date.now() - started } });
    } while (pullAgain);
  } catch (error) {
    apiError('sync:updates', error);
  } finally {
    pulling = false;
  }
}

function onWorld(world: WorldPublic | null) {
  if (!world) return;
  const running = world.status === 'running' ? world.speed : 0;
  scene.serverTick.value = world.tick;
  scene.speed.value = running;
  const strength = (type: 'drought' | 'storm') => world.activeEffects.filter((e) => e.type === type).reduce((m, e) => Math.max(m, 0.45 + e.severity * 0.55), 0);
  scene.drought.value = withTiming(strength('drought'), { duration: 1500 });
  scene.storm.value = withTiming(strength('storm'), { duration: 700 });
  set({ world });
  if (world.version > lastVersion) void pullUpdates();
}

// ---------- lifecycle ----------
const DEVICE_KEY = 'living-world.deviceId';
async function deviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await AsyncStorage.setItem(DEVICE_KEY, created);
  return created;
}

function beat() {
  if (!source || AppState.currentState !== 'active') return;
  source.heartbeat().catch((error) => apiError('session:heartbeat', error));
}

export async function boot() {
  set({ phase: 'loading', loadError: undefined });
  try {
    unsubscribeWorld?.();
    unsubscribePremium?.();
    source?.dispose();
    agents.clear();
    slots.length = 0;
    slotOf.clear();
    anims = [];
    events = [];
    seenEvents.clear();
    lastVersion = 0;
    source = createWorldSource();
    set({ sourceKind: source.kind });
    const id = await deviceId();
    await source.bootstrap(id);
    await source.heartbeat();
    const list = await source.listAgents();
    mergeAgents(list);
    const recent = await source.feed({ limit: 60, minSalience: 0 });
    mergeEvents([...recent].reverse(), false);
    unsubscribeWorld = source.subscribeWorld(onWorld, (error) => apiError('world:get', error));
    unsubscribePremium = source.subscribePremium((premium) => set({ premium }));
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(beat, 15000);
    set({ phase: 'ready' });
  } catch (error) {
    set({ phase: 'error', loadError: apiError('bootstrap', error) });
  }
}

/** Opens a Whop checkout for the Colony Pass. The webhook flips `premium` once payment succeeds. */
export async function buyPremium() {
  if (!source || state.premium || state.checkingOut) return;
  set({ checkingOut: true });
  try {
    await WebBrowser.openBrowserAsync(await source.createCheckout());
  } catch (error) {
    showToast('error', apiError('billing:createCheckout', error));
  } finally {
    set({ checkingOut: false });
  }
}

AppState.addEventListener('change', (next) => {
  if (next === 'active') beat();
});

// ---------- selection and camera ----------
export function selectAgent(id: Id | null) {
  scene.selectedSlot.value = id ? getSlot(id) : -1;
  set({ selectedAgentId: id, selectedLocationId: id ? null : state.selectedLocationId });
}
export function selectLocation(id: LocationId | null) {
  if (id) scene.selectedSlot.value = -1;
  set({ selectedLocationId: id, selectedAgentId: id ? null : state.selectedAgentId });
}
export function clearSelection() {
  scene.selectedSlot.value = -1;
  set({ selectedAgentId: null, selectedLocationId: null });
}

/** Opens a colonist's inspector and brings them into view. In follow mode, switches who is followed. */
export function jumpToAgent(id: Id) {
  const agent = getAgent(id);
  if (!agent) return;
  set({ panel: 'none', picker: null });
  if (state.followAgentId) {
    if (agent.alive) return follow(id);
    unfollow();
  }
  selectAgent(id);
  const at = agentPoint(id);
  if (at) flyTo(at.x, at.y, Math.max(scene.zoom.value, 1.25));
}
export function jumpToLocation(id: LocationId) {
  set({ panel: 'none', picker: null });
  if (state.followAgentId) unfollow();
  selectLocation(id);
  const c = LOCATION_LAYOUT[id].center;
  flyTo(c.x, c.y, Math.max(scene.zoom.value, 0.9));
}

export function follow(id: Id) {
  const agent = getAgent(id);
  if (!agent || !agent.alive) return;
  if (!state.followAgentId) savedPose = cameraPose();
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = undefined;
  bannerQueue = [];
  scene.selectedSlot.value = getSlot(id);
  setFollowSlot(getSlot(id));
  set({ followAgentId: id, selectedAgentId: id, selectedLocationId: null, banner: null, power: null, panel: 'none' });
  source?.setFocus(id).catch((error) => apiError('session:setFocus', error));
}
export function unfollow() {
  if (!state.followAgentId) return;
  setFollowSlot(-1);
  if (savedPose) flyToPose(savedPose);
  savedPose = null;
  scene.selectedSlot.value = -1;
  set({ followAgentId: null, selectedAgentId: null });
  source?.setFocus(null).catch((error) => apiError('session:setFocus', error));
}

/** Map taps arrive here from the UI thread. */
export function tapAgentSlot(slot: number) {
  const id = slots[slot];
  if (!id) return;
  const draft = state.power;
  if (draft?.picking === 'agent' || draft?.picking === 'about') return pickPowerAgent(id);
  if (draft?.picking === 'locations') return;
  if (state.followAgentId) {
    if (id !== state.followAgentId) follow(id);
    return;
  }
  selectAgent(id);
}
export function tapWorld(x: number, y: number) {
  const location = locationAt(x, y);
  const draft = state.power;
  if (draft?.picking === 'locations') {
    if (location) togglePowerLocation(location);
    return;
  }
  if (draft?.picking) return;
  if (state.followAgentId) return;
  if (location) selectLocation(location);
  else clearSelection();
}

// ---------- time ----------
export async function setSpeed(speed: Speed) {
  const world = state.world;
  if (!source || !world) return;
  scene.speed.value = speed;
  set({ world: { ...world, speed, status: speed === 0 ? 'paused' : 'running' } });
  try {
    await source.setSpeed(speed);
  } catch (error) {
    apiError('world:setSpeed', error);
    scene.speed.value = world.status === 'running' ? world.speed : 0;
    set({ world });
    showToast('error', 'Could not change the speed. Check the connection and try again.');
  }
}

export async function skipToNotable() {
  if (!source || state.skipping) return;
  set({ skipping: true });
  try {
    const result = await source.skipToNotable(state.followAgentId ?? undefined);
    await pullUpdates();
    const event = events.find((e) => e.id === result.eventId);
    const hours = Math.round((result.advancedTicks / 6) * 10) / 10;
    showToast('info', event ? 'Skipped ' + hours + 'h: ' + event.summary : 'Skipped ' + hours + 'h. Nothing notable happened.');
  } catch (error) {
    apiError('world:skipToNotable', error);
    showToast('error', 'Could not skip ahead. Try again.');
  } finally {
    set({ skipping: false });
  }
}

// ---------- panels ----------
export function openChronicle(eventId: Id | null = null) {
  set({ panel: 'chronicle', chronicleEventId: eventId, power: null, picker: null });
}
export function openCreator() {
  set({ panel: 'creator', power: null, picker: null });
}
export const closePanel = () => set({ panel: 'none', chronicleEventId: null });
export const openPicker = (picker: AgentPicker) => set({ picker });
export const closePicker = () => set({ picker: null });
export const toggleDev = () => set({ devOpen: !state.devOpen });
export const setFailNext = (failNext: boolean) => set({ dev: { ...state.dev, failNext } });

// ---------- god powers ----------
const NEEDS_TARGET: PowerType[] = ['grant', 'kill', 'whisper', 'rumor'];

/** Starts a power flow. With agentId the target step is skipped (the inspector's quick buttons). */
export function startPower(type: PowerType, agentId?: Id) {
  if (type === 'create_character') return openCreator();
  if (state.followAgentId && !agentId) unfollow();
  pendingCommand = null;
  set({
    panel: 'none',
    picker: null,
    power: {
      type,
      picking: type === 'storm' ? 'locations' : NEEDS_TARGET.includes(type) && !agentId ? 'agent' : null,
      agentId,
      locationIds: [],
      sending: false,
    },
  });
}
export function cancelPower() {
  pendingCommand = null;
  set({ power: null, picker: null });
}
export function setPowerPicking(picking: PowerDraft['picking']) {
  if (state.power) set({ power: { ...state.power, picking } });
}
export function pickPowerAgent(id: Id) {
  const draft = state.power;
  const agent = getAgent(id);
  if (!draft || !agent) return;
  if (draft.picking === 'about') {
    set({ power: { ...draft, aboutAgentId: id, picking: null }, picker: null });
    return;
  }
  if (!agent.alive && draft.type !== 'rumor') {
    showToast('info', agent.name + ' is dead. Choose a living colonist.');
    return;
  }
  set({ power: { ...draft, agentId: id, picking: null, error: undefined }, picker: null });
}
export function togglePowerLocation(id: LocationId) {
  const draft = state.power;
  if (!draft) return;
  const has = draft.locationIds.includes(id);
  set({ power: { ...draft, locationIds: has ? draft.locationIds.filter((l) => l !== id) : [...draft.locationIds, id] } });
}
export function setPowerLocations(ids: LocationId[]) {
  if (state.power) set({ power: { ...state.power, locationIds: ids } });
}
export function clearPowerAbout() {
  if (state.power) set({ power: { ...state.power, aboutAgentId: undefined } });
}

function resultText(iv: Intervention, result: Extract<InterventionResult, { ok: true }>): string {
  const others = Math.max(0, result.affectedAgentIds.length - 1);
  switch (iv.type) {
    case 'drought':
      return 'The ice wells are failing. Watch the water price.';
    case 'storm':
      return 'The storm has hit. ' + result.affectedAgentIds.length + ' colonists were caught in it.';
    case 'grant':
      return (getAgent(iv.params.agentId)?.name ?? 'They') + ' received ' + iv.params.amount + ' ' + iv.params.resource + '.';
    case 'kill':
      return (getAgent(iv.params.agentId)?.name ?? 'They') + ' is dead.' + (others > 0 ? ' ' + others + ' others felt it at once.' : '');
    case 'whisper':
      return 'The idea is planted in ' + (getAgent(iv.params.agentId)?.name ?? 'their') + "'s mind. Only they know.";
    case 'rumor':
      return 'The rumor is out. ' + result.affectedAgentIds.length + ' colonists heard it first.';
    case 'create_character':
      return iv.params.name + ' has arrived at the colony.';
  }
}

function fxPoint(iv: Intervention, result: Extract<InterventionResult, { ok: true }>): { x: number; y: number }[] {
  const centre = (id: LocationId) => LOCATION_LAYOUT[id].center;
  switch (iv.type) {
    case 'drought':
      return [centre('ice_wells')];
    case 'storm': {
      const ids = iv.params.locationIds?.length ? iv.params.locationIds : (Object.keys(LOCATIONS) as LocationId[]).filter((id) => LOCATIONS[id].exposed);
      return ids.map(centre);
    }
    case 'grant':
    case 'kill':
    case 'whisper':
      return [agentPoint(iv.params.agentId) ?? centre('plaza')];
    case 'rumor':
      return [agentPoint(iv.params.aboutAgentId) ?? centre('plaza'), ...(iv.params.seedLocationId ? [centre(iv.params.seedLocationId)] : [])];
    case 'create_character':
      return [(result.createdAgentId && agentPoint(result.createdAgentId)) || centre('landing_pad')];
  }
}

async function send(intervention: Intervention, commandId: string): Promise<boolean> {
  if (!source) return false;
  pendingCommand = { intervention, commandId };
  if (state.power) set({ power: { ...state.power, sending: true, error: undefined, canRetry: false } });
  const fail = (message: string, canRetry: boolean) => {
    if (state.power) set({ power: { ...state.power, sending: false, error: message, canRetry } });
    else showToast('error', message);
    return false;
  };
  try {
    if (state.dev.failNext) {
      setFailNext(false);
      throw new Error('simulated network failure');
    }
    const result = await source.apply(intervention, commandId);
    if (!result.ok) {
      apiError('interventions:apply', result.code + ' ' + result.message);
      pendingCommand = null;
      return fail(result.message, false);
    }
    pendingCommand = null;
    await pullUpdates();
    for (const p of fxPoint(intervention, result)) addFx(intervention.type, p.x, p.y);
    set({ power: null });
    showToast('ok', resultText(intervention, result));
    if (intervention.type === 'create_character' && result.createdAgentId) {
      set({ panel: 'none' });
      jumpToAgent(result.createdAgentId);
    }
    return true;
  } catch (error) {
    apiError('interventions:apply', error);
    return fail('The command did not reach the colony. Nothing was changed. You can try again.', true);
  }
}

/** Sends a god power with a fresh command id. Resolves true when the backend accepted it. */
export function applyPower(intervention: Intervention): Promise<boolean> {
  return send(intervention, Crypto.randomUUID());
}
/** Re-sends the last failed command with the same command id, which the backend treats as idempotent. */
export function retryPower(): Promise<boolean> {
  if (!pendingCommand) return Promise.resolve(false);
  return send(pendingCommand.intervention, pendingCommand.commandId);
}

export async function resetWorld() {
  if (!source) return;
  try {
    await source.reset();
    await boot();
  } catch (error) {
    apiError('world:reset', error);
    showToast('error', 'Could not reset the world.');
  }
}
