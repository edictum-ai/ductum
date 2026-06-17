import { execFile } from 'node:child_process'

export async function defaultOpenBrowser(url: string, options: { env?: Record<string, string | undefined> } = {}): Promise<void> {
  const platform = process.platform
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  await new Promise<void>((resolve, reject) => {
    const child = execFile(command, args, { env: browserEnv(options.env ?? process.env) }, (error) => {
      if (error != null) reject(error)
      else resolve()
    })
    child.unref()
  })
}

function browserEnv(env: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    ['PATH', 'HOME', 'TERM']
      .map((key) => [key, env[key]] as const)
      .filter((entry): entry is readonly [string, string] => entry[1] != null && entry[1] !== ''),
  )
}
