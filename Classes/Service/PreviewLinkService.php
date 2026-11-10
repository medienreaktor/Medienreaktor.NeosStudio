<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Medienreaktor\NeosStudio\Domain\Model\PreviewLink;
use Medienreaktor\NeosStudio\Domain\Repository\PreviewLinkRepository;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAddress;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Security\Cryptography\HashService;
use Neos\Flow\Utility\Algorithms;
use Neos\Neos\Domain\Model\UserId;

/**
 * Lifecycle of shareable preview links: minting (secret generation + TTL
 * clamping), validation for the anonymous share endpoint, and revocation.
 *
 * The URL secret is 256 bits from the CSPRNG, transported base64url. Lookup
 * is by its SHA-256 hash - constant-time comparison is inherent (an attacker
 * without the secret cannot produce a colliding hash to probe with). So the
 * creator can copy a link again, the secret is also kept encrypted
 * (XSalsa20-Poly1305) under a key derived from Flow's encryption key: a
 * database dump or backup alone still reconstructs no working link - it
 * takes the key in Data/Persistent too. Rotating that key makes the stored
 * secrets unreadable, which only hides the URLs; the links keep working.
 */
#[Flow\Scope('singleton')]
class PreviewLinkService
{
    #[Flow\Inject]
    protected PreviewLinkRepository $previewLinkRepository;

    #[Flow\Inject]
    protected HashService $hashService;

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
     * Mint a link for one document. The secret is persisted only encrypted;
     * revealSecret() recovers it for the link's creator.
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
            $expiresAt,
            $this->encryptSecret($secret),
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

    /**
     * The URL secret of a link, or null when it can't be recovered: links
     * minted before secrets were kept, and ones encrypted under a since
     * rotated encryption key. Callers must have checked ownership.
     */
    public function revealSecret(PreviewLink $link): ?string
    {
        if ($link->tokenCiphertext === null) {
            return null;
        }
        $payload = base64_decode($link->tokenCiphertext, true);
        if ($payload === false || strlen($payload) <= SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) {
            return null;
        }
        $secret = sodium_crypto_secretbox_open(
            substr($payload, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES),
            substr($payload, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES),
            $this->secretKey()
        );
        // The hash check guards against a row whose ciphertext and hash
        // don't belong together: never hand out a URL that wouldn't work.
        if ($secret === false || !hash_equals($link->tokenHash, hash('sha256', $secret))) {
            return null;
        }

        return $secret;
    }

    private function encryptSecret(string $secret): string
    {
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);

        return base64_encode($nonce . sodium_crypto_secretbox($secret, $nonce, $this->secretKey()));
    }

    /**
     * 32 bytes derived from Flow's encryption key (via its HMAC, which is all
     * the HashService exposes of it), dedicated to this purpose by the label.
     */
    private function secretKey(): string
    {
        return hash('sha256', $this->hashService->generateHmac('Medienreaktor.NeosStudio:PreviewLinkSecret'), true);
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
