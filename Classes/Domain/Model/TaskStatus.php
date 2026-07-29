<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Model;

/**
 * Workflow state of a task workspace. These are editorial *intents* - the
 * content repository knows nothing about them; publishing is the only
 * transition with a content-level effect (and DONE is also set by the
 * lifecycle hook when a task workspace gets published outside this package).
 */
enum TaskStatus: string
{
    case OPEN = 'OPEN';
    case IN_REVIEW = 'IN_REVIEW';
    case DONE = 'DONE';
}
