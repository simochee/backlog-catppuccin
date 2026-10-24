import { sharedTokenScope } from './guards.mjs';

const latteInks = [
  { hue: 'rosewater', color: '#ce5a41', amount: 13.6, roles: ['marker-beige', 'link', 'primary'] },
  { hue: 'pink', color: '#df2daf', amount: 16.4, roles: ['marker-pink', 'marker-magenta', 'link', 'primary'] },
  { hue: 'peach', color: '#d54e01', amount: 10.1, roles: ['marker-orange', 'link', 'primary'] },
  { hue: 'yellow', color: '#af7017', amount: 10.6, roles: ['marker-yellow', 'warning', 'link', 'primary'] },
  { hue: 'sky', color: '#0384b8', amount: 9, roles: ['link', 'primary'] },
];
export const paletteAllowlist = [
  ...latteInks.flatMap(({ hue, color, amount, roles }) => roles.flatMap((role) =>
    (role === 'primary' ? ['icon'] : ['text', 'icon']).map((content) => ({
      flavor: 'latte', property: `--nuui-${content}-${role}`, color,
      reason: `Minimum ${amount}% Latte ${hue} darkening at 0.1% resolution for 3:1 ink on its 22% tint over base.`,
    })))),
  { flavor: 'latte', property: '--warningColorScaleText', color: '#b47317', reason: 'Minimum 9.5% Latte yellow darkening at 0.1% resolution for 3:1 warning ink on its 16% tint over base.' },
  ...[
    ['str', '#358524', 'green', 6.6], ['atv', '#358524', 'green', 6.6],
    ['typ', '#a36715', 'yellow', 13.4], ['atn', '#a36715', 'yellow', 13.4],
    ['lit', '#ca4b01', 'peach', 12.1], ['dec', '#c54d33', 'rosewater', 18],
  ].flatMap(([token, color, hue, amount]) => ['', '.dark-mode'].map((mode) => ({
    flavor: 'latte', property: 'color', color, selector: `${sharedTokenScope}${mode} .prettyprint .${token}`,
    reason: `Minimum ${amount}% Latte ${hue} darkening at 0.1% resolution for 3:1 syntax ink on surface0.`,
  }))),
];
