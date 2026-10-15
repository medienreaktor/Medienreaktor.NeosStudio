import { config } from '@/config'
import { type FetchInit, request } from '../http/request'

/**
 * A request against the Studio API below config.studioApiBase
 * ('/neos/studio/api'): tasks, notifications, access roles, preview links,
 * workspace review, history and trash - what the Studio adds to Neos.
 */
export function studioFetch<T>(path: string, init?: FetchInit): Promise<T> {
  return request<T>(config.studioApiBase, path, init)
}
