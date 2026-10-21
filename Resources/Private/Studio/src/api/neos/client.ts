import createClient, { type FetchOptions } from 'openapi-fetch'
import { config } from '@/config'
import {
  authorizedFetch,
  type FetchInit,
  request,
  serializeQuery,
  stream,
  type StreamInit,
  upload,
  type UploadOptions,
} from '../http/request'
import type { paths } from './schema/openapi'

/**
 * The client of the Neos API below config.apiBase ('/api'): Neos.Api's
 * operations and the Studio's (tasks, notifications, access roles, preview
 * links, the creation dialog), both in the generated `paths` of
 * schema/openapi.ts. URLs, path and query parameters, bodies and responses
 * are typed by them:
 *
 *   await unwrap(api.GET('/cr/{contentRepositoryId}/nodes/{nodeAggregateId}', {
 *     params: { path: { contentRepositoryId, nodeAggregateId }, query },
 *     signal,
 *   }))
 *
 * Every request goes through the shell's transport (http/request.ts: bearer
 * token, 401 refresh-and-retry, Accept-Language, no HTTP caching); unwrap()
 * turns the result into the data or an ApiError. Query parameters are
 * serialized the way PHP reads them (serializeQuery).
 */
const client = createClient<paths>({
  baseUrl: config.apiBase,
  fetch: authorizedFetch,
  querySerializer: serializeQuery,
})

export { unwrap } from '../http/request'

type Method = 'get' | 'put' | 'post' | 'delete' | 'patch'

/** The paths with an operation of the method. */
type PathsWith<M extends Method> = {
  [Path in keyof paths]: paths[Path][M] extends undefined ? never : Path
}[keyof paths]

/** The operation of the path and method. */
type Operation<Path extends keyof paths, M extends Method> = NonNullable<
  paths[Path][M]
>

/** The success statuses an operation can answer with. */
type SuccessStatus = 200 | 201 | 202 | 203 | 204 | 206

/**
 * The parsed body of an operation's success response: its JSON content,
 * undefined for one without (204).
 */
type ResponseData<Op> = Op extends { responses: infer Responses }
  ? {
      [Status in keyof Responses & SuccessStatus]: Responses[Status] extends {
        content: { 'application/json': infer Body }
      }
        ? Body
        : undefined
    }[keyof Responses & SuccessStatus]
  : never

/** The keys of T that are not optional. */
type RequiredKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K
}[keyof T]

/** The init argument: optional unless the operation requires params or a body. */
type InitArgs<Op> = [RequiredKeys<FetchOptions<Op>>] extends [never]
  ? [init?: FetchOptions<Op>]
  : [init: FetchOptions<Op>]

/** What a call resolves with - for unwrap(). */
interface Result<Data> {
  data?: Data
  error?: unknown
  response: Response
}

type ApiMethod<M extends Method> = <Path extends PathsWith<M>>(
  path: Path,
  ...init: InitArgs<Operation<Path, M>>
) => Promise<Result<ResponseData<Operation<Path, M>>>>

/**
 * The typed calls, one per method. openapi-fetch's own client types its
 * parameters and bodies, and so does this; the responses are typed from the
 * operations directly - openapi-fetch passes them through its Readable<>
 * helper, which drops every member typed plain `null` (e.g. the
 * references/children/... of a node in references.node) and so turns a Node
 * into something a Node is not.
 */
export const api = client as unknown as {
  GET: ApiMethod<'get'>
  PUT: ApiMethod<'put'>
  POST: ApiMethod<'post'>
  DELETE: ApiMethod<'delete'>
  PATCH: ApiMethod<'patch'>
}

/**
 * An untyped request against the Neos API, for paths the generated schema
 * does not know - the plugin API hands it to plugins for their own
 * operations. The shell's own code uses {@link api}.
 */
export function apiFetch<T>(path: string, init?: FetchInit): Promise<T> {
  return request<T>(config.apiBase, path, init)
}

/**
 * A request to a Neos API operation that answers with Server-Sent Events
 * (see http/request.ts stream()), e.g. a plugin's long-running job reporting
 * progress - the plugin API hands it to plugins. Same auth and base URL as
 * {@link apiFetch}.
 */
export function apiStream(path: string, init: StreamInit): Promise<void> {
  return stream(config.apiBase, path, init)
}

/** The path parameters of an operation. */
type PathParams<Op> = Op extends { parameters: { path: infer Params } }
  ? Params
  : never

/**
 * A multipart upload with progress against a Neos API operation (asset
 * uploads and file replacements): the XHR path of http/request.ts, typed by
 * the operation like the client - its path, path parameters and response.
 */
export function apiUpload<M extends 'post' | 'put', Path extends PathsWith<M>>(
  method: M,
  path: Path,
  pathParams: PathParams<Operation<Path, M>>,
  formData: FormData,
  options: Omit<UploadOptions, 'method'> = {},
): Promise<Exclude<ResponseData<Operation<Path, M>>, undefined>> {
  const url = String(path).replace(/\{([^}]+)\}/g, (_, name: string) =>
    encodeURIComponent(
      String((pathParams as Record<string, string | number>)[name]),
    ),
  )
  return upload(config.apiBase, url, formData, {
    ...options,
    method: method.toUpperCase(),
  })
}

/**
 * A page of a paginated listing, as far as fetchAllPages needs it - every
 * generated Paginated*Listing satisfies it.
 */
export interface PageOf<T> {
  data: T[]
  meta: { total: number }
}

/** Neos.Api's maximum page size. */
const MAX_PAGE_SIZE = 100

/**
 * Every item of a paginated Neos.Api listing: reads the first page of the
 * maximum size, then - knowing meta.total - all remaining pages at once. For
 * the lists the shell needs in full (tree levels, changes, the user roster) -
 * not for listings a UI pages through itself (the media browser).
 *
 * `fetchPage` reads one page with the offset and limit given, e.g.
 *
 *   fetchAllPages((page) =>
 *     unwrap(api.GET('/users', { params: { query: page }, signal })),
 *   )
 */
export async function fetchAllPages<T>(
  fetchPage: (page: { offset: number; limit: number }) => Promise<PageOf<T>>,
): Promise<T[]> {
  const first = await fetchPage({ offset: 0, limit: MAX_PAGE_SIZE })
  const offsets: number[] = []
  for (
    let offset = MAX_PAGE_SIZE;
    // A short page is the last one, whatever the total said.
    first.data.length === MAX_PAGE_SIZE && offset < first.meta.total;
    offset += MAX_PAGE_SIZE
  ) {
    offsets.push(offset)
  }
  const rest = await Promise.all(
    offsets.map((offset) => fetchPage({ offset, limit: MAX_PAGE_SIZE })),
  )
  return [first, ...rest].flatMap((page) => page.data)
}
