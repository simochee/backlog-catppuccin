import { sharedTokenScope } from './guards.mjs';

const latteInks = [
  { hue: 'rosewater', color: '#cc5339', amount: 15.6, roles: ['marker-beige', 'link', 'primary'] },
  { hue: 'pink', color: '#db21a9', amount: 19.6, roles: ['marker-pink', 'marker-magenta', 'link', 'primary'] },
  { hue: 'peach', color: '#ca4b01', amount: 12.1, roles: ['marker-orange', 'link', 'primary'] },
  { hue: 'yellow', color: '#a86b16', amount: 12.1, roles: ['marker-yellow', 'warning', 'link', 'primary'] },
  { hue: 'green', color: '#358524', amount: 6.6, roles: ['marker-green', 'marker-lime', 'success', 'link', 'primary'] },
  { hue: 'sky', color: '#037eaf', amount: 10.7, roles: ['link', 'primary'] },
];
export const paletteAllowlist = [
  ...latteInks.flatMap(({ hue, color, amount, roles }) => roles.flatMap((role) =>
    (role === 'primary' ? ['icon'] : ['text', 'icon']).map((content) => ({
      flavor: 'latte', property: `--nuui-${content}-${role}`, color,
      reason: `Minimum ${amount}% Latte ${hue} darkening at 0.1% resolution for 3:1 ink on its 30% tint over base.`,
    })))),
  { flavor: 'latte', property: '--warningColorScaleText', color: '#b47317', reason: 'Minimum 9.5% Latte yellow darkening at 0.1% resolution for 3:1 warning ink on its 16% tint over base.' },
  ...['', '.dark-mode'].flatMap((mode) => [
    {
      flavor: 'latte', property: 'color', color: '#ca4b01',
      selector: ['.Code-table .Code-table_content_separator', '.Code-table .Code-table_content_separator td', '.Code-split-table .Line-src.separator'].map((selector) => `${sharedTokenScope}${mode} ${selector}`).join(',\n  '),
      reason: 'Minimum 12.1% Latte peach darkening at 0.1% resolution for 3:1 separator ink on surface0.',
    },
    {
      flavor: 'latte', property: 'color', color: '#e244b8', selector: `${sharedTokenScope}${mode} .code-view__header`,
      reason: 'Minimum 11.2% Latte pink darkening at 0.1% resolution for 3:1 file-path ink on mantle.',
    },
  ]),
  ...[
    ['str', '#358524', 'green', 6.6], ['atv', '#358524', 'green', 6.6],
    ['typ', '#a36715', 'yellow', 13.4], ['atn', '#a36715', 'yellow', 13.4],
    ['lit', '#ca4b01', 'peach', 12.1], ['dec', '#c54d33', 'rosewater', 18],
  ].flatMap(([token, color, hue, amount]) => ['', '.dark-mode'].map((mode) => ({
    flavor: 'latte', property: 'color', color, selector: `${sharedTokenScope}${mode} .prettyprint .${token}`,
    reason: `Minimum ${amount}% Latte ${hue} darkening at 0.1% resolution for 3:1 syntax ink on surface0.`,
  }))),
];
