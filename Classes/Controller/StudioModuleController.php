<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller;

use Neos\Flow\Mvc\Routing\UriBuilder;
use Neos\Neos\Controller\Module\AbstractModuleController;

/**
 * Backend module entry point for Neos Studio.
 *
 * The backend menu always links modules to /neos/module/<path>, and module
 * responses are normally embedded into the backend module chrome — but the
 * Studio SPA is a complete standalone page. ModuleController passes responses
 * carrying a Location header through unwrapped, so this controller simply
 * redirects to the Studio shell route.
 */
class StudioModuleController extends AbstractModuleController
{
    public function indexAction()
    {
        $uriBuilder = new UriBuilder();
        $uriBuilder->setRequest($this->request->getMainRequest());
        $this->redirectToUri($uriBuilder->uriFor('index', [], 'Studio', 'Medienreaktor.NeosStudio'));
    }
}
