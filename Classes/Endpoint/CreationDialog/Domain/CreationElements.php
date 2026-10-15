<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\CreationDialog\Domain;

use Neos\Api\Infrastructure\ContentRepository\InvalidPropertyValue;
use Neos\Api\Infrastructure\ContentRepository\PropertyValues;
use Neos\ContentRepository\Core\NodeType\NodeType;
use Neos\ContentRepository\Core\SharedModel\Node\NodeAggregateIds;
use Neos\Flow\Annotations as Flow;
use Neos\Media\Domain\Model\AssetInterface;
use Neos\Media\Domain\Repository\AssetRepository;

/**
 * The values of a creation dialog (the node type's ui.creationDialog.elements, promoted properties and references
 * included) as node creation handlers expect them, as the Neos UI's NodePropertyConversionService converts them
 *
 * Reference and references elements become NodeAggregateIds (one id or a list), elements named like a property are
 * converted as Neos.Api converts that property, the others by their type: dates (RFC 3339) and assets ({"id": "…"}),
 * everything else as given. Elements the node type doesn't declare and null values are left out, handlers find them
 * as given in NodeCreationElements::serialized()
 */
#[Flow\Scope('singleton')]
final readonly class CreationElements
{
    private const array DATE_TYPES = ['DateTime', '\DateTime', 'DateTimeImmutable', '\DateTimeImmutable', 'DateTimeInterface', '\DateTimeInterface'];

    public function __construct(
        private PropertyValues $propertyValues,
        private AssetRepository $assetRepository,
    ) {
    }

    /**
     * @param array<mixed> $values by element name
     * @return array<string, mixed>
     * @throws InvalidPropertyValue
     */
    public function convert(NodeType $nodeType, array $values): array
    {
        $declared = $nodeType->getConfiguration('ui.creationDialog.elements');
        $converted = [];
        foreach (is_array($declared) ? $declared : [] as $name => $configuration) {
            $name = (string)$name;
            $value = $values[$name] ?? null;
            if ($value === null) {
                continue;
            }
            $type = is_array($configuration) && is_string($configuration['type'] ?? null) ? $configuration['type'] : 'string';
            $converted[$name] = match (true) {
                $type === 'reference' || $type === 'references' => self::nodeAggregateIds($name, $value),
                $nodeType->hasProperty($name) => $this->propertyValues->toWrite($nodeType, [$name => $value])->values[$name],
                in_array($type, self::DATE_TYPES, true) => self::date($name, $value),
                is_a(ltrim($type, '\\'), AssetInterface::class, true) => $this->asset($name, $value),
                default => $value,
            };
        }
        return $converted;
    }

    /**
     * @throws InvalidPropertyValue
     */
    private static function nodeAggregateIds(string $name, mixed $value): NodeAggregateIds
    {
        $ids = match (true) {
            is_string($value) => $value !== '' ? [$value] : [],
            is_array($value) && array_is_list($value) => $value,
            default => throw new InvalidPropertyValue(sprintf('The element %s must be a node aggregate id or a list of them', $name)),
        };
        try {
            return NodeAggregateIds::fromArray($ids);
        } catch (\InvalidArgumentException | \TypeError $exception) {
            throw new InvalidPropertyValue(sprintf('The element %s must be a node aggregate id or a list of them: %s', $name, $exception->getMessage()));
        }
    }

    /**
     * @throws InvalidPropertyValue
     */
    private static function date(string $name, mixed $value): \DateTimeImmutable
    {
        foreach ([\DATE_RFC3339, \DATE_RFC3339_EXTENDED] as $format) {
            $date = is_string($value) ? \DateTimeImmutable::createFromFormat($format, $value) : false;
            if ($date !== false) {
                return $date;
            }
        }
        throw new InvalidPropertyValue(sprintf('The element %s must be a date as RFC 3339', $name));
    }

    /**
     * @throws InvalidPropertyValue
     */
    private function asset(string $name, mixed $value): AssetInterface
    {
        $asset = is_array($value) && is_string($value['id'] ?? null) ? $this->assetRepository->findByIdentifier($value['id']) : null;
        return $asset instanceof AssetInterface
            ? $asset
            : throw new InvalidPropertyValue(sprintf('The element %s must be an existing asset as {"id": "…"}', $name));
    }
}
