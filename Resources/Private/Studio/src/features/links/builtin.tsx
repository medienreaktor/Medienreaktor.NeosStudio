import { translate as t } from '@/lib/i18n'
import { isAssetUri, isDocumentUri } from './linkValue'
import { linkEditorRegistry } from './registry'
import { AssetLinkTab } from './tabs/AssetLinkTab'
import { DocumentLinkTab } from './tabs/DocumentLinkTab'
import { EmailLinkTab } from './tabs/EmailLinkTab'
import { ExternalLinkTab } from './tabs/ExternalLinkTab'

export const DOCUMENT_LINK_TYPE = 'document'
export const ASSET_LINK_TYPE = 'asset'
export const EXTERNAL_LINK_TYPE = 'external'
export const EMAIL_LINK_TYPE = 'email'

/**
 * Register the built-in link types. Called once before the app mounts,
 * exactly like a third-party plugin would register its own link type (a tab
 * for an external data source) from its entry point.
 */
export function registerBuiltinLinkTypes(): void {
  linkEditorRegistry.register({
    id: DOCUMENT_LINK_TYPE,
    label: t('link.document', 'Document'),
    icon: <i className="fas fa-file-lines" aria-hidden />,
    component: DocumentLinkTab,
    matches: isDocumentUri,
  })
  linkEditorRegistry.register({
    id: ASSET_LINK_TYPE,
    label: t('link.media', 'Media'),
    icon: <i className="fas fa-paperclip" aria-hidden />,
    component: AssetLinkTab,
    matches: isAssetUri,
  })
  linkEditorRegistry.register({
    id: EXTERNAL_LINK_TYPE,
    label: t('link.external', 'External'),
    icon: <i className="fas fa-globe" aria-hidden />,
    component: ExternalLinkTab,
    matches: (href) => /^https?:\/\//i.test(href),
    // Any href no type recognizes shows here verbatim, editable.
    isFallback: true,
  })
  linkEditorRegistry.register({
    id: EMAIL_LINK_TYPE,
    label: t('link.email', 'E-Mail'),
    icon: <i className="fas fa-envelope" aria-hidden />,
    component: EmailLinkTab,
    matches: (href) => /^mailto:/i.test(href),
  })
}
