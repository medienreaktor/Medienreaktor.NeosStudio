import { config } from '@/config'
import { type FetchInit, request } from '../http/request'

/**
 * A request against the Studio's operations of the Neos API, below
 * config.apiBase ('/api') like Neos.Api's own: tasks, notifications, access
 * roles, preview links, workspace review, history and trash - what the
 * Studio adds to Neos. The same as apiFetch, named for what it reaches.
 */
export function studioFetch<T>(path: string, init?: FetchInit): Promise<T> {
  return request<T>(config.apiBase, path, init)
}
