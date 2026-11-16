/**
 * Look and feel: a dark space palette, hard pixel borders and two open-licence pixel fonts
 * (Silkscreen for labels and headings, Pixelify Sans for reading text; both SIL OFL 1.1).
 */
import { PixelifySans_400Regular, PixelifySans_500Medium, PixelifySans_700Bold } from '@expo-google-fonts/pixelify-sans';
import { Silkscreen_400Regular, Silkscreen_700Bold } from '@expo-google-fonts/silkscreen';
import type { EventCategory } from '../../shared/types';

export const colors = {
  space: '#05060c',
  ink: '#0b0d18',
  panel: '#12152a',
  panelHi: '#1b2040',
  panelLo: '#0c0e1d',
  border: '#3d4a7a',
  borderHi: '#7f93d6',
  text: '#e9edff',
  textDim: '#97a3cc',
  textFaint: '#5e6a94',
  accent: '#5fe3f0',
  accentDim: '#1f6f80',
  good: '#6fe08a',
  warn: '#ffc857',
  danger: '#ff5d5d',
  dangerDim: '#7a2230',
  violet: '#b98cff',
  pink: '#ff7ab8',
  gold: '#ffd24a',
  /** What the player did. */
  amber: '#fab85c',
  /** What a colonist merely believes (earthlight). */
  earth: '#78bdfa',
} as const;

export const categoryColor: Record<EventCategory, string> = {
  environment: '#ffb061',
  economy: '#ffd24a',
  social: '#ff7ab8',
  politics: '#9aa8ff',
  health: '#6fe08a',
  action: '#5fe3f0',
  intervention: '#b98cff',
};

export const fonts = {
  label: 'Silkscreen_400Regular',
  labelBold: 'Silkscreen_700Bold',
  body: 'PixelifySans_400Regular',
  bodyMedium: 'PixelifySans_500Medium',
  bodyBold: 'PixelifySans_700Bold',
  /** Font files, for Skia text on the map. */
  files: { label: Silkscreen_400Regular as number, body: PixelifySans_500Medium as number },
  /** Map for expo-font's useFonts. */
  load: { Silkscreen_400Regular, Silkscreen_700Bold, PixelifySans_400Regular, PixelifySans_500Medium, PixelifySans_700Bold },
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
