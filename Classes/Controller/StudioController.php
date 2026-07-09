<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller;

use Medienreaktor\NeosApi\Domain\Model\OAuthClient;
use Medienreaktor\NeosApi\Domain\Repository\OAuthClientRepository;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\Mvc\Controller\ActionController;
use Neos\Flow\Persistence\PersistenceManagerInterface;

/**
 * Serves the Neos Studio single-page application and lazily provisions its
 * first-party OAuth client (zero configuration for the operator).
 *
 * The shell requires a logged-in backend user (see Settings.yaml). Once
 * loaded, the SPA performs the authorization-code + PKCE flow against the
 * Medienreaktor.NeosApi endpoints; because its client is first-party, the
 * consent screen is skipped and the token is obtained silently.
 */
class StudioController extends ActionController
{
    private const CLIENT_IDENTIFIER = 'neos-studio';

    #[Flow\Inject]
    protected OAuthClientRepository $clientRepository;

    #[Flow\Inject]
    protected PersistenceManagerInterface $persistenceManager;

    /**
     * @var array<string, string>
     */
    #[Flow\InjectConfiguration(package: 'Medienreaktor.NeosApi', path: 'oauth.scopes')]
    protected array $apiScopes = [];

    public function indexAction(): string
    {
        $uri = $this->request->getHttpRequest()->getUri();
        $origin = $uri->getScheme() . '://' . $uri->getAuthority();
        $redirectUri = $origin . '/neos/studio';

        $this->ensureClient($redirectUri);

        $scopes = implode(' ', array_keys($this->apiScopes));
        $config = [
            'clientId' => self::CLIENT_IDENTIFIER,
            'authorizeEndpoint' => $origin . '/oauth/authorize',
            'tokenEndpoint' => $origin . '/oauth/token',
            'apiBase' => $origin . '/api',
            'redirectUri' => $redirectUri,
            'scopes' => $scopes,
        ];

        return $this->renderSpa($config);
    }

    private function ensureClient(string $redirectUri): void
    {
        $client = $this->clientRepository->findOneByIdentifier(self::CLIENT_IDENTIFIER);
        $scopes = array_keys($this->apiScopes);

        if ($client === null) {
            $client = new OAuthClient(
                self::CLIENT_IDENTIFIER,
                'Neos Studio',
                null, // public client, PKCE only
                [$redirectUri],
                ['authorization_code', 'refresh_token'],
                $scopes,
                true // first-party: skip consent
            );
            $this->clientRepository->add($client);
            $this->persistenceManager->persistAll();
            return;
        }

        // Keep the redirect URI in sync with the current origin (dev domains change)
        if (!in_array($redirectUri, $client->getRedirectUris(), true)) {
            $this->clientRepository->remove($client);
            $this->persistenceManager->persistAll();
            $client = new OAuthClient(
                self::CLIENT_IDENTIFIER,
                'Neos Studio',
                null,
                [$redirectUri],
                ['authorization_code', 'refresh_token'],
                $scopes,
                true
            );
            $this->clientRepository->add($client);
            $this->persistenceManager->persistAll();
        }
    }

    /**
     * @param array<string, string> $config
     */
    private function renderSpa(array $config): string
    {
        $this->response->setContentType('text/html');

        // Use Flow's resource:// stream wrapper - __DIR__ would point at the
        // compiled proxy class in the cache, not at the package.
        $indexFile = 'resource://Medienreaktor.NeosStudio/Public/Studio/index.html';
        $configScript = '<script>window.__NEOS_STUDIO__ = '
            . json_encode($config, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . ';</script>';

        if (!is_file($indexFile)) {
            return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Neos Studio</title>' . $configScript
                . '</head><body style="font-family:system-ui;max-width:40rem;margin:4rem auto">'
                . '<h1>Neos Studio is not built yet</h1>'
                . '<p>Run the frontend build in <code>DistributionPackages/Medienreaktor.NeosStudio</code>:</p>'
                . '<pre>npm install &amp;&amp; npm run build</pre>'
                . '<p>then flush caches and reload.</p></body></html>';
        }

        $html = (string)file_get_contents($indexFile);

        // Inject runtime config just before the first script/module tag
        return preg_replace('/<\/head>/', $configScript . '</head>', $html, 1) ?? $html;
    }
}
