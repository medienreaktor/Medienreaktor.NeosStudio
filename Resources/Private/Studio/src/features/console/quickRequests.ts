export interface QuickRequest {
  label: string
  method: string
  path: string
  body?: string
}

export const QUICK_REQUESTS: QuickRequest[] = [
  { label: 'GET /api/me', method: 'GET', path: '/api/me' },
  { label: 'GET /api/sites', method: 'GET', path: '/api/sites' },
  { label: 'GET /api/workspaces', method: 'GET', path: '/api/workspaces' },
  { label: 'GET /api/nodetypes', method: 'GET', path: '/api/nodetypes' },
  { label: 'GET /api/dimensions', method: 'GET', path: '/api/dimensions' },
  {
    label: 'POST /api/commands (SetNodeProperties)',
    method: 'POST',
    path: '/api/commands',
    body: JSON.stringify(
      {
        type: 'SetNodeProperties',
        payload: {
          workspaceName: 'live',
          nodeAggregateId: 'REPLACE_ME',
          originDimensionSpacePoint: { language: 'en_US' },
          propertyValues: { title: 'Changed via Studio' },
        },
      },
      null,
      2,
    ),
  },
]
