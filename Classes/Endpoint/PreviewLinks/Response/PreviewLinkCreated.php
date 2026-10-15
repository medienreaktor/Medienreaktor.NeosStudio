<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\PreviewLinks\Response;

use Medienreaktor\NeosStudio\Endpoint\PreviewLinks\Schema\NewPreviewLink;
use Neos\OpenApi\Binding\TypeReference;
use Neos\OpenApi\Response\ApiResponse;
use Neos\OpenApi\Support\HttpStatusCode;
use Neos\OpenApi\Support\MediaTypeRange;

/**
 * A 201 with the new preview link and its share URL. No Location: a single
 * link can't be read, it is in the list of the caller's links
 */
final readonly class PreviewLinkCreated implements ApiResponse
{
    public function __construct(
        private NewPreviewLink $previewLink,
    ) {
    }

    public static function statusCode(): HttpStatusCode
    {
        return HttpStatusCode::fromInteger(201);
    }

    public static function description(): string
    {
        return 'The preview link was created, this is the only response with its share URL';
    }

    public static function bodyType(): TypeReference
    {
        return TypeReference::of(NewPreviewLink::class);
    }

    public static function contentType(): MediaTypeRange
    {
        return MediaTypeRange::fromString('application/json');
    }

    public function body(): NewPreviewLink
    {
        return $this->previewLink;
    }
}
