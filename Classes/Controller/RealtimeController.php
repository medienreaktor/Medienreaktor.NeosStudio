<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller;

use Medienreaktor\NeosStudio\Service\WorkspaceEventFeed;
use Medienreaktor\NeosStudio\Service\WorkspaceEventFeedFactory;
use Medienreaktor\NeosStudio\Service\WorkspaceHistoryService;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\ContentRepositoryRegistry\ContentRepositoryRegistry;
use Neos\ContentRepositoryRegistry\Exception\ContentRepositoryNotFoundException;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Mvc\Controller\ActionController;

/**
 * The server-to-server surface of the realtime sidecar (the Hocuspocus
 * WebSocket server in this package's Resources/Private/Realtime/): the sidecar tails each
 * active workspace's change feed ONCE here and fans the events out to every
 * connected editor - replacing one poll per editor per 2s with one poll per
 * workspace.
 *
 * It tails the content stream through the Studio's WorkspaceEventFeed and
 * classifies events with WorkspaceHistoryService::parseFeedEvent() - the same
 * classification the shell's polling transport applies client-side to
 * Neos.Api's workspace events (api/collaboration.ts), so both transports
 * deliver identical feed events.
 *
 * Deliberately no operation of the Studio API (no bearer token, no scopes)
 * and sessionless - excluded from the backend session provider like
 * ShareController.
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
class RealtimeController extends ActionController
{
    /**
     * Feed page size per request; a full page tells the sidecar its clients
     * must refresh wholesale.
     */
    private const EVENT_FEED_LIMIT = 200;

    /**
     * @var array<string>
     */
    protected $supportedMediaTypes = ['application/json'];

    #[Flow\Inject]
    protected WorkspaceHistoryService $workspaceHistoryService;

    #[Flow\Inject]
    protected ContentRepositoryRegistry $contentRepositoryRegistry;

    /**
     * Untyped: absent configuration injects null.
     */
    #[Flow\InjectConfiguration(path: 'realtime.sharedSecret')]
    protected $sharedSecret;

    /**
     * The workspace change feed: {workspace, contentStreamId, sequenceNumber,
     * reset, truncated, events}. Without stream+since (the baseline), or when
     * the workspace moved to a different content stream since (reset=true),
     * no events are enumerated - only the current cursor is handed out. The
     * sidecar relays the events to the shell without translation.
     */
    public function eventsAction(string $contentRepositoryId, string $workspaceName): string
    {
        $this->requireSharedSecret();

        try {
            $contentRepositoryId = ContentRepositoryId::fromString($contentRepositoryId);
            $workspace = $this->contentRepositoryRegistry->get($contentRepositoryId)->findWorkspaceByName(WorkspaceName::fromString($workspaceName));
        } catch (\InvalidArgumentException | ContentRepositoryNotFoundException) {
            $workspace = null;
        }
        if ($workspace === null) {
            $this->throwJsonStatus(404, 'workspace_not_found', 'The workspace does not exist.');
        }

        $query = $this->request->getHttpRequest()->getQueryParams();
        $knownStream = isset($query['stream']) && is_string($query['stream']) && $query['stream'] !== '' ? $query['stream'] : null;
        $since = isset($query['since']) && is_numeric($query['since']) ? (int)$query['since'] : null;

        /** @var WorkspaceEventFeed $feed */
        $feed = $this->contentRepositoryRegistry->buildService($contentRepositoryId, new WorkspaceEventFeedFactory());
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

    protected function initializeAction(): void
    {
        $this->response->setContentType('application/json');
        $this->response->setHttpHeader('Cache-Control', 'private, no-store');
    }

    /**
     * @param array<string, mixed> $data
     */
    private function json(array $data): string
    {
        return json_encode($data, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    private function throwJsonStatus(int $statusCode, string $error, string $description): never
    {
        $this->throwStatus($statusCode, null, json_encode([
            'error' => $error,
            'error_description' => $description,
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }
}
