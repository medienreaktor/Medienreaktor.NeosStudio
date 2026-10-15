<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller;

use Neos\Api\Infrastructure\ContentRepository\ContentStreamEventsFactory;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\ContentRepositoryRegistry\ContentRepositoryRegistry;
use Neos\ContentRepositoryRegistry\Exception\ContentRepositoryNotFoundException;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Mvc\Controller\ActionController;

/**
 * The server-to-server surface of the realtime sidecar (the Hocuspocus
 * WebSocket server in this package's Resources/Private/Realtime/): the sidecar
 * watches the HEAD of each active workspace's content stream here - one
 * request per workspace, not one per editor - and tells the workspace's
 * editors "something changed" whenever it moves.
 *
 * Deliberately no event contents: the editors then read the events
 * themselves through Neos.Api's listWorkspaceEvents with their own token, so
 * Neos.Api's per-node read filtering applies to what each of them sees, and
 * the feed is classified in one place only (the shell's
 * features/collaboration/eventFeed.ts). A moving head says nothing more than
 * "this workspace you may read has new events".
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
     * @var array<string>
     */
    protected $supportedMediaTypes = ['application/json'];

    #[Flow\Inject]
    protected ContentRepositoryRegistry $contentRepositoryRegistry;

    /**
     * Untyped: absent configuration injects null.
     */
    #[Flow\InjectConfiguration(path: 'realtime.sharedSecret')]
    protected $sharedSecret;

    /**
     * The head of the workspace's change feed: {workspace, contentStreamId,
     * sequenceNumber} - the current content stream and the (global) sequence
     * number of its newest event, null for an empty stream. The same cursor
     * Neos.Api's listWorkspaceEvents pages by (its `after`), so the shell can
     * tell whether a head is news to it.
     */
    public function headAction(string $contentRepositoryId, string $workspaceName): string
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

        $contentStreamId = $workspace->currentContentStreamId;
        $newest = null;
        $events = $this->contentRepositoryRegistry->buildService($contentRepositoryId, new ContentStreamEventsFactory());
        foreach ($events->load($contentStreamId)->backwards()->limit(1) as $envelope) {
            $newest = $envelope->sequenceNumber->value;
        }

        return $this->json([
            'workspace' => $workspace->workspaceName->value,
            'contentStreamId' => $contentStreamId->value,
            'sequenceNumber' => $newest,
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
