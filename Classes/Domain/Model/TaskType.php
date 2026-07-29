<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Domain\Model;

/**
 * The kind of task workspace. Deliberately OUR enum, not an extension of
 * Neos' WorkspaceClassification (which is a closed PHP enum): task workspaces
 * are ordinary SHARED workspaces to the Neos core, the type lives in this
 * package's sidecar metadata.
 */
enum TaskType: string
{
    /**
     * A short-lived editorial task, e.g. "update the pricing page"
     */
    case TASK = 'TASK';

    /**
     * A longer-lived feature branch collecting related changes for one release
     */
    case FEATURE = 'FEATURE';
}
