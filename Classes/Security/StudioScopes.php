<?php

declare(strict_types=1);

namespace Medienreaktor\NeosStudio\Security;

/**
 * The OAuth scopes of the Studio API, to be used in the operations' `security`
 * requirements with Neos.Api's ApiAuthContextProvider::SCOPES
 *
 * Each one is the matcher of a Neos\Api\Security\ApiPrivilege target in
 * Policy.yaml, which the account must hold as well (see Neos.Api's
 * PrivilegeScopes). All start with "studio.", their group on the consent page.
 */
final class StudioScopes
{
    public const string NOTIFICATIONS_READ = 'studio.notifications.read';
    public const string NOTIFICATIONS_UPDATE = 'studio.notifications.update';
    public const string PREVIEWLINKS_READ = 'studio.previewlinks.read';
    public const string PREVIEWLINKS_CREATE = 'studio.previewlinks.create';
    public const string PREVIEWLINKS_DELETE = 'studio.previewlinks.delete';
    public const string TASKS_READ = 'studio.tasks.read';
    public const string TASKS_UPDATE = 'studio.tasks.update';
    public const string TASKS_APPROVE = 'studio.tasks.approve';
    public const string ACCESS_READ = 'studio.access.read';
    public const string ACCESSROLES_READ = 'studio.accessroles.read';
    public const string ACCESSROLES_UPDATE = 'studio.accessroles.update';

    /**
     * The privilege target the shell asks for to show the role administration
     */
    public const string ACCESSROLES_UPDATE_PRIVILEGE = 'Medienreaktor.NeosStudio:Api.AccessRoles.Update';
}
