<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller;

use Medienreaktor\NeosApi\Controller\Api\AbstractApiController;
use Medienreaktor\NeosApi\Service\WorkspaceEventFeed;
use Medienreaktor\NeosApi\Service\WorkspaceEventFeedFactory;
use Medienreaktor\NeosApi\Service\WorkspaceHistoryService;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Flow\Annotations as Flow;

/**
 * The server-to-server surface of the realtime sidecar (the Hocuspocus
 * WebSocket server in this package's Resources/Private/Realtime/): the sidecar tails each
 * active workspace's change feed ONCE here and fans the events out to every
 * connected editor - replacing one poll per editor per 2s with one poll per
 * workspace.
 *
 * A Studio feature through and through, so it lives here and not in the
 * NeosApi package - it merely reuses the API's feed services (the same ones
 * behind the user-scoped events endpoint).
 *
 * Deliberately NOT in the Controller\Api namespace (no bearer token, no
 * session - excluded from the backend session provider like ShareController).
 * The credential is the shared secret (Medienreaktor.NeosStudio.realtime.sharedSecret)
 * in the X-Realtime-Secret header, validated in-action - the same pattern as
 * the anonymous preview-link endpoint. While no secret is configured the
 * endpoint answers 404 for every request, so an unconfigured installation
 * exposes nothing.
 *
 * Per-USER authorization is not this endpoint's job: the sidecar authorizes
 * every editor's connection with the editor's own bearer token against the
 * user-scoped API before it forwards anything (see Resources/Private/Realtime/server.js).
 */
class RealtimeController extends AbstractApiController
{
    /**
     * Feed page size per request - mirrors the user-scoped events endpoint;
     * a full page tells the sidecar its clients must refresh wholesale.
     */
    private const EVENT_FEED_LIMIT = 200;

    #[Flow\Inject]
    protected WorkspaceHistoryService $workspaceHistoryService;

    /**
     * Untyped: absent configuration injects null.
     */
    #[Flow\InjectConfiguration(path: 'realtime.sharedSecret')]
    protected $sharedSecret;

    /**
     * The workspace change feed, shaped exactly like the user-scoped
     * /api/workspaces/{name}/events resource (same baseline/reset/truncated
     * semantics), so the sidecar relays payloads without translation.
     */
    public function eventsAction(string $workspaceName): string
    {
        $this->requireSharedSecret();

        $workspace = $this->getContentRepository()->findWorkspaceByName(WorkspaceName::fromString($workspaceName));
        if ($workspace === null) {
            $this->throwJsonStatus(404, 'workspace_not_found', 'The workspace does not exist.');
        }

        $query = $this->request->getHttpRequest()->getQueryParams();
        $knownStream = isset($query['stream']) && is_string($query['stream']) && $query['stream'] !== '' ? $query['stream'] : null;
        $since = isset($query['since']) && is_numeric($query['since']) ? (int)$query['since'] : null;

        /** @var WorkspaceEventFeed $feed */
        $feed = $this->contentRepositoryRegistry->buildService($this->getContentRepositoryId(), new WorkspaceEventFeedFactory());
        $contentStreamId = $workspace->currentContentStreamId;

        if ($knownStream === null || $since === null || $knownStream !== $contentStreamId->value) {
            return $this->json([
                'workspace' => $workspace->workspaceName->value,
                'contentStreamId' => $contentStreamId->value,
                'sequenceNumber' => $feed->latestSequenceNumber($contentStreamId),
                'reset' => $knownStream !== null && $knownStream !== $contentStreamId->value,
                'truncated' => false,
                'events' => [],
            ]);
        }

        $envelopes = $feed->eventsSince($contentStreamId, $since, self::EVENT_FEED_LIMIT);
        $cursor = $since;
        $events = [];
        foreach ($envelopes as $envelope) {
            $cursor = $envelope->sequenceNumber->value;
            $parsed = $this->workspaceHistoryService->parseFeedEvent($envelope);
            if ($parsed !== null) {
                $events[] = $parsed['event'];
            }
        }

        return $this->json([
            'workspace' => $workspace->workspaceName->value,
            'contentStreamId' => $contentStreamId->value,
            'sequenceNumber' => $cursor,
            'reset' => false,
            'truncated' => count($envelopes) === self::EVENT_FEED_LIMIT,
            'events' => $events,
        ]);
    }

    /**
     * Constant-time shared-secret check. No secret configured = the feature
     * is off: answer 404 (not 403) so probing cannot even learn the endpoint
     * exists.
     */
    private function requireSharedSecret(): void
    {
        $secret = is_string($this->sharedSecret) ? $this->sharedSecret : '';
        if ($secret === '') {
            $this->throwJsonStatus(404, 'not_found', 'Not found.');
        }
        $provided = $this->request->getHttpRequest()->getHeaderLine('X-Realtime-Secret');
        if (!hash_equals($secret, $provided)) {
            $this->throwJsonStatus(403, 'invalid_secret', 'The realtime shared secret does not match.');
        }
    }
}
