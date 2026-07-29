<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Repository;

use Doctrine\ORM\EntityManagerInterface;
use Medienreaktor\NeosStudio\Domain\Model\Notification;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Persistence\Repository;

#[Flow\Scope('singleton')]
class NotificationRepository extends Repository
{
    public const ENTITY_CLASSNAME = Notification::class;

    #[Flow\Inject]
    protected EntityManagerInterface $entityManager;

    /**
     * Newest first; unread ones only when $unreadOnly is set.
     *
     * @return array<Notification>
     */
    public function findByUser(string $userId, bool $unreadOnly = false, int $limit = 20, int $offset = 0): array
    {
        $query = $this->createQuery();
        $constraints = [$query->equals('userId', $userId)];
        if ($unreadOnly) {
            $constraints[] = $query->equals('readAt', null);
        }

        return $query
            ->matching($query->logicalAnd(...$constraints))
            ->setOrderings(['createdAt' => \Neos\Flow\Persistence\QueryInterface::ORDER_DESCENDING])
            ->setLimit($limit)
            ->setOffset($offset)
            ->execute()
            ->toArray();
    }

    public function countUnreadByUser(string $userId): int
    {
        $query = $this->createQuery();

        return $query->matching(
            $query->logicalAnd(
                $query->equals('userId', $userId),
                $query->equals('readAt', null)
            )
        )->count();
    }

    /**
     * Bulk-mark all unread notifications of the user as read; returns the
     * number of affected notifications. DQL because loading potentially many
     * entities just to stamp a timestamp is wasteful.
     */
    public function markAllReadForUser(string $userId, \DateTimeImmutable $now): int
    {
        return (int)$this->entityManager
            ->createQuery(sprintf('UPDATE %s n SET n.readAt = :now WHERE n.userId = :userId AND n.readAt IS NULL', Notification::class))
            ->setParameter('now', $now)
            ->setParameter('userId', $userId)
            ->execute();
    }

    /**
     * Housekeeping: remove notifications older than the given threshold.
     */
    public function removeOlderThan(\DateTimeImmutable $threshold): int
    {
        return (int)$this->entityManager
            ->createQuery(sprintf('DELETE FROM %s n WHERE n.createdAt < :threshold', Notification::class))
            ->setParameter('threshold', $threshold)
            ->execute();
    }
}
