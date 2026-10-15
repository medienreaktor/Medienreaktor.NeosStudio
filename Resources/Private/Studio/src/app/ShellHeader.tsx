import { useState } from 'react'
import { useNodeVariants } from '@/api/neos/endpoints/nodes'
import type { Node, NodeAddress } from '@/api/neos/schema'
import type { EditingContext } from '@/app/useEditingContext'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { PresenceAvatars } from '@/features/collaboration/PresenceAvatars'
import { CreateVariantDialog } from '@/features/dimensions/CreateVariantDialog'
import { DimensionSwitcher } from '@/features/dimensions/DimensionSwitcher'
import { ModalLauncher } from '@/features/modals/ModalLauncher'
import { PreviewButton } from '@/features/preview/PreviewButton'
import { PreviewToolbar } from '@/features/preview/PreviewPane'
import { ShareButton } from '@/features/sharing/ShareButton'
import { SiteSwitcher } from '@/features/sites/SiteSwitcher'
import { PublishReviewButton } from '@/features/workspaces/PublishReviewButton'
import { SyncWorkspaceButton } from '@/features/workspaces/SyncWorkspaceButton'
import { WorkspaceSwitcher } from '@/features/workspaces/WorkspaceSwitcher'

/**
 * The bar over the main area: the site, dimension and workspace switchers,
 * the preview's controls and the publish entry point - plus the dialog for
 * creating a document variant the dimension switcher opens.
 */
export function ShellHeader({
  editing,
  document,
  onSelectSite,
  onChangeDimension,
  onVariantCreated,
  onReload,
  onSwitchEditingContext,
  onNavigate,
}: {
  editing: EditingContext
  /** The selected document. */
  document: Node | null
  onSelectSite: (nodeName: string) => void
  onChangeDimension: (point: string) => void
  /** A variant of the document now exists in this point - switch to it. */
  onVariantCreated: (point: string) => void
  /** Reload the preview, the trees and the inspector together. */
  onReload: () => void
  onSwitchEditingContext: (workspaceName: string | null) => void
  onNavigate: (address: NodeAddress, workspaceName: string) => void
}) {
  const {
    sites,
    site,
    workspaces,
    personalWorkspace,
    activeWorkspace,
    baseTargets,
    contentRepository,
    dimensions,
    allowedEditablePoints,
    dimensionSpacePoint,
  } = editing
  // Set when the user picked a dimension the selected document does not exist
  // in - the create-variant dialog is open for this target point.
  const [variantRequest, setVariantRequest] = useState<string | null>(null)
  // Where the selected document exists; drives the switcher's muted "+" items.
  const { data: documentVariants } = useNodeVariants(document)

  return (
    // Fixed height so the bar does not jump as the switchers and workspace
    // buttons resolve and render after load.
    <header className="@container flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <SidebarTrigger />
          <ModalLauncher />
        </div>
        {sites.length > 0 && activeWorkspace && dimensionSpacePoint && (
          <SiteSwitcher
            sites={sites}
            workspaceName={activeWorkspace.name}
            dimensionSpacePoint={dimensionSpacePoint}
            value={site?.nodeName ?? null}
            onChange={onSelectSite}
          />
        )}
        {dimensions.length > 0 && dimensionSpacePoint && (
          <DimensionSwitcher
            dimensions={dimensions}
            // The configuration's full set, so values it rules out still read
            // as "does not exist" - the access-restricted ones render locked
            // instead.
            allowedPoints={contentRepository?.dimensionSpacePoints ?? []}
            permittedPoints={allowedEditablePoints}
            value={dimensionSpacePoint}
            documentCoverage={
              document
                ? documentVariants?.meta.coveredDimensionSpacePoints
                : undefined
            }
            onCreateVariant={setVariantRequest}
            onChange={onChangeDimension}
          />
        )}
        {/* Preview + Share as one split button; gap-px splits the segments
            with a hairline of header background. */}
        {document && (
          <div className="flex gap-px">
            <PreviewButton document={document} className="rounded-r-none" />
            <ShareButton document={document} className="rounded-l-none" />
          </div>
        )}

        <PreviewToolbar document={document} onReload={onReload} />
      </div>
      <div className="flex items-center gap-2">
        <PresenceAvatars />
        {personalWorkspace && activeWorkspace && baseTargets.length > 0 && (
          <WorkspaceSwitcher
            personalWorkspace={personalWorkspace}
            activeWorkspace={activeWorkspace}
            targets={baseTargets}
            onSwitchEditingContext={onSwitchEditingContext}
          />
        )}
        {activeWorkspace && (
          <>
            <SyncWorkspaceButton workspaceName={activeWorkspace.name} />
            <PublishReviewButton
              workspaces={workspaces}
              activeWorkspace={activeWorkspace}
              onNavigate={onNavigate}
            />
          </>
        )}
      </div>

      {variantRequest && document && activeWorkspace && (
        <CreateVariantDialog
          document={document}
          targetPoint={variantRequest}
          dimensions={dimensions}
          workspaceName={activeWorkspace.name}
          onCancel={() => setVariantRequest(null)}
          onCreated={(point) => {
            setVariantRequest(null)
            onVariantCreated(point)
          }}
        />
      )}
    </header>
  )
}
