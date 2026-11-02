# Hard removals cannot be published per site or document on Neos 9.2

| | |
|---|---|
| Status | **Proposed** - open for discussion, nothing merged |
| Date | 2026-09-29 |
| Affects | `medienreaktor/neos-api` (the write API) and every client that sends `RemoveNodeAggregate`. The Studio UI itself is not affected, it already soft-deletes. |
| Found on | pyvot-website: neos/neos 9.2.0-beta4, neos/neos-ui 9.2.0-beta3, neos-api 1.14.4, while seeding content through the API |
| Patch | `2026-09-29-neosapi-soft-removal-on-neos-9.2.patch` next to this file, `git format-patch` against neos-api 1.14.4 (`a027b7b`); not pushed anywhere |

## What happens

A workspace contains a hard removal (`RemoveNodeAggregate` sent through `POST /api/commands`). Publishing that workspace with a site filter (`POST /api/workspaces/{ws}/publish` with `{"site": "..."}`, which calls `WorkspacePublishingService::publishChangesInSite()`) leaves the removal pending. If the removal is the only change, the publish fails:

```
POST /api/workspaces/admin-admin/publish {"site": "f3cf19b5-..."}
409 {"error": "operation_failed",
     "error_description": "The command \"PublishIndividualNodesFromWorkspace\" for workspace admin-admin must contain nodes to publish"}
hasPublishableChanges=true pendingChanges=1
```

The same removal published without a site filter goes through. The same deletion issued as `TagSubtree {"tag": "removed"}` also publishes fine with the site filter (`200 {"publishedChanges": 1}`). Document-scoped publishes and discards are affected the same way, they use the same scoping.

## Why

Neos scopes a publish or discard by walking up from each changed node to its site or document:

- Neos 9.2, `Neos.Neos/Classes/Domain/Service/WorkspacePublishingService.php:389-415`, `isChangePublishableWithinAncestorScope()`: `findClosestNode($change->nodeAggregateId, ...)` in the workspace subgraph with `VisibilityConstraints::createEmpty()`. A soft-removed node is still in the graph (tag `removed`) and is found. A hard-removed node is gone, the lookup returns `null`, the change matches no site and no document.
- Neos 9.1 used `$change->getLegacyRemovalAttachmentPoint() ?? $change->nodeAggregateId` for that lookup. The attachment point (the closest document, captured at removal time) travelled from the command through the event into the pending-changes projection. neos-api 1.14 auto-fills it (`CommandsController::resolveRemovalAttachmentPoint()`), which is what keeps hard removals scopable on 9.1.
- Neos 9.2 dropped the attachment point from the command, the event, the `Change` model and `ChangeProjection::whenNodeAggregateWasRemoved()`. `RemoveNodeAggregate::fromArray()` (`neos/contentrepository-core/Classes/Feature/NodeRemoval/Command/RemoveNodeAggregate.php:59-67`) reads exactly four keys; a `removalAttachmentPoint` in the payload is ignored without a warning. So the API's auto-fill is a no-op on 9.2.

Neos itself no longer hard-removes inside a workspace, for exactly this reason:

- `Neos.Neos/Classes/Domain/SubtreeTagging/NeosSubtreeTag.php`, docblock of `removed()`: "Issuing 'hard' removals via RemoveNodeAggregate on a non-live workspace is not desired in Neos and comes with complications: hard removals destroy all hierarchy information immediately, making it impossible to locate where a removal took place [...] Associating content changes with its document is important when publishing via publishChangesInDocument()".
- `Neos.Neos.Ui/Classes/Domain/Model/Changes/Remove.php:61-67`: the classic UI's delete dispatches `TagSubtree::create(..., NeosSubtreeTag::removed())`.
- The Studio does the same: `Resources/Private/Studio/src/features/editing/nodeActions.ts`, `deleteNodes()`, sends `TagSubtree` with `tag: 'removed'`. The API README documents deleting as a soft removal, too.

## Who is affected

Only API clients that send `RemoveNodeAggregate` into a workspace on Neos 9.2. In our case that is a seed script; it currently works around the gap by publishing the whole workspace without a site filter. Studio editors are not affected. Root workspaces (live) are not affected either: nothing is published from them.

## Options

### A. Execute `RemoveNodeAggregate` as a soft removal in Neos 9.2 workspaces (the patch)

`CommandsController` translates a `RemoveNodeAggregate` into `TagSubtree(removed)` when the target workspace has a base workspace and the running Neos has no attachment point (`LegacyRemovalAttachmentPoint::isSupported()`, a `method_exists` gate on `Change`). Root workspaces keep the hard removal, Neos 9.1 keeps everything as it is. The response echoes the requested type `RemoveNodeAggregate`, shape unchanged.

Consequences:

- Scoped publish and discard work again; deletions appear in the trash and are restorable; live keeps the node tagged `removed` until the soft-removal garbage collector erases it (`Neos.Neos.softRemoval.garbageCollectionGracePeriod`, default `P7D`). Normal reads answer 404 in the meantime, `?includeDeleted=1` shows the node.
- The API does something other than what the client asked for. A client that expects the node to be erased immediately (for example one that re-creates a node under the same aggregate id right away) will see `SubtreeIsAlreadyTagged` or a still-existing node.
- A second `RemoveNodeAggregate` on the same node answers 422 `command_failed` (`SubtreeIsAlreadyTagged`); before it was 422 for a missing node.
- **Access control changes.** `Classes/Security/AccessControlAuthProvider.php:246-253` maps `RemoveNodeAggregate` to the `deleteNodes` privilege but `TagSubtree` to `editNodes`. The auth provider sees the dispatched command, so on 9.2 a `RemoveNodeAggregate` in a workspace would only require `editNodes`. That is already the case for every Studio deletion today (the Studio sends `TagSubtree`), which raises the question whether `deleteNodes` should guard `TagSubtree(removed)` as well, independent of this decision.
- Verified locally on 9.2 (see Reproduction); 9.1 only by reading the code (`isRootWorkspace()`, `TagSubtree::create()` with five arguments and `NeosSubtreeTag::removed()` exist there). Multi-dimensional repositories not tested; the translation passes `coveredDimensionSpacePoint` and `nodeVariantSelectionStrategy` through unchanged.

### B. Keep the hard removal, document the limitation

No code change beyond the docblock corrections. The README and the OpenAPI description state that on 9.2 a hard removal in a workspace can only be published or discarded together with the whole workspace, and that clients should send `TagSubtree(removed)`.

Consequences: the API stays literal (a removal is a removal). Every client that deletes and publishes per site or document on 9.2 has to change to `TagSubtree`, or its deletions get stuck. The auto-filled `removalAttachmentPoint` stays in the code as a 9.1-only feature.

### C. Reject `RemoveNodeAggregate` in workspaces on 9.2

Answer 422 with a message pointing to `TagSubtree(removed)`, unless the target is a root workspace.

Consequences: explicit instead of silent; no privilege drift; the same client migration as B, but the client learns about it on the first call instead of at publish time. A breaking change for 9.2 setups, so a major release or at least a prominent changelog entry.

### D. Re-implement the scoping in the API's publish and discard actions

Resolve the document and site of a deleted change ourselves (with the base workspace as fallback, as `WorkspaceReadContext::closestDocumentAndSite()` already does for listings) and publish with `PublishIndividualNodesFromWorkspace` directly.

Rejected: duplicates about 60 lines of core logic, depends on `@internal` classes (`SoftRemovalGarbageCollector`), and still cannot attribute a node that was created and hard-removed in the same workspace (no base to fall back to).

## Recommendation

A, with two additions to discuss: the response could name the executed command (for example `"executedAs": "TagSubtree"`) so the substitution is visible to clients, and `deleteNodes` should probably guard `TagSubtree(removed)` in the Studio's auth provider regardless of A, because a soft delete is a delete for the editor.

The reasoning: Neos 9.2 has one deletion model in workspaces, and the API's own README already prescribes it. Keeping a second model alive only for API clients means keeping a path that the content repository can no longer publish correctly. B and C push the migration to every client; A keeps existing clients working and changes only what they could not do anyway (publish that removal per site).

If we prefer C for the sake of explicitness, the patch's `CommandsController` change is the part to replace; the `LegacyRemovalAttachmentPoint` gate and the docblock corrections stay useful either way.

## Open questions

1. A, B or C? (D is out.)
2. Should the response expose the executed command type?
3. Should `deleteNodes` cover `TagSubtree(removed)` in `AccessControlAuthProvider`? Today `editNodes` is enough for a soft delete from any client, Studio included.
4. Versioning: a behaviour change of an existing command on one Neos version. Minor with a changelog entry, or major?
5. Should 9.1 move to the same model (soft removal, drop the attachment point auto-fill) so the API behaves identically on both versions?

## Reproduction

Against a ddev instance on Neos 9.2 with the API client credentials, in the personal workspace of the API user (base `live`, no pending changes):

1. `POST /api/commands` `CreateNodeAggregateWithNode` for a content node below the site's `main` collection, then `POST /api/workspaces/{ws}/publish` with `{"site": "<siteAggregateId>"}` - 200, node is in live.
2. `POST /api/commands` `RemoveNodeAggregate` for that node (`coveredDimensionSpacePoint: {}`, `nodeVariantSelectionStrategy: "allVariants"`).
3. `GET /api/workspaces/{ws}/changes` lists one row `{"deleted": true, "document": ..., "site": ...}` (the document and site come from the base-workspace fallback of the listing, not from the content repository).
4. `POST /api/workspaces/{ws}/publish` with `{"site": "<siteAggregateId>"}` - **409 operation_failed**, workspace still has one pending change. Without the site filter: 200.
5. Repeat 1 to 4 with `TagSubtree {"tag": "removed"}` instead of step 2: the site-filtered publish answers 200, `publishedChanges: 1`, workspace clean.

With the patch applied, step 2 (`RemoveNodeAggregate`) behaves like step 5: `GET /api/nodes/{address}?includeDeleted=1` shows the node with `tags: ["removed"]`, the site-filtered publish answers 200, live holds the node tagged `removed` until the garbage collector runs.

## Found on the way: hard removals can resurrect nodes on Neos 9.2

Reproduced on neos/neos 9.2.0-beta4 (neos/contentgraph-doctrinedbaladapter 9.2.0-beta4; the code on the `9.2` branch head is the same). It affects every option above, because every deletion ends as a hard removal in live sooner or later.

The 9.2 graph projection stores hierarchy relations in **content stream layers**. A content stream reads a stack of layers and writes into its top one; when a workspace forks from live and live's write layer already holds rows, live gets a fresh write layer and the fork shares the old ones (`DoctrineDbalContentGraphProjection::whenContentStreamWasForked()`). A change to a row that lives in a lower layer is copy-on-write: the row is copied into the write layer (`SubtreeTagging::addSubtreeTag()`, property changes that re-point the relation to a new node row). A removal of a row from a lower layer writes a tombstone (a row with the same id and NULL columns) into the write layer.

The bug is in `Domain/Projection/Feature/NodeRemoval.php`, `removeRelationRecursivelyFromDatabaseIncludingNonReferencedNodes()`: when the relation found for the removed node sits in the write layer, the row is deleted physically, without checking whether the same relation id also exists in a lower layer of the stream. If it does (the write-layer row was a copy-on-write copy), the lower row becomes visible again: the node is back, with the state it had before the copy.

Two sequences, both verified against the database (`cr_default_p_graph_hierarchyrelation`, `id` / `contentstreamlayer`):

1. Create node, publish (row in live's write layer). Rebase or create any workspace (live's row is now in a lower layer, live has a new write layer). Soft-remove via `TagSubtree(removed)`, publish (copy with the tag in the write layer). `RemoveNodeAggregate` on live: the tagged copy is deleted, the untagged lower row shows through. Result: the node is visible again in live and in every workspace, tag gone.
2. Same start. `SetNodeProperties` on live (copy in the write layer pointing to the new node row). `RemoveNodeAggregate` on live: the copy is deleted, the node reappears with its old properties.

A second `RemoveNodeAggregate` then finds the lower row and writes the tombstone, so the node disappears for good. A removal in a fresh workspace (whose write layer never held the row) is correct on the first try, which is why the neos-api patch above behaved correctly in its tests.

Consequences:

- `SoftRemovalGarbageCollector` runs at every publish and discard (`WorkspacePublishingService`, `WorkspaceService`) and erases published soft removals older than the grace period (`Neos.Neos.softRemoval.garbageCollectionGracePeriod`, default `P7D`) with `RemoveNodeAggregate` on live. Because the workspace that published the soft removal is forked from live again right afterwards, live's write layer usually rotates before the collector runs, and the removal then writes a tombstone correctly. The resurrection needs the collector to run in the same layer epoch as the tag copy: a grace period of zero, or a hard removal issued directly on live (an API client, a migration, a cleanup script) before any fork happened. That is exactly what happened to our test node.
- Any client that edits and hard-removes the same node within one workspace epoch, or publishes such a pair, resurrects the old version of the node. Our seed script (`update.mjs`) must never set properties on a node it removes in the same run.
- For the decision above it strengthens A and C over B: hard removals from API clients on 9.2 should stay out of workspaces until the core fix lands. The fix itself belongs upstream (tombstone instead of physical delete when a lower layer still holds the relation id); we should report it with the two sequences.
