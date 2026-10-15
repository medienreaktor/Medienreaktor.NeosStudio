<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Notifications\Schema;

use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * A list of notifications
 *
 * @implements \IteratorAggregate<Notification>
 */
final readonly class NotificationList implements ProvidesSchema, \IteratorAggregate
{
    /**
     * @var list<Notification>
     */
    public array $notifications;

    public function __construct(Notification ...$notifications)
    {
        $this->notifications = array_values($notifications);
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }

    public function getIterator(): \Traversable
    {
        yield from $this->notifications;
    }
}
