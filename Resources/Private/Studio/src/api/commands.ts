import { apiFetch } from './client'

/**
 * A content repository command for POST /api/commands - the discriminated
 * union the backend whitelists in its CommandRegistry.
 */
export interface Command {
  type: string
  payload: Record<string, unknown>
}

/**
 * Execute commands sequentially in one request. The batch stops at the first
 * failure and the error reports how many commands were applied - partial
 * application is possible (the CR is not transactional across commands).
 */
export async function executeCommands(commands: Command[]): Promise<void> {
  if (commands.length === 0) return
  if (commands.length === 1) {
    await apiFetch('/commands', { method: 'POST', body: commands[0] })
  } else {
    await apiFetch('/commands/batch', { method: 'POST', body: { commands } })
  }
}
