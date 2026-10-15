<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks\Response;

use Medienreaktor\NeosStudio\Endpoint\Tasks\Schema\TaskComment;
use Neos\OpenApi\Binding\TypeReference;
use Neos\OpenApi\Response\ApiResponse;
use Neos\OpenApi\Support\HttpStatusCode;
use Neos\OpenApi\Support\MediaTypeRange;

/**
 * A 201 with the new comment. No Location: a single comment can't be read, it
 * is in the task's comments
 */
final readonly class TaskCommentCreated implements ApiResponse
{
    public function __construct(
        private TaskComment $comment,
    ) {
    }

    public static function statusCode(): HttpStatusCode
    {
        return HttpStatusCode::fromInteger(201);
    }

    public static function description(): string
    {
        return 'The comment was added';
    }

    public static function bodyType(): TypeReference
    {
        return TypeReference::of(TaskComment::class);
    }

    public static function contentType(): MediaTypeRange
    {
        return MediaTypeRange::fromString('application/json');
    }

    public function body(): TaskComment
    {
        return $this->comment;
    }
}
