<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

/**
 * A task workspace cannot be deleted while a workspace based on it still
 * holds changes - deleting it would strand them on a base that is gone.
 */
final class TaskWorkspaceInUseException extends \RuntimeException
{
}
