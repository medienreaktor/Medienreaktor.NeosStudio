<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Medienreaktor\NeosStudio\Domain\Model\PreviewLink;
use Medienreaktor\NeosStudio\Domain\Repository\PreviewLinkRepository;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAddress;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Utility\Algorithms;
use Neos\Neos\Domain\Model\UserId;

/**
 * Lifecycle of shareable preview links: minting (secret generation + TTL
 * clamping), validation for the anonymous share endpoint, and revocation.
 *
 * The URL secret is 256 bits from the CSPRNG, transported base64url; only
 * its SHA-256 hash is stored, so neither a database dump nor a backup can
 * reconstruct working links. Lookup is by hash - constant-time comparison
 * is inherent (an attacker without the secret cannot produce a colliding
 * hash to probe with).
 */
#[Flow\Scope('singleton')]
class PreviewLinkService
{
    #[Flow\Inject]
    protected PreviewLinkRepository $previewLinkRepository;

    /**
     * Interval spec (\DateInterval) applied when the client requests no TTL.
     */
    #[Flow\InjectConfiguration(path: 'previewLinks.defaultLifetime')]
    protected string $defaultLifetime;

    /**
     * Hard ceiling: requested TTLs are clamped, never rejected, so a client
     * asking for more silently gets the maximum.
     */
    #[Flow\InjectConfiguration(path: 'previewLinks.maxLifetime')]
    protected string $maxLifetime;

    /**
     * Mint a link for one document. The returned secret appears exactly once -
     * it is never persisted and cannot be retrieved again.
     *
     * @return array{link: PreviewLink, secret: string}
     */
    public function createLink(
        NodeAddress $nodeAddress,
        string $label,
        ?\DateInterval $requestedTtl,
        UserId $creator
    ): array {
        $now = new \DateTimeImmutable();
        // Piggyback garbage collection on the write path, mirroring the OAuth
        // token records - no cron needed for a table this small.
        $this->previewLinkRepository->removeExpired($now);

        $secret = $this->encodeBase64Url(random_bytes(32));
        $expiresAt = $this->clampExpiry($now, $requestedTtl);

        $link = new PreviewLink(
            Algorithms::generateUUID(),
            hash('sha256', $secret),
            $nodeAddress->contentRepositoryId,
            $nodeAddress->workspaceName,
            $nodeAddress->dimensionSpacePoint,
            $nodeAddress->aggregateId,
            $label,
            $creator,
            $now,
            $expiresAt
        );
        $this->previewLinkRepository->add($link);

        return ['link' => $link, 'secret' => $secret];
    }

    /**
     * Resolve a URL secret to its link - null for unknown, malformed and
     * expired tokens alike, so the share endpoint reveals nothing about
     * which of those it was.
     */
    public function validateToken(string $secret): ?PreviewLink
    {
        // 32 random bytes base64url-encode to exactly 43 characters; anything
        // else cannot be a minted secret, skip the hash + query.
        if (preg_match('/^[A-Za-z0-9_-]{43}$/', $secret) !== 1) {
            return null;
        }

        $link = $this->previewLinkRepository->findByTokenHash(hash('sha256', $secret));
        if ($link === null || $link->isExpired(new \DateTimeImmutable())) {
            return null;
        }

        return $link;
    }

    /**
     * The creator's active links (expired ones are collected on the fly).
     *
     * @return array<PreviewLink>
     */
    public function findLinksOf(UserId $creator): array
    {
        $now = new \DateTimeImmutable();

        return array_values(array_filter(
            $this->previewLinkRepository->findByCreator($creator),
            fn (PreviewLink $link) => !$link->isExpired($now)
        ));
    }

    /**
     * Revoke (delete) a link. Only the creator may: foreign and unknown ids
     * both report false, indistinguishably.
     */
    public function revokeLink(string $id, UserId $creator): bool
    {
        $link = $this->previewLinkRepository->findById($id);
        if ($link === null || !$link->createdByUserId->equals($creator)) {
            return false;
        }
        $this->previewLinkRepository->remove($id);

        return true;
    }

    private function clampExpiry(\DateTimeImmutable $now, ?\DateInterval $requestedTtl): \DateTimeImmutable
    {
        $maximum = $now->add(new \DateInterval($this->maxLifetime));
        $requested = $now->add($requestedTtl ?? new \DateInterval($this->defaultLifetime));

        return min($requested, $maximum);
    }

    private function encodeBase64Url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
