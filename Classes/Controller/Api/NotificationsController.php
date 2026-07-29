<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller\Api;

use Medienreaktor\NeosApi\Controller\Api\AbstractApiController;
use Medienreaktor\NeosStudio\Domain\Model\Notification;
use Medienreaktor\NeosStudio\Domain\Repository\NotificationRepository;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Persistence\PersistenceManagerInterface;
use Neos\Neos\Domain\Model\UserId;
use Neos\Neos\Domain\Service\UserService;

/**
 * The authenticated user's Studio notifications (the bell in the shell).
 *
 * Strictly per-user: every action resolves the recipient from the
 * authenticated account, ids of other users' notifications are treated as
 * non-existent. Lives behind the same OAuth bearer firewall as the NeosApi
 * controllers (request pattern registered in Settings.yaml).
 */
class NotificationsController extends AbstractApiController
{
    #[Flow\Inject]
    protected NotificationRepository $notificationRepository;

    #[Flow\Inject]
    protected UserService $userService;

    #[Flow\Inject]
    protected PersistenceManagerInterface $persistenceManager;

    /**
     * GET /api/notifications
     */
    public function indexAction(int $limit = 20, int $offset = 0, bool $unread = false): string
    {
        $this->requireScope('neos.read');
        $userId = $this->requireUserId();

        $notifications = $this->notificationRepository->findByUser($userId->value, $unread, min($limit, 100), $offset);

        return $this->json([
            'notifications' => array_map($this->serializeNotification(...), $notifications),
            'unreadCount' => $this->notificationRepository->countUnreadByUser($userId->value),
        ]);
    }

    /**
     * POST /api/notifications/read - body: {"ids": ["..."]} or {"all": true}
     *
     * Skips Flow's CSRF check like all unsafe bearer-token endpoints:
     * authorization comes from the bearer token, not the (same-origin)
     * backend session cookie that would otherwise trigger it.
     *
     * The body is read directly (like the NeosApi batch endpoints) - a
     * mapped array action argument would trip over Flow's property mapping,
     * which refuses array elements without explicit per-index allowances.
     */
    #[Flow\SkipCsrfProtection]
    public function markReadAction(): string
    {
        $this->requireScope('neos.write');
        $userId = $this->requireUserId();

        $body = json_decode((string)$this->request->getHttpRequest()->getBody(), true);
        if (!is_array($body)) {
            $this->throwJsonStatus(400, 'invalid_request', 'Request body must be a JSON object.');
        }
        $all = ($body['all'] ?? false) === true;
        $ids = array_filter(
            is_array($body['ids'] ?? null) ? $body['ids'] : [],
            is_string(...)
        );

        if ($all) {
            $this->notificationRepository->markAllReadForUser($userId->value, new \DateTimeImmutable());
        } else {
            foreach ($ids as $id) {
                $notification = $this->notificationRepository->findByIdentifier($id);
                // Foreign ids are silently skipped, not revealed as existing.
                if ($notification instanceof Notification && $notification->getUserId() === $userId->value) {
                    $notification->markRead();
                    $this->notificationRepository->update($notification);
                }
            }
        }

        return $this->json([
            'unreadCount' => $this->notificationRepository->countUnreadByUser($userId->value),
        ]);
    }

    /**
     * DELETE /api/notifications - clear the user's read notifications.
     *
     * Only read ones: an unread notification may have arrived since the
     * user last looked at the list, and clearing must not swallow it.
     * CSRF skipped for the same reason as markReadAction.
     */
    #[Flow\SkipCsrfProtection]
    public function clearAction(): string
    {
        $this->requireScope('neos.write');
        $userId = $this->requireUserId();

        $removed = $this->notificationRepository->removeReadForUser($userId->value);

        return $this->json([
            'removed' => $removed,
            'unreadCount' => $this->notificationRepository->countUnreadByUser($userId->value),
        ]);
    }

    private function requireUserId(): UserId
    {
        $user = $this->userService->getCurrentUser();
        if ($user === null) {
            // client_credentials tokens act as an account without a Neos user;
            // notifications are inherently user-bound.
            $this->throwJsonStatus(403, 'no_user', 'Notifications require a token bound to a Neos user.');
        }

        return $user->getId();
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeNotification(Notification $notification): array
    {
        return [
            'id' => $this->persistenceManager->getIdentifierByObject($notification),
            'source' => $notification->getSource(),
            'type' => $notification->getType(),
            'title' => $notification->getTitle(),
            'message' => $notification->getMessage(),
            'payload' => $notification->getPayload() === []
                ? new \stdClass()
                : $notification->getPayload(),
            'createdAt' => $notification->getCreatedAt()->format(\DateTimeInterface::ATOM),
            'readAt' => $notification->getReadAt()?->format(\DateTimeInterface::ATOM),
        ];
    }
}
