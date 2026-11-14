export const preferenceSchemes = Object.freeze([
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
]);
export const preferenceFonts = Object.freeze([
  'inter',
  'manrope',
  'nunito',
  'lora',
]);
export const defaultPreferences = Object.freeze({
  locale: 'en',
  mode: 'light',
  scheme: 'teal',
  layout: 'TABLE',
  typography: Object.freeze({
    family: 'inter',
    size: 14,
    weight: 400,
    style: 'normal',
    lineHeight: 1.45,
  }),
});
export function validatePreferences(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Choose valid appearance preferences.');
  const t = input.typography;
  if (!['en', 'ml', 'hi'].includes(input.locale))
    throw new Error('Choose English, Malayalam or Hindi.');
  if (!['light', 'dark', 'system'].includes(input.mode))
    throw new Error('Choose light, dark or system display mode.');
  if (!preferenceSchemes.includes(input.scheme))
    throw new Error('Choose an available color scheme.');
  if (!['TABLE', 'CARDS', 'ROUTE'].includes(input.layout))
    throw new Error('Choose table, cards or route sequence layout.');
  if (
    !t ||
    typeof t !== 'object' ||
    Array.isArray(t) ||
    !preferenceFonts.includes(t.family) ||
    !Number.isInteger(t.size) ||
    t.size < 12 ||
    t.size > 24 ||
    ![400, 500, 600, 700].includes(t.weight) ||
    !['normal', 'italic'].includes(t.style) ||
    ![1.25, 1.45, 1.6].includes(t.lineHeight)
  )
    throw new Error(
      'Choose supported font, size, weight, style and line spacing.',
    );
  return {
    locale: input.locale,
    mode: input.mode,
    scheme: input.scheme,
    layout: input.layout,
    typography: {
      family: t.family,
      size: t.size,
      weight: t.weight,
      style: t.style,
      lineHeight: t.lineHeight,
    },
  };
}
