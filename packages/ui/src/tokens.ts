/** Values read from Figma variables and native component exports. */
export const palette = {
  ink: '#172D2B',
  muted: '#697775',
  teal: '#087F73',
  tealHover: '#06695F',
  background: '#F5F6F3',
  white: '#FFFFFF',
  border: '#D9E3DE',
  controlBorder: '#D3DEDA',
  skeleton: '#E0E8E5',
  subtle: '#EEF3F0',
  disabled: '#E8ECE9',
  disabledText: '#929E9A',
  focus: '#9BCBC3',
  red: '#AD2B30',
  amber: '#8C5C14',
  dark: '#2E3440',
  light: '#E5EDF2',
  success: '#087F73',
  successBackground: '#E2F2ED',
  warning: '#936321',
  warningBackground: '#FBF1DD',
  danger: '#B13F3F',
  dangerHover: '#943232',
  dangerBackground: '#FBEDEC',
  info: '#386A8A',
  infoBackground: '#ECF3F8',
} as const;

/** Preview palettes are exact; only Teal light and Nord dark have full-screen references. */
export const colorSchemes = {
  default: { name: 'Default', accent: '#4C6DCD', background: '#F5F6FA' },
  dynamic: { name: 'Dynamic', accent: '#675983', background: '#F6F3FC' },
  catppuccin: { name: 'Catppuccin', accent: '#936BCC', background: '#F0ECFA' },
  greenApple: { name: 'Green Apple', accent: '#448651', background: '#EEF6EB' },
  lavender: { name: 'Lavender', accent: '#8051BA', background: '#F2EBFC' },
  midnightDusk: {
    name: 'Midnight Dusk',
    accent: '#B73378',
    background: '#F7EDF3',
  },
  nord: { name: 'Nord', accent: '#5A889E', background: '#EDF2F7' },
  strawberryDaiquiri: {
    name: 'Strawberry Daiquiri',
    accent: '#B64C69',
    background: '#FCEFF0',
  },
  tako: { name: 'Tako', accent: '#846181', background: '#F6F0F9' },
  teal: { name: 'Teal & Turquoise', accent: '#087F73', background: '#EAF5F1' },
  tidalWave: { name: 'Tidal Wave', accent: '#187E9C', background: '#EDF6FA' },
  yinYang: { name: 'Yin & Yang', accent: '#242626', background: '#F6F6F4' },
  yotsuba: { name: 'Yotsuba', accent: '#B76234', background: '#FFF2E9' },
  tokyoNight: { name: 'Tokyo Night', accent: '#526ABD', background: '#EEF0FC' },
  monochrome: { name: 'Monochrome', accent: '#434747', background: '#FAFAFA' },
} as const;
export type ColorScheme = keyof typeof colorSchemes;
export type DisplayMode = 'light' | 'dark' | 'system';
export const fonts = {
  inter: { name: 'Inter', family: '"Inter Variable", Inter, sans-serif' },
  manrope: {
    name: 'Manrope',
    family: '"Manrope Variable", Manrope, "Inter Variable", sans-serif',
  },
  nunito: {
    name: 'Nunito',
    family:
      '"Nunito Sans Variable", "Nunito Sans", "Inter Variable", sans-serif',
  },
  lora: {
    name: 'Lora',
    family: '"Lora Variable", Lora, "Inter Variable", serif',
  },
} as const;
export type FontFamily = keyof typeof fonts;
export const readingSizes = { compact: 12, standard: 14, large: 18 } as const;
export const lineSpacings = {
  tight: 1.25,
  standard: 1.45,
  relaxed: 1.6,
} as const;
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  state: 16,
  lg: 24,
  xl: 32,
  section: 48,
} as const;
export const radii = { badge: 4, control: 6, card: 8 } as const;
export const controlSizes = { small: 32, medium: 40, large: 48 } as const;
export type Tone = 'success' | 'info' | 'warning' | 'error' | 'neutral';
export type SaveState = 'idle' | 'saving' | 'error';
