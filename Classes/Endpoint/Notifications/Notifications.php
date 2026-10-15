<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Notifications;

use Medienreaktor\NeosStudio\Domain\Model;
use Medienreaktor\NeosStudio\Domain\Repository\NotificationRepository;
use Medienreaktor\NeosStudio\Endpoint\Notifications\RequestBody\NotificationsMarkRead;
use Medienreaktor\NeosStudio\Endpoint\Notifications\Schema\Notification;
use Medienreaktor\NeosStudio\Endpoint\Notifications\Schema\NotificationList;
use Medienreaktor\NeosStudio\Endpoint\Notifications\Schema\NotificationListingMeta;
use Medienreaktor\NeosStudio\Endpoint\Notifications\Schema\PaginatedNotificationListing;
use Medienreaktor\NeosStudio\Security\StudioCallers;
use Medienreaktor\NeosStudio\Security\StudioScopes;
use Neos\Api\Security\ApiAuthContextProvider;
use Neos\Api\Security\ApiCaller;
use Neos\Api\Shared\Parameter\Limit;
use Neos\Api\Shared\Parameter\Offset;
use Neos\Api\Shared\Response\Forbidden;
use Neos\Api\Shared\Schema\ListingLinks;
use Neos\Flow\Persistence\PersistenceManagerInterface;
use Neos\Neos\Domain\Model\User;
use Neos\OpenApi\Attributes\AuthContext;
use Neos\OpenApi\Attributes\Operation;
use Neos\OpenApi\Attributes\Parameter;
use Neos\OpenApi\Attributes\RequestBody;
use Psr\Http\Message\ServerRequestInterface;

/**
 * The caller's Studio notifications (the bell in the shell)
 *
 * Strictly the caller's own: the recipient is the Neos user of the token,
 * notifications of other users are never listed or changed. That's why every
 * operation needs a token of a Neos user (403 otherwise).
 */
final readonly class Notifications
{
    public function __construct(
        private NotificationRepository $notificationRepository,
        private PersistenceManagerInterface $persistenceManager,
        private StudioCallers $studioCallers,
    ) {
    }

    #[Operation(
        path: '/notifications',
        method: 'GET',
        summary: 'List your notifications',
        description: 'A page of the caller\'s notifications, newest first. offset and limit (25 by default, 100 at most) choose the page, meta.total and links tell about the others; meta.unread counts all unread ones, whatever the filter.',
        operationId: 'listNotifications',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::NOTIFICATIONS_READ],
        ],
    )]
    public function list(
        #[AuthContext] ApiCaller $caller,
        ServerRequestInterface $request,
        #[Parameter(in: 'query', description: 'true lists only unread notifications')]
        bool $filterByUnread = false,
        #[Parameter(in: 'query', description: 'How many items to skip, 0 if omitted')]
        Offset|null $offset = null,
        #[Parameter(in: 'query', description: 'How many items at most, 25 if omitted, 100 at most')]
        Limit|null $limit = null,
    ): PaginatedNotificationListing|Forbidden {
        $user = $this->studioCallers->requireUserOf($caller);
        if (!$user instanceof User) {
            return $user;
        }
        $offset ??= Offset::none();
        $limit ??= Limit::default();
        $userId = $user->getId()->value;
        $unread = $this->notificationRepository->countUnreadByUser($userId);
        $total = $filterByUnread ? $unread : $this->notificationRepository->countByUser($userId);
        $notifications = $this->notificationRepository->findByUser($userId, $filterByUnread, $limit->value, $offset->value);
        return new PaginatedNotificationListing(
            new NotificationList(...array_map(
                fn (Model\Notification $notification) => Notification::from($notification, (string)$this->persistenceManager->getIdentifierByObject($notification)),
                $notifications,
            )),
            new NotificationListingMeta($total, $unread),
            ListingLinks::for($request, $offset, $limit, $total),
        );
    }

    #[Operation(
        path: '/notifications/read',
        method: 'POST',
        summary: 'Mark notifications read',
        description: 'Marks the caller\'s notifications with the IDs read, or all of them with all: true. IDs of notifications that don\'t exist or aren\'t the caller\'s are left alone, as are notifications that already are read.',
        operationId: 'markNotificationsRead',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::NOTIFICATIONS_UPDATE],
        ],
    )]
    public function markRead(
        #[AuthContext] ApiCaller $caller,
        #[RequestBody(description: 'Which notifications to mark read')] NotificationsMarkRead $selection,
    ): Forbidden|null {
        $user = $this->studioCallers->requireUserOf($caller);
        if (!$user instanceof User) {
            return $user;
        }
        $userId = $user->getId()->value;
        if ($selection->all === true) {
            $this->notificationRepository->markAllReadForUser($userId, new \DateTimeImmutable());
            return null;
        }
        foreach ($selection->ids ?? [] as $id) {
            $notification = $this->notificationRepository->findByIdentifier($id);
            // other users' notifications are treated as non-existent
            if ($notification instanceof Model\Notification && $notification->getUserId() === $userId) {
                $notification->markRead();
                $this->notificationRepository->update($notification);
            }
        }
        return null;
    }

    #[Operation(
        path: '/notifications',
        method: 'DELETE',
        summary: 'Clear your read notifications',
        description: 'Removes the caller\'s read notifications. Unread ones stay: one may have arrived since the caller last looked at the list.',
        operationId: 'clearReadNotifications',
        security: [
            ApiAuthContextProvider::SCOPES => [StudioScopes::NOTIFICATIONS_UPDATE],
        ],
    )]
    public function clearRead(#[AuthContext] ApiCaller $caller): Forbidden|null
    {
        $user = $this->studioCallers->requireUserOf($caller);
        if (!$user instanceof User) {
            return $user;
        }
        $this->notificationRepository->removeReadForUser($user->getId()->value);
        return null;
    }
}
