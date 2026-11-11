<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Tests\Unit\Security;

use Medienreaktor\NeosStudio\Domain\Model\AccessRole;
use Medienreaktor\NeosStudio\Domain\Model\AccessRoleConstraints;
use Medienreaktor\NeosStudio\Domain\Model\EffectiveAccess;
use Medienreaktor\NeosStudio\Security\AccessControlAuthProvider;
use Medienreaktor\NeosStudio\Service\AccessControlService;
use Neos\ContentRepository\Core\DimensionSpace\OriginDimensionSpacePoint;
use Neos\ContentRepository\Core\Feature\NodeModification\Command\SetNodeProperties;
use Neos\ContentRepository\Core\Feature\NodeModification\Dto\PropertyValuesToWrite;
use Neos\ContentRepository\Core\Feature\Security\AuthProviderInterface;
use Neos\ContentRepository\Core\Feature\Security\Dto\Privilege;
use Neos\ContentRepository\Core\Projection\ContentGraph\ContentGraphReadModelInterface;
use Neos\ContentRepository\Core\SharedModel\ContentRepository\ContentRepositoryId;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateId;
use Neos\ContentRepository\Core\SharedModel\Workspace\WorkspaceName;
use Neos\Neos\Domain\Service\WorkspaceService;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

/**
 * The provider only ever narrows what Neos' own provider granted. These pin
 * down the one case where it must not narrow at all: code running inside
 * SecurityContext::withoutAuthorizationChecks(). Neos runs the soft-removal
 * garbage collector that way after every publish, across all workspaces based
 * on live - applying the editor's roles there failed every publish of a
 * restricted editor after it had already been committed.
 */
final class AccessControlAuthProviderTest extends TestCase
{
    #[Test]
    public function rolesApplyWhileAuthorizationChecksAreEnabled(): void
    {
        $provider = $this->provider(authorizationChecksDisabled: false);

        self::assertFalse($provider->canExecuteCommand($this->editIn('translation'))->granted);
        self::assertTrue($provider->canExecuteCommand($this->editIn('entwurf'))->granted);
    }

    #[Test]
    public function rolesStayOutOfCodeRunningWithoutAuthorizationChecks(): void
    {
        $provider = $this->provider(authorizationChecksDisabled: true);

        self::assertTrue($provider->canExecuteCommand($this->editIn('translation'))->granted);
        self::assertTrue($provider->canReadNodesFromWorkspace(WorkspaceName::fromString('translation'))->granted);
    }

    private function provider(bool $authorizationChecksDisabled): AccessControlAuthProvider
    {
        $delegate = $this->createStub(AuthProviderInterface::class);
        $delegate->method('canExecuteCommand')->willReturn(Privilege::granted('granted by Neos'));
        $delegate->method('canReadNodesFromWorkspace')->willReturn(Privilege::granted('granted by Neos'));

        $now = new \DateTimeImmutable('2026-11-11 12:00:00');
        $entwurfOnly = EffectiveAccess::restrictedBy([
            new AccessRole('id', 'entwurf', 'Entwurf', '', AccessRoleConstraints::create(
                workspaceNames: ['entwurf'],
                allowPublishToLive: false,
            ), true, $now, $now),
        ]);

        $accessControlService = $this->createStub(AccessControlService::class);
        $accessControlService->method('isEnforcedInContentRepository')->willReturn(true);
        $accessControlService->method('authorizationChecksAreDisabled')->willReturn($authorizationChecksDisabled);
        $accessControlService->method('effectiveAccessForCurrentUser')->willReturn($entwurfOnly);
        $accessControlService->method('nodeContext')->willReturn([['some-node'], 'site']);

        return new AccessControlAuthProvider(
            ContentRepositoryId::fromString('default'),
            $delegate,
            $this->createStub(ContentGraphReadModelInterface::class),
            $accessControlService,
            // Final, and never asked: the read model knows no workspace, so the
            // provider classifies every one as UNKNOWN before reaching it, and
            // the workspace lists of the roles decide.
            (new \ReflectionClass(WorkspaceService::class))->newInstanceWithoutConstructor(),
            new NullLogger(),
        );
    }

    private function editIn(string $workspaceName): SetNodeProperties
    {
        return SetNodeProperties::create(
            WorkspaceName::fromString($workspaceName),
            NodeAggregateId::fromString('some-node'),
            OriginDimensionSpacePoint::fromArray(['language' => 'de']),
            PropertyValuesToWrite::fromArray(['title' => 'changed']),
        );
    }
}
