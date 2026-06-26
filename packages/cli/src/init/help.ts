export const initHelpData = {
  command: 'ductum init',
  usage: 'ductum init [options]',
  description: 'Create a local Ductum factory directory and apply its initial configuration',
  options: [
    { flags: '--dir <path>', description: 'Install directory. Defaults to ~/.ductum/factories.' },
    { flags: '--name <projectName>', description: 'Project name. Defaults to default.' },
    { flags: '--no-git', description: 'Skip git init and the initial commit' },
    { flags: '--login', description: 'Run auth acquisition during init' },
    { flags: '--no-login', description: 'Skip auth acquisition during init' },
    { flags: '--no-browser', description: 'Do not open the browser; print the dashboard URL and pairing link' },
    { flags: '--resume', description: 'Resume init at the Claude auth step' },
    { flags: '-h, --help', description: 'display help for command' },
  ],
}

export function formatInitHelp(): string {
  return [
    'Usage: ductum init [options]',
    '',
    'Create a local Ductum factory directory and apply its initial configuration',
    '',
    'Options:',
    '  --dir <path>          Install directory. Defaults to ~/.ductum/factories.',
    '  --name <projectName>  Project name. Defaults to default.',
    '  --no-git              Skip git init and the initial commit',
    '  --login               Run auth acquisition during init',
    '  --no-login            Skip auth acquisition during init',
    '  --no-browser          Do not open the browser; print the dashboard URL and pairing link',
    '  --resume              Resume init at the Claude auth step',
    '  -h, --help            display help for command',
  ].join('\n')
}
