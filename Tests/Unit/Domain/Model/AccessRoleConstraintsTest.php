<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Tests\Unit\Domain\Model;

use Medienreaktor\NeosStudio\Domain\Model\AccessRole;
use Medienreaktor\NeosStudio\Domain\Model\AccessRoleConstraints;
use Medienreaktor\NeosStudio\Domain\Model\EffectiveAccess;
use Medienreaktor\NeosStudio\Domain\Model\NodeTreeRule;
use Neos\Flow\Tests\UnitTestCase;

/**
 * The access-role rule semantics. Pure logic with no Flow dependencies, and
 * the part of the feature where a mistake is invisible until someone is
 * wrongly locked out (or wrongly let in) - so it is pinned down here rather
 * than left to be discovered in an editorial workflow.
 *
 * The client re-implements the very same rules to shape its UI (see
 * Resources/Private/Studio/src/api/accessRoles.ts); changes here need to land
 * there too.
 */
class AccessRoleConstraintsTest extends UnitTestCase
{
    /**
     * @test
     */
    public function emptyConstraintsRestrictNothing(): void
    {
        $constraints = AccessRoleConstraints::unrestricted();

        self::assertTrue($constraints->allowsSite('some-site'));
        self::assertTrue($constraints->allowsNodePath(['node', 'site']));
        self::assertTrue($constraints->allowsDimensionSpacePoint(['language' => 'de']));
        self::assertTrue($constraints->allowsCapability('editNodes'));
        self::assertFalse($constraints->isRestricting());
    }

    /**
     * @test
     */
    public function allowRulesTurnThePageTreeIntoAWhitelist(): void
    {
        $constraints = AccessRoleConstraints::create(nodeTreeRules: [
            NodeTreeRule::create('ALLOW', 'site', 'branch'),
        ]);

        self::assertTrue($constraints->allowsNodePath(['branch', 'site']));
        self::assertTrue($constraints->allowsNodePath(['page', 'branch', 'site']));
        self::assertFalse($constraints->allowsNodePath(['elsewhere', 'site']));
    }

    /**
     * @test
     */
    public function withoutAllowRulesTheRestOfTheTreeStaysOpen(): void
    {
        $constraints = AccessRoleConstraints::create(nodeTreeRules: [
            NodeTreeRule::create('DENY', 'site', 'secret'),
        ]);

        self::assertFalse($constraints->allowsNodePath(['secret', 'site']));
        self::assertFalse($constraints->allowsNodePath(['below', 'secret', 'site']));
        self::assertTrue($constraints->allowsNodePath(['elsewhere', 'site']));
    }

    /**
     * The combination the page-tree editor is built around: grant a branch,
     * cut one page out of it.
     *
     * @test
     */
    public function theNearestRuleWins(): void
    {
        $constraints = AccessRoleConstraints::create(nodeTreeRules: [
            NodeTreeRule::create('ALLOW', 'site', 'branch'),
            NodeTreeRule::create('DENY', 'site', 'secret'),
        ]);

        self::assertTrue($constraints->allowsNodePath(['page', 'branch', 'site']));
        self::assertFalse($constraints->allowsNodePath(['secret', 'branch', 'site']));
        self::assertFalse($constraints->allowsNodePath(['below', 'secret', 'branch', 'site']));
    }

    /**
     * @test
     */
    public function aRuleWithoutDescendantsCoversOnlyItsOwnNode(): void
    {
        $constraints = AccessRoleConstraints::create(nodeTreeRules: [
            NodeTreeRule::create('DENY', 'site', 'page', includeDescendants: false),
        ]);

        self::assertFalse($constraints->allowsNodePath(['page', 'site']));
        self::assertTrue($constraints->allowsNodePath(['child', 'page', 'site']));
    }

    /**
     * @test
     */
    public function dimensionsNotMentionedByAPointCannotViolateItsRestriction(): void
    {
        $constraints = AccessRoleConstraints::create(dimensionValues: ['language' => ['de']]);

        self::assertTrue($constraints->allowsDimensionSpacePoint(['language' => 'de']));
        self::assertFalse($constraints->allowsDimensionSpacePoint(['language' => 'en']));
        self::assertTrue($constraints->allowsDimensionSpacePoint(['market' => 'b2b']));
    }

    /**
     * @test
     */
    public function anEmptyValueListIsNoRestrictionAtAll(): void
    {
        $constraints = AccessRoleConstraints::create(dimensionValues: ['language' => []]);

        self::assertTrue($constraints->allowsDimensionSpacePoint(['language' => 'en']));
        self::assertFalse($constraints->isRestricting());
    }

    /**
     * @test
     */
    public function rootWorkspacesStayReadableEvenForNarrowRoles(): void
    {
        $constraints = AccessRoleConstraints::create(
            workspaceNames: ['review'],
            allowPersonalWorkspace: false,
        );

        // Live has to stay readable or the frontend breaks for the members.
        self::assertTrue($constraints->allowsWorkspaceRead('live', 'ROOT'));
        self::assertTrue($constraints->allowsWorkspaceRead('review', 'SHARED'));
        self::assertFalse($constraints->allowsWorkspaceRead('campaign', 'SHARED'));
        self::assertFalse($constraints->allowsWorkspaceRead('user-jane', 'PERSONAL'));
    }

    /**
     * The distinction the whole workspace restriction rests on: being able to
     * SEE live is not being allowed to WORK in it.
     *
     * @test
     */
    public function aNarrowedListExcludesLiveFromEditingEvenThoughItStaysReadable(): void
    {
        $constraints = AccessRoleConstraints::create(workspaceNames: ['review']);

        self::assertTrue($constraints->allowsWorkspaceRead('live', 'ROOT'));
        self::assertFalse($constraints->allowsWorkspaceEditing('live', 'ROOT'));
        self::assertTrue($constraints->allowsWorkspaceEditing('review', 'SHARED'));
        self::assertFalse($constraints->allowsWorkspaceEditing('campaign', 'SHARED'));
    }

    /**
     * @test
     */
    public function anEmptyWorkspaceListLeavesEvenLiveEditable(): void
    {
        $constraints = AccessRoleConstraints::unrestricted();

        self::assertTrue($constraints->allowsWorkspaceEditing('live', 'ROOT'));
        self::assertTrue($constraints->allowsWorkspaceEditing('anything', 'SHARED'));
    }

    /**
     * @test
     */
    public function onlyWithheldCapabilitiesArePersisted(): void
    {
        $constraints = AccessRoleConstraints::create(capabilities: [
            'deleteNodes' => false,
            'editNodes' => true,
        ]);

        self::assertFalse($constraints->allowsCapability('deleteNodes'));
        self::assertTrue($constraints->allowsCapability('editNodes'));
        // Unknown names are granted, so adding a capability never
        // retroactively takes something away from an existing role.
        self::assertTrue($constraints->allowsCapability('somethingAddedLater'));
        self::assertEquals((object)['deleteNodes' => false], $constraints->jsonSerialize()['capabilities']);
    }

    /**
     * @test
     */
    public function constraintsSurviveAJsonRoundTrip(): void
    {
        $constraints = AccessRoleConstraints::create(
            siteNodeNames: ['site'],
            nodeTreeRules: [NodeTreeRule::create('ALLOW', 'site', 'branch', 'Branch', 'Site / Branch')],
            dimensionValues: ['language' => ['de']],
            workspaceNames: ['review'],
            allowPublishToLive: false,
            capabilities: ['deleteNodes' => false],
        );

        self::assertSame(
            $constraints->toJsonString(),
            AccessRoleConstraints::fromJsonString($constraints->toJsonString())->toJsonString()
        );
    }

    /**
     * @test
     */
    public function rolesAreAdditiveButEvaluatedPerRole(): void
    {
        $first = $this->role(AccessRoleConstraints::create(
            siteNodeNames: ['first'],
            nodeTreeRules: [NodeTreeRule::create('ALLOW', 'first', 'branch-a')],
        ));
        $second = $this->role(AccessRoleConstraints::create(
            siteNodeNames: ['second'],
            nodeTreeRules: [NodeTreeRule::create('ALLOW', 'second', 'branch-b')],
        ));
        $access = EffectiveAccess::restrictedBy([$first, $second]);

        self::assertTrue($access->allowsSite('first'));
        self::assertTrue($access->allowsSite('second'));
        self::assertFalse($access->allowsSite('third'));

        self::assertTrue($access->allowsNode(['branch-a', 'root'], 'first'));
        // The branch the OTHER role grants must not become reachable through
        // this role's site - that is what "per role" buys.
        self::assertFalse($access->allowsNode(['branch-b', 'root'], 'first'));
    }

    /**
     * @test
     */
    public function noAssignedRoleMeansUnrestricted(): void
    {
        self::assertTrue(EffectiveAccess::restrictedBy([])->unrestricted);
    }

    /**
     * @test
     */
    public function identifiersAreDerivedFromTheLabel(): void
    {
        self::assertSame('editors-north', AccessRole::identifierFromLabel('Editors North!'));
        self::assertSame('redaktion-nord', AccessRole::identifierFromLabel('  Redaktion  Nord  '));
    }

    private function role(AccessRoleConstraints $constraints): AccessRole
    {
        $now = new \DateTimeImmutable('2026-08-24 12:00:00');

        return new AccessRole('id', 'identifier', 'Label', '', $constraints, true, $now, $now);
    }
}
