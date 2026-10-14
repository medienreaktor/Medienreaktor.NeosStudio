<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

use Neos\ContentRepository\Core\Factory\ContentRepositoryServiceFactoryDependencies;
use Neos\ContentRepository\Core\Factory\ContentRepositoryServiceFactoryInterface;

/**
 * Builds the {@see WorkspaceEventFeed} with access to the content
 * repository's event store (via ContentRepositoryRegistry::buildService()).
 *
 * @implements ContentRepositoryServiceFactoryInterface<WorkspaceEventFeed>
 */
final class WorkspaceEventFeedFactory implements ContentRepositoryServiceFactoryInterface
{
    public function build(ContentRepositoryServiceFactoryDependencies $serviceFactoryDependencies): WorkspaceEventFeed
    {
        return new WorkspaceEventFeed($serviceFactoryDependencies->eventStore);
    }
}
