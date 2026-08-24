<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Model;

use Neos\Flow\Annotations as Flow;

/**
 * A dynamically created access role: a named bundle of restrictions
 * ({@see AccessRoleConstraints}) that administrators assign to backend users
 * in the Studio, without touching Policy.yaml or deploying anything.
 *
 * Deliberately NOT a Flow policy role. Flow roles are static configuration
 * read at compile time, and Neos 9 removed the node-level privilege targets
 * that a generated policy would have needed anyway - so an editable role
 * would have meant generating YAML into a package and flushing caches on
 * every save. Instead this is plain application data, evaluated at request
 * time by the {@see \Medienreaktor\NeosStudio\Service\AccessControlService}:
 * the Studio narrows its UI to it, and the content repository refuses writes
 * outside it (see the AccessControlAuthProvider). The Flow role a user has -
 * Editor, Administrator - keeps deciding *what kind* of thing they may do;
 * this decides *where*.
 *
 * Roles are additive: a user assigned several roles may do what any one of
 * them allows.
 */
#[Flow\Proxy(false)]
final readonly class AccessRole implements \JsonSerializable
{
    public function __construct(
        public string $id,
        /** URL-safe, stable, unique - the handle scripts and imports refer to. */
        public string $identifier,
        public string $label,
        public string $description,
        public AccessRoleConstraints $constraints,
        /** Inactive roles keep their members but stop restricting anything. */
        public bool $active,
        public \DateTimeImmutable $createdAt,
        public \DateTimeImmutable $updatedAt,
    ) {
    }

    /**
     * A URL-safe identifier derived from a label ("Redaktion Nord" ->
     * "redaktion-nord"), falling back to a generated one for labels that
     * consist purely of characters we drop (e.g. non-latin scripts).
     */
    public static function identifierFromLabel(string $label): string
    {
        $identifier = strtolower(trim($label));
        $identifier = preg_replace('/[^a-z0-9]+/u', '-', $identifier) ?? '';
        $identifier = trim($identifier, '-');

        return $identifier !== '' ? $identifier : 'role-' . substr(md5($label . microtime()), 0, 8);
    }

    public function withConstraints(AccessRoleConstraints $constraints, \DateTimeImmutable $now): self
    {
        return new self($this->id, $this->identifier, $this->label, $this->description, $constraints, $this->active, $this->createdAt, $now);
    }

    /**
     * @param array<int, string> $memberUserIds
     * @return array<string, mixed>
     */
    public function toArray(array $memberUserIds = []): array
    {
        return [
            'id' => $this->id,
            'identifier' => $this->identifier,
            'label' => $this->label,
            'description' => $this->description,
            'active' => $this->active,
            'restricting' => $this->constraints->isRestricting(),
            'constraints' => $this->constraints->jsonSerialize(),
            'memberUserIds' => array_values($memberUserIds),
            'createdAt' => $this->createdAt->format(\DateTimeInterface::ATOM),
            'updatedAt' => $this->updatedAt->format(\DateTimeInterface::ATOM),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function jsonSerialize(): array
    {
        return $this->toArray();
    }
}
