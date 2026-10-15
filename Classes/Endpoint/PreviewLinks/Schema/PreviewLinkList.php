<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\PreviewLinks\Schema;

use Neos\JsonSchema\ProvidesSchema;
use Neos\JsonSchema\Schema;
use Neos\Schematic\Discovery\AutoDiscoveringSchema;

/**
 * A list of preview links
 *
 * @implements \IteratorAggregate<PreviewLink>
 */
final readonly class PreviewLinkList implements ProvidesSchema, \IteratorAggregate
{
    /**
     * @var list<PreviewLink>
     */
    public array $previewLinks;

    public function __construct(PreviewLink ...$previewLinks)
    {
        $this->previewLinks = array_values($previewLinks);
    }

    public static function schema(): Schema
    {
        static $schema = null;
        return $schema ??= AutoDiscoveringSchema::analyze(self::class);
    }

    public function getIterator(): \Traversable
    {
        yield from $this->previewLinks;
    }
}
