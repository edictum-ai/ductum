export const initHelpData = {
  command: 'ductum init',
  usage: 'ductum init [options]',
  description: 'Create a local Ductum factory directory',
  options: [
    { flags: '--dir <path>', description: 'Install directory. Defaults to ~/ductum.' },
    { flags: '--name <projectName>', description: 'Project name. Defaults to factory.' },
    { flags: '--no-git', description: 'Skip git init and the initial commit' },
    { flags: '--login', description: 'Run auth acquisition during init' },
    { flags: '--no-login', description: 'Skip auth acquisition during init' },
    { flags: '--no-browser', description: 'Do not open the browser; print the dashboard URL and local token-file auth command' },
    { flags: '--resume', description: 'Resume init at the Claude auth step' },
    { flags: '-h, --help', description: 'display help for command' },
  ],
}

export function formatInitHelp(): string {
  return [
    'Usage: ductum init [options]',
    '',
    'Create a local Ductum factory directory',
    '',
    'Options:',
    '  --dir <path>          Install directory. Defaults to ~/ductum.',
    '  --name <projectName>  Project name. Defaults to factory.',
    '  --no-git              Skip git init and the initial commit',
    '  --login               Run auth acquisition during init',
    '  --no-login            Skip auth acquisition during init',
    '  --no-browser          Do not open the browser; print the dashboard URL and local token-file auth command',
    '  --resume              Resume init at the Claude auth step',
    '  -h, --help            display help for command',
  ].join('\n')
}
