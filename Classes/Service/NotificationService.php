<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Medienreaktor\NeosStudio\Domain\Model\Notification;
use Medienreaktor\NeosStudio\Domain\Repository\NotificationRepository;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Persistence\PersistenceManagerInterface;
use Neos\Neos\Domain\Model\User;
use Neos\Neos\Domain\Model\UserId;
use Neos\Neos\Domain\Service\UserService;

/**
 * Public API for producing Studio notifications - the extension point other
 * packages plug into: call notify() (or one of the fan-out variants) and the
 * notification appears in the recipient's Studio notification bell.
 *
 * Persistence follows Flow's normal request lifecycle (persistAll on
 * shutdown). Producers running outside of it (long-running workers) can call
 * flush() explicitly.
 */
#[Flow\Scope('singleton')]
class NotificationService
{
    #[Flow\Inject]
    protected NotificationRepository $notificationRepository;

    #[Flow\Inject]
    protected PersistenceManagerInterface $persistenceManager;

    #[Flow\Inject]
    protected UserService $userService;

    /**
     * @param array<string, mixed> $payload
     */
    public function notify(UserId $userId, string $source, string $type, string $title, string $message = '', array $payload = []): Notification
    {
        $notification = new Notification($userId->value, $source, $type, $title, $message, $payload);
        $this->notificationRepository->add($notification);

        return $notification;
    }

    /**
     * @param iterable<UserId> $userIds
     * @param array<string, mixed> $payload
     */
    public function notifyUsers(iterable $userIds, string $source, string $type, string $title, string $message = '', array $payload = []): void
    {
        $seen = [];
        foreach ($userIds as $userId) {
            if (isset($seen[$userId->value])) {
                continue;
            }
            $seen[$userId->value] = true;
            $this->notify($userId, $source, $type, $title, $message, $payload);
        }
    }

    /**
     * Notify every user who effectively has the given Flow role (directly
     * assigned or inherited through the role hierarchy), e.g. all
     * "Vendor.Site:SuperEditor"s. Optionally excluding some users (typically
     * the actor causing the notification).
     *
     * @param array<UserId> $excludedUserIds
     * @param array<string, mixed> $payload
     */
    public function notifyUsersWithRole(string $roleIdentifier, string $source, string $type, string $title, string $message = '', array $payload = [], array $excludedUserIds = []): void
    {
        $excluded = array_map(static fn (UserId $id) => $id->value, $excludedUserIds);
        $recipients = [];
        /** @var User $user */
        foreach ($this->userService->getUsers() as $user) {
            $userId = $user->getId();
            if (in_array($userId->value, $excluded, true) || !$this->userHasRole($user, $roleIdentifier)) {
                continue;
            }
            $recipients[] = $userId;
        }
        $this->notifyUsers($recipients, $source, $type, $title, $message, $payload);
    }

    /**
     * Persist pending notifications immediately - only needed outside Flow's
     * normal request lifecycle.
     */
    public function flush(): void
    {
        $this->persistenceManager->persistAll();
    }

    private function userHasRole(User $user, string $roleIdentifier): bool
    {
        foreach ($user->getAccounts() as $account) {
            foreach ($account->getRoles() as $role) {
                if ($role->getIdentifier() === $roleIdentifier) {
                    return true;
                }
                foreach ($role->getAllParentRoles() as $parentRole) {
                    if ($parentRole->getIdentifier() === $roleIdentifier) {
                        return true;
                    }
                }
            }
        }

        return false;
    }
}
