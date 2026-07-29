<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Model;

use Doctrine\ORM\Mapping as ORM;
use Neos\Flow\Annotations as Flow;

/**
 * A notification addressed to a single Neos user, shown in the Studio shell's
 * notification bell.
 *
 * Notifications are produced by other packages through the
 * {@see \Medienreaktor\NeosStudio\Service\NotificationService} - the Studio
 * only stores and displays them. "type" is a producer-namespaced discriminator
 * (e.g. "taskWorkflow.assigned") clients may use to render specific
 * notification kinds differently; "payload" carries arbitrary structured data
 * for that purpose (e.g. a workspace name to link to).
 */
#[Flow\Entity]
#[ORM\Index(name: 'idx_notification_user_created', columns: ['userid', 'createdat'])]
#[ORM\Index(name: 'idx_notification_user_read', columns: ['userid', 'readat'])]
class Notification
{
    /**
     * The Neos UserId (Neos\Neos\Domain\Model\UserId) of the recipient
     */
    #[ORM\Column(length: 40)]
    protected string $userId;

    /**
     * Package key of the producing package, e.g. "Medienreaktor.NeosStudio" for the built-in task workflow
     */
    #[ORM\Column]
    protected string $source;

    /**
     * Producer-namespaced notification kind, e.g. "taskWorkflow.assigned"
     */
    #[ORM\Column]
    protected string $type;

    #[ORM\Column]
    protected string $title;

    #[ORM\Column(type: 'text')]
    protected string $message;

    /**
     * Arbitrary structured data for the notification type (string-keyed).
     * Note: plain "array" because Flow's ClassSchema cannot parse keyed
     * generics in entity property annotations.
     *
     * @var array
     */
    #[ORM\Column(type: 'json')]
    protected array $payload;

    #[ORM\Column]
    protected \DateTimeImmutable $createdAt;

    #[ORM\Column(nullable: true)]
    protected ?\DateTimeImmutable $readAt = null;

    /**
     * @param array<string, mixed> $payload
     */
    public function __construct(
        string $userId,
        string $source,
        string $type,
        string $title,
        string $message = '',
        array $payload = []
    ) {
        $this->userId = $userId;
        $this->source = $source;
        $this->type = $type;
        $this->title = $title;
        $this->message = $message;
        $this->payload = $payload;
        $this->createdAt = new \DateTimeImmutable();
    }

    public function getUserId(): string
    {
        return $this->userId;
    }

    public function getSource(): string
    {
        return $this->source;
    }

    public function getType(): string
    {
        return $this->type;
    }

    public function getTitle(): string
    {
        return $this->title;
    }

    public function getMessage(): string
    {
        return $this->message;
    }

    /**
     * @return array<string, mixed>
     */
    public function getPayload(): array
    {
        return $this->payload;
    }

    public function getCreatedAt(): \DateTimeImmutable
    {
        return $this->createdAt;
    }

    public function getReadAt(): ?\DateTimeImmutable
    {
        return $this->readAt;
    }

    public function markRead(): void
    {
        $this->readAt ??= new \DateTimeImmutable();
    }
}
