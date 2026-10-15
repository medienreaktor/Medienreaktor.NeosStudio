<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Endpoint\Tasks\Response;

use Medienreaktor\NeosStudio\Endpoint\Tasks\Schema\Task;
use Neos\Api\Shared\Response\Created;
use Neos\OpenApi\Binding\TypeReference;
use Neos\OpenApi\Response\ApiResponseWithHeaders;

/**
 * A 201 with the new task and where to find it
 */
final readonly class TaskCreated implements ApiResponseWithHeaders
{
    use Created;

    public function __construct(
        private Task $task,
    ) {
    }

    public static function description(): string
    {
        return 'The task was created';
    }

    public static function locationDescription(): string
    {
        return 'The URI of the new task, relative to the request URI';
    }

    public static function bodyType(): TypeReference
    {
        return TypeReference::of(Task::class);
    }

    public function body(): Task
    {
        return $this->task;
    }

    public function headers(): array
    {
        // resolved against POST …/tasks, this is …/tasks/{workspaceName}
        return ['Location' => 'tasks/' . $this->task->workspaceName->value];
    }
}
