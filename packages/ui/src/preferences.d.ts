export interface PreferenceValues {
  locale: 'en' | 'ml' | 'hi';
  mode: 'light' | 'dark' | 'system';
  scheme: (typeof preferenceSchemes)[number];
  layout: 'TABLE' | 'CARDS' | 'ROUTE';
  typography: {
    family: (typeof preferenceFonts)[number];
    size: number;
    weight: 400 | 500 | 600 | 700;
    style: 'normal' | 'italic';
    lineHeight: 1.25 | 1.45 | 1.6;
  };
}
export const preferenceSchemes: readonly [
  'default',
  'dynamic',
  'catppuccin',
  'greenApple',
  'lavender',
  'midnightDusk',
  'nord',
  'strawberryDaiquiri',
  'tako',
  'teal',
  'tidalWave',
  'yinYang',
  'yotsuba',
  'tokyoNight',
  'monochrome',
];
export const preferenceFonts: readonly ['inter', 'manrope', 'nunito', 'lora'];
export const defaultPreferences: Readonly<PreferenceValues>;
export function validatePreferences(input: unknown): PreferenceValues;
