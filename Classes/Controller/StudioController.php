<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Controller;

use Medienreaktor\NeosApi\Domain\Model\OAuthClient;
use Medienreaktor\NeosApi\Domain\Repository\OAuthClientRepository;
use Neos\Flow\Annotations as Flow;
use Neos\Flow\I18n\Locale;
use Neos\Flow\I18n\Translator;
use Neos\Flow\Mvc\Controller\ActionController;
use Neos\Flow\Persistence\PersistenceManagerInterface;
use Neos\Neos\Controller\Backend\MenuHelper;
use Neos\Neos\Service\UserService;

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

    #[Flow\Inject]
    protected UserService $userService;

    /**
     * @var array<string, string>
     */
    #[Flow\InjectConfiguration(package: 'Medienreaktor.NeosApi', path: 'oauth.scopes')]
    protected array $apiScopes = [];

    /**
     * Studio respects the same tree-depth preferences as the classic Neos
     * backend (Neos.Neos.userInterface.navigateComponent.*.loadingDepth).
     * Untyped: configuration injection may yield null if the path is absent.
     */
    #[Flow\InjectConfiguration(package: 'Neos.Neos', path: 'userInterface.navigateComponent.nodeTree.loadingDepth')]
    protected $nodeTreeLoadingDepth;

    #[Flow\InjectConfiguration(package: 'Neos.Neos', path: 'userInterface.navigateComponent.structureTree.loadingDepth')]
    protected $structureTreeLoadingDepth;

    /**
     * Third-party plugin bundles to load into the shell. Each package that
     * extends the Studio contributes an entry here (see Settings.yaml for the
     * schema); the SPA build itself has no knowledge of them.
     *
     * @var array<string, array{javascript?: string, stylesheet?: string, position?: int}>
     */
    #[Flow\InjectConfiguration(path: 'plugins')]
    protected array $plugins = [];

    /**
     * WebSocket URL of the optional realtime sidecar (see "The realtime
     * sidecar" in the package README). Untyped: absent configuration injects
     * null.
     */
    #[Flow\InjectConfiguration(path: 'realtime.websocketUrl')]
    protected $realtimeWebsocketUrl;

    /**
     * Whether the shell offers the classic backend modules in a menu next to
     * the logo. Untyped: absent configuration injects null.
     */
    #[Flow\InjectConfiguration(path: 'enableLegacyModules')]
    protected $enableLegacyModules;

    #[Flow\Inject]
    protected MenuHelper $menuHelper;

    #[Flow\Inject]
    protected Translator $translator;

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
            'previewBase' => $origin . '/neos/studio/preview',
            'redirectUri' => $redirectUri,
            'scopes' => $scopes,
            'nodeTree' => [
                'loadingDepth' => (int)($this->nodeTreeLoadingDepth ?? 4),
            ],
            'structureTree' => [
                // 0 means unlimited, per the Neos.Neos setting's contract
                'loadingDepth' => (int)($this->structureTreeLoadingDepth ?? 4),
            ],
            // Label translations: the SPA loads the core's XLIFF-as-JSON
            // bundle for the backend user's interface language at boot.
            'interfaceLanguage' => $this->userService->getInterfaceLanguage(),
            // The user's UI mode preference (same value /me/profile serves),
            // injected so the shell can theme itself before the first API
            // roundtrip. Schema-less preference array: coerce out-of-range
            // values to the dark default.
            'uiMode' => $this->uiMode(),
            'xliffEndpoint' => $origin . '/neos/xliff.json',
            // The classic backend logout (POST, session-authenticated): ends
            // the Flow session the shell and the silent OAuth flow ride on.
            'logoutEndpoint' => $origin . '/neos/logout',
            // Optional realtime sidecar; null keeps collaboration on HTTP
            // polling (no extra infrastructure required).
            'realtime' => [
                'url' => is_string($this->realtimeWebsocketUrl) && $this->realtimeWebsocketUrl !== ''
                    ? $this->realtimeWebsocketUrl
                    : null,
            ],
            // The classic backend modules for the legacy-modules menu; empty
            // unless enableLegacyModules is set (the shell hides the menu).
            'legacyModules' => $this->legacyModules(),
        ];

        return $this->renderSpa($config);
    }

    /**
     * The backend user's Studio UI mode ("light" | "dark" | "system"), read
     * from the same `studio.uiMode` user preference the /me/profile endpoint
     * manages. Dark is the Studio default.
     */
    private function uiMode(): string
    {
        $uiMode = $this->userService->getUserPreference('studio.uiMode');

        return in_array($uiMode, ['light', 'dark', 'system'], true) ? $uiMode : 'dark';
    }

    /**
     * The classic backend modules for the shell's legacy-modules menu: the
     * same privilege-filtered list the old UI's menu shows, built by the core
     * MenuHelper from the Neos.Neos.modules settings. Labels are translated
     * here (into the backend user's interface language) so the SPA renders
     * them as-is - unlike the Studio's own labels they can come from any
     * package/source and are not guaranteed to be in the XLIFF bundle the
     * shell loads.
     *
     * @return array<int, array{label: string, icon: string, uri: string, submodules: array<int, array{label: string, icon: string, uri: string}>}>
     */
    private function legacyModules(): array
    {
        if ($this->enableLegacyModules !== true) {
            return [];
        }

        $moduleList = $this->menuHelper->buildModuleList($this->controllerContext);

        // 'studio' and 'content' are folded into a synthesized "Content"
        // group heading the menu (see below) instead of appearing as two
        // top-level entries.
        $modules = [];
        $contentGroup = $this->contentGroup($moduleList);
        if ($contentGroup['submodules'] !== []) {
            $modules[] = $contentGroup;
        }
        foreach ($moduleList as $moduleName => $module) {
            if ($moduleName === 'studio' || $moduleName === 'content' || $module['hideInMenu'] === true) {
                continue;
            }
            $submodules = [];
            foreach ($module['submodules'] as $submodule) {
                if ($submodule['hideInMenu'] === true) {
                    continue;
                }
                $submodules[] = [
                    'label' => $this->translateModuleLabel((string)$submodule['label']),
                    'icon' => (string)$submodule['icon'],
                    'uri' => (string)$submodule['uri'],
                ];
            }
            $modules[] = [
                'label' => $this->translateModuleLabel((string)$module['label']),
                'icon' => (string)$module['icon'],
                'uri' => (string)$module['uri'],
                'submodules' => $submodules,
            ];
        }

        return $modules;
    }

    /**
     * The "Content" group heading the legacy-modules menu: "Neos Studio"
     * (this shell's own backend-module entry) plus "Legacy UI" - the classic
     * content module, present only when Neos.Neos.Ui is installed (it
     * registers 'content') and the user's privileges grant it.
     *
     * @param array<string, array<string, mixed>> $moduleList
     * @return array{label: string, icon: string, uri: string, submodules: array<int, array{label: string, icon: string, uri: string}>}
     */
    private function contentGroup(array $moduleList): array
    {
        $submodules = [];
        $studioModule = $moduleList['studio'] ?? null;
        if ($studioModule !== null && $studioModule['hideInMenu'] !== true) {
            $submodules[] = [
                'label' => $this->translateModuleLabel((string)$studioModule['label']),
                'icon' => (string)$studioModule['icon'],
                'uri' => (string)$studioModule['uri'],
            ];
        }
        $contentModule = $moduleList['content'] ?? null;
        if ($contentModule !== null && $contentModule['hideInMenu'] !== true) {
            $submodules[] = [
                'label' => $this->translateModuleLabel('Medienreaktor.NeosStudio:Main:app.legacyUi'),
                'icon' => (string)$contentModule['icon'],
                'uri' => (string)$contentModule['uri'],
            ];
        }

        return [
            // The same label the classic UI's content module carries; it
            // lives in Neos.Neos, so it resolves without Neos.Neos.Ui too.
            'label' => $this->translateModuleLabel('Neos.Neos:Main:content'),
            'icon' => '',
            'uri' => (string)($studioModule['uri'] ?? $contentModule['uri'] ?? ''),
            'submodules' => $submodules,
        ];
    }

    /**
     * Resolve a "Package:Source:trans.unit.id" module label in the backend
     * user's interface language; plain strings (and unresolvable ids) pass
     * through unchanged.
     */
    private function translateModuleLabel(string $label): string
    {
        $parts = explode(':', $label, 3);
        if (count($parts) !== 3) {
            return $label;
        }
        try {
            return $this->translator->translateById(
                $parts[2],
                [],
                null,
                new Locale($this->userService->getInterfaceLanguage()),
                $parts[1],
                $parts[0]
            ) ?? $label;
        } catch (\Exception) {
            return $label;
        }
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

        // Keep the redirect URI and the allowed scopes in sync: dev domains
        // change, and newly configured scopes (e.g. neos.media) must propagate
        // to the existing first-party client or the Studio can never request them.
        $redirectUriChanged = !in_array($redirectUri, $client->getRedirectUris(), true);
        $scopesChanged = array_values($client->getAllowedScopes()) !== array_values($scopes);
        if ($redirectUriChanged || $scopesChanged) {
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
     * @param array<string, mixed> $config
     */
    private function renderSpa(array $config): string
    {
        $this->response->setContentType('text/html');
        // Without explicit caching headers Safari heuristically caches the
        // shell - and with it the reference to a hashed bundle that no longer
        // exists after the next deploy (or, worse, a stale bundle it also
        // cached). The shell must always be fetched fresh; the hashed assets
        // it references cache themselves just fine.
        $this->response->setHttpHeader('Cache-Control', 'private, no-store');

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

        [$pluginStyles, $pluginScripts] = $this->pluginTags();

        // Inject runtime config (and any plugin stylesheets) into <head>...
        $html = preg_replace('/<\/head>/', $configScript . $pluginStyles . '</head>', $html, 1) ?? $html;

        // ...and plugin scripts just before </body>. They are deferred
        // `type="module"` tags placed after the shell's own module, so the
        // shell installs its React + plugin API globals and mounts first, then
        // each plugin registers into the live (observable) registries.
        return preg_replace('/<\/body>/', $pluginScripts . '</body>', $html, 1) ?? $html;
    }

    /**
     * Build the <link> and <script> tags for the configured plugin bundles.
     *
     * @return array{0: string, 1: string} [head stylesheet tags, body script tags]
     */
    private function pluginTags(): array
    {
        $plugins = $this->plugins;
        // Stable order: explicit `position` ascending, then package key.
        uasort($plugins, static function (array $a, array $b): int {
            return ((int)($a['position'] ?? 100)) <=> ((int)($b['position'] ?? 100));
        });

        $styles = '';
        $scripts = '';
        foreach ($plugins as $plugin) {
            $stylesheet = $plugin['stylesheet'] ?? null;
            if (is_string($stylesheet) && ($uri = $this->resourceUri($stylesheet)) !== null) {
                $styles .= '<link rel="stylesheet" href="' . htmlspecialchars($uri, ENT_QUOTES) . '">';
            }
            $javascript = $plugin['javascript'] ?? null;
            if (is_string($javascript) && ($uri = $this->resourceUri($javascript)) !== null) {
                $scripts .= '<script type="module" src="' . htmlspecialchars($uri, ENT_QUOTES) . '"></script>';
            }
        }

        return [$styles, $scripts];
    }

    /**
     * Turn a `resource://<Package>/Public/<path>` URI into the published web
     * URI (`/_Resources/Static/Packages/<Package>/<path>`), cache-busted by
     * the file's mtime. Returns null when the referenced file is not present -
     * a plugin whose frontend has not been built is skipped rather than
     * emitting a 404, so the shell still loads.
     */
    private function resourceUri(string $resourcePath): ?string
    {
        if (!is_file($resourcePath)) {
            return null;
        }
        if (!preg_match('#^resource://([^/]+)/Public/(.+)$#', $resourcePath, $matches)) {
            return null;
        }
        return '/_Resources/Static/Packages/' . $matches[1] . '/' . $matches[2]
            . '?v=' . filemtime($resourcePath);
    }
}
