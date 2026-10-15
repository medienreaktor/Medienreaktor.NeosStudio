<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\AccessRoles\Schema;

use Medienreaktor\NeosStudio\Domain\Model;
use Neos\JsonSchema\ArraySchema;
use Neos\JsonSchema\BooleanSchema;
use Neos\JsonSchema\ObjectSchema;
use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\JsonSchema\StringSchema;
use Neos\JsonSchema\Support\ObjectProperties;

/**
 * Where the members of an access role may work: sites, page tree, dimension
 * values, workspaces and capabilities. What isn't restricted is allowed
 *
 * The schema is written out: dimensionValues and capabilities are maps, which
 * schematic can't discover. Clients evaluate the same rules to shape their UI,
 * so they get the rules, not a verdict
 */
final readonly class AccessRoleConstraints implements ProvidesSchema
{
    /**
     * @param list<string> $siteNodeNames
     * @param list<array<string, mixed>> $nodeTreeRules
     * @param array<string, list<string>>|\stdClass $dimensionValues
     * @param list<string> $workspaceNames
     * @param array<string, bool>|\stdClass $capabilities
     */
    public function __construct(
        public array $siteNodeNames,
        public array $nodeTreeRules,
        public array|\stdClass $dimensionValues,
        public array $workspaceNames,
        public bool $allowPersonalWorkspace,
        public bool $allowPublishToLive,
        public bool $allowWorkspaceCreation,
        public array|\stdClass $capabilities,
    ) {
    }

    public static function from(Model\AccessRoleConstraints $constraints): self
    {
        return new self(
            array_values($constraints->siteNodeNames),
            array_map(static fn (Model\NodeTreeRule $rule) => $rule->jsonSerialize(), array_values($constraints->nodeTreeRules)),
            $constraints->dimensionValues === [] ? new \stdClass() : $constraints->dimensionValues,
            array_values($constraints->workspaceNames),
            $constraints->allowPersonalWorkspace,
            $constraints->allowPublishToLive,
            $constraints->allowWorkspaceCreation,
            $constraints->capabilities === [] ? new \stdClass() : $constraints->capabilities,
        );
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= ObjectSchema::create(
            description: 'Where the members of an access role may work. Every list or map left empty restricts nothing',
            properties: ObjectProperties::create(
                siteNodeNames: ArraySchema::create(
                    description: 'The node names of the sites they may work in, empty for every site',
                    items: StringSchema::create(examples: ['neosdemo']),
                ),
                nodeTreeRules: ArraySchema::create(
                    description: 'Documents they may (ALLOW) or may not (DENY) work in, empty for the whole page tree. With an ALLOW rule only the allowed branches are open; a DENY rule cuts a branch out of them',
                    items: ObjectSchema::create(
                        properties: ObjectProperties::create(
                            mode: StringSchema::create(enum: ['ALLOW', 'DENY']),
                            siteNodeName: StringSchema::create(description: 'The site the document belongs to'),
                            nodeAggregateId: StringSchema::create(description: 'The document'),
                            label: StringSchema::create(description: 'The label of the document when the rule was made'),
                            path: StringSchema::create(description: 'The labels of the document and its ancestors when the rule was made, for display'),
                            includeDescendants: BooleanSchema::create(description: 'false for the document alone, true for everything below it as well'),
                        ),
                        additionalProperties: false,
                        required: ['mode', 'siteNodeName', 'nodeAggregateId', 'label', 'path', 'includeDescendants'],
                    ),
                ),
                dimensionValues: ObjectSchema::create(
                    description: 'The values they may work in by dimension, a dimension left out allows every value',
                    examples: [['language' => ['de', 'en']]],
                    additionalProperties: ArraySchema::create(items: StringSchema::create()),
                ),
                workspaceNames: ArraySchema::create(
                    description: 'The shared workspaces they may use, empty for all',
                    items: StringSchema::create(examples: ['marketing']),
                ),
                allowPersonalWorkspace: BooleanSchema::create(description: 'Whether they may use their personal workspace'),
                allowPublishToLive: BooleanSchema::create(description: 'Whether they may publish to live'),
                allowWorkspaceCreation: BooleanSchema::create(description: 'Whether they may create shared workspaces'),
                capabilities: ObjectSchema::create(
                    description: 'The capabilities withheld from them (false), a capability left out is granted. The capabilities are listed by listAccessRoles and getMyAccess',
                    examples: [['deleteNodes' => false]],
                    additionalProperties: BooleanSchema::create(),
                ),
            ),
            additionalProperties: false,
            required: ['siteNodeNames', 'nodeTreeRules', 'dimensionValues', 'workspaceNames', 'allowPersonalWorkspace', 'allowPublishToLive', 'allowWorkspaceCreation', 'capabilities'],
        );
    }
}
