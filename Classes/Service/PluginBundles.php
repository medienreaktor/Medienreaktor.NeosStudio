<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Service;

/**
 * The plugin bundles configured under Medienreaktor.NeosStudio.plugins, as
 * both places that load them read them: the shell (StudioController:
 * `javascript`, `stylesheet`) and the edit-mode preview (PreviewController:
 * `guestJavascript`, a plugin's rich text extensions for inline editing).
 */
final class PluginBundles
{
    /**
     * The configured plugins in load order: explicit `position` ascending,
     * then configuration order.
     *
     * @param array<string, array{javascript?: string, guestJavascript?: string, stylesheet?: string, position?: int}>|null $plugins
     * @return array<string, array{javascript?: string, guestJavascript?: string, stylesheet?: string, position?: int}>
     */
    public static function sorted(?array $plugins): array
    {
        $plugins = $plugins ?? [];
        uasort($plugins, static function (array $a, array $b): int {
            return ((int)($a['position'] ?? 100)) <=> ((int)($b['position'] ?? 100));
        });
        return $plugins;
    }

    /**
     * Turn a `resource://<Package>/Public/<path>` URI into the published web
     * URI (`/_Resources/Static/Packages/<Package>/<path>`), cache-busted by
     * the file's mtime. Returns null when the referenced file is not present -
     * a plugin whose frontend has not been built is skipped rather than
     * emitting a 404, so the page still loads.
     */
    public static function resourceUri(mixed $resourcePath): ?string
    {
        if (!is_string($resourcePath) || !is_file($resourcePath)) {
            return null;
        }
        if (!preg_match('#^resource://([^/]+)/Public/(.+)$#', $resourcePath, $matches)) {
            return null;
        }
        return '/_Resources/Static/Packages/' . $matches[1] . '/' . $matches[2]
            . '?v=' . filemtime($resourcePath);
    }
}
